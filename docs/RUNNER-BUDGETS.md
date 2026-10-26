# Budgets durables du runner — livrable local

Implémentation locale du 23 septembre 2026, après [Escrow v7](ESCROW-V7.md). Aucun registre de production n’a été initialisé, aucun tarif activé, aucune transaction publique envoyée et Phala reste arrêté. Le [branchement v7](BILLING-INTEGRATION.md) est désormais implémenté localement avec réservation du parcours avant émission du devis.

Le [business plan](BUSINESS-PLAN.md) distingue budgets prévisionnels, recettes et financement. Aucune enveloppe proposée, prestation espérée ou simulation de marge n'est une valeur comptable à injecter dans le registre.

**Activation bloquée :** les [correctifs locaux de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) réconcilient les transactions confirmées et libèrent le budget des devis expirés jamais verrouillés. La [deuxième passe](RECOVERY-OPERATIONS.md) ajoute la reprise d’un résultat perdu par Next, un journal chiffré, la rediffusion identique bornée et les outils de sauvegarde/diagnostic. Une coupure avant checkpoint runner, un PnL positif et le crypto-shredding des anciennes sauvegardes restent hors garantie.

## Ce que le code impose

Le registre SQLite du runner réside dans un **répertoire privé du disque persistant de la CVM**, distinct de la base PostgreSQL de Next. `BEGIN IMMEDIATE`, WAL et `synchronous=FULL` rendent les admissions atomiques entre processus utilisant **le même fichier sur un disque local**. Node 22.13+ est requis. Un registre absent, illisible, remplacé, lié à une autre chaîne ou un autre wallet bloque les opérations. Le service ne crée jamais lui-même un registre vide.

La politique du registre contient une référence comptable, une échéance et des montants entiers en micro-USD : marge déjà acquise après charges antérieures, liquidités disponibles, réserve de frais fixes/arrêt, maxima par requête, ingestion et entraînement. Elle contient aussi les plafonds ETH cumulés/par transaction, unités de gas, prix du gas, borne prudente ETH/USD, confirmations et nombre maximal d’échecs/réservations simultanées.

```text
plafond disponible = min(marge acquise, liquidités) - réserve fixe - coûts maximaux déjà alloués
admission seulement si plafond disponible >= nouveau coût maximal
```

Les dépôts escrow, montants dus aux providers, apports et tokens testnet ne sont pas des revenus Sirius. Le registre **n’importe pas encore une comptabilité vérifiée** : l’opérateur doit justifier les chiffres et la borne de conversion avec `accountingReference`. Aucune recette future n’est anticipée. Une marge initiale nulle refuse les dépenses, même avec un wallet financé. Les bornes doivent couvrir les coûts complets de chaque opération ; les valeurs de tests ne sont ni une grille commerciale ni des budgets à appliquer.

- Chaque appel de `handleRunnerOp`, y compris le fallback en processus, réserve le coût maximal d’une requête. En v7, les grants et devis sont vérifiés avant d’utiliser les requêtes déjà réservées pour le prêt. L’ingestion et les deux types d’entraînement réservent en plus leur exposition avant déchiffrement/calcul/upload. Les contrôles de portée on-chain restent obligatoires avant l’entraînement d’un emprunt.
- Les résultats d'entraînement terminés (CID et métriques) sont persistés : la reprise du même job ne réentraîne ni ne repinne le modèle. Le résultat du scellement, qui contient `wrappedKey`, n'est plus mis en cache ; l'ouverture du registre purge les anciens résultats actifs de scellement et tronque le WAL. Aucun plaintext, DEK en clair, master key ou préimage n’est enregistré dans ce registre. Les sauvegardes antérieures et leurs copies ne sont pas purgées par ce code ; un scellement dont la réponse est perdue ne se rejoue pas automatiquement.
- Un job déjà engagé ne redémarre pas après erreur ou crash. Les réservations incertaines ne périment pas. Les requêtes de reprise consomment néanmoins leur propre budget de traitement ; l’épuisement peut donc suspendre aussi les livraisons via le runner.
- Succès et échecs ne recréditent aucun maximum alloué. Seul un devis expiré, jamais verrouillé et sans opération libère sa réservation après vérification on-chain. Cette comptabilité conservatrice limite les admissions ; **elle ne mesure pas les frais facturables au borrower**. Elle ne permet aucune retenue v7 à elle seule : la mesure d’exécution est enregistrée séparément.
- Les échecs ouvrent un coupe-circuit persistant au seuil configuré. Les prêts v7 conservent leurs budgets déjà affectés, dans les limites du nombre de requêtes et tentatives. Les succès, changements de jour et redémarrages ne remettent aucun compteur à zéro.
- Les téléchargements/upload IPFS sont bornés à 8 Mio de blob chiffré et 20 secondes ; les réponses de métadonnées upload à 64 Kio. Les dépassements ne déclenchent pas de reprise automatique.

