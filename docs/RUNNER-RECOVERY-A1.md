# A1 — Reprise runner et interface comptable

Préparation locale du 24 septembre 2026, Ali, branche `fix/runner-recovery`. Référence de périmètre : [répartition A1/A2](WORK-PLAN-1-7.md). Les validations ci-dessous ne constituent pas une activation Phala ni une validation du réseau public.

## Comportement livré

- Le client RA-TLS vérifie la quote matérielle et les mesures, refuse le mode amorçage et lie l'adresse de règlement annoncée à `SIRIUS_LOCK_AUTHORIZER`, au réseau et aux contrats configurés avant toute requête métier. Le résultat est mis en cache cinq minutes, comme le transport existant.
- Le reaper reconnaît un remboursement v7 canonique avant d'appeler le runner. Une panne de reprise ne laisse plus ce prêt bloqué en entraînement. Un règlement déjà miné conserve la récupération du modèle et la validation de sa preuve ; aucune clôture n'est inventée sur erreur RPC.
- L'anti-rejeu persistant utilise une insertion SQLite atomique. Les fichiers hérités, même vides ou malformés, restent bloquants pendant au moins deux heures après leur dernière modification. Leur collecte est bornée à 128 entrées par passage ; celle de SQLite à 256 expirations. Un passage a lieu tous les 64 appels, ainsi qu'au premier appel du processus.
- Les diagnostics distinguent une intention sans hash, un journal absent, des reprises épuisées et l'attente d'un reçu. Le budget reste engagé dans tous les cas incertains.
- Un export JSON versionné fournit l'interface avec la comptabilité d'Ali. Un préflight indépendant prépare le contrôle de la finalité sur la cible.

## Procédure de reprise

Suspendre les nouvelles admissions avant toute restauration ou intervention sur le volume. Conserver une copie cohérente du registre et des journaux ; ne pas éditer les compteurs ou effacer une intention pour débloquer le wallet.

| Observation | Action autorisée par le mécanisme existant | Ce qui reste bloqué |
|---|---|---|
| Coupure avant checkpoint résultat/mesure | Conserver l'engagement ; rechercher les preuves disponibles et laisser le remboursement contractuel à échéance. | Aucun recalcul, aucune consommation maximale inventée. |
| Résultat et mesure durables, réponse Next perdue | Reprise par le reaper avec le devis déjà signé ; reconstitution de l'attestation, persistance puis règlement. | Aucun nouveau grant ou nouvel upload requis. |
| Transaction réservée sans hash (`unsigned`) | `reconcile` clôt la tentative comme échouée après cinq minutes ; le maximum de coût reste alloué. L'ordre du code interdit tout envoi avant persistance du hash. | Pas de nouvelle signature pour cette même intention. |
| Hash et journal présents (`awaiting-receipt`) | Chercher le reçu canonique. `rebroadcast` peut utiliser les mêmes octets, le même nonce et les mêmes frais, trois envois au total, espacés d'au moins 30 secondes. | Aucun remplacement de transaction ni hausse des frais. |
| Ancienne intention sans journal (`journal-missing`) | Rechercher le hash connu, le compte/nonce et la résolution du prêt sur la chaîne ; réconcilier un reçu canonique retrouvé. | Pas de reconstruction ou nouvelle signature automatique. |
| Toujours sans reçu après trois envois (`attempts-exhausted`) | Continuer les lectures de réconciliation ; escalade opérateur avec les références publiques. | Réservation conservée, nouvelle transaction du wallet interdite. |
| Remboursement déjà canonique, runner indisponible | Le reaper clôt l'état applicatif et récupère les montants remboursés/retenus du contrat. | Un timeout seul ne vaut jamais preuve de remboursement. |
| Volume absent, remplacé ou restauré depuis une copie ancienne | Arrêter tous les écrivains ; comparer sauvegarde, derniers exports, factures et chaîne avec Ali avant reprise. | Ne jamais initialiser un nouveau budget pour remplacer l'exposition inconnue. |

