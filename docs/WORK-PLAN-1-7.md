# Répartition Ali / Ali — points 1 à 7

Établi le **24 septembre 2026**, à partir du dépôt et de la répartition retenue dans la discussion. Ali et Ali sont polyvalents : les responsabilités ci-dessous servent à avancer en parallèle et à limiter les fichiers modifiés en commun. Elles peuvent changer après intégration d'un lot.

## Objectif et périmètre

Fiabiliser le parcours existant, valider Phala/v7 sur testnet, étendre les capacités du produit et préparer un pilote externe. Les numéros renvoient à la checklist de finition :

1. Reprise et règlement : checkpoints, transactions incertaines, finalité et anciennes copies de clés.
2. Tarifs et dépenses : coûts réels, comptabilité, politiques de facturation et plafonds.
3. Bascule Phala et contrats v7 sur testnet.
4. Migrations applicatives et préservation des historiques.
5. Validation réelle avec deux wallets, y compris les incidents.
6. Upload direct, entraînements asynchrones et nouveaux modèles.
7. Entretiens, prospects et pilote externe.

Le KYB externe, l'audit indépendant et le lancement mainnet ne font pas partie de cette tranche. La revue des sorties modèle avant données sensibles reste nécessaire dans le point 6. La préparation ne vaut pas autorisation de redémarrer Phala, d'engager une dépense ou d'appliquer une migration distante.

La facturation v7, plusieurs mécanismes de reprise et les outils d'exploitation existent déjà : chaque tâche commence par leur état actuel, sans les reconstruire. Voir [ROADMAP.md](ROADMAP.md), [BILLING-INTEGRATION.md](BILLING-INTEGRATION.md) et [le suivi des correctifs](AUDIT-2026-09-23.md).

## Lots et dépendances

| Lot | Ali | Ali | Preuve de fin |
|---|---|---|---|
| **A — Fiabilisation et préparation** | Reprise transactionnelle, checkpoints, finalité et application des budgets : point 1 et partie technique du 2. | Coûts, rapprochement comptable, superviseur, sauvegardes/restauration et inventaire historique : point 2 et préparation du 4. | Scénarios locaux vérifiés ; procédures de reprise, coûts et politiques prêts pour les essais autorisés. |
| **B — Intégration réelle** | Contrats, images, CVM, attestation et coordination des mutations distantes : point 3. | Migrations applicatives, compatibilité historique, préparation et suivi des scénarios navigateur : points 4 et 5. | Parcours à deux wallets validé ensemble, modèle ouvert, crédits retirés et incidents rejoués. |
| **C — Capacités produit** | Upload direct complet : navigateur, réception chiffrée, morceaux, reprise, intégrité et limites. | Jobs asynchrones complets : file persistante, API, état applicatif, interface, interruptions et reaper. | Dataset volumineux envoyé directement au runner puis entraîné en asynchrone, avec ressources et facturation bornées. |
| **D — Modèles et qualification** | Validation à 100 Mo, charge, pannes et correction des limites découvertes. | Modèle non linéaire, validation des données, profil versionné, métriques et lecteur navigateur. | Modèle non linéaire livré et ouvert après règlement ; compatibilité historique conservée. |
| **En parallèle — Pilote** | Entretiens et qualification des besoins ; préparation technique de l'exploitation. | Entretiens, suivi des prospects, périmètre du pilote et retours utilisateurs. | Trois accords de test puis pilote externe documenté ; quatre semaines d'exploitation à mesurer. |

Les entretiens commencent dès le lot A. La préparation locale des interfaces du lot C peut avancer pendant A/B, mais leur activation attend la validation du parcours existant. Le pilote avec données sensibles attend la revue adaptée des garanties de traitement et de sortie. La cible de 1 Go reste à confirmer selon le besoin ; le jalon technique est 100 Mo.

## Première paire de tâches : lot A

### A1 — Ali : reprise transactionnelle et checkpoints

**Périmètre principal :** `src/lib/runner/` pour budgets et transactions, `src/lib/billing/recovery.ts`, `src/lib/billing/settlement.ts`, `src/lib/evm/finality.ts`, intégration dans `src/runner/` et tests associés. Les fichiers précis sont annoncés dans chaque ticket.

- Reproduire les coupures avant/après checkpoint ; distinguer résultat durable, consommation prouvée et état incertain.
- Définir la reprise après journal incomplet, transaction introuvable ou retour arrière du stockage, sans nouveau nonce arbitraire, double paiement ni budget recréé.
- Préparer les tests RPC/finalité qui devront ensuite être exécutés sur la cible.
- Fournir à Ali un format d'export des opérations, réservations, consommations et règlements pour la réconciliation comptable.
- Coordonner avec Ali la restauration et le traitement des anciennes copies de clés ; ne pas supprimer de sauvegarde historique implicitement.

