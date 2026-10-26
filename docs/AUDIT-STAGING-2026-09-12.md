# Audit de staging — 12 septembre 2026

> Mise à jour de lecture — 23 septembre 2026 : ce rapport conserve ses constats, correctifs et résultats historiques. L'[audit approfondi](AUDIT-2026-09-23.md) inclut un suivi des correctifs locaux et des limites restantes du parcours v7. Les résultats ci-dessous ne constituent pas une validation de ces nouveaux scénarios ni de l’environnement distant. Phala reste arrêté.

Audit du code local après les correctifs de connexion, de navigation et de configuration par branche. Le dossier est resté sur `staging`. Aucune commande Git, publication, migration distante ni transaction sur un réseau public n'a été exécutée.

Les quatre constats ci-dessous ont reçu un correctif local le 13 septembre ; voir [les corrections et la migration v6](ESCROW-V6.md). Le compte rendu suivant conserve les observations du 12 septembre avant correction. Les deux bugs frontend ont été reproduits dans Chromium ; les deux constats d'autorisation reposent sur la revue du code et des tests existants. Ils sont distincts du défaut d'origine qui causait « Sign-in challenge rejected » et qui est corrigé localement.

## Constats de l’audit initial

| ID | Priorité | Problème | Preuve |
|---|---|---|---|
| F1 | P2 — moyenne | Les événements restent attachés au premier wallet après sélection d'un autre provider | Reproduction navigateur locale |
| F2 | P2 — moyenne | Une réponse tardive réaffiche les datasets du compte précédent | Reproduction navigateur locale |
| F3 | P2 — moyenne | Le login accepte certains smart accounts que les autorisations suivantes refusent | Analyse statique |
| F4 | P2 — moyenne | Un lock hors application peut empêcher la suppression d'un dataset | Analyse statique et test existant du verrou de suppression |

### F1 — Événements du mauvais wallet

Référence : [`WalletConnector.tsx`](../src/components/wallet/WalletConnector.tsx), `openWalletModal` lignes 58–68 et effet lignes 76–120.

L'effet choisit un provider au montage, puis s'abonne à ses événements `accountsChanged` et `chainChanged`. Ses dépendances ne comprennent pas le provider sélectionné. La connexion explicite à un autre wallet met à jour le store, mais ne déplace pas les abonnements.

Reproduction avec deux providers EIP-6963 simulés :

1. Injecter A comme `window.ethereum` et annoncer A et B.
2. Ouvrir le sélecteur et choisir B ; son adresse apparaît correctement.
3. Émettre `accountsChanged` depuis B avec une nouvelle adresse.

Résultat mesuré : A garde un listener `accountsChanged`, B n'en possède aucun et l'ancienne adresse de B reste affichée. Les changements de réseau de B suivent le même chemin d'abonnement absent. L'interface peut donc afficher une identité ou un réseau différents du wallet qui signe ; les contrôles serveur ne sont pas contournés par cette reproduction.

Correction attendue : rendre le provider sélectionné observable, réabonner le connecteur lors de son changement et ignorer les retours asynchrones d'un provider remplacé. Couvrir aussi la découverte tardive d'un provider EIP-6963.

### F2 — Réponse datasets devenue obsolète

Référence : [`datasets/page.tsx`](<../src/app/(app)/datasets/page.tsx>), `loadPage` lignes 92–104 et effet lignes 118–121.

Le chargement dépend de l'adresse et de l'authentification, mais une requête déjà partie applique toujours sa réponse. Le changement de compte ne l'annule pas et aucune identité de requête n'est vérifiée avant `setDatasets`.

Reproduction avec des API interceptées et le pont de test local :

1. Connecter A et retenir sa réponse `/api/datasets`.
2. Passer à B et laisser sa nouvelle requête afficher le dataset de B.
3. Libérer la réponse de A contenant un dataset brouillon de A.

Résultat mesuré : le bouton wallet affiche toujours B, mais la liste de B est remplacée par celle de A. Cela expose dans l'interface des métadonnées déjà reçues pour le compte précédent et rend les actions incohérentes. Cette preuve ne montre aucun accès serveur non autorisé aux données d'un tiers.

Correction attendue : invalider les chargements précédents au changement d'identité, vider immédiatement les données de l'ancien compte et protéger également la pagination contre les réponses obsolètes.

### F3 — Support des comptes contractuels incohérent

Références : [`auth/verify/route.ts`](../src/app/api/auth/verify/route.ts) ligne 41, [`signature.ts`](../src/lib/evm/signature.ts) lignes 22–25 et 70–95, [`authorization.ts`](../src/lib/runner/authorization.ts) lignes 80–87, [`mutation-grant.ts`](../src/lib/auth/mutation-grant.ts) ligne 17.

Le login autorise une validation contractuelle lorsque la signature ne récupère pas directement l'adresse revendiquée. Ensuite, la délégation runner impose que l'adresse EIP-191 récupérée soit celle du compte. Pour un compte contractuel dont le propriétaire signe, ces deux adresses diffèrent : une connexion peut réussir puis les opérations protégées échouer en 401. Les mutations de visibilité et de suppression réutilisent cette validation. Par ailleurs, les signatures dont la longueur diffère de 65 octets sont rejetées avant la tentative contractuelle.