Le contrôle d'inode détecte le remplacement du registre pendant l'exécution. Il **ne détecte pas tous les retours arrière** : une ancienne copie cohérente ouverte après redémarrage peut sembler valide. Ni ce code ni l'export ne prouvent qu'une sauvegarde est la plus récente. La reprise après rollback reste une procédure opérateur, avec les dépenses postérieures à la copie comptabilisées avant réouverture.

Dans l'environnement concerné, avec les chemins et secrets déjà configurés :

```bash
pnpm runner:budget inspect /chemin/prive/ledger.sqlite /chemin/prive/budget-policy.json
pnpm runner:transactions reconcile
pnpm runner:transactions rebroadcast
```

`reconcile` ne diffuse rien. `rebroadcast` est une opération réseau susceptible de consommer le gas déjà réservé : à utiliser seulement dans un créneau d'exploitation autorisé. Aucun de ces appels n'a été exécuté sur Phala pendant A1.

## Interface fournie à Ali

```bash
pnpm --silent runner:budget export /chemin/prive/ledger.sqlite /chemin/prive/budget-policy.json
```

La sortie standard est un document JSON `version: 1`, typé par `RunnerAccountingExport` dans `src/lib/runner/budget-ledger.ts`. Le snapshot est lu dans une transaction SQLite cohérente. Le CLI ouvre le registre existant ; il ne le réinitialise pas. Comme les autres commandes du registre, son ouverture applique le schéma additif existant et purge les anciens résultats de scellement du cache actif.

| Champ | Interprétation |
|---|---|
| `chainId`, `wallet`, `accountingReference` | Identité du budget et référence à ses justificatifs. |
| `generatedAtMs` | Heure d'observation, pas preuve d'ancienneté ou d'intégrité signée. |
| `totals.allocatedUsdMicros`, `allocatedWei` | Exposition maximale allouée, incluant les incertitudes. **Ce ne sont pas des factures.** |
| `totals.remainingUsdMicros`, `remainingWei` | Solde réservable selon la politique, pas bénéfice. |
| `operations[]` | ID stable, empreinte, nature, état, coût maximal, workflow parent, hash/nonce et tentatives de transaction. |
| `workflows[]` | Réservation globale de chaque devis et nombre de requêtes/calculs/transactions encore disponibles. |
| `checkpoint` | `not-started`, `uncertain`, `result-durable`, `result-missing` ou `failure-measured`. |
| `measurement` | Durée réellement enregistrée au checkpoint, heure de départ et succès/échec ; `null` signifie absence de mesure, jamais zéro consommation. |
| `failureClaim` | Frais compute revendiqués et empreinte de preuve ; ce reçu préparé n'atteste pas que le contrat l'a accepté. |
| `pendingTransactions[]` | Intentions incertaines avec motif de reprise et présence du journal. |

Les montants monétaires sont des **chaînes d'entiers** : USD en millionièmes, ETH en wei, compute en unités atomiques du token indiqué par le devis. Les décimales USDC proviennent de ce devis et du contrat du token, jamais d'une constante supposée commune aux réseaux. Les dates portent explicitement `Ms` ou `Seconds`.

Pour éviter un double compte : sommer les budgets des workflows **plus uniquement** les opérations dont `workflowId` est nul. Les autres opérations consomment l'enveloppe déjà allouée au devis. Cette somme doit rejoindre `totals.allocated*`. Les opérations terminées restent allouées par prudence ; aucune marge n'est recréée après succès ou échec.

Rapprochement idempotent : clé `(chainId, wallet, operation.id)` ou `(chainId, wallet, workflow.id)`. Un nouvel export met à jour l'observation ; il ne crée pas une seconde dépense. Le workflow contient le réseau, l'escrow et le `loanKey` ; son empreinte correspond au devis. Les intentions `release:` / `failure:` portent les mêmes références publiques.

