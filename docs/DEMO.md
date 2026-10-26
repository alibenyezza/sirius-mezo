# Démo EVM locale et testnet

**État au 23 septembre 2026 :** le [parcours v7](BILLING-INTEGRATION.md) est intégré localement et son test EVM isolé passe. Le [suivi de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) décrit les correctifs et les limites encore bloquantes. Phala est arrêté. Les commandes de déploiement et de démarrage ci-dessous sont des procédures pour une future opération validée, pas des actions effectuées pendant ces correctifs.

Pour reproduire uniquement le parcours de facturation local, `pnpm test:billing` compile les contrats et démarre son nœud Hardhat isolé avec token synthétique, worker réel et IPFS simulé. Il ne requiert ni portefeuille public financé, ni Pinata réel, ni Phala. Les valeurs de prix et de budget de ses fixtures ne sont pas des tarifs commerciaux.

## Préparation

Copier l'environnement puis renseigner au minimum :

- `EVM_NETWORK="testnet"` ;
- `MEZO_DEPLOYER_KEY` avec un compte testnet financé ;
- `EVM_RPC_URL` pour les scripts applicatifs et de déploiement si le RPC public ne convient pas ; `MEZO_TESTNET_RPC` configure séparément le réseau Hardhat ;
- `SIRIUS_USDC_ADDRESS`, `NEXT_PUBLIC_SIRIUS_USDC_ADDRESS` et `SIRIUS_USDC_CODE_HASH`, issus du token utilisé pour la démo ; `contracts:bootstrap-demo` peut créer un token synthétique, qui n'est pas de l'USDC officiel ;
- `SIRIUS_KYB_ADMIN`, `SIRIUS_KYB_VERIFIER`, `SIRIUS_SMOKE_PROVIDER_ADDRESS`, `SIRIUS_SMOKE_DATASET_ID` et `SIRIUS_SMOKE_MODEL_ID` ;
- `SIRIUS_MASTER_KEY`, `SIRIUS_SESSION_SECRET` et `RUNNER_TRANSPORT_SECRET` ;
- `PINATA_JWT` et `PINATA_GATEWAY` pour le parcours IPFS ;
- les quatre adresses une fois le déploiement effectué : escrow, USDC, KYB et dataset.

La pipeline configure `SIRIUS_APP_ORIGIN`, `SIRIUS_APP_ORIGIN_ALIASES` et
`NEXT_PUBLIC_SIRIUS_APP_ORIGIN` depuis la branche, avant le build et le déploiement.
Staging utilise `https://sirius-mezo-staging.vercel.app` ; main utilise
`https://sirius-data.tech` et ses alias Vercel. Un merge ne nécessite pas de recopier
ces valeurs. Le runner distant garde le même domaine canonique que son application.
En local, conserver l'origine localhost et une origine publique vide.
Voir [DEPLOYMENT.md](DEPLOYMENT.md) pour la matrice, le refus 403 du challenge et les
fichiers ignorés qui persistent lors d'un changement de branche.

Ne jamais utiliser de clé mainnet pour une démo.

## Vérification locale des contrats

```bash
pnpm install --frozen-lockfile
pnpm contracts:compile
pnpm contracts:test
pnpm test:billing
pnpm contracts:abi
pnpm datasets:generate
```

Ces commandes valident les contrats et régénèrent les ABI TypeScript. `test:billing` déploie uniquement des contrats éphémères sur son nœud Hardhat local ; aucun déploiement public n'est effectué.

La [procédure v6](ESCROW-V6.md) conserve les correctifs F1–F4 et la migration historique. La prochaine bascule suit [v7](BILLING-INTEGRATION.md), après correction des bloqueurs, validation des tarifs et préparation des budgets. Ne pas déployer un v6 intermédiaire pour le seul changement de runner ; les étapes historiques ci-dessous ne valent pas validation de v7.

## Déploiement testnet

Avant la future bascule v7 : contrats et trésorerie choisis, politiques validées, registre persistant, historiques préservés, préflights et migrations prêts. Le mode par défaut du code reste v6 ; l'activation v7 exige `SIRIUS_BILLING_VERSION=7` de manière cohérente sur les composants concernés. Suivre [DEPLOYMENT.md](DEPLOYMENT.md) et [PHALA.md](PHALA.md).

```bash
pnpm contracts:deploy:testnet
```

Les versions v6 et v7 exigent `SIRIUS_LOCK_AUTHORIZER`, l’adresse publique du compte de règlement du runner. Le script choisit la version d'escrow selon la configuration de facturation et affiche les adresses du déploiement. Reporter ces valeurs dans l'environnement ciblé :

```dotenv
NEXT_PUBLIC_SIRIUS_ESCROW_ADDRESS="0x..."
NEXT_PUBLIC_SIRIUS_USDC_ADDRESS="0x..."
NEXT_PUBLIC_SIRIUS_KYB_ADDRESS="0x..."
NEXT_PUBLIC_SIRIUS_DATASET_ADDRESS="0x..."
SIRIUS_ESCROW_ADDRESS="0x..."
SIRIUS_USDC_ADDRESS="0x..."
SIRIUS_KYB_ADDRESS="0x..."
SIRIUS_DATASET_ADDRESS="0x..."
```

