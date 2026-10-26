# Runbook — migrations applicatives et préservation des historiques

Préparation B2.2 du 25 septembre 2026, Ali, pour le point 4 du [plan de travail](WORK-PLAN-1-7.md). Ali exécute les mutations distantes ; Ali prépare, photographie et contrôle. Rien dans ce document n'autorise une migration, un déploiement ou une dépense : chaque étape a un responsable et un résultat attendu.

## Ce que le pipeline fait déjà

**Décision staging du 25 septembre :** Ali demande une remise à zéro de la base staging existante et de nouveaux contrats indépendants. Pour cette cible, suivre [PHALA-V7-STAGING.md](PHALA-V7-STAGING.md#reprise-du-25-septembre--staging-neuf) : aucune reprise des anciens historiques ni attente du prêt v6. Les règles de préservation de ce runbook restent applicables à une migration historique et à la production ; aucune remise à zéro de production n’est autorisée.

D'après [la pipeline](../.github/workflows/pipeline.yml), tout push sur `staging` ou `main` lance, dans l'environnement GitHub correspondant, le job **Migrations** : le préflight `scripts/check-evm-migration.ts` puis `prisma migrate deploy`. Les déploiements Vercel, images et reaper attendent ce job. Il n'y a **pas de `migrate deploy` manuel** dans la procédure normale.

Conséquences :

- **Staging** porte déjà `20260919000000_track_runner_provenance` et `20260923000000_add_compute_billing` : la pipeline de la PR #4 a réussi ses migrations ([PHALA-V7-STAGING.md](PHALA-V7-STAGING.md)). Il reste à le vérifier par une photo.
- **Production** en est restée à `20260906000000_reconcile_dataset_deletion` lors de l'observation du 23 septembre ([PHALA.md](PHALA.md)). La fenêtre de maintenance de production **est** la fusion de `staging` vers `main` : le job Migrations y applique les deux migrations sur la base réelle avant de déployer le code.
- Les deux migrations sont additives (colonnes nullables ou avec défaut, un type énuméré). Il n'existe aucune migration inverse : le retour arrière est une restauration de sauvegarde, réservée à un dégât constaté.

Le préflight de la pipeline lit `SIRIUS_MIGRATION_ESCROW_ADDRESSES` (tous les anciens escrows) dans les variables de l'environnement GitHub, avec `EVM_NETWORK` et `EVM_RPC_URL`. Il bloque si un ancien prêt n'est pas réconcilié ou si un escrow n'est pas déclaré.

## Outils

| Commande | Rôle | Écrit sur la base ? |
|---|---|---|
| `ops:db-inventory snapshot <env-privé> [--before=photo.json]` | Photo en lecture seule : schéma, migrations, comptes, empreintes, agrégats métier, datasets à réimporter | Non |
| `ops:db-inventory compare avant.json après.json --migrations=…` | Écarts entre deux photos, attentes lues dans les fichiers SQL des migrations | Non |
| `ops:db-inventory expect --migrations=…` | Tables (avec leur clé primaire), colonnes, types et index qu'une migration a le droit d'ajouter | Non |
| `ops:postgres backup` / `verify` | Sauvegarde chiffrée et restauration locale de contrôle | Non |
| `contracts:check-upgrade` | Préflight de changement d'escrow : historiques déclarés, prêts terminés, aucun fonds verrouillé dans un ancien escrow | Non |
| `runner:check-migration` | Préflight de bascule Phala : datasets, entraînements et prêts d'un autre runner ; modèles historiques à préserver | Non |
| `phala:check-v7` | Préflight de chaîne v7 sans signature (Ali) | Non |

Le fichier `<env-privé>` contient `DATABASE_URL` en `0600`, hors Git, jamais affiché. Les photos vont dans `.ops/` (privé, exclu du contexte Docker et de Git). `ops:db-inventory` est une commande à ajouter au manifeste par Ali : en attendant, `node scripts/operations/db-inventory.mjs`.

## Partie 1 — Vérifier staging maintenant

Responsable : Ali, lecture seule. Aucune fenêtre nécessaire.

1. Photographier la base staging : `ops:db-inventory snapshot .ops/staging-db.env > .ops/staging-2026-09-25.json`.
2. Contrôler dans la photo : les deux migrations présentes, ni annulées ni inachevées ; `loans.byRunnerKind` et `datasets.byRunnerKind` à `UNKNOWN` pour les lignes antérieures ; `loans.billingColumnsFilled` à zéro partout ; `receipts` : le nombre de reçus `dataset:v2` est le nombre de datasets à réimporter ; `datasets.toReimport` : la liste exacte.
3. Relever `loans.byEscrow` : ce sont les escrows que staging doit garder dans `SIRIUS_LEGACY_ESCROW_ADDRESSES` (Next, reaper, runner) et dans `SIRIUS_MIGRATION_ESCROW_ADDRESSES` (pipeline). Ne pas remplacer l'escrow d'un prêt existant par les nouvelles adresses.
4. Conserver la photo : elle sert de référence « avant » pour toute photo ultérieure de staging.

## Partie 2 — Fenêtre de maintenance production

### Go ou no-go

Tous les points suivants doivent être vrais avant d'ouvrir la PR `staging → main`. Un seul manquant = pas de fusion.

| Condition | Vérification | Responsable |
|---|---|---|
| Le prêt v6 `0xa798…7390` (10 USDC, échéance 1er octobre 2026 à 08:13 UTC (10:13 à Paris)) est réglé ou remboursé | `ops:escrow-events` (A2) ou explorateur ; puis `contracts:check-upgrade` passe | Ali puis Ali |
| Aucun prêt, entraînement ou dataset en cours sur l'ancien runner | Photo : `loans.byStatus` sans PENDING/SUBMITTING/ESCROWED/TRAINING/SETTLING ; `trainingJobs.byStatus` sans PENDING/RUNNING | Ali |
| Contrats v7 déployés et `phala:check-v7` vert | Rapport du préflight | Ali |
| Variables de l'environnement GitHub `production` à jour : `DATABASE_URL`, `EVM_NETWORK`, `EVM_RPC_URL` (archive), `SIRIUS_MIGRATION_ESCROW_ADDRESSES` avec `0xede81141d007593d4bfce2de4778f753d167700e,0x805a2c2deaa3a8926e85fed6b341dacb54cacba0` et tout autre escrow relevé | Lecture des variables (valeurs jamais recopiées ici) | Ali |
| Sauvegarde chiffrée du jour vérifiée par restauration locale | `ops:postgres backup` puis `verify` | Ali |
| Photo « avant » prise après la sauvegarde | `ops:db-inventory snapshot .ops/prod-db.env > .ops/prod-avant.json` | Ali |
| Attentes calculées | `ops:db-inventory expect --migrations=20260919000000_track_runner_provenance,20260923000000_add_compute_billing` | Ali |
| Créneau annoncé, deux opérateurs disponibles jusqu'à la fin | Message écrit | Ali et Ali |

### Déroulé

| # | Étape | Commande ou action | Résultat attendu | Responsable |
|---|---|---|---|---|
| 1 | Gel des nouvelles opérations | Annonce ; aucune préparation de prêt ni d'entraînement pendant la fenêtre. Il n'existe pas de mécanisme applicatif de gel : la fenêtre repose sur la vérification de la photo et sur l'accord des deux opérateurs | Photo « avant » sans ligne en cours | Ali et Ali |
| 2 | Fusion `staging → main` | PR relue par les deux ; fusion | Pipeline lancée sur `main` | Ali |
| 3 | Suivi du job Migrations | Journal du job : préflight EVM validé, `migrate deploy` applique exactement deux migrations | Deux migrations, aucune autre | Ali |
| 4 | Échec du job Migrations | Rien d'autre n'est déployé (les jobs suivants en dépendent). Lire l'erreur, ne pas relancer à l'aveugle. Un préflight bloqué se corrige par ses causes (escrow non déclaré, prêt non réconcilié), jamais en retirant la vérification | Arrêt propre | Ali, décision à deux |
| 5 | Photo « après » | `ops:db-inventory snapshot .ops/prod-db.env --before=.ops/prod-avant.json > .ops/prod-apres.json` | Photo comparable | Ali |
| 6 | Comparaison | `ops:db-inventory compare .ops/prod-avant.json .ops/prod-apres.json --migrations=20260919000000_track_runner_provenance,20260923000000_add_compute_billing` | `ok: true`, aucun écart. Un écart critique déclenche l'étape 10 | Ali |
| 7 | Préflights post-migration | `runner:check-migration` avec le fichier de contrôle de la cible ; `contracts:check-upgrade` | Préflights validés ; nombre de modèles historiques à préserver relevé | Ali |
| 8 | Suspension des anciennes fiches | Mise à jour explicite `status = SUSPENDED` sur les seuls identifiants de `datasets.toReimport`, exécutée pendant la fenêtre et journalisée ; blobs, clés et reçus intacts | Nouvelle photo puis `compare` : exactement `domain-changed:datasets.byStatus`, rien d'autre | Ali, liste fournie par Ali |
| 9 | Vérification du code déployé | Smokes de la pipeline verts ; livraison d'un modèle historique déjà réglé depuis un wallet disponible ; crédits historiques visibles dans Wallet | Historiques accessibles | Ali et Ali |
| 10 | Retour arrière, seulement sur dégât constaté | Restaurer la sauvegarde de l'étape « go » selon [RECOVERY-OPERATIONS.md](RECOVERY-OPERATIONS.md) ; revenir au déploiement Vercel précédent ; nouvelle photo et `compare` contre la photo « avant » | Photo identique à « avant » | Ali, décision à deux |
| 11 | Réimport | Les providers réimportent les datasets suspendus depuis le navigateur vers le runner Phala et publient de nouveaux titres ; aucune migration automatique des titres | Fiches réimportées avec reçu v3 et `runnerKind = PHALA` | Providers, suivi Ali |
| 12 | Preuves | Photos, sortie de `compare`, lien de la pipeline, hashes éventuels, dans `.ops/` ; synthèse sans secret dans la documentation | Dossier complet | Ali |

### Ce que la comparaison doit montrer

Après les deux migrations, sur une base historique :

- colonnes ajoutées : `runnerKind`, `runnerDeploymentId` sur Dataset, TrainingJob et Loan ; les sept colonnes de facturation sur Loan ; type `RunnerKind` ; rien d'autre ;
- comptes identiques dans toutes les tables, empreintes identiques sur les colonnes d'avant ;
- `runnerKind` à `UNKNOWN` et `runnerDeploymentId` nul sur toutes les lignes existantes ;
- colonnes de facturation vides : tout remplissage est un écart critique ;
- mêmes prêts par escrow, mêmes reçus, même ensemble de modèles.

La répétition de cette séquence sur PostgreSQL est le test `db-inventory.test.ts` : base historique synthétique, deux migrations, comparaison sans écart, puis détection d'une valeur retouchée.

Pour une migration qui crée des tables (comme `20261003000000_add_user_profiles` : `UserProfile`, `DatasetAccessLog`), `expect` les annonce avec leur clé primaire ; une table annoncée n'est plus un `table-unexpected`, et une table annoncée mais absente est l'écart critique `table-not-added`. Pour une table créée, l'outil vérifie son existence, sa clé primaire (`<table>_pkey`), la présence de chacune de ses colonnes (`column-not-added`) et de chacun de ses index annoncés (`index-not-added`). Limite connue : il ne compare ni le type, la nullabilité et le défaut des colonnes d'une table neuve, ni ses contraintes `CHECK`. Attention, `prisma migrate deploy` n'applique pas un fichier de migration en une transaction : si un ordre échoue, les ordres précédents du même fichier restent appliqués et la migration est marquée non terminée dans `_prisma_migrations`. En cas d'échec, lire l'erreur, constater l'état réel en base (`information_schema`, `pg_constraint`), nettoyer à la main ce qui a été appliqué, puis `prisma migrate resolve --rolled-back <nom>` avant de relancer.

## Escrows à déclarer

| Escrow | Version | Rôle après migration | Où |
|---|---|---|---|
| `0xede81141d007593d4bfce2de4778f753d167700e` | v5 | 100 USDC de crédits dus, aucun prêt ouvert | `SIRIUS_LEGACY_ESCROW_ADDRESSES`, `SIRIUS_MIGRATION_ESCROW_ADDRESSES` |
| `0x805a2c2deaa3a8926e85fed6b341dacb54cacba0` | v6 | 20 USDC de crédits dus, un prêt ouvert jusqu'au 1er octobre | Idem |
| Nouvel escrow v7 | v7 | Escrow courant après déploiement | `SIRIUS_ESCROW_ADDRESS` et `NEXT_PUBLIC_*` |

Les anciennes adresses ne sont jamais retirées : elles portent les crédits, les preuves et les préimages historiques.

## Limites

- Ce runbook ne remplace ni le [runbook Phala](PHALA.md) pour l'activation de la CVM, ni [PHALA-V7-STAGING.md](PHALA-V7-STAGING.md) pour les contrats et les volumes. Il couvre la base applicative et les historiques.
- Une photo sans écart ne prouve pas la cohérence avec la chaîne : le rapprochement A2 reste nécessaire pour les crédits et les prêts.
- Les onze modèles historiques sans wallet accessible restent conservés et non livrables, quelle que soit la migration.