Les règlements sont des références à vérifier : hash, nonce et état du journal. `succeeded` ne donne ni revenu net ni montant réel du gas. Ali doit joindre reçus canoniques, événements des contrats, montant/précision du devis et factures fournisseur. Un remboursement effectué directement par le borrower peut ne pas apparaître comme transaction runner : le retrouver via le prêt et les événements. Aucun revenu encaissé, dépôt client transformé en profit ou PnL n'est déduit par l'export.

Aucun payload de devis signé, contexte de livraison, CID, modèle, clé, préimage ou transaction chiffrée n'est exporté. L'export reste un document d'exploitation privé, pas une page publique. Une mesure persistée malformée fait échouer l'export ; elle n'est pas remplacée par une estimation.

## Mise à jour de l'anti-rejeu

Le fichier est `RUNNER_REPLAY_DIR/replay.sqlite`, dans le volume persistant existant. Aucune migration Prisma n'est nécessaire.

Le démarrage actif et chaque admission refusent un registre absent, inaccessible, vide ou corrompu. Ils ne créent ni fichier SQLite ni schéma. L'amorçage Phala reste disponible sans registre : les opérations métier y sont déjà désactivées.

```bash
pnpm runner:replay check /chemin/prive/replay
pnpm runner:replay init /chemin/prive/replay
```

`init` est réservé à une première installation ou à une migration volontaire depuis les anciens fichiers sans SQLite. Il crée le registre exclusivement et refuse tout fichier existant, même vide ou invalide. Les fichiers historiques sont conservés. Un registre SQLite A1 déjà présent reste compatible : `check` suffit.

**Après perte d'un registre ou du volume, ne pas exécuter `init`.** Restaurer et vérifier l'historique selon la procédure opérateur ; l'absence du fichier n'est jamais une preuve de première installation. Une restauration ancienne mais cohérente reste indétectable automatiquement. Dans l'image, les commandes correspondantes sont `node --conditions=react-server --import tsx scripts/runner-replay.ts check /chemin/prive/replay` et, seulement dans les cas ci-dessus, `init`.

1. Arrêter toutes les instances de l'ancien runner avant d'utiliser la nouvelle image sur ce volume. **Ne pas faire cohabiter les deux formats** : un ancien processus ne lit pas les nouvelles réservations SQLite.
2. Conserver les sous-répertoires historiques `grant` et `capability`. Les anciens fichiers empêchent la réutilisation des autorisations encore valides ; leur contenu n'est pas nécessaire au nettoyage.
3. Sauvegarder/restaurer le volume entier, y compris le journal SQLite éventuel, hors service ou via une méthode SQLite cohérente. Une copie brute du seul fichier actif n'est pas une sauvegarde garantie.
4. Pour revenir à l'ancienne image, suspendre les admissions et laisser expirer toutes les autorisations déjà émises, au moins deux heures après leur dernière émission. Ne pas effacer SQLite pour effectuer un retour arrière immédiat.

La base SQLite réutilise ses pages libérées ; le fichier ne diminue pas nécessairement après collecte. Un registre corrompu entraîne un refus, sans remplacement automatique par une base vide. Une perte complète du volume reste un incident de reprise ; restaurer le budget sans l'anti-rejeu n'est pas suffisant.

## Contrôles RPC/finalité préparés

```bash
pnpm runner:check-finality
pnpm runner:check-finality 0xHASH_DE_TRANSACTION_DE_TEST_CONFIRME
```

La seconde ligne est un gabarit : remplacer par un vrai hash hexadécimal de 32 octets. Le script exige `EVM_NETWORK` et `EVM_RPC_URL` injectés dans l'environnement et lit la politique habituelle ; il ne charge aucun `.env` implicitement. Il n'utilise aucun compte de signature et n'envoie aucune transaction. Il vérifie le réseau, le bloc retenu, sa cohérence canonique et éventuellement le reçu, puis expose le retard en blocs. Le mode `finalized` refuse un tag absent ; aucune rétrogradation vers `latest`. Dans l'image runner, utiliser `node --conditions=react-server --import tsx scripts/check-runner-finality.ts`.