## Règlement et wallet gas

Une seule intention de transaction peut être ouverte pour le wallet dans ce registre, même pour deux prêts/contrats différents. Le maximum ETH par transaction et son équivalent USD arrondi vers le haut sont réservés avant préparation. Le code contrôle réseau RPC, compte dérivé, contrat configuré, méthode `release` ou reçu final v7 `recordExecution`, calldata reconstruite et valeur ETH nulle. Il refuse un solde ETH inférieur à la réservation, une estimation de gas trop élevée ou un prix au-dessus de la borne.

La transaction EIP-1559 est signée localement avec nonce `pending`, gas borné, `maxFeePerGas` plafonné et pourboire nul. Son hash et son nonce sont persistés **avant** `sendRawTransaction`. La transaction signée est scellée sous AES-256-GCM dans le registre avant l’envoi. Deux rediffusions identiques au maximum sont possibles après 30 secondes, sans remplacement, hausse de frais ni nouveau nonce. Préimage, calldata et transaction brute ne sont jamais stockés en clair ni inclus dans les messages d’erreur.

Une perte de réponse ou un timeout conserve l’intention. Avant un nouvel envoi, le runner réconcilie indépendamment du statut du prêt les transactions en attente : hash, compte, contrat, nonce, calldata, bloc canonique et confirmations configurées. Un revert consomme la tentative et compte comme échec. Une réservation sans hash, donc sans envoi possible, est déclarée échouée lors d'une réconciliation après cinq minutes. Le maximum alloué reste consommé après succès ou revert.

La réconciliation d'une transaction confirmée après timeout est testée localement. Une transaction introuvable après les rediffusions permises ou une réorganisation non résolue garde l’intention réservée ; aucun nouveau nonce n’est autorisé automatiquement.

Un crash entre réservation et persistance du hash bloque l'envoi pendant cinq minutes ; la prochaine réconciliation clôt ensuite la réservation sans hash en échec. Les commandes `runner:transactions reconcile` et `rebroadcast` réconcilient ou rediffusent les intentions existantes, sans nouveau nonce ni réapprovisionnement du registre. Ne pas le supprimer, le recréer ou modifier son SQL pour contourner cet arrêt. La réconciliation opérateur devra prouver l’état des intentions avant toute évolution du budget. La réconciliation par hash est possible avec une politique périmée dans l’adaptateur ; une requête HTTP peut toutefois être refusée plus tôt par son propre budget épuisé.

Les remboursements à échéance et retraits pull-only restent exécutables directement sur les contrats sans service runner. Aucun débit de trésorerie, indemnisation automatique, swap ou recharge du wallet n’est ajouté.

## Configuration locale et préparation d’activation

Les commandes manipulent uniquement un fichier local explicitement fourni :

```bash
pnpm runner:budget init /chemin/prive/budget.sqlite /chemin/politique.json
pnpm runner:budget inspect /chemin/prive/budget.sqlite /chemin/politique.json
```

Le répertoire doit préexister en `0700`, le fichier est créé en `0600` avec création exclusive : `init` refuse tout fichier existant. `inspect` lit les compteurs et la politique persistée ; il ne recharge pas la politique depuis le JSON. Les champs complets sont définis par `BudgetPolicy` dans `src/lib/runner/budget-ledger.ts`. `validUntil` est un timestamp Unix en millisecondes. `maxActive` doit couvrir les requêtes et leurs sous-opérations réservées simultanément.

`RUNNER_BUDGET_FILE` désigne ce fichier ; `SIRIUS_LOCK_AUTHORIZER` doit désigner le wallet opérationnel attendu. Le budget est obligatoire en production, en mode Phala et sur mainnet. Le développement/test synthétique v6 en mode stub sur testnet peut fonctionner sans registre ; les devis et prêts v7 l’exigent également dans cet environnement. Le mode bootstrap HTTP reste sans opérations métier et n’exige pas de budget.

