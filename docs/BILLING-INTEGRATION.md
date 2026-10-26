# Facturation v7 — intégration locale

État au 23 septembre 2026 : devis signé, prépaiement, calcul, règlement et remboursement sont raccordés dans le code. **Aucun tarif réel activé, aucune migration distante, aucun déploiement public ; Phala reste arrêté.** Le mode par défaut reste v6. Les tarifs commerciaux, la comptabilité réconciliée et les plafonds fournisseurs restent à valider : cette intégration ne garantit pas à elle seule un PnL non négatif.

Les prix et revenus envisagés figurent dans [BUSINESS-PLAN.md](BUSINESS-PLAN.md). Ses simulations ne modifient ni `RUNNER_BILLING_POLICY_FILE` ni les devis ; le prix dataset reste attribué au provider et le revenu compute à Sirius.

**Activation toujours bloquée :** le [suivi de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) décrit les correctifs locaux et les limites restantes : finalité du réseau cible, crash avant checkpoint runner, anciennes copies de clés et validation économique. La [deuxième passe](RECOVERY-OPERATIONS.md) couvre la perte de réponse Next et les courses testées sur PostgreSQL et entre processus.

## Défauts constatés avant cette passe de correction

- **Remboursement confirmé, wallet runner bloqué :** si `recordExecution` réussit mais que la confirmation RPC est perdue, son intention reste réservée. La reprise de `run-loan-job` rejette le prêt déjà remboursé dans `matchesScope` avant d’atteindre la réconciliation du hash. L’intention bloque ensuite les transactions des autres prêts. Le PoC local reproduit ces trois étapes. La réconciliation doit rester accessible après clôture du prêt ; le retour applicatif anticipé d’un prêt déjà `SETTLED` doit aussi être traité.
- **Calcul réussi puis abandon sans facturation :** le navigateur doit émettre un nouveau grant `settle-loan` après le calcul. S’il s’arrête avant, aucun checkpoint de consommation n’est publié ; le remboursement à échéance est intégral malgré le modèle produit et la mesure de réussite persistée. Le PoC a récupéré les 4 USDC synthétiques prépayés, avec zéro crédit à la trésorerie. Le modèle n’a pas été déchiffré gratuitement, mais les coûts et les allocations restent à la charge de Sirius. La publication de la consommation ou le règlement doit cesser de dépendre de cette nouvelle action du borrower.
- **Devis absent, confirmation contournée :** si les réponses `/api/loans` et `/authorize` omettent `billingQuote`, le client reprend le parcours historique et transmet les transactions fournies par l’API sans afficher de devis, même pour un parcours configuré v7. Une réponse API compromise ou incorrecte peut ainsi proposer une approbation illimitée ou une transaction arbitraire ; la confirmation du wallet reste nécessaire. Le client doit vérifier indépendamment la version attendue et refuser un devis absent en v7.
- **Suppression cryptographique non garantie :** le cache durable de l’ingestion conserve `wrappedKey` dans `operations.result` après suppression de sa copie Prisma. Tant que cette copie et la master key subsistent, la suppression applicative seule ne détruit pas l’accès cryptographique. Le cycle de suppression doit couvrir le registre et ses copies avant toute promesse de crypto-shredding.

Ces constats sont conservés comme historique de l'audit initial ; leur état actuel figure dans le suivi lié plus haut.

## Parcours implémenté