Sur la cible, dans un futur créneau autorisé : vérifier la même politique sur Next/reaper/runner, observer la progression de `finalized` et sa latence, contrôler un lock/règlement/remboursement canonique, simuler une panne RPC et constater l'absence de livraison prématurée. Ce préflight ponctuel ne prouve pas qu'un RPC dit vrai ni la garantie de finalité économique du rollup.

## Signalements connexes relus

- **Séparation VPS / Phala** : `TEE_MODE=phala` côté Next/reaper choisit la vérification distante ; avec `RUNNER_URL`, il n'impose pas d'enclave locale. Les tests de configuration couvrent ce cas. Ne pas passer le reaper en `stub` pour contourner une erreur de mesure.
- **Réponse de scellement dataset perdue** : le cache de `wrappedKey` n'est pas réintroduit. La reprise transparente reste indisponible. Vérifier l'état du draft ; s'il n'a ni titre ni prêt, le supprimer par le parcours existant puis réimporter avec un nouvel identifiant. Conserver le coût de l'ancienne tentative ; inventorier un éventuel blob orphelin avant toute suppression manuelle.
- **Devis refusé dans le navigateur** : une autorisation signée reste utilisable jusqu'à son expiration. Son budget ne doit pas être libéré au simple clic d'annulation. La collecte existante attend l'expiration dans un bloc confirmé et l'absence de prêt on-chain ; une panne de finalité peut prolonger la réservation.
- **Challenges de connexion** : leur émission est sans écriture SQL. Le nonce est enregistré après validation de la signature wallet, avec contrainte d'unicité et nettoyage des expirations ; le signalement d'un stockage durable à chaque émission ne correspond pas au code actuel.

## Validation et limites

Vérification dans une copie sans secrets locaux, sous Node 22.23.2 : **336 tests applicatifs**, **18 tests d'exploitation**, parcours `test:billing` sur EVM locale, lint, typage applicatif et build réussis. Ces validations locales ne constituent pas un déploiement.

Les tests locaux couvrent les coupures `SIGKILL` avant/après checkpoint, restauration SQLite, journal incomplet, trois diffusions identiques au maximum, budgets conservés, concurrence anti-rejeu entre huit processus, liaison RA-TLS au déploiement, remboursements/réorganisations et export sans secrets. Le parcours de facturation utilise de vrais contrats sur une chaîne locale ; stockage IPFS et persistance Next y sont simulés.

Restent à exécuter sur la cible : restauration du volume Phala, stabilité de l'identité après redémarrage, quote matérielle réelle, comportement du RPC public et prêt complet en enclave. Les tarifs, justificatifs, plafonds fournisseurs, copie hors machine et anciennes copies de clés restent suivis avec Ali dans A2. Aucun de ces contrôles n'est remplacé par les tests locaux.
### Correctifs après revue de la PR #5

La PR #5 est fusionnée dans staging. La revue a confirmé deux lacunes de cette version : création implicite du registre après perte de stockage et import de `dotenv` absent des dépendances de production du runner. Les correctifs ci-dessus ajoutent l'initialisation explicite, les refus au démarrage et à l'admission, puis retirent cet import. Un test exécute les deux CLI avec uniquement les paquets de production accessibles et un RPC local simulé ; la perte du fichier et celle du volume sont aussi couvertes.

Validation locale de ces correctifs, sous Node 22.23.2 et sans secrets : **343 tests applicatifs**, parcours de facturation sur EVM local, lint, typage et build réussis. Une installation réelle avec `pnpm install --prod --frozen-lockfile --ignore-scripts --offline` confirme aussi que les CLI se chargent sans `dotenv` ; aucune connexion à un RPC public ni activation Phala pendant ces vérifications.
