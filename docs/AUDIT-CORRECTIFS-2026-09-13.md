# Correctifs de l’audit staging — 13 septembre 2026

> Mise à jour de lecture — 23 septembre 2026 : ce rapport conserve ses constats, correctifs et résultats historiques. L'[audit approfondi](AUDIT-2026-09-23.md) inclut un suivi des correctifs locaux et des limites restantes du parcours v7. Les résultats ci-dessous ne constituent pas une validation de ces nouveaux scénarios ni de l’environnement distant. Phala reste arrêté.

Les neuf constats A1–A9 sont corrigés dans le code local de staging. Aucun déploiement distant, changement de secret, transaction publique, commit, push ou commande Git n’a été exécuté pendant cette passe. Le code Solidity et la configuration distante constituent deux états distincts.

## Corrections et preuves

| ID | Correctif | Validation locale |
|---|---|---|
| A1 | Wallet et Dashboard affichent les crédits USDC et proposent `withdrawFor` pour le bénéficiaire de la session. Les escrows courants et historiques autorisés sont lus séparément, avec les décimales de leur token. Un contrôle d’identité précède l’envoi wallet, après la vérification du réseau. | Route réelle : v5/v6, bénéficiaire, calldata, panne historique isolée. Chromium : retrait confirmé, crédit et solde rafraîchis ; transaction rejetée, crédit conservé. Contrats : release/refund/crédits/retraits. |
| A2 | L’ingestion et le calcul partagent le plafond de 20 millions d’opérations. Une erreur de budget est imputable au CSV et remonte avant scellement. | CSV linéaire de 19 999 lignes / 32 paramètres et logistique de 4 000 lignes refusés avant calcul ; seuil exact admissible testé. |
| A3 | Le login vérifie la révision wallet et le provider après les attentes. Les opérations de cookie sont sérialisées ; une vérification obsolète nettoie sa session avant une nouvelle tentative. | Chromium avec signature EIP-191 et réponse verify retardée. Tests applicatifs : compte, réseau, provider, logout et nouvelle connexion. |
| A4 | Entraîner, Audit et Mes datasets recréent leurs états par identité et authentification. Les anciennes réponses et clés livrées ne sont pas publiées dans le nouvel écran. | Chromium : dataset privé A retardé après chargement de B ; historique A remplacé par B. |
| A5 | Wallet et Dashboard recréent soldes et états associés lors du remplacement de la connexion. | Chromium : A à 111 USDC, réponse retardée après B à 22 ; B reste à 22 sur les deux pages. |
| A6 | Entraîner consomme `x-sirius-next-cursor` pour ses datasets et le catalogue. Le chargement suivant est explicite, dédupliqué et invalidé par un refresh plus récent. | Chromium : accès à la page suivante pour les deux listes, conservation de la première page et disparition du bouton en fin de liste. |
| A7 | Préparation et soumission KYB ont chacune trois appels par sujet/heure. Le quota client reste partagé. La finalisation parrainée contrôle l’émetteur serveur, tandis que le parcours direct exige toujours le sujet. | Route réelle : 200 → 503 → 200 → 200 puis troisième tentative possible ; quatrième refusée. Finalisation parrainée et refus du même émetteur dans le parcours direct. |
| A8 | `SiriusKybRegistry` v3 inclut `uint64 verifierEpoch` dans le message signé, sous un domaine EIP-712 version `2`. Le producteur de consentement parrainé est aligné. | Hardhat : signatures inutilisées de l’époque précédente refusées après retrait/réactivation ; nouvelles signatures acceptées, pour les deux modes d’émission. |
| A9 | La preuve d’attestation est comparée au déploiement enregistré du prêt et à la liste historique autorisée. | Route réelle et résolution historique réelle : ancien escrow autorisé accepté, non déclaré refusé, termes altérés refusés. |

Le correctif A7 inclut un défaut supplémentaire découvert pendant la correction : une transaction du vérificateur pouvait réussir puis être rejetée à la persistance, car le serveur attendait l’adresse du sujet comme émetteur. Le paramètre d’émetteur du parrainage provient du service serveur, jamais du corps HTTP.

## Vérifications

- **220 tests applicatifs réussis.**
- **62 tests Chromium réussis.**
- **46 tests Hardhat réussis.** Compilation Solidity et export des ABI effectués.
- TypeScript applicatif, ESLint et build de production Next réussis.
- Installation et génération Prisma réussies avec le lockfile mis à jour.