`SIRIUS_ESCROW_ADDRESS` est la valeur serveur utilisée pour lier la dérivation du préimage au déploiement précis. Elle doit désigner le même contrat que la valeur publique.

Le script vérifie le code de l'USDC configuré contre `SIRIUS_USDC_CODE_HASH` et refuse un escrow existant : chaque déploiement crée un nouveau trio KYB, escrow et dataset cohérent. L'émetteur KYB doit signer les attestations des wallets hors de l'application avant le smoke.

Avant de remplacer les adresses d'une instance partagée, tous les prêts existants doivent être réglés ou remboursés. La migration bloque explicitement tant qu'un prêt est actif, suspend les anciens titres incompatibles, puis les datasets doivent être réimportés et publiés sur le nouveau registre.

### Migration et historique des prêts

La pipeline vérifie la chaîne avant la migration des profils. Dans les **variables GitHub de l'environnement ciblé** (`staging` ou `production`), renseigner :

- `EVM_NETWORK` ;
- `EVM_RPC_URL` (facultatif si le RPC par défaut convient) ;
- `SIRIUS_MIGRATION_ESCROW_ADDRESSES` : liste séparée par des virgules de **tous** les escrows utilisés par cette base, anciens et actuel.

Un statut `CANCELLED` en base ne prouve pas un remboursement : le préflight bloque aussi si le contrat contient encore un lock actif. Ne jamais contourner ce contrôle en modifiant les statuts SQL. Un RPC indisponible bloque la vérification sans annuler de prêt. Effectuer le changement de contrats en maintenance, sans nouvel emprunt ni transaction wallet en attente : le contrôle ne peut pas prédire une transaction diffusée après sa lecture.

Pour lancer le même contrôle localement avec l'environnement PostgreSQL ciblé déjà chargé :

```bash
NODE_OPTIONS="--conditions=react-server" node --import tsx scripts/check-evm-migration.ts
pnpm exec prisma migrate deploy
```

La migration additive `20260905010000_track_loan_deployment` conserve le réseau, l'escrow et le bloc de préparation des nouveaux prêts. Elle ne supprime aucun dataset et ne requiert pas de clôturer les prêts actifs. Le blocage des prêts et la suspension des datasets concernent l'ancienne migration `20260905000000_add_dataset_training_profile`, si celle-ci n'a pas encore été appliquée. Ne pas réécrire les migrations déjà appliquées. Le préflight refuse les schémas autres que `public` et les locks connus sans reçu miné.

Les migrations supplémentaires `20260919000000_track_runner_provenance` et `20260923000000_add_compute_billing` sont nécessaires au code courant. La seconde ajoute les champs du devis au prêt ; elle ne migre aucun escrow actif vers v7. Elles n'ont pas été appliquées à distance pendant cette passe.

Configurer `SIRIUS_LEGACY_ESCROW_ADDRESSES` (anciens escrows, même réseau, séparés par des virgules) dans **Next/Vercel, le worker VPS et le runner Phala**. Garder la master key du runner : changer de contrat n'implique pas de changer les clés de chiffrement. Les reçus v2 historiques ne sont acceptés que pour livrer un modèle déjà réglé, jamais pour autoriser un nouveau règlement.

Le reaper récupère les locks dont le hash n'a pas été enregistré, y compris ceux annulés seulement en base. Pour les prêts anciens, la recherche commence au bloc de mint du dataset. Si ce bloc manque aussi, fournir le hash de la transaction `lock` via « Récupérer le lock » ; ne pas inventer une confirmation locale. Les prêts expirés se remboursent depuis le wallet du borrower ; le crédit USDC reste à retirer avec le mécanisme de retrait du contrat.

Le VPS doit également définir `SIRIUS_DATASET_ADDRESS`. Lors d'une future bascule, mettre à jour worker et runner avec leurs configurations, pas seulement le frontend. La compatibilité des contrats v5/v4 concerne la reprise historique et les correctifs applicatifs du 5 septembre ; les nouveaux prêts du code courant exigent v6 ou v7 selon le mode choisi. Elle ne dispense pas des nouveaux contrats requis pour Phala et la facturation.

## Mise à jour des correctifs sur staging

La checklist qui suit concerne uniquement les correctifs applicatifs du **5 septembre**. Les corrections F1–F4 du 13 septembre ont ensuite introduit v6 : voir [ESCROW-V6.md](ESCROW-V6.md). Ces instructions historiques ne constituent pas la procédure d'activation du parcours v7 audité le 23 septembre.

Cette mise à jour ne change aucun contrat Solidity. Conserver Escrow v5, DatasetRegistry v4, KYB et le token existants ; ne pas relancer `contracts:deploy:testnet` ni `contracts:bootstrap-demo` pour ces correctifs.