L’image suivante devra inclure ce code et l’outil `scripts/runner-budget.ts`. Lors d’une future activation autorisée, préparer le répertoire privé dans le volume persistant existant, transmettre `RUNNER_BUDGET_FILE` au conteneur et refaire les mesures d’attestation. Le compose actuellement épinglé et la CVM arrêtée n’ont pas été modifiés. L’initialisation d’un registre réel exige d’abord la validation des coûts et de la marge ; aucune valeur positive de démonstration ne doit servir de financement fictif.

## Limites avant exploitation réelle

Le [suivi de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) détaille les correctifs locaux. Avant exploitation, résoudre ou borner les risques restants : coupure avant checkpoint runner, transaction encore introuvable après les reprises, finalité du réseau cible, anciennes sauvegardes contenant `wrappedKey`, restauration du volume et coûts réels. Les conditions financières et d'infrastructure ci-dessous restent indépendantes de ces correctifs.

Cette brique **ne garantit pas encore un PnL non négatif**. Restent nécessaires :

- Une source comptable réconciliée et la calibration du barème réel. V7 réserve désormais un entraînement, 16 requêtes et deux transactions jusqu’à clôture ; v6 conserve les allocations par opération. Voir [les garanties et limites de cette réservation](BILLING-INTEGRATION.md#réserver-jusquà-la-clôture).
- L'installation et la surveillance du superviseur extérieur préparé, avec son échéance absolue, ainsi que des plafonds fournisseur vérifiés. Le worker v7 est terminable, mais ses limites et celles d’IPFS ne bornent pas les abonnements, stockage, factures déjà engagées ou l’inactivité. Voir [OPERATIONS-PREPARATION.md](OPERATIONS-PREPARATION.md).
- Les coûts hors handler runner : routes Next avant admission, authentification publique, faucet/KYB, préflights, reaper et dépinning. La liquidité agrégée USD ne vérifie pas les crédits disponibles chez chaque fournisseur.
- La séparation effective des comptes et droits en production, la validation des paramètres gas/finalité sur le rollup cible et la validation de la restauration du volume runner. Les outils de sauvegarde cohérente SQLite sont implémentés ; la restauration PostgreSQL 18 et les copies de blobs vérifiées ne valident pas cette reprise du registre. Une politique expirée suspend l’admission sans arrêter automatiquement une machine facturée.

Un disque local commun est une condition de ce mécanisme. **Deux CVM ou deux fichiers ne partagent pas le budget**, même avec la même clé. Ne pas dupliquer le wallet/registre sur des disques indépendants ou restaurer une vieille sauvegarde pour relancer les admissions ; une coordination centrale serait nécessaire avant ce type de mise à l’échelle. Ce dispositif n’est pas une protection contre un opérateur/root capable de modifier le code, le registre ou la clé.

Le budget SQLite et le registre anti-rejeu des grants sont deux mécanismes distincts. Le nettoyage de `RUNNER_REPLAY_DIR` ignore désormais les réservations vides ou incomplètes, ce qui ferme la course reproduite en local (S-09). L’unicité a été testée entre huit processus réels. Le répertoire doit rester commun sur un disque local, avec une version homogène du runner.

## Vérification

Validation du premier livrable : 272 tests applicatifs, lint, typage et build. Après les correctifs, la [validation v7](BILLING-INTEGRATION.md#validation-locale-et-limites) atteint **308 tests applicatifs, 18 tests des outils d’exploitation, 79 tests contrats, 62 tests navigateur, un parcours EVM local et une suite PostgreSQL entre huit processus réussis**. Elle couvre la reprise d’un résultat durable, la rediffusion identique, la réconciliation d'un reçu canonique et le refus de livraison avant règlement ; elle ne vaut pas activation sur Phala.

Les tests `budget.test.ts` couvrent notamment la dernière réservation entre deux processus, la persistance des tentatives, les doublons, le cache du modèle, les limites globales et de gas, les prix périmés, les données comptables invalides, les reverts et la perte de réponse RPC. `pinata.test.ts` vérifie la coupure des flux trop grands et le refus avant upload. Aucun accès RPC, Pinata ou Phala réel n’est nécessaire.
