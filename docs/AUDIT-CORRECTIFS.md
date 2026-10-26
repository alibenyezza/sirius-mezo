# Audit des correctifs — 5 septembre 2026

> Mise à jour de lecture — 23 septembre 2026 : ce rapport conserve ses constats, correctifs et résultats historiques. L'[audit approfondi](AUDIT-2026-09-23.md) inclut un suivi des correctifs locaux et des limites restantes du parcours v7. Les résultats ci-dessous ne constituent pas une validation de ces nouveaux scénarios ni de l’environnement distant. Phala reste arrêté.

Ce rapport conserve les résultats historiques du 5 septembre. Les modifications de connexion et de configuration par branche du 12 septembre sont décrites dans [DEPLOYMENT.md](DEPLOYMENT.md) ; leurs validations ne remplacent pas rétroactivement celles ci-dessous. Les constats ultérieurs et leurs correctifs figurent dans [l'audit staging du 12 septembre](AUDIT-STAGING-2026-09-12.md) et [l'audit du 23 septembre](AUDIT-2026-09-23.md).

## Périmètre et résultat

Relecture des correctifs applicatifs de staging : prêts, escrow historique, runner, remboursements, upload, worker et migrations. La relecture sécurité a été effectuée séparément de l'implémentation, puis les cas signalés ont été reproduits avec des transactions et une base simulées.

Les problèmes identifiés dans ce périmètre sont corrigés localement. Cela ne constitue ni un audit externe des contrats ni une validation de l'instance distante. Aucun contrat, secret distant ou état de prêt réel n'a été modifié pendant cet audit.

## Correctifs vérifiés

| Problème | Correction |
|---|---|
| Un mauvais hash rendait le prêt définitivement impossible à reprendre | Conservation immédiate du hash, libération d'un candidat prouvé invalide, remplacement seulement sur preuve du vrai lock confirmé |
| Une autre transaction du même borrower vers l'escrow pouvait être acceptée | Validation partagée de l'émetteur, du contrat, de l'appel `lock` et du hash du prêt |
| Une reprise concurrente pouvait répondre succès sans avoir changé l'état | Vérification du nombre de lignes modifiées, puis de l'état et du hash relus |
| Un candidat de remplacement rejeté pouvait annuler un vrai lock encore pending | La reprise utilisateur ne peut pas annuler un prêt sans lock confirmé ; l'annulation automatique reste au reaper |
| Un ancien remboursement correctement retrouvé était présenté comme un échec | Acceptation de `CANCELLED` seulement avec preuve on-chain de remboursement et le bon hash de lock |
| La migration pouvait passer avec une transaction connue encore en attente | Exigence d'un reçu miné ; contrôle aussi des prêts annulés sans preuve de remboursement ; refus des schémas PostgreSQL non supportés |
| Des erreurs techniques pouvaient journaliser préimage, URL RPC ou jeton | Suppression des objets erreur bruts dans les chemins API, règlement, reaper et démarrage runner concernés |
| Une panne de base pouvait provoquer un rejet non géré du reaper local | Capture de l'échec planifié et reprise à la passe suivante |

Les correctifs précédents restent couverts : livraison d'un modèle AES-GCM avec reçu HMAC v2 après redéploiement autorisé, séparation des clés par chaîne/escrow, remboursement signé dans le wallet sans master key Next, récupération des locks non enregistrés et pagination au-delà de 50 prêts actifs.

L'upload accepte au maximum 3 Mio de CSV. Un test chiffre effectivement un fichier à cette limite et vérifie que l'enveloppe JSON reste sous 4,5 MB ; un fichier plus grand est rejeté.

## Validation locale

- Tests applicatifs : 156 tests, dont 23 tests comportementaux de reprise, migration et erreurs techniques.
- Contrats Hardhat : 41 tests.
- Lint et typage TypeScript vérifiés ; build Next vérifié avec `next build --webpack` et une URL PostgreSQL factice de build, sans accès à la base distante.
- Playwright : lancement tenté, bloqué avant les scénarios par `listen EPERM 127.0.0.1:3100` dans l'environnement d'exécution. Le parcours navigateur n'est donc pas déclaré validé ici.
- Aucun smoke testnet, déploiement Phala ou migration sur Neon n'a été exécuté.

## Mise en service

**Pas de nouveau déploiement Solidity pour ces correctifs** si l'instance utilise déjà SiriusEscrow v5 et SiriusDatasetRegistry v4. Les contrats et leurs ABI n'ont pas changé.

La migration `20260905010000_track_loan_deployment` ajoute trois colonnes nullable et ne clôture aucun prêt. Les variables d'historique doivent être alignées entre Next, le worker et le runner distant éventuel. Le préflight des profils utilise les variables de l'environnement GitHub, pas celles récupérées par Vercel. Voir la [checklist staging](DEMO.md#mise-à-jour-des-correctifs-sur-staging).

## Limites et actions externes

- Le RPC de règlement voit le préimage avant inclusion de `release` : il reste une dépendance de confiance. Masquer les logs ne protège pas contre un RPC hostile ou la diffusion d'une transaction non minée.
- Les escrows historiques doivent tous être déclarés. Si hash et bloc de préparation/mint manquent, une récupération manuelle du vrai hash de lock reste nécessaire.
- Les tests de persistance et de RPC utilisent des doublures ; les conflits réels PostgreSQL, le navigateur et les transactions testnet restent à vérifier après déploiement.
- Le mode démonstration sans runner distant n'est pas une enclave attestée. La validation Phala/RA-TLS reste ouverte.
- **Rectificatif du 23 septembre :** la mention antérieure d'un mot de passe Neon partagé n'a pas été étayée par son message d'origine ; aucune compromission n'est établie. Ali demande de conserver les identifiants PostgreSQL existants, sans rotation dans cette préparation. Préserver aussi la master key historique nécessaire aux modèles existants. Voir [OPERATIONS-PREPARATION.md](OPERATIONS-PREPARATION.md).

## Messages de commits proposés

1. `fix(staging): harden loan recovery, migrations and uploads` — code, tests, migration additive, configurations d'environnement et déploiement.
2. `docs: update EVM architecture and staging deployment guide` — README et documentation dans `docs/`.

Ces messages sont des propositions : aucun commit ni push n'a été réalisé par l'assistant.
