# Compatibilité historique — matrice des formats et de leurs lecteurs

Préparation B2.1 du 25 septembre 2026, Ali, pour le point 4 du [plan de travail](WORK-PLAN-1-7.md). Chaque ligne relie un format ancien au code qui le lit encore et au test qui l'épingle. Si un lecteur est modifié, le test nommé échoue.

Les tests marqués « ops » tournent dans `pnpm test:operations` ; les autres dans `pnpm test`.

## Formats et lecteurs

| Format historique | Où il vit | Lecteur | Comportement fixé | Test |
|---|---|---|---|---|
| Reçu de prêt **v2** (sans profil de modèle) | `Loan.runnerReceipt` | `verifyLoanDeliveryReceipt` | Accepté uniquement pour relivrer un modèle déjà réglé, sur un escrow de la liste historique ; refusé par `verifyLoanReceipt` | `src/lib/runner/evm-receipt.test.ts`, `scripts/operations/historical-compat.test.ts` (ops) |
| Reçu d'entraînement **v2** | `TrainingJob.runnerReceipt` | `verifyTrainingReceipt` | Accepté pour la relivraison de son seul job ; aucun profil inventé ; clé HMAC v2 distincte de la v3 | `historical-compat.test.ts` (ops) |
| Reçu de dataset **v2** | `Dataset.runnerReceipt` | `verifyDatasetReceipt` | **Refusé** : un dataset scellé sous l'ancien format doit être réimporté | `historical-compat.test.ts` (ops) |
| Reçu v2 ou v3 : cohérence des métadonnées avec la base | Sauvegardes | `historicalDeliveryInventory` | Profil absent en v2 accepté comme « non attesté », jamais complété | `scripts/operations/historical-delivery.test.mjs` (ops) |
| Modèle linéaire **sans `version` ni `mae`** | Blobs de modèles historiques | `parseDownloadedModel` | Ouvert tel quel ; `—` affiché pour les champs absents ; toute version ou MAE ajoutée est refusée | `src/lib/train/model-client.test.ts`, `historical-compat.test.ts` (ops) |
| Escrow **v4** : tuple `getLoan` sans profil d'entraînement | Chaîne | `readLoan` via `legacyEscrowAbi` | Lu avec l'ABI historique ; profil à zéro, jamais une valeur par défaut | `historical-compat.test.ts` (ops) |
| Escrows **v5** et **v6** | Chaîne, `0xede8…700e` et `0x805a…cba0` | `readLoan` via `siriusescrowAbi` | Tuple avec profil ; pas de champ de facturation | `historical-compat.test.ts` (ops), `src/lib/audit-regressions.test.ts` (crédits) |
| Escrow **v7** | Chaîne, à déployer | `readLoan` via `siriusescrowv7Abi` | Montant = dataset + compute ; champs de facturation exposés | `historical-compat.test.ts` (ops), `src/lib/billing/flow.test.ts` |
| Version de contrat inconnue | Chaîne | `readLoan` | Refus explicite, aucun repli | `historical-compat.test.ts` (ops) |
| Liste des escrows historiques autorisés | `SIRIUS_LEGACY_ESCROW_ADDRESSES` | `trustedEscrowBindings` | Toute lecture hors liste est refusée, même avec une version connue | `evm-receipt.test.ts`, `reaper.test.ts`, `historical-compat.test.ts` (ops) |
| Événements v5/v6 réels du testnet | Fixtures `scripts/operations/fixtures/escrow-events.*.testnet.json` | `collectEscrowEvents`, `reconcile` | 9 et 37 événements décodés ; 120 USDC dus, un prêt v6 ouvert | `escrow-events.test.ts`, `reconcile.test.ts` (branche A2) |
| Prêt v6 lancé sans devis (parcours historique) | Navigateur | `legacyBorrowTransactions` | Vérifie l'adresse du lock, le prix et le titre EVM avant signature | `e2e/billing-v7.spec.ts` pin le garde-fou (devis refusé sur un escrow v6) ; le constructeur de lock v6 lui-même reste sans test dédié |
| Lignes sans `runnerKind` ni `runnerDeploymentId` | Base, avant migration | Migration de provenance | `UNKNOWN` par défaut, identifiant nul ; jamais réattribuées à Phala | `db-inventory.test.ts` (ops, PostgreSQL) |
| Prêts sans colonnes de facturation | Base, avant migration | Migration de facturation | Sept colonnes nulles ; un remplissage pendant la migration est un écart critique | `db-inventory.test.ts` (ops, PostgreSQL) |

## Préflights de migration, déjà couverts

| Préflight | Ce qu'il bloque | Test |
|---|---|---|
| `checkEscrowUpgrade` | Historiques sans déploiement, prêts en cours sur l'ancien escrow, déploiement historique non déclaré, **fonds encore verrouillés dans un ancien escrow** | `src/lib/sirius/reaper.test.ts` |
| `checkRunnerMigration` | Datasets actifs, entraînements et prêts en cours d'un autre runner ; compte les modèles historiques à préserver | `src/lib/sirius/runner-provenance.test.ts` |
| `checkEvmMigration` | Anciens prêts non réconciliés, escrow de migration non déclaré, transaction de lock non confirmée | `src/lib/sirius/reaper.test.ts` |

**Conséquence pour la fenêtre de maintenance :** le prêt v6 de 10 USDC verrouillé le 24 septembre bloque `checkEscrowUpgrade` tant qu'il n'est pas réglé ou remboursé. Son échéance est le 1er octobre 2026 à 10:13 UTC ; le remboursement est alors réclamable par n'importe qui. Aucune bascule avant.

## Ce que le lot B ne change pas

Aucun lecteur n'a été modifié dans cette tranche : les tests épinglent l'existant. Deux limites restent documentées et non corrigées :

- **Datasets scellés sous reçu v2 :** leur réimport est obligatoire ; l'inventaire de migration (`ops:db-inventory`) donne leur nombre par la répartition des versions de reçus.
- **Onze modèles historiques sans wallet accessible :** conservés, non livrables ; voir [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md).