Correction attendue : définir un support cohérent de bout en bout. Si les comptes contractuels restent hors périmètre, les refuser clairement dès la connexion ; sinon concevoir leur délégation sans ajouter implicitement une nouvelle dépendance RPC de confiance au runner. Aucun parcours avec un smart wallet réel n'a été exécuté pendant cet audit.

### F4 — Suppression bloquée par un lock hors application

Références : [`SiriusEscrow.sol`](../contracts/src/SiriusEscrow.sol) lignes 148–176, [`SiriusDatasetRegistry.sol`](../contracts/src/SiriusDatasetRegistry.sol) lignes 192–200, [`provider.ts`](../src/lib/sirius/provider.ts) lignes 240–249. Le test de [`escrow.test.ts`](../contracts/test/escrow.test.ts) autour de la ligne 260 vérifie déjà le refus `DatasetInUse` pendant un lock actif.

`lock` exige un titre vivant et le KYB des deux parties, mais aucune autorisation liant les conditions du prêt au provider ou au runner. Un borrower KYB peut donc créer directement un lock absent de la base applicative, avec un montant minimal de 0,001 USDC, son propre hashlock et une durée allant jusqu'à 30 jours. Ce lock incrémente le compteur qui empêche le provider de détruire son titre. Le principal est remboursable à échéance et des locks chevauchants peuvent prolonger le blocage.

Le statut `PRIVATE` est stocké uniquement en base ; il ne ferme pas ce chemin contractuel. Le constat concerne la disponibilité de la suppression, sans preuve d'exposition du CSV ni de vol de fonds. Les gates KYB et le coût des transactions limitent les acteurs possibles, sans établir le consentement au prêt.

Correction attendue : lier l'ouverture d'un escrow à des conditions autorisées et prévoir comment un provider ferme son titre aux nouveaux prêts. Cela nécessite une évolution revue du protocole et de son déploiement, pas seulement un filtre frontend. Aucun changement Solidity ni scénario supplémentaire sur chaîne n'a été exécuté pour ce constat.

## Correctifs déjà présents dans le code local

- Origines canoniques et alias exacts sélectionnés depuis `main` ou `staging`, avant le build et au runtime Vercel ; rejet des références inconnues.
- Domaine signé conservé pour le runner et vérification de la clé d'ingestion contre le domaine canonique intégré au build navigateur.
- Cause de l'échec de challenge affichée, nettoyage de la délégation après un échec et nouvelle tentative après refus de signature.
- Restauration de session sur l'accueil sans redirection automatique vers le dashboard.
- Génération des fixtures synthétiques avant les tests CI, notamment les trois fichiers `energy-demand*.csv` attendus dans `public/examples/regression/`.

La procédure et les pièges de changement de branche sont dans [DEPLOYMENT.md](DEPLOYMENT.md). Ces changements locaux ne modifient pas les instances déjà publiées.

## Validation et état distant

| Vérification | Résultat |
|---|---|
| Tests applicatifs et scripts de cible/smoke | 190 / 190 passent |
| Suite Playwright Chromium | 49 / 49 passent |
| Tests Hardhat sur réseau local | 41 / 41 passent |
| Lint, typage TypeScript, build de production | Passent |
| Syntaxe YAML de la pipeline | Analysée sans erreur ; pipeline GitHub non exécutée |
| Reproductions F1 et F2 | Confirment les défauts ; scénarios supplémentaires hors suite existante |

Sur l'instance staging déjà publiée, une requête de challenge avec un corps vide et une origine identique à l'hôte retourne :

- domaine `sirius-mezo-staging.vercel.app` : **400 « Adresse invalide »**, donc le contrôle d'origine passe ;
- alias `sirius-mezo-staging-byezzaali-gmailcoms-projects.vercel.app` : **403 « Origine de requête non autorisée »**, donc l'ancienne configuration demeure active.

Ces sondes n'ont créé ni nonce valide ni session. Elles ne valident pas un login complet. Le smoke ajouté à la pipeline demandera, après déploiement, de vrais challenges temporaires sur tous les domaines de la cible.

Le diagnostic préalable du domaine canonique main `sirius-data.tech` a rencontré un timeout HTTPS depuis l'environnement local. Cela ne suffit pas à localiser une panne DNS ou réseau. Sa disponibilité reste à vérifier avant de déclarer la validation main réussie ; un alias accessible ne suffit pas au smoke du domaine canonique.

## Limites

La revue couvre les parcours frontend principaux, les sessions et origines, les grants et leur anti-rejeu, les routes datasets/prêts/modèles, la portée des autorisations runner, la reprise du règlement, les contrôles contractuels et la sélection des déploiements. Les tests navigateur interceptent les API et les tests applicatifs utilisent notamment des doublures de base et de RPC.

Aucun parcours complet navigateur/PostgreSQL/runner/contrats distant, aucune attestation Phala ni audit de dépendances n'a été validé ici. Aucun constat critique n'a été confirmé dans ce périmètre ; les suites vertes ne constituent pas une certification de sécurité.