1. Next réserve le prêt et transmet au runner le reçu authentifié du dataset. Le runner vérifie le titre EVM et son profil, lit les décimales du token et construit le devis. Le prix compute est le maximum entre le prix du profil et un **minimum commun à tous les emprunts**. Aucun tarif commercial n’est fourni par défaut.
2. Le runner réserve atomiquement l’exposition maximale du parcours dans son registre SQLite, avant de retourner le devis signé. Sans marge acquise disponible, ETH disponible ou politique valable jusqu’à l’échéance maximale du prêt, aucun devis utilisable n’est émis.
3. Marketplace et Entraîner exigent le devis signé pour un escrow v7, affichent dataset, compute, total, barème, retenue maximale et expiration, puis reconstruisent `approve(total)` et `lock(terms, authorization)` après acceptation. Le navigateur vérifie la version du contrat, la signature, le réseau, le token et sa précision. Pour v6, il reconstruit aussi les transactions depuis le prix affiché et le titre on-chain. Le renouvellement après approve conserve les termes initiaux.
4. Le runner vérifie `matchesScope` avec le `termsHash` reconstruit depuis le devis signé, le reçu dataset et le grant du borrower avant tout déchiffrement. Le calcul n’est pas déclenché par un devis seul.
5. À la réussite, le modèle chiffré est conservé et la preuve d’exécution lie le hash du devis. Le runner v7 n'envoie aucune capsule avant règlement ; Next persiste un engagement attesté. Le reaper peut régler un résultat v7 persisté sans nouveau grant du borrower. `release` publie le préimage et crédite atomiquement provider et trésorerie. La clé du modèle v7 n'est livrée qu'après vérification du reçu canonique et des confirmations configurées. Le résultat et sa mesure sont enregistrés atomiquement dans SQLite avant la réponse ; le reaper peut les récupérer et les vérifier si Next les a perdus. Une coupure avant ce checkpoint runner reste une consommation incertaine.
6. Après un échec mesuré, le runner persiste la mesure puis signe un reçu final. Quand `recordExecution` est inclus, il crédite le remboursement du dataset et du compute non consommé, moins la retenue annoncée. Le registre réconcilie une transaction confirmée après perte de réponse RPC avant le prochain envoi. Une transaction introuvable est rediffusable depuis son journal chiffré, avec les mêmes octets et trois envois au maximum ; une incertitude persistante exige une intervention.

Les remboursements sont des **crédits escrow à retirer**, pas des virements automatiques vers le wallet. Les frais réseau payés par le borrower pour approve, lock, refund et withdraw restent séparés ; aucun supplément automatique ni débit de la trésorerie n’est ajouté.

## Devis et consommation

Le manifeste canonique est défini dans [`quote.ts`](../src/lib/billing/quote.ts). L’ordre des clés est fixé, les champs libres sont refusés, les montants sont des chaînes d’entiers atomiques et les adresses sont normalisées. `quoteHash = keccak256(UTF8(JSON canonique))` est engagé dans les termes EIP-712 v7. La signature expire au plus cinq minutes après émission, jamais après la fenêtre autorisée par Next.

Le manifeste lie notamment le reçu dataset, le profil, les deux bénéficiaires, les deux prix, les plafonds, le barème, le réseau, le token, ses décimales, le runner et la politique `consumed-execution-only`. La trésorerie compute doit être distincte du compte opérationnel du runner, du borrower, du provider et de l’escrow.

La quantité mesurée est le **temps écoulé d’exécution du job**, depuis la récupération du dataset jusqu’à la production/upload du modèle, transferts inclus. Ce n’est pas un nombre de millisecondes CPU. Le devis l’annonce ainsi. Le barème doit justifier le coût de cette durée avec `costReference` ; il ne doit inclure ni marge commerciale, ni réserve non consommée, ni frais fixes déjà affectés ailleurs.

```text
retenue = min(durée mesurée entière en ms × executionRateAtomicPerMs,
              maxFailureFee)
remboursement = datasetAmount + computeAmount - retenue
```

Le prix forfaitaire complet est crédité uniquement lors du `release` ; une réussite locale seule ne l’acquiert pas. La mesure utilise une horloge monotone ; le registre conserve le début, la durée bornée, le résultat et l’empreinte du devis. Aucun dataset, préimage ou clé en clair n’y est stocké. Le résultat d'ingestion n'est plus mis en cache ; l'ouverture du registre purge les anciennes copies actives de clé enveloppée, sans effacer les sauvegardes antérieures. Le premier reçu final fixe aussi l’horodatage de chaîne : si la reprise atteint l’adaptateur, elle ne fabrique pas une autre transaction avec un nouveau timestamp. L’EVM vérifie la signature et les bornes, pas la facture fournisseur.