1. Sauvegarder la base PostgreSQL ciblée. Si la migration des profils est encore en attente, suivre les contrôles de prêts ci-dessus pendant une fenêtre de maintenance ; ne pas utiliser `migrate reset` ni contourner les statuts.
2. Dans le projet Vercel **`sirius-mezo-staging`**, utiliser l'environnement **Production** choisi par la pipeline. Les origines du sign-in y sont synchronisées automatiquement. Ajouter `SIRIUS_LEGACY_ESCROW_ADDRESSES` avec tous les anciens escrows de cette base, sans remplacer `SIRIUS_ESCROW_ADDRESS` par une ancienne adresse.
3. Dans `.env.vps` du worker staging, renseigner le même réseau, le même escrow courant, `SIRIUS_DATASET_ADDRESS` et la même liste historique. La pipeline redéploie le worker ; le frontend seul ne suffit pas.
4. Dans les variables GitHub de l'environnement **staging**, renseigner `EVM_NETWORK=testnet`, éventuellement `EVM_RPC_URL`, et `SIRIUS_MIGRATION_ESCROW_ADDRESSES` (escrows historiques et courant). Ces variables ne sont pas récupérées automatiquement depuis Vercel. Un RPC contenant un jeton doit rester un secret GitHub, pas une variable ordinaire.
5. Relancer la pipeline sur le code mis à jour : tests → migration additive → déploiement Vercel/worker. Si `RUNNER_URL` est vide, le runner local de démonstration est mis à jour avec Next. Si un runner Phala distant est utilisé, mettre à jour son image et sa liste historique séparément, conserver sa master key et réépingler ses mesures RA-TLS.
6. Le smoke de la pipeline contrôle les challenges sur les domaines autorisés et le refus de l'autre branche. Vérifier aussi dans le navigateur : login, accueil conservé au rechargement, upload linéaire/logistique, profil imposé à l'emprunt, animation pendant le calcul, reprise, livraison historique, puis remboursement d'un prêt expiré et retrait du crédit.

Repères issus du déploiement staging communiqué le 5 septembre 2026, à comparer aux paramètres de l'instance avant toute modification :

| Usage | Adresse |
|---|---|
| Escrow courant v5 | `0xede81141d007593d4bfce2de4778f753d167700e` |
| DatasetRegistry courant v4 | `0x18a6594a7a5b227b87808c733c40067d20357618` |
| Ancien escrow à conserver pour l'historique | `0x2634986bb181f41f50447dcbea4b3fc6affaf416` |

Pour ces deux escrows uniquement : la liste historique contient l'ancien ; la liste de migration contient l'ancien **et** le courant, séparés par une virgule. Ajouter tout autre déploiement réellement utilisé par cette base.

Ne jamais copier la clé privée du déployeur vers le frontend. Les identifiants PostgreSQL sont conservés à la demande de Ali ; l'ancienne note évoquant un partage hors du gestionnaire de secrets n'a pas été étayée. Préserver aussi les clés historiques du runner. La [préparation opérationnelle](OPERATIONS-PREPARATION.md) décrit la sauvegarde et les contrôles réalisés sans rotation ni activation distante.

## Smoke on-chain

Cette commande conserve son périmètre historique v6 et refuse v7 avant toute écriture. Pour v7, le test local est `pnpm test:billing` ; la validation publique future devra exercer le vrai runner et ses devis, sans exporter sa clé. Ne pas employer le smoke historique comme preuve de validation v7.

```bash
pnpm contracts:smoke
```

Depuis v6, ce smoke exige un escrow testnet dédié dont le déployeur est l’autorisateur ; il refuse l’escrow du runner avant toute transaction. Le parcours applicatif valide le vrai runner sans exporter sa clé. Le smoke exige aussi un borrower et un provider déjà attestés, ainsi qu'un titre EVM live de ce provider (`SIRIUS_SMOKE_DATASET_ID`) dont le profil correspond à `SIRIUS_SMOKE_MODEL_ID`. Il exerce l'approbation USDC, le verrouillage, le release et le retrait du crédit. Il doit être exécuté avant d'intégrer les adresses dans une instance partagée.

## Parcours applicatif

Le parcours navigateur est EVM-only. La validation locale couvre séparément les contrats, le runner et l'application :

L'upload est limité à **3 Mio de CSV**, afin que l'enveloppe chiffrée encodée en JSON reste sous la limite de corps des fonctions Vercel. Le contrôle s'applique dans le navigateur et dans le runner.

```bash
pnpm test
pnpm test:billing
pnpm test:operations
pnpm lint
pnpm build
docker compose --env-file .env.local up --detach --wait --build
pnpm runner:smoke
```

Validations du 23 septembre : dernière passe réussie avec 304 tests applicatifs, 13 tests des outils d'exploitation, lint et typage applicatif. Le build a été validé lors de la passe précédente. Les passes précédentes couvrent aussi 79 tests contrats, 62 tests navigateur, le typage v7, un parcours EVM v7 et PostgreSQL 17 entre huit processus. La sauvegarde réelle a été restaurée et migrée sur PostgreSQL 18 local. Avant activation, valider les pannes encore ouvertes, le parcours à deux vrais wallets, les remboursements/retraits et RA-TLS sur Phala actif et testnet. Ce guide ne prouve aucune de ces validations distantes.