**Acceptation :** régressions locales reproductibles, exposition incertaine conservée dans les budgets, procédure opérateur documentée, validations distantes restantes explicites.

### A2 — Ali : comptabilité et outils d'exploitation

**Périmètre principal :** `scripts/operations/`, `deploy/operations/`, documentation d'exploitation et inventaire des historiques. Les modifications nécessaires dans les budgets runner passent par Ali.

- Partir des sauvegardes, outils de coûts, benchmarks et superviseur déjà préparés.
- Rapprocher dépenses, recettes, remboursements et engagements sans assimiler les dépôts clients ou apports à des bénéfices.
- Consommer l'export convenu avec Ali ; ne pas créer une seconde autorité de réservation ou de mesure du compute.
- Préparer tarifs, financement des essais, limites fournisseurs et scénarios d'arrêt ; distinguer propositions et politiques approuvées.
- Vérifier les procédures locales de restauration et préparer celle du volume runner réel.
- Préparer la matrice des tests navigateur, les accès historiques et les entretiens du pilote.

**Acceptation :** calculs traçables, écarts comptables visibles, essais financés à faire approuver avant activation, procédures testées localement et scénarios distants prêts.

## Interfaces à fixer avant les développements parallèles

| Interface | Accord minimal |
|---|---|
| Comptabilité / budgets | Identifiants d'opération, réservations, montants réellement engagés, règlements définitifs et états incertains ; unités et règles d'idempotence. |
| Upload direct | Création/expiration d'une session, morceaux, reprise, empreintes, autorisation liée au contenu, validation finale et nettoyage. |
| Jobs | Identifiant, statuts et transitions, consultation, erreurs publiques, résultat récupérable, échéances et traitement des orphelins. |
| Modèles | Identifiant/version du profil, format livré, métriques, limites et compatibilité des modèles historiques. |
| Facturation longue | Limites acceptées avant paiement, mesure de consommation, durée du prêt, clôture et remboursement. Augmenter seulement un timeout ne suffit pas. |

Types, exemples de requêtes/réponses et tests de contrat doivent être intégrés avant leurs consommateurs. Des doublures permettent d'avancer séparément ; la validation finale utilise les composants réels. La donnée brute et les clés restent dans le périmètre autorisé ; l'upload direct ne déplace pas le déchiffrement vers Next.

## Propriété des fichiers et passages de relais

Un ticket indique son propriétaire, ses fichiers, ses dépendances et ses critères de fin. Aucun répertoire n'autorise à modifier tous ses fichiers sans coordination.

| Zone commune | Responsable des modifications |
|---|---|
| Entrées runner, formats Next ↔ runner, autorisations et devis signé | Ali ; les évolutions nécessaires aux tâches d'Ali sont convenues avant implémentation. |
| Schéma Prisma et migrations applicatives | Ali ; exécution distante coordonnée par Ali. |
| Algorithmes et registre des modèles pendant D | Ali ; revue de Ali sur les effets sécurité, profils, preuves et facturation. |
| `package.json`, `pnpm-lock.yaml`, pipeline | Ali comme intégrateur ; Ali transmet ses besoins de dépendances et commandes. |
| Reaper | Ali pendant A/B ; passage explicite à Ali pour les jobs asynchrones en C, après intégration du travail précédent. |
| Déploiements et mutations distantes | Ali comme opérateur pour éviter deux opérations concurrentes ; décisions d'activation distinctes du développement. |

Pendant C, Ali prend les écrans/routes d'upload et Ali les écrans/routes de suivi des jobs. Les fichiers qui servent aux deux, notamment la page d'entraînement et les points d'entrée runner, ont un seul intégrateur annoncé dans les tickets. Les nouvelles fonctions sont développées dans des modules dédiés lorsque cela clarifie ces frontières, sans refonte générale préalable.

## Organisation GitHub

### Base commune avant les deux branches de travail

Intégrer d'abord les changements existants de `staging` et de `PhalaIntegration` dans une base revue. Les deux développeurs démarrent ensuite du même état intégré, avec chacun sa copie locale, sa base de test et ses volumes. Ne pas partager les fichiers privés `.env*` ni déduire leur cible de la branche.

Branches proposées pour le premier lot :

- `fix/runner-recovery` : Ali, tâche A1.
- `feat/operations-accounting` : Ali, tâche A2.