Chaque job v7 est borné par une durée configurée entre 1 et **30 secondes**, qui couvre récupération, calcul et upload. Le calcul tourne dans un worker terminable, avec limites de heap 128/16 Mio ; le processus parent termine ce worker sur interruption. La limite dataset est de 3 Mio, et les limites IPFS existantes restent applicables. Ce mécanisme ne remplace pas un superviseur externe de la CVM, des plafonds de mémoire du conteneur ou un arrêt de facturation fournisseur.

## Réserver jusqu’à la clôture

Chaque devis engage dès le départ :

- le maximum de coût d’un entraînement ;
- le maximum de coût de 16 requêtes de traitement/reprise/livraison ;
- deux maxima de transaction, chacun compté en ETH et en micro-USD avec arrondi prudent.

La réservation est liée à la chaîne, l’escrow, la clé de prêt et au hash du devis. Sa validité couvre `expiresAt + challengeDays`, et la politique de coûts doit durer au moins jusque-là. Les frais de préparation du devis restent des opérations séparées, couvertes par le budget global.

Ces allocations ne sont pas débitées deux fois pendant l’exécution. Le coupe-circuit global refuse les nouveaux engagements mais préserve l’utilisation des budgets déjà affectés. Les limites du prêt, du gas, de durée et l’interdiction d’un second nonce incertain restent actives. Les tentatives épuisées ou un wallet bloqué peuvent néanmoins empêcher une clôture anticipée ; le remboursement contractuel à échéance reste indépendant du runner. La réconciliation et la rediffusion bornée des transactions sont intégrées ; une transaction introuvable après épuisement des reprises ou une coupure avant le checkpoint runner peut encore empêcher cette clôture.

**Comptabilité volontairement conservatrice :** les dépenses engagées et les réservations des prêts verrouillés ne sont pas recréditées automatiquement. Un devis expiré sans lock et sans opération restitue sa réservation après vérification on-chain. Une transaction introuvable peut encore bloquer le wallet ; ne pas supprimer ou recréer le registre pour relancer le service. Un budget de gas réellement préfinancé est requis, même si le compute sera payé plus tard en USDC.

## Configuration et migration préparées

| Paramètre | Rôle |
|---|---|
| `SIRIUS_BILLING_VERSION` | Absent ou `6` : parcours historique ; `7` : devis et escrow v7 obligatoires. Configurer Next, reaper, runner et outils de manière cohérente. |
| `SIRIUS_EVM_FINALITY` | `confirmations` ou `finalized` ; `finalized` par défaut en production et obligatoire sur mainnet, sans repli si le RPC ne le fournit pas. |
| `RUNNER_BUDGET_FILE` | Registre existant obligatoire pour les devis et prêts v7, même dans les tests/dev synthétiques ; pas de création implicite. |
| `RUNNER_BILLING_POLICY_FILE` | Fichier JSON local du runner ; ne pas envoyer les secrets/registre à Next. Son absence ou sa péremption bloque les devis et le démarrage métier v7. |

Le fichier tarifaire suit [`BillingPolicy`](../src/lib/billing/config.ts) : `version=1`, `tariffVersion`, `costReference`, `validUntil` en millisecondes Unix, `chainId`, `usdc`, `usdcDecimals`, `computeRecipient`, `minimumComputeAmount`, puis `profiles.linear_regression` et `profiles.logistic_regression`. Chaque profil contient `computeAmount`, `maxFailureFee`, `executionRateAtomicPerMs` et `maxExecutionMs`. Les montants et taux sont des chaînes d’unités atomiques du token. `maxFailureFee` ne peut dépasser le compute finalement annoncé. Les valeurs de fixtures sont synthétiques et ne constituent pas un tarif approuvé.

**Choix testnet confirmé par Ali :** `computeRecipient = 0xb6acf8a998bb8efa34a954cd6334ccc15da7f919`, également compte de déploiement associé à `MEZO_DEPLOYER_KEY` dans `.env`. La politique transmet uniquement cette adresse publique au runner. Le compte Phala `0x3b31923ee7cb2a15fc85abbeeae1fc32afc08c8d` conserve ses signatures de devis et de règlement. Utiliser des wallets provider et borrower distincts de la trésorerie pour le parcours testnet.