Les API et providers des tests navigateur sont simulés. Les tests de contrats utilisent Hardhat et des fonds locaux. Ces résultats ne prouvent pas encore le parcours complet PostgreSQL/Phala/contrats publics. Le typage autonome du harness Hardhat n’est pas un contrôle déclaré passant ; le typage applicatif et les tests Solidity le sont.

La première passe Chromium ci-dessus utilisait le dossier de développement et sa configuration locale. Le run GitHub suivant a révélé trois échecs A1/A5 dus à l’adresse USDC absente de l’environnement de test. Ces trois échecs ont été reproduits dans une copie sans `.env*` et sans variables métier héritées. Le correctif ajoute uniquement une adresse factice serveur/navigateur à Playwright, sans modifier les mocks, les assertions, les timeouts ni le code applicatif. Voir [le diagnostic CI](DEPLOYMENT.md#échec-des-tests-de-solde-en-ci).

Après ce correctif, **62/62 tests Chromium passent en 28,9 secondes** dans cette copie isolée, avec `CI=1`, un seul worker et les délais habituels. Aucun retry n’a été nécessaire. Le typage applicatif et le lint de la configuration passent également. Cette reproduction locale ne remplace pas la validation du prochain run GitHub sur Linux.

## Dépendances

Next et `eslint-config-next` passent à **16.3.5**. Les overrides corrigent les dépendances transitives affectées, en conservant l’arête `@phala/dstack-sdk → @noble/hashes 1.8.0` nécessaire à ses imports. Les remplacements de versions majeures d’outillage ont été qualifiés par installation/génération Prisma, compilation Solidity, tests Hardhat et build ; aucun déploiement ou appel de publication de source sur un explorateur n’a été effectué.

| Scan | Avant | Après |
|---|---|---|
| Complet | 62 entrées : 2 critiques, 28 hautes, 25 modérées, 7 faibles | 1 faible ; aucune modérée, haute ou critique |
| Production | 27 entrées : 2 critiques, 12 hautes, 11 modérées, 2 faibles | 1 faible ; aucune modérée, haute ou critique |

L’alerte restante est **`elliptic` 6.6.1 — GHSA-848j-6mx2-7j84**. Le registre npm ne publie pas la version 6.6.2 suggérée par la plage du scanner ; l’[avis GitHub](https://github.com/advisories/GHSA-848j-6mx2-7j84) indique qu’aucune version corrigée n’est disponible. Le package subsiste notamment dans `@phala/dcap-qvl` et des dépendances d’outillage. Le module de compatibilité Phala inspecté l’utilise pour vérifier les signatures ; aucun exploit applicatif de cet avis n’a été démontré. Cette observation n’est pas une correction du package.

`pnpm audit:deps`, ajouté à la CI, bloque à partir de la gravité modérée. L’alerte faible n’est pas masquée par une exception et reste visible. `pnpm audit --json` continue donc de retourner un échec ; `pnpm audit:deps` passe. Un avertissement de peer dependency (`abitype` 0.9.10 / `zod` 4) reste présent ; il n’a pas empêché les validations ci-dessus.

## Mise en service

La connexion fonctionne sans nouveau paramètre utilisateur. Pour appliquer A8 aux contrats publics, suivre la [migration coordonnée Escrow v6 / KYB strict v3](ESCROW-V6.md) :

1. Préserver la base, la master key et les adresses historiques ; terminer les anciens prêts actifs avant de changer le contrat courant du runner.
2. Déployer le registre strict v3, le registre dataset associé et l’escrow v6 sur la cible testnet choisie. Leur liaison est immuable. Produire de nouveaux consentements KYB et appliquer les mêmes adresses à Next, au worker et au runner.
3. Exécuter le préflight v6, puis vérifier un prêt complet, les deux retraits, une preuve et un modèle historiques avant réouverture.

Le registre ouvert actuel de démonstration ne reproduit pas A8 ; remplacer le code Next ne le transforme pas en registre strict. Le choix main/staging continue de sélectionner les origines ; il ne migre pas Solidity et ne choisit pas mainnet.

Les CSV scellés avant le nouveau contrôle de budget ne sont pas réévalués automatiquement : leurs propriétaires doivent réimporter les fichiers concernés. Les signatures KYB v2 sont incompatibles avec le nouveau registre. Les preuves Phala historiques restent soumises à la politique d’identité épinglée existante, qui n’a pas été assouplie.