Une branche correspond à une tâche, pas à plusieurs semaines de travail personnel. Les PR restent petites et sont relues par l'autre développeur. Un point quotidien suffit pour annoncer fichiers concernés, interface modifiée et dépendance bloquante.

Si la mise à jour distante de staging doit attendre, une branche d'intégration dédiée, par exemple `integration/points-1-7`, peut servir de base commune après résolution et tests. Dans la pipeline actuelle, une PR vers cette branche exécute la vérification ; un push sur cette branche ne déclenche pas le déploiement. Cette option ne résout pas les conflits ni ne valide la cible distante.

### Ce que déclenche une fusion vers staging

La branche s'appelle **`staging`**. D'après [la pipeline](../.github/workflows/pipeline.yml) :

1. Une PR exécute les vérifications ; les jobs de déploiement sont exclus par leur dépendance au job réservé aux événements `push`.
2. Un push sur `staging`, notamment après fusion d'une PR, lance les vérifications, puis les migrations PostgreSQL, la publication des images et les déploiements Vercel/reaper de staging.
3. La pipeline ne déploie pas les contrats et ne démarre/met à jour pas la CVM Phala.

La fusion est donc une opération de déploiement applicatif, pas seulement un partage de code. Avant fusion, vérifier les sauvegardes, migrations, variables et adresses de **staging**. La v7 ne doit pas être activée accidentellement ; une intégration avec le mode historique conservé est possible après validation de cette configuration. Cela ne demande pas un nouveau contrat v6 et n'autorise aucune bascule de production.

### Contrôle préalable au 24 septembre 2026

Observation ponctuelle après `git fetch origin`, avant ajout du présent fichier :