La migration [`20260923000000_add_compute_billing`](../prisma/migrations/20260923000000_add_compute_billing/migration.sql) ajoute sept colonnes nullable à Loan : devis signé, hash, montants dataset/compute, plafond, retenue et remboursement. Les prêts historiques ne reçoivent aucune répartition inventée. Le client Prisma local a été régénéré ; la migration n’a été appliquée à aucune base distante. Elle doit précéder la publication du nouveau client Prisma, même si l’instance reste en v6.

Les migrations de provenance et de facturation ont été vérifiées sur une copie chiffrée de la base réelle, restaurée sur PostgreSQL 18 local ; les valeurs historiques sont conservées. Le reaper v7 refuse de démarrer sans runner distant et configuration d'attestation complète. `pnpm ops:check-release <next.env> <reaper.env> <runner.env>` compare les configurations privées explicites sans afficher leurs secrets. Voir la [préparation opérationnelle](OPERATIONS-PREPARATION.md) pour les images, sauvegardes et limites de ces contrôles.

Le script de déploiement sélectionne `SiriusEscrowV7` uniquement avec `SIRIUS_BILLING_VERSION=7`. Les contrôles de version refusent un couple mode/contrat incohérent ; reaper, historiques, preuves et retraits savent relire v7. Le smoke contractuel historique refuse v7 avant toute écriture : le parcours réel v7 doit passer par le runner, sans exporter sa clé.

Avant toute activation publique, valider les limites restantes du suivi d'audit, notamment les anciennes copies de clés, les coupures avant checkpoint runner et la finalité du réseau cible. Restent nécessaires un nouvel escrow et un registre dataset lié, une maintenance et la préservation des historiques, l’application de la migration, des politiques réelles et une image/attestation Phala actualisées. Ne pas convertir les anciens prêts en changeant leur adresse. Le Compose distant, les environnements privés, les fonds et les abonnements n’ont pas été modifiés.

## Validation locale et limites

Validation locale après correctifs : **308 tests applicatifs, 18 tests des outils d’exploitation, 79 tests contrats, 62 tests navigateur, le parcours EVM local et la suite PostgreSQL entre huit processus réussis**, lint, typages application/v7 et build Next réussis. Le test EVM couvre la récupération du résultat perdu par Next, la rediffusion identique après perte RPC, le règlement v7 sans nouveau grant et le refus de livraison avant confirmation ; il ne reproduit pas toutes les pannes distantes ni les réorganisations. Leur réussite ne vaut pas feu vert d’activation. Voir les [conditions de reprise](RECOVERY-OPERATIONS.md).

```bash
pnpm test
pnpm test:billing
pnpm test:operations
pnpm contracts:test
pnpm exec tsc --noEmit
pnpm exec tsc -p contracts/tsconfig.v7.json --noEmit
pnpm lint
pnpm build
```

`test:billing` compile puis démarre un nœud Hardhat isolé sur localhost avec USDC synthétique 18 décimales. Il exerce les vrais contrats et handlers runner, le calcul worker, la séparation des crédits, l’échec mesuré, le remboursement sans consommation, les reprises et le traitement de prêts déjà réservés après ouverture du coupe-circuit. IPFS est simulé en mémoire ; aucune connexion Phala/Pinata/RPC publique ni base PostgreSQL n’est nécessaire. Les tests navigateur utilisent un fournisseur EIP-1193 simulé et vérifient acceptation, montant exact, substitution et changement de wallet. Ils ne remplacent pas un parcours visuel à deux vrais wallets ni la validation RA-TLS.

Restent avant exploitation : tarifs et coût justifiable de la durée active, marges acquises réconciliées, plafonds réels Phala/stockage/RPC/hébergement, coûts hors runner, installation et surveillance du superviseur préparé, restauration du volume runner, copie de sauvegarde hors machine, re-livraison des clés historiques, validation de finalité/gas du rollup, migrations PostgreSQL distantes et parcours navigateur/runner public. Le financement du premier démarrage ne doit pas être présenté comme un bénéfice acquis.