| Contrôle | Résultat |
|---|---|
| Branche courante | `PhalaIntegration`, commit `080b7cf`, identique à `origin/PhalaIntegration`. |
| Écart avec `origin/staging` | 9 commits propres à `PhalaIntegration` ; 18 commits de staging non intégrés. |
| Travail local | 26 fichiers suivis modifiés et 9 fichiers non suivis, hors ce document. Ces changements ne figurent pas encore dans la branche publiée. |
| Simulation de fusion des commits | Conflits dans `package.json`, `src/lib/ipfs/pinata.ts` et `src/lib/ipfs/pinata.test.ts`. Simulation sans changement de branche ni de fichiers de travail ; elle n'inclut pas les modifications non commitées. |
| PR de `PhalaIntegration` | Aucune trouvée, tous états confondus. |
| Dernière CI staging consultée | [Réussie le 22 septembre](https://github.com/alibenyezza/sirius-mezo/actions/runs/35787296237), sur `6b0c849` ; elle ne valide pas la fusion à venir. |
| Vérification locale de ce passage | 308 tests applicatifs, 18 tests d'exploitation, lint, typage applicatif et contrôle des espaces du diff réussis. |
| Contrôles non rejoués dans ce passage | Build, navigateur, contrats, facturation EVM, PostgreSQL multiprocessus et audit des dépendances ; à exécuter sur le résultat intégré via la CI complète. |
| Protections GitHub | API des protections et règles refusée avec HTTP 403 lié à l'offre du dépôt. Leur application n'est pas confirmée par ce contrôle. |
| `AGENTS.md` | Non suivi et ignoré ; doit le rester. |

**Décision initiale : pas de fusion immédiate vers staging.** Préparer la PR et la base commune est possible. Les premiers bloqueurs étaient les changements locaux à inclure, la divergence et les conflits ; la configuration distante n'a pas été revérifiée dans ce passage.

### Intégration locale du 24 septembre 2026

Le travail local a été conservé dans `1bbbb11`, puis `origin/staging` (`6b0c849`) intégré dans **`PhalaIntegration`**. Les trois conflits sont résolus : la liste des tests conserve les deux branches ; les reprises IPFS de staging respectent les limites de taille et l'annulation du budget Phala. La connexion Google et les correctifs mobile/faucet sont conservés avec la facturation et la reprise v7.

Validation du résultat dans une copie sans secrets locaux :

- Installation avec lockfile figé, lint, typage applicatif/v7 et build réussis.
- 321 tests applicatifs, 18 tests d'exploitation et 79 tests des contrats réussis.
- Parcours de facturation v7 sur chaîne locale et migrations/quotas PostgreSQL entre huit processus réussis, avec une base PostgreSQL 17 jetable.
- 62 tests navigateur Chromium réussis ; les services et wallets externes y sont simulés.
- Audit des dépendances accepté au seuil CI `moderate` ; une vulnérabilité de sévérité faible reste signalée.

Ces contrôles locaux utilisent Node 26 ; la CI sous Node 22 reste à obtenir sur la PR. Secrets, sauvegardes et `AGENTS.md` sont exclus du commit. Aucun push, aucune modification de la branche `staging`, migration distante ou activation Phala n'accompagne cette intégration. La prochaine étape GitHub est la publication de `PhalaIntegration` et la PR ; la revue avec Ali et la validation de la configuration distante restent nécessaires avant fusion vers staging.

### Ordre des actions GitHub

1. Relire et sélectionner les changements locaux à conserver, y compris les nouveaux scripts importés par le code existant et ce document. Les commiter explicitement ; éviter un ajout global aveugle. Secrets, sauvegardes et `AGENTS.md` restent exclus.
2. Actualiser les références et intégrer `origin/staging` dans `PhalaIntegration`, une fois le travail local conservé. Résoudre les conflits en gardant les fonctionnalités des deux branches : notamment connexion Google, correctifs mobile/IPFS et facturation/reprise Phala. Ne pas choisir globalement « ours » ou « theirs ».
3. Réconcilier le manifeste de dépendances et le lockfile, puis vérifier l'installation et les contrôles locaux sur le résultat intégré.
4. Publier uniquement la branche de travail et ouvrir une PR en brouillon : **base `staging`, compare `PhalaIntegration`**. Relire le diff et les migrations avec Ali.
5. Obtenir une CI complète verte sur la dernière révision de la PR, avec PostgreSQL local jetable pour les tests. Corriger les échecs sans contourner les contrôles.
6. Vérifier la préparation de staging : sauvegarde, base, contrats, mode de facturation, origines, runner éventuel et configuration du reaper. Les variables publiques nécessitent un build pour la bonne cible.
7. Après revue d'Ali et validation de la cible, fusionner la PR ; suivre séparément migrations, images, Vercel, reaper et smokes. Une CI de PR verte ne prouve pas leur réussite distante.
8. Après validation de cette base commune, créer les deux branches A1/A2 depuis le nouveau `staging` et ouvrir des PR ciblées. Ne pas fusionner vers `main` dans cette opération.

Pour les règles GitHub, viser une revue par l'autre développeur, le contrôle `Vérification` obligatoire et l'absence de push direct sur les branches de déploiement. La disponibilité dépend de l'offre et des droits du dépôt ; conserver le dépôt privé. Si ces règles ne peuvent pas être imposées techniquement, appliquer explicitement la même discipline à deux. Voir [les protections GitHub](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).

Le contrôle préalable conserve l'état observé à la création du document ; la section d'intégration locale donne l'avancement suivant. Ces sections décrivent la préparation avant publication ; l’avancement suivant figure ci-dessous.


### Base commune intégrée et lot A1 — 24 septembre 2026

La [PR #4](https://github.com/alibenyezza/sirius-mezo/pull/4) a été fusionnée dans `staging`, commit `368abb8`. La [pipeline de staging](https://github.com/alibenyezza/sirius-mezo/actions/runs/36018852971) est passée, y compris migrations, images, Vercel, reaper et smokes. Cette intégration ne démarre pas la CVM Phala.

Ali travaille sur `fix/runner-recovery` depuis cette base. L'implémentation A1 et son interface pour Ali sont décrites dans [RUNNER-RECOVERY-A1.md](RUNNER-RECOVERY-A1.md) : reprise des remboursements v7, liaison RA-TLS au déploiement, anti-rejeu SQLite, export comptable et préflight de finalité. La validation locale couvre 336 tests applicatifs, 18 tests d'exploitation, le parcours de facturation EVM, lint, typage et build sous Node 22. La revue de la PR A1 et les essais Phala restent nécessaires avant activation.

Ali peut avancer sur `feat/operations-accounting` en consommant `RunnerAccountingExport` et `pnpm --silent runner:budget export`. Les répertoires `scripts/operations/` et `deploy/operations/` restent dans son périmètre. Toute activation Phala et tout essai payant nécessitent toujours un créneau et un budget autorisés.

### Lot B : cible staging retenue — 24 septembre 2026

Les PR #5 et #6 sont fusionnées et déployées sur staging. Ali a choisi d'y raccorder Phala/v7 avant le site public. La préparation se poursuit sur `feat/phala-v7-integration` ; le [runbook du lot B](PHALA-V7-STAGING.md) donne les contrôles, l'initialisation explicite, les configurations séparées et les preuves attendues. Le RPC archive, le gas du wallet Phala et les politiques d'Ali restent des prérequis ; l'intégration réelle et les essais à deux wallets ne sont pas encore réalisés.

### Lot A2 — 24 septembre 2026

Ali travaille sur `feat/operations-accounting` depuis `staging` (`332afae`). Le détail et les procédures sont dans [OPERATIONS-ACCOUNTING.md](OPERATIONS-ACCOUNTING.md) : contrat testé de l'export A1, relevé des escrows en lecture seule, proposition tarifaire bloquée tant qu'elle n'est pas approuvée, fiche des limites fournisseurs, rapport de supervision et watchdog durci, contrôle de restauration du volume runner, inventaire historique, [matrice navigateur](BROWSER-TEST-MATRIX.md) et [guide d'entretiens](PILOT-INTERVIEWS.md). Validation locale sous Linux et Node 22 : 56 tests d'exploitation, typage et lint.

Le rapprochement comptable (A2.1) est livré et vérifié sur les relevés réels v5/v6 : 56 tests d'exploitation. Points à convenir avec Ali : commandes `ops:*` à ajouter au manifeste, canal en lecture seule du contrôle de budget vers le superviseur, copie hors machine des sauvegardes, validation de l'inventaire. Aucun push, activation Phala, dépense ni migration distante n'accompagne ce travail.

### Lot B2 — 25 septembre 2026

Ali travaille sur `feat/migration-historique` depuis `staging` (`c30cff8`). Livré : l'inventaire de migration en lecture seule ([MIGRATION-RUNBOOK.md](MIGRATION-RUNBOOK.md), répété sur PostgreSQL), les lecteurs d'anciens formats épinglés ([HISTORICAL-COMPATIBILITY.md](HISTORICAL-COMPATIBILITY.md)), le runbook de la fenêtre de maintenance, les scénarios navigateur du parcours v7 (`e2e/billing-v7.spec.ts`) et le kit de preuve du parcours réel ([TESTNET-RUN-KIT.md](TESTNET-RUN-KIT.md)). Validation locale sous Linux et Node 22 : 32 tests d'exploitation, 71 tests navigateur, typage et lint.

Constats pour la suite : les deux migrations sont déjà appliquées sur staging par la pipeline ; la fenêtre de production est la fusion vers `main` ; le prêt v6 de 10 USDC ouvert jusqu'au 1er octobre bloque `contracts:check-upgrade` jusque-là. Reste B2.5, le parcours réel à deux wallets dans le créneau Phala de Ali. Commandes `ops:db-inventory` et `ops:testnet-evidence` à ajouter au manifeste. Aucun push, activation Phala, dépense ni migration distante n'accompagne ce travail.

### Intégration A2/B2 et nouveau staging — 25 septembre 2026

La [PR #8](https://github.com/alibenyezza/sirius-mezo/pull/8), issue de `feat/staging-v7-completion`, est fusionnée dans `staging` (`0423f4a`) : A2/B2 réunis, commandes d’exploitation raccordées, financement explicite par crédits Phala réservé aux wallets internes, diagnostic RA-TLS pour le superviseur et ajout de wallets sans remise à zéro du registre. CI verte. Voir [les essais internes](PHALA-TRIAL-CREDITS.md).

Ali a choisi de vider la base staging existante et d’abandonner ses anciennes données de démonstration. Trois nouveaux contrats testnet sont déployés et finalisés ; leurs adresses et les mesures Phala actives sont enregistrées dans Vercel staging et les configurations locales dédiées. Le runner actif, son budget et la stabilité de son identité après redémarrage sont vérifiés. Le prêt v6 historique n’empêche pas ce parcours indépendant. Ali a terminé les tranches 0 à 2 du nouveau VPS ; SSH et accès Neon sont vérifiés. Les reapers historiques staging et production sont déployés sur le nouvel hôte ; les secrets GitHub des deux environnements sont basculés et leurs jobs VPS ont réussi. Vercel et les migrations n’ont pas été relancés pendant ce transfert. Watchdog/collecteur sont installés sous `sirius-ops`, timers désactivés. Les anciens reapers restent en place par choix de Ali ; le nettoyage Neon et la bascule v7 attendent la neutralisation des anciens écrivains staging. Le parcours réel reste à exécuter avec Ali. État exact, transactions et répartition restante : [lot B](PHALA-V7-STAGING.md#ce-quil-reste-à-fournir-et-à-exécuter), [migration VPS](VPS-MIGRATION.md). La production reste hors de cette remise à zéro.
