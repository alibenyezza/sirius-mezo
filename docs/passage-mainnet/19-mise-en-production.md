# Mise en production mainnet — checklist exécutable

La suite ordonnée des gestes qui font passer `sirius-data.tech` sur Mezo mainnet (31612). Chaque étape dit qui l'exécute, la commande exacte, ce qu'on vérifie et quoi faire si ça échoue. Les tests après mise en production sont dans [18-a-tester-au-passage-mainnet.md](18-a-tester-au-passage-mainnet.md) ; la décision de lancer dans [00-PLAN-GLOBAL.md](00-PLAN-GLOBAL.md).

Références : [MAINNET-LAUNCH-PLAN.md](../MAINNET-LAUNCH-PLAN.md), [MAINNET-RUNBOOKS.md](../MAINNET-RUNBOOKS.md), [DEPLOYMENT.md](../DEPLOYMENT.md), [PHALA.md](../PHALA.md), [PHALA-V7-STAGING.md](../PHALA-V7-STAGING.md), [17-audit-et-lancement-restants.md](17-audit-et-lancement-restants.md).

## Règles

- Aucune valeur secrète dans le chat, Git, la CI ou ce dossier. Ici, seulement des **noms** de variables.
- Toute transaction mainnet est signée par un humain, après lecture de la cible.
- Les commandes se lancent depuis un clone à jour du commit de staging qu'on fusionnera, avec `pnpm install --frozen-lockfile` et `pnpm contracts:compile` faits. Les fichiers privés vont dans `.ops/mainnet/` (ignoré par Git), en `0600`.
- Les clés se chargent sans passer par l'historique du shell : `read -rs MEZO_DEPLOYER_KEY && export MEZO_DEPLOYER_KEY`.
- Les variables gardent leur nom historique `*_USDC_*` : sur mainnet elles désignent l'**MUSD** de Mezo.
- Chaque étape réussie est consignée dans [MAINNET-LAUNCH.md](../MAINNET-LAUNCH.md) : heure, auteur, adresse, hash ou sortie de commande.

## Valeurs fixes

| Élément | Valeur |
|---|---|
| Réseau | Mezo mainnet, chainId `31612`, explorateur `https://explorer.mezo.org` |
| MUSD (`SIRIUS_USDC_ADDRESS`) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, 18 décimales |
| Empreinte du proxy MUSD (`SIRIUS_USDC_CODE_HASH`) | `0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6` (relevée le 4 octobre) |
| Vérificateur KYB (`SIRIUS_KYB_VERIFIER`) | `0xDf432930e4999eD8aeF94Ab72F6bE3D60F6e7455` |
| Admin KYB et trésorerie (`SIRIUS_KYB_ADMIN` = `SIRIUS_COMPUTE_RECIPIENT`) | le Safe mainnet 2/3 (adresse à créer) |
| Origine | `https://sirius-data.tech` ; alias `https://sirius-mezo.vercel.app`, `https://sirius-mezo-byezzaali-gmailcoms-projects.vercel.app` |
| Projet Vercel | `sirius-mezo` (`prj_gmEKctb6EJcsErIQqamKiZNaK5vZ`), environnement Production |
| Environnement GitHub | `production` |
| VPS | `162.19.66.80`, compte `sirius-deploy`, dossier `/opt/sirius`, projet Compose `sirius` |
| Base Neon | projet `summer-sun-75471238`, branche `mainnet` `br-icy-band-b42mskv2`, déjà créée et migrée |
| Plafonds de la bêta | `SIRIUS_MAX_LOAN_USDC=50`, `SIRIUS_MAX_EXPOSURE_USDC=500` ([plan](../MAINNET-LAUNCH-PLAN.md)) |
| Finalité | `SIRIUS_EVM_FINALITY=finalized`, `SIRIUS_EVM_CONFIRMATIONS=1` ; le bloc `finalized` est environ 8 500 blocs (≈ 14 min) derrière la tête (relevé du 5 octobre). Palier rapide facultatif pour les petits prêts : [20-finalite-rapide.md](20-finalite-rapide.md) |

## 1. Pré-requis

Rien ne commence tant qu'une ligne manque.

| Pré-requis | Qui | Preuve attendue |
|---|---|---|
| Safe mainnet **2/3** sur 31612 : Ali, Ali, clé matérielle de secours rangée hors ligne, seuil 2 | Ali et Ali | Adresse du Safe ; `eth_getCode` non vide sur l'explorateur ; une transaction de test signée par deux propriétaires |
| Compte de déploiement **neuf**, environ 0,05 ETH mainnet, clé dans un fichier local `0600`, jamais en CI ni sur un serveur | Ali ou Ali | Adresse publique et solde sur l'explorateur |
| Vérificateur KYB `0xDf43…7455` : clé dans un fichier local d'opérateur (`verifier.key`, une ligne), compte sans fonds, distinct de l'admin | Ali | Adresse ; fichier présent sur le poste d'opérateur |
| Base Neon mainnet migrée : URL **pooler** pour Next et le reaper, URL **directe** pour le job Migrations | Ali | `prisma migrate status` sans migration en attente ; tables `Loan` et `Dataset` vides |
| Carte Phala, sans recharge automatique, plafond fixé (environ 45 $/mois) ; profil CLI `sirius` connecté (`pnpm dlx phala@1.1.22 login --profile sirius`) | Ali (carte), Ali (profil) | Capture du tableau de bord Phala |
| Jeton GHCR `read:packages` pour que la CVM tire l'image privée (`DSTACK_DOCKER_REGISTRY`, `DSTACK_DOCKER_USERNAME`, `DSTACK_DOCKER_PASSWORD`) | Ali | Variables présentes dans le fichier privé du runner |
| RPC d'**archive** mainnet, une clé (section 6) | Ali | `eth_getBalance` sur un vieux bloc répond sans `historical state … is not available` |
| Montants décidés : plafonds 50 / 500 MUSD ; politique de budget (`earnedMarginUsdMicros`, `cashUsdMicros`, `fixedReserveUsdMicros`, `costsUsdMicros.request/seal/training`, `gas.totalWei`, `gas.maxTransactionWei`, `gas.maxGas`, `gas.maxFeePerGasWei`, `gas.ethUsdMicrosUpperBound`, `gas.confirmations`, `maxFailures`, `maxActive`, `validUntil`) ; politique de tarif (`minimumComputeAmount`, `profiles.*.computeAmount`, `maxFailureFee`, `executionRateAtomicPerMs`, `maxExecutionMs`, `validUntil`) | Ali et Ali | Deux fichiers JSON validés par la répétition locale de l'étape 7 |
| Pinata de production : `PINATA_JWT`, `PINATA_GATEWAY` | Ali | Un pin de test depuis le poste |
| Projet Web3Auth de production (`sapphire_mainnet`) : `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` | Ali | Domaine `sirius-data.tech` autorisé dans le projet |
| Clés MoonPay **live** (`pk_live_…` et `sk_live_…`), facultatives : sans elles le choix « carte » reste masqué | Ali | Paire live des deux côtés, ou absente des deux côtés |
| Deux wallets d'équipe pour le premier prêt (fournisseur, emprunteur) avec un peu d'ETH mainnet ; l'emprunteur avec au moins 5 MUSD (Relay depuis Base, ou virement) | Ali et Ali | Soldes sur l'explorateur |
| Accès VPS `sirius-deploy@162.19.66.80` et droits d'approbation sur l'environnement GitHub `production` | Ali | Connexion SSH ; onglet Actions |
| Staging figé : test complet sur testnet passé, second audit sans critique ni élevé ouvert, CI verte sur le dernier commit | Ali et Ali | Checklist de [00](00-PLAN-GLOBAL.md) |

## 2. Étapes, dans l'ordre

L'ordre compte. L'adresse de règlement de la machine Phala doit exister **avant** les contrats (le signataire de lock est gravé dans l'escrow) ; les contrats doivent exister **avant** l'initialisation de la machine (les politiques les désignent) ; tout doit être configuré **avant** la fusion sur main (la pipeline déploie ce qu'elle trouve).

### Étape 1 — RPC d'archive

**Qui** : Ali. **Pas de transaction.**

1. Créer la clé chez le fournisseur retenu (section 6) pour Mezo mainnet. La mettre dans `.ops/mainnet/rpc.env` sous `EVM_RPC_URL`.
2. Vérifier qu'il sert l'historique et le bon réseau :

```bash
set -a; . .ops/mainnet/rpc.env; set +a
curl -s -X POST "$EVM_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
curl -s -X POST "$EVM_RPC_URL" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"eth_getBalance","params":["0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168","0x1000"]}'
EVM_NETWORK=mainnet pnpm runner:check-finality
```

**Vérifier** : `0x1237` ; un `result` hexadécimal (et non une erreur `-32000`) ; le rapport de finalité affiche un bloc `finalized` canonique et `lagBlocks` cohérent (quelques milliers).

**Si ça échoue** : le fournisseur ne sert pas l'archive sur cette offre. Changer d'offre ou de fournisseur. Ne jamais mettre le RPC public dans `EVM_RPC_URL` de production : il refuse l'état au bloc finalisé (section 6).

### Étape 2 — Image du runner

**Qui** : Ali.

1. Relever le digest de l'image runner produite par la pipeline du **dernier commit de staging** (celui qui sera fusionné) :

```bash
gh run list --branch staging --workflow pipeline --limit 1
gh run view <id-du-run> --log | grep 'Image runner'
```

2. Noter `ghcr.io/alibenyezza/sirius-runner@sha256:<64 hex>`.

**Vérifier** : le run est vert et son commit est bien la tête de staging. L'image reconstruite sur main après la fusion aura un autre digest : elle n'est pas déployée, celle-ci reste la référence.

**Si ça échoue** : aucun run vert sur ce commit → corriger staging d'abord. Ne pas réutiliser un digest d'un commit antérieur.

### Étape 3 — Rendu des trois Compose de production

**Qui** : Ali. Docker Compose requis en local ; aucun conteneur démarré.

```bash
mkdir -p .ops/mainnet && chmod 700 .ops/mainnet
IMG=ghcr.io/alibenyezza/sirius-runner@sha256:<digest>
pnpm phala:compose-v7 bootstrap "$IMG" .ops/mainnet/bootstrap.compose.json --origin=https://sirius-data.tech
pnpm phala:compose-v7 init      "$IMG" .ops/mainnet/init.compose.json      --origin=https://sirius-data.tech
pnpm phala:compose-v7 active    "$IMG" .ops/mainnet/active.compose.json    --origin=https://sirius-data.tech
```

**Vérifier** : trois fichiers `0600`, chacun annonce `Compose … préparé pour https://sirius-data.tech`. Dans chaque fichier, `image` vaut le digest et `RUNNER_TRANSPORT_SECRET` / `PINATA_JWT` restent `${…}` (non interpolés).

**Si ça échoue** : « Préparation Compose refusée » → digest mal formé, fichier de sortie déjà présent ou Docker absent. Ne jamais déployer `docker compose config` avec les secrets interpolés : le Compose entre dans la mesure attestée.

### Étape 4 — Création et amorçage de la machine Phala de production

**Qui** : Ali. Coût : la machine tourne à partir d'ici (environ 0,06 $/h plus disque).

1. Préparer `.ops/mainnet/runner.bootstrap.env` (`0600`) avec, noms seulement : `EVM_NETWORK=mainnet`, `EVM_RPC_URL`, `PINATA_GATEWAY`, `PINATA_JWT`, `RUNNER_TRANSPORT_SECRET` (nouveau, `openssl rand -base64 32`), `SIRIUS_USDC_ADDRESS` (MUSD), `DSTACK_DOCKER_REGISTRY=ghcr.io`, `DSTACK_DOCKER_USERNAME`, `DSTACK_DOCKER_PASSWORD`. Laisser `SIRIUS_ESCROW_ADDRESS`, `SIRIUS_KYB_ADDRESS`, `SIRIUS_DATASET_ADDRESS`, `SIRIUS_LOCK_AUTHORIZER`, `SIRIUS_LEGACY_ESCROW_ADDRESSES` vides : les contrats n'existent pas encore. Jamais `SIRIUS_MASTER_KEY`, `MEZO_DEPLOYER_KEY` ni `SIRIUS_KYB_VERIFIER_KEY`.
2. Créer la **nouvelle** CVM (la CVM `e8a8b8cb…` reste la démo de staging) :

```bash
pnpm dlx phala@1.1.22 deploy --profile sirius \
  -n sirius-mainnet -t tdx.small --disk-size 20G --kms phala \
  --no-dev-os --no-public-logs --no-public-sysinfo \
  -c .ops/mainnet/bootstrap.compose.json -e .ops/mainnet/runner.bootstrap.env --wait
```

3. Noter l'identifiant de la CVM et son app ID. `RUNNER_URL` = `https://<app-id>-4100s.<gateway-domain>` (suffixe `s` obligatoire : TLS jusqu'au runner).
4. Capturer l'identité, sans aucun secret métier :

```bash
RUNNER_URL=https://<app-id>-4100s.<gateway-domain> pnpm runner:capture-ra-tls
```

**Vérifier** : quote Intel `UpToDate`, certificat lié à la quote, mode `bootstrap`, `GET /health` → `status: bootstrap`. Relever l'**adresse de règlement** (future `SIRIUS_LOCK_AUTHORIZER`), l'empreinte de la clé d'ingestion, la chaîne KMS et le MRTD. Ne **pas** épingler les mesures de l'amorçage dans Next.

**Si ça échoue** : image privée non tirée → vérifier le jeton GHCR (`read:packages`) ; PCCS `ECONNRESET` en IPv6 → relancer avec `node --dns-result-order=ipv4first --conditions=react-server --import tsx src/runner/capture-ra-tls.ts`. Tant que les contrats ne sont pas déployés, une CVM ratée peut être arrêtée et supprimée, puis recréée : son adresse n'est encore gravée nulle part.

### Étape 5 — Exécution à blanc des contrats

**Qui** : Ali, avec la clé de déploiement sur son poste. **Aucune transaction.**

```bash
read -rs MEZO_DEPLOYER_KEY && export MEZO_DEPLOYER_KEY
SIRIUS_DEPLOY_NETWORK=mainnet SIRIUS_ALLOW_MAINNET=true SIRIUS_BILLING_VERSION=7 SIRIUS_DEPLOY_DRY_RUN=true \
EVM_RPC_URL=<rpc-archive> \
SIRIUS_USDC_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 \
SIRIUS_USDC_CODE_HASH=0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6 \
SIRIUS_KYB_ADMIN=<Safe> SIRIUS_KYB_VERIFIER=0xDf432930e4999eD8aeF94Ab72F6bE3D60F6e7455 \
SIRIUS_LOCK_AUTHORIZER=<adresse de règlement de l'étape 4> \
pnpm contracts:deploy:testnet
```

Le nom du script contient « testnet » pour des raisons historiques : `SIRIUS_DEPLOY_NETWORK` choisit le réseau. Ne pas mettre `SIRIUS_KYB_MODE=open` ni `SIRIUS_ALLOW_SHARED_ROLES` : refusés sur mainnet.

**Vérifier** : `réseau : mainnet (chainId 31612)`, `USDC : 0x5fc5… (18 décimales)`, `Exécution à blanc : toutes les vérifications sont passées`, `contrats : SiriusKybRegistry, SiriusDatasetRegistry, SiriusEscrowV7`, admin = Safe, vérificateur = `0xDf43…`. Les quatre adresses (déployeur, Safe, vérificateur, règlement) sont distinctes.

**Si ça échoue** : `Code hash USDC inattendu` → relire `eth_getCode` sur `0x5fc5…d168`, confirmer sur Blockscout que le proxy est toujours celui de Mezo, mettre à jour le hash ; jamais de contournement. `L'admin KYB … doit être un contrat` → le Safe n'est pas déployé sur 31612. `Solde nul` → alimenter le déployeur (accepté à blanc, refusé en vrai).

### Étape 6 — Déploiement réel des contrats et vérification

**Qui** : Ali. **Quatre transactions mainnet** (trois déploiements, une liaison).

1. Même commande qu'à l'étape 5 **sans** `SIRIUS_DEPLOY_DRY_RUN=true`.
2. Conserver la sortie complète : les trois adresses, le gas total, le bloc `À reporter dans .env.local`. Conserver aussi les hashes, même en cas de timeout : ne jamais relancer un déploiement dont la réponse manque sans avoir lu l'explorateur.
3. Sur `https://explorer.mezo.org/address/<adresse>` pour chaque contrat, lire : escrow `VERSION()` = `sirius-escrow-usdc-v7`, `usdc()` = MUSD, `kyb()`, `datasets()`, `lockAuthorizer()` = adresse de règlement ; registre datasets `VERSION()` = `sirius-dataset-v4`, `escrow()` = l'escrow ; registre KYB `VERSION()` = `sirius-kyb-v3`, `admin()` = Safe, `isVerifier(0xDf43…)` = true, `isKybValid(0x…dEaD)` = false.
4. Préflight au bloc finalisé, depuis `.ops/mainnet/preflight.env` : `EVM_NETWORK=mainnet`, `SIRIUS_BILLING_VERSION=7`, `SIRIUS_EVM_FINALITY=finalized`, `SIRIUS_EVM_CONFIRMATIONS=1`, `EVM_RPC_URL`, `SIRIUS_USDC_ADDRESS`, `SIRIUS_USDC_CODE_HASH`, `SIRIUS_DEPLOYER_ADDRESS`, `SIRIUS_COMPUTE_RECIPIENT=<Safe>`, `SIRIUS_KYB_ADMIN=<Safe>`, `SIRIUS_LOCK_AUTHORIZER`, `SIRIUS_ESCROW_ADDRESS`, `SIRIUS_DATASET_ADDRESS`, `SIRIUS_KYB_ADDRESS` :

```bash
node --env-file=.ops/mainnet/preflight.env --conditions=react-server --import tsx scripts/check-phala-v7.ts --network=mainnet
```

5. Financer : environ 0,05 ETH vers l'adresse de règlement (ses `release`), un peu d'ETH vers le Safe (transactions d'admin KYB). Relancer le préflight.

**Vérifier** : `chainChecksPassed: true`, `issues: []` (avant le financement, seul `runner.native_balance_zero` est attendu). Le rapport dit `activationReady: false` : normal, les autres preuves viennent des étapes suivantes.

**Si ça échoue** : un déploiement rejeté laisse les contrats précédents inutilisés : redéployer la série complète (gas seulement), ne jamais mélanger deux séries. `Administration KYB hors du compte de gouvernance` → mauvais `SIRIUS_KYB_ADMIN`. `Versions, liaisons ou mode KYB … incompatibles` → une adresse recopiée de travers. Les contrats ne se modifient pas : une erreur se corrige par un nouveau déploiement, tant qu'aucun prêt n'existe.

### Étape 7 — Politiques mainnet et initialisation des volumes

**Qui** : Ali (politiques), Ali (déploiement).

1. Écrire `.ops/mainnet/budget-policy.json` et `.ops/mainnet/billing-policy.json` avec les montants décidés. Règles imposées par le code : `chainId` 31612 dans les deux ; `usdc` = MUSD en minuscules ; `usdcDecimals` 6 ; `computeRecipient` = Safe en minuscules ; `wallet` (budget) = adresse de règlement en minuscules, distincte du Safe ; `earnedMarginUsdMicros` et `cashUsdMicros` strictement positifs ; ni `trial` ni `sponsored` ; `gas.confirmations ≥ 1` ; `validUntil` du budget ≥ celui du tarif, tous deux dans le futur ; `maxFailureFee ≤ computeAmount` par profil.
2. Répéter l'initialisation en local sur un répertoire jetable (Linux ou macOS) :

```bash
rm -rf /tmp/sirius-mainnet-volume && mkdir -p /tmp/sirius-mainnet-volume/budget /tmp/sirius-mainnet-volume/replay
RUNNER_VOLUME_ACTION=initialize-new-v7-volume EVM_NETWORK=mainnet \
SIRIUS_LOCK_AUTHORIZER=<règlement> SIRIUS_USDC_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 SIRIUS_COMPUTE_RECIPIENT=<Safe> \
RUNNER_INITIAL_BUDGET_POLICY="$(cat .ops/mainnet/budget-policy.json)" RUNNER_INITIAL_BILLING_POLICY="$(cat .ops/mainnet/billing-policy.json)" \
node --import tsx scripts/initialize-runner-volume.ts /tmp/sirius-mainnet-volume
```

3. Préparer `.ops/mainnet/runner.init.env` = `runner.bootstrap.env` + `SIRIUS_ESCROW_ADDRESS`, `SIRIUS_KYB_ADDRESS`, `SIRIUS_DATASET_ADDRESS`, `SIRIUS_LOCK_AUTHORIZER`, `SIRIUS_COMPUTE_RECIPIENT`, `RUNNER_INITIAL_BUDGET_POLICY` (le JSON sur une ligne), `RUNNER_INITIAL_BILLING_POLICY`.
4. Déployer le Compose `init` sur **la même CVM** :

```bash
pnpm dlx phala@1.1.22 deploy --profile sirius --cvm-id <cvm-id> \
  -c .ops/mainnet/init.compose.json -e .ops/mainnet/runner.init.env --wait
```

**Vérifier** : la répétition locale affiche `Volumes v7 initialisés pour mainnet (chaîne 31612)`. Les logs de la CVM sont privés : la preuve de l'initialisation réelle est le démarrage actif de l'étape 8 (le runner refuse de démarrer sans registres) puis le rapport de budget attesté.

**Si ça échoue** : `Politiques mainnet invalides` ou `incompatibles ou non financées` → corriger le JSON, relancer la répétition locale. Un échec **dans la CVM** ne se corrige jamais en supprimant les volumes : analyse opérateur ([PHALA-V7-STAGING.md](../PHALA-V7-STAGING.md)). Tant qu'aucun prêt n'a été verrouillé, recréer une CVM reste possible, mais son adresse de règlement change : il faudrait redéployer l'escrow et le registre datasets (étape 6).

### Étape 8 — Activation, épinglage, redémarrage de vérification

**Qui** : Ali.

1. Préparer `.ops/mainnet/runner.active.env` = `runner.init.env` **sans** `RUNNER_INITIAL_BUDGET_POLICY` ni `RUNNER_INITIAL_BILLING_POLICY`, plus `RUNNER_MONITOR_SECRET` (nouveau, `openssl rand -base64 32`) et `SIRIUS_EVM_CONFIRMATIONS=1`.
2. Activer :

```bash
pnpm dlx phala@1.1.22 deploy --profile sirius --cvm-id <cvm-id> \
  -c .ops/mainnet/active.compose.json -e .ops/mainnet/runner.active.env --wait
```

3. Recapturer : `RUNNER_URL=… pnpm runner:capture-ra-tls`. Comparer le hash du Compose au document brut de `pnpm dlx phala@1.1.22 cvms attestation <cvm-id> --profile sirius`.
4. Épingler ces quatre valeurs (elles iront dans Next et le reaper, jamais dans la CVM) :

| Variable | Longueur | Source |
|---|---|---|
| `SIRIUS_EXPECTED_MRTD` | 96 hex | capture active |
| `SIRIUS_EXPECTED_COMPOSE_HASH` | 64 hex | capture active, identique au document d'attestation Phala |
| `SIRIUS_EXPECTED_MASTER_KEY_CHAIN_SHA256` | 64 hex | capture active, identique à l'amorçage |
| `NEXT_PUBLIC_SIRIUS_INGRESS_KEY_SHA256` | 64 hex | capture active, identique à l'amorçage |

`SIRIUS_EXPECTED_RTMR3` n'est plus lu depuis la PR #72 : RTMR3 change à chaque redémarrage et l'identité est prouvée par MRTD, le hash du Compose et le journal d'événements rejoué. Ne pas la renseigner.

5. Rapport de budget attesté : `EVM_NETWORK=mainnet RUNNER_URL=… RUNNER_MONITOR_SECRET=… SIRIUS_LOCK_AUTHORIZER=… pnpm ops:runner-monitor .ops/mainnet/budget-report.json`.
6. Redémarrage de vérification : `pnpm dlx phala@1.1.22 cvms stop <cvm-id> --profile sirius`, puis `cvms start`, puis recapture et nouveau rapport.

**Vérifier** : mode `actif` ; même adresse de règlement, même clé d'ingestion, même chaîne KMS qu'à l'amorçage ; MRTD et hash du Compose identiques avant et après le redémarrage (seul RTMR3 bouge) ; rapport de budget : chaîne 31612, `wallet` = règlement, `failures` 0, aucune opération incomplète, solde ETH > 0,03.

**Si ça échoue** : le runner actif ne démarre pas → le journal (privé) dit laquelle des vérifications a cassé : réseau RPC, versions, liaisons, `lockAuthorizer` on-chain différent du compte dérivé. Repasser le Compose `bootstrap` sur la même CVM pour la remettre dans un état sûr, corriger, réactiver. Si l'adresse de règlement a changé entre deux captures : ne pas continuer, la clé n'est plus celle de l'escrow ([runbook 1](../MAINNET-RUNBOOKS.md)).

### Étape 9 — Variables Vercel production

**Qui** : Ali. Projet `sirius-mezo`, environnement **Production** uniquement. Par le tableau de bord, ou `vercel env add <NOM> production --sensitive` qui demande la valeur sur l'entrée standard (jamais `--value=` avec un secret : il resterait dans l'historique). Liste complète et sources en section 3.1.

1. Retirer d'abord ce qui est interdit sur mainnet : `SIRIUS_MASTER_KEY`, `SIRIUS_FAUCET_KEY`, `SIRIUS_KYB_VERIFIER_KEY`, `DSTACK_SIMULATOR_ENDPOINT`, `SIRIUS_DEPLOYMENT_MODE`, `NEXT_PUBLIC_SIRIUS_DEPLOYMENT_MODE`, `SIRIUS_PHALA_DEMO`, `SIRIUS_LEGACY_ESCROW_ADDRESSES`, `SIRIUS_EXPECTED_RTMR3`, `NEXT_PUBLIC_SIRIUS_E2E`.
2. Poser toutes les variables de la section 3.1.
3. Activer la **porte d'aperçu** (section 3.1 et `.env.example`) : `SIRIUS_PREVIEW_GATE=true` et `SIRIUS_PREVIEW_KEY` (`openssl rand -hex 32`, marquée Sensitive), **avant** la fusion de l'étape 12. Tant qu'elle est active, le public voit la page d'attente « Something's cooking » sur toutes les pages, les API répondent 503 (sauf `/api/auth/challenge`, `/terms`, `/preview` et les fichiers statiques : `src/lib/preview-gate/gate.ts`), `/terms` reste lisible mais sans connecteur de portefeuille, et l'équipe teste le vrai mainnet derrière. Fermée par défaut : `true` sans clé d'au moins 32 caractères ferme le site à **tous**, équipe comprise, et les logs Vercel le disent au démarrage (`SIRIUS_PREVIEW_GATE=true sans SIRIUS_PREVIEW_KEY valide`). La clé est **générée pour ce lancement** : jamais celle d'un essai local ou staging, elle transite dans des URL et des historiques de navigateur.
4. `vercel env ls production` : relire les **noms** (les valeurs ne s'affichent pas).

**Vérifier** : chaque variable privée a sa jumelle `NEXT_PUBLIC_*` identique (quatre contrats, réseau, origine). `NEXT_PUBLIC_WEB3AUTH_NETWORK=sapphire_mainnet`. Les trois origines et `SIRIUS_REQUIRE_PHALA` seront réécrites par la pipeline : les poser quand même. `SIRIUS_PREVIEW_GATE` et `SIRIUS_PREVIEW_KEY` présentes toutes les deux, sur ce projet seulement (jamais sur staging).

**Si ça échoue** : une variable manquante arrête l'instance au démarrage avec `… obligatoire en production` dans les logs Vercel ; le site ne répond pas 200 et le job Fumée échoue. Corriger, puis redéployer (relancer le job Vercel ou pousser un commit vide sur main).

### Étape 10 — Environnement GitHub `production` et VPS

**Qui** : Ali.

1. Environnement GitHub `production` (secrets lus sur l'entrée standard, jamais en argument) :

```bash
gh variable set EVM_NETWORK --env production --body mainnet
gh variable set SIRIUS_MIGRATION_ESCROW_ADDRESSES --env production --body ""
gh secret set EVM_RPC_URL --env production < .ops/mainnet/rpc-url.txt
gh secret set DATABASE_URL --env production < .ops/mainnet/neon-direct-url.txt
gh secret list --env production ; gh variable list --env production
```

`VERCEL_TOKEN`, `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` existent déjà (transfert du 25 septembre) ; vérifier leur présence seulement.

2. VPS, reaper de production :

```bash
ssh sirius-deploy@162.19.66.80
cd /opt/sirius && cp -p .env.vps .env.vps.avant-mainnet && chmod 600 .env.vps.avant-mainnet
```

Éditer `.env.vps` avec la liste de la section 3.2 (garder la ligne `SIRIUS_WORKER_IMAGE=` : la pipeline la réécrit). `SIRIUS_LEGACY_ESCROW_ADDRESSES` vide, `SIRIUS_WITHDRAW_RELAYER_ENABLED=false`, aucun `PINATA_JWT`, aucune clé. Ne pas relancer le conteneur : la pipeline le fera avec la nouvelle image. Juste avant la fusion de l'étape 12, arrêter l'ancien reaper testnet : `docker compose -p sirius --env-file .env.vps stop reaper`.

**Vérifier** : `grep -c '^EVM_NETWORK="mainnet"' .env.vps` donne 1 ; aucune valeur `[SENSITIVE]` ; permissions `0600`.

**Si ça échoue** : restaurer `.env.vps.avant-mainnet`. Le reaper mainnet refuse de démarrer sur une configuration incomplète et nomme la variable manquante (`Reaper mainnet refusé, configuration attendue : …`), visible dans `check-reaper.sh`.

### Étape 11 — `release-check` mainnet

**Qui** : Ali et Ali ensemble. **Pas de réseau.**

1. Assembler trois fichiers privés à partir des valeurs **posées** (pas d'un export Vercel : ses `[SENSITIVE]` font échouer le contrôle) : `.ops/mainnet/next.env` (section 3.1), `.ops/mainnet/reaper.env` (copie de `.env.vps`), `.ops/mainnet/runner.env` (= `runner.active.env` + les constantes fixées par le Compose : `TEE_MODE=phala`, `SIRIUS_BILLING_VERSION=7`, `SIRIUS_EVM_FINALITY=finalized`, `RUNNER_BUDGET_FILE=/var/lib/sirius-runner/budget/ledger.sqlite`, `RUNNER_BILLING_POLICY_FILE=/var/lib/sirius-runner/budget/billing-policy.json`).
2. Lancer :

```bash
pnpm ops:check-release --network=mainnet .ops/mainnet/next.env .ops/mainnet/reaper.env .ops/mainnet/runner.env
```

**Vérifier** : `configurationReady: true`, `issues: []`. Les trois autres champs (`activeAttestationVerified`, `contractsVerified`, `policiesVerified`) restent `false` : ils sont prouvés par les étapes 6 et 8, pas par ce script.

**Si ça échoue** : chaque entrée de `issues` nomme le rôle et la variable (`next.SIRIUS_MAX_LOAN_USDC`, `divergence.RUNNER_URL`, `reaper.forbidden-secret-or-simulator`, `transport-secret`…). Corriger à la source (Vercel, `.env.vps`, fichier runner), pas seulement dans la copie.

### Étape 12 — Fusion staging → main, approbation, déploiement

**Qui** : l'un ouvre la PR, **l'autre** approuve le déploiement.

```bash
gh pr create --base main --head staging --title "release: mise en production mainnet" --body "Checklist 19 : étapes 1 à 11 consignées dans docs/MAINNET-LAUNCH.md"
gh pr checks --watch
gh pr merge --merge
gh run watch
```

Après la fusion, la pipeline s'arrête sur les jobs liés à l'environnement `production` : onglet Actions → run → « Review deployments » → `production` → Approve. Les jobs Migrations (préflight EVM sur la base mainnet, puis `prisma migrate deploy`), Front Vercel (origines, `SIRIUS_REQUIRE_PHALA=true`, build, déploiement), Reaper VPS et Fumée s'enchaînent.

**Vérifier** : `gh run watch` vert, **porte d'aperçu active** (le job Fumée passe avec elle : la racine répond 200 avec la page d'attente, et `/api/auth/challenge` est en liste blanche) ; `https://sirius-data.tech` affiche « Something's cooking » sans cookie et `curl -s https://sirius-data.tech/api/train` répond `503 {"error":"Sirius ouvre bientôt"}` ; chaque membre de l'équipe ouvre une fois `https://sirius-data.tech/preview?key=<SIRIUS_PREVIEW_KEY>` (clé collée dans la barre d'adresse, jamais dans le chat), est redirigé vers la racine et voit le site complet pendant **7 jours** (durée du cookie `sirius_preview` ; passé ce délai, rouvrir `/preview?key=…`). Le cookie est **propre au domaine** qui l'a posé : `sirius-data.tech`, `sirius-mezo.vercel.app` et l'alias du projet sont trois cookies distincts, refaire `/preview?key=…` sur chaque adresse réellement utilisée (le navigateur ne partage pas non plus le cookie entre profils ni en navigation privée) ; `/status` affiche mainnet, MUSD, plafonds 50 / 500 ; `node scripts/smoke-auth.mjs main` passe ; sur le VPS `bash deploy/vps/check-reaper.sh /opt/sirius sirius` trouve `[reaper] passe ok` ; logs Vercel sans `obligatoire en production`.

**Si ça échoue** : Migrations rouge → lire la dernière étape affichée du préflight (base d'une autre chaîne, pooler, quota Neon : [DEPLOYMENT.md](../DEPLOYMENT.md)) ; rien n'est déployé tant que ce job est rouge. Vercel rouge → variable manquante (étape 9). Reaper rouge → `.env.vps` (étape 10) ; relancer uniquement le job VPS après correction. Fumée rouge → origine ou DNS. `/preview?key=…` répond 404 à l'équipe → clé absente, trop courte ou différente de celle posée (étape 9) ; corriger la variable puis « Redeploy ». Une fusion ne se défait pas, mais un déploiement non approuvé ne se produit pas : on peut corriger sur staging, refusionner, puis approuver.

### Étape 12 bis — Ouverture au public (fin de la porte d'aperçu)

**Qui** : Ali, après les étapes 13 et 14 et la décision de l'étape 16.

1. Sur Vercel, projet `sirius-mezo`, Production : supprimer `SIRIUS_PREVIEW_GATE` et `SIRIUS_PREVIEW_KEY` (ou poser `SIRIUS_PREVIEW_GATE=false` ; la clé se retire de toute façon, elle a transité dans des URL). Elle ne se réutilise jamais : si la porte doit être reposée (section 4), **régénérer** une `SIRIUS_PREVIEW_KEY` (`openssl rand -hex 32`), ce qui invalide tous les cookies posés avec l'ancienne.
2. Redéployer : « Redeploy » du déploiement courant dans le tableau de bord, ou relancer le job Front Vercel. Les variables sont lues à chaque requête par le proxy, mais une instance ne voit un changement de variable qu'après redéploiement.

**Vérifier** : en navigation privée (sans cookie), `https://sirius-data.tech` affiche la page d'accueil et `curl -s -o /dev/null -w '%{http_code}' https://sirius-data.tech/api/auth/session` ne répond plus 503 ; `/coming-soon` reste accessible mais n'est plus liée nulle part (noindex) ; `node scripts/smoke-auth.mjs main` passe toujours.

**Si ça échoue** : la page d'attente persiste → variable encore présente ou redéploiement non fait ; un cookie `sirius_preview` restant chez l'équipe est sans effet une fois la porte retirée.

### Étape 13 — Invitations KYB des deux wallets d'équipe

**Qui** : Ali, sur le poste qui détient `verifier.key`. **Lecture seule de la chaîne.**

```bash
EVM_NETWORK=mainnet EVM_RPC_URL=<rpc-archive> SIRIUS_KYB_ADDRESS=<registre KYB> \
node --conditions=react-server --import tsx scripts/operations/kyb-invite.ts invite <wallet fournisseur> --key-file=./verifier.key --days=90
```

Puis la même commande pour le wallet emprunteur. Chaque wallet colle son code sur `https://sirius-data.tech/kyb` et accepte (une transaction, gas payé par le wallet).

**Vérifier** : `/kyb` affiche « vérifié » avec la date d'expiration ; `isKybValid(wallet)` = true sur l'explorateur ; un troisième wallet sans code ne peut ni publier ni emprunter.

**Si ça échoue** : `n'est pas un vérificateur actif de ce registre` → mauvais registre ou mauvaise clé ; `Registre KYB inattendu` → `SIRIUS_KYB_ADDRESS` erroné. Une invitation refusée sur `/kyb` vient d'un nonce ou d'une époque périmés : en régénérer une.

### Étape 14 — Premier prêt réel de 5 MUSD

**Qui** : Ali (fournisseur) et Ali (emprunteur), ou l'inverse. **Argent réel, montant minimal.**

1. Fournisseur : publier un petit dataset avec un gain tel que gain + frais de calcul = 5 MUSD (l'écran d'upload affiche les trois montants).
2. Emprunteur : « Add funds → depuis un autre wallet » si besoin (QR, adresse, avertissement réseau), puis emprunter : approbation du total exact, verrouillage. Noter le hash du lock.
3. Attendre la finalité (environ 15 minutes) : l'interface indique l'attente. Entraîner. Le règlement part de la machine Phala ; attendre sa finalité.
4. Télécharger le modèle. Ouvrir `/certificate/<id>`.
5. Rapport de budget attesté (étape 8, point 5) : `failures` 0, aucune opération bloquée.

**Vérifier** sur l'explorateur : le lock et le release sur l'escrow ; la part calcul créditée au Safe ; le crédit du fournisseur retirable depuis Wallet (retrait manuel). Consigner les hashes dans le journal.

**Si ça échoue** : un prêt verrouillé non réglé est remboursable par `refund()` après le délai de sécurité de 3 jours ; règlement bloqué → [runbooks 2 et 3](../MAINNET-RUNBOOKS.md) (`pnpm runner:budget`, `pnpm runner:transactions`). Ne pas relancer un règlement à la main depuis une autre clé : seule l'enclave signe.

### Étape 15 — Retrait de la clé de déploiement

**Qui** : Ali.

1. Vérifier que la clé n'a plus aucun rôle : `admin()` du registre KYB = Safe, `isVerifier(déployeur)` = false, `lockAuthorizer()` = règlement, `escrow()` du registre datasets déjà lié (la liaison était son seul rôle).
2. Transférer le reste d'ETH du déployeur vers l'adresse de règlement (ou le Safe), avec le wallet de son choix, en vérifiant la cible.
3. Supprimer le fichier de clé (`shred -u` ou équivalent), vider `MEZO_DEPLOYER_KEY` de tout `.env` et de l'environnement (`unset`), effacer l'historique du shell si la clé y est passée (`history -c`). Même chose pour tout poste qui l'a eue.

**Vérifier** : solde du déployeur à 0 sur l'explorateur ; `grep -rl MEZO_DEPLOYER_KEY ~ 2>/dev/null` ne renvoie que `.env.example`.

**Si ça échoue** : rien à défaire ; une clé effacée trop tôt coûte au plus le reste d'ETH qu'elle portait, elle ne gouverne rien.

### Étape 16 — Décision de lancer

Dérouler [18-a-tester-au-passage-mainnet.md](18-a-tester-au-passage-mainnet.md) (ajout de fonds, Safe, machine, bout en bout), puis la checklist de décision de [00-PLAN-GLOBAL.md](00-PLAN-GLOBAL.md). Un seul point manquant reporte d'un jour.

## 3. Inventaire des variables mainnet

« Obligatoire » = l'instance refuse de démarrer, ou le contrôle (`instrumentation-node.ts`, `runner/config.ts`, `worker/mainnet-guard.ts`, `release-check.mjs`, `exposure-limits.ts`, `deploy-policy.ts`, `phala-v7-preflight.ts`, `initialize-runner-volume.ts`) échoue sans elle. « Pratique » = sans elle, une fonction tombe en 503. La colonne `.env.example` dit si le nom y figure.

### 3.1 Next sur Vercel (projet `sirius-mezo`, Production)

| Variable | Valeur attendue | Source | Obligatoire | `.env.example` |
|---|---|---|---|---|
| `EVM_NETWORK`, `NEXT_PUBLIC_EVM_NETWORK` | `mainnet` | décision | oui | oui |
| `EVM_RPC_URL` | RPC d'archive | étape 1 | pratique (lectures au bloc finalisé) | oui |
| `TEE_MODE` | `phala` | fixe | oui | oui |
| `SIRIUS_REQUIRE_PHALA` | `true` | réécrite par la pipeline | oui | oui |
| `SIRIUS_SESSION_SECRET` | 32 octets base64, neuf | `openssl rand -base64 32` | oui | oui |
| `SIRIUS_APP_ORIGIN`, `NEXT_PUBLIC_SIRIUS_APP_ORIGIN` | `https://sirius-data.tech` | réécrites par la pipeline | oui | oui |
| `SIRIUS_APP_ORIGIN_ALIASES` | les deux alias | réécrite par la pipeline | non | oui |
| `SIRIUS_ESCROW_ADDRESS`, `SIRIUS_USDC_ADDRESS`, `SIRIUS_KYB_ADDRESS`, `SIRIUS_DATASET_ADDRESS` | étape 6 ; MUSD | sortie de `deploy.ts` | oui | oui |
| `NEXT_PUBLIC_SIRIUS_ESCROW_ADDRESS`, `NEXT_PUBLIC_SIRIUS_USDC_ADDRESS`, `NEXT_PUBLIC_SIRIUS_KYB_ADDRESS`, `NEXT_PUBLIC_SIRIUS_DATASET_ADDRESS` | identiques aux privées | idem | oui | oui |
| `SIRIUS_LEGACY_ESCROW_ADDRESSES` | **absente ou vide** | — | interdite non vide | oui |
| `SIRIUS_BILLING_VERSION` | `7` | fixe | oui (`release-check`, devis v7) | **non** |
| `SIRIUS_EVM_FINALITY`, `SIRIUS_EVM_CONFIRMATIONS` | `finalized`, `1` | fixe | oui (`release-check` ; défaut implicite sinon) | **non** |
| `SIRIUS_LOCK_AUTHORIZER` | adresse de règlement | étape 4 | oui (`release-check`, contrôle du runner) | oui |
| `RUNNER_URL` | `https://<app-id>-4100s.<gateway>` | étape 4 | oui | oui |
| `RUNNER_TRANSPORT_SECRET` | même valeur que le runner et le reaper | étape 4 | oui | oui |
| `SIRIUS_EXPECTED_MRTD`, `SIRIUS_EXPECTED_COMPOSE_HASH`, `SIRIUS_EXPECTED_MASTER_KEY_CHAIN_SHA256`, `NEXT_PUBLIC_SIRIUS_INGRESS_KEY_SHA256` | capture active | étape 8 | oui | oui |
| `SIRIUS_MAX_LOAN_USDC`, `SIRIUS_MAX_EXPOSURE_USDC` | `50`, `500` | décision | oui | **non** |
| `SIRIUS_REAPER_ENABLED` | `true` | fixe | oui | oui |
| `SIRIUS_TRUST_PROXY_HEADERS`, `SIRIUS_INGRESS_RATE_LIMITED` | `true`, `true` | fixe | oui | oui |
| `DATABASE_URL`, `DATABASE_POOL_MAX` | URL pooler Neon mainnet, `5` | Neon | oui | oui |
| `PINATA_JWT`, `PINATA_GATEWAY` | production | Pinata | pratique (modèles, publication) | oui |
| `SIRIUS_BILLING_POLICY_JSON` | même JSON que `billing-policy.json` | étape 7 | pratique (affichage du tarif à l'upload) | en commentaire seulement |
| `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID`, `NEXT_PUBLIC_WEB3AUTH_NETWORK` | projet de production, `sapphire_mainnet` | Web3Auth | `sapphire_mainnet` obligatoire dès que le client ID est posé | oui |
| `NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY`, `MOONPAY_SECRET_KEY` | `pk_live_…`, `sk_live_…` | MoonPay | non (carte masquée sans) | oui |
| `SIRIUS_ADMIN_ADDRESSES` | adresses d'Ali et Ali | décision | non | oui |
| `SIRIUS_PHALA_DEMO_ORIGIN` | `https://phala.sirius-data.tech` | fixe | non (lien de `/phala`) | **non** |
| `SIRIUS_ADMISSIONS_CLOSED` | **absente** (coupe-circuit, runbook 1) | — | non | **non** |
| `SIRIUS_MAX_CONCURRENT_UPLOADS` | `2` | défaut | non | oui |
| `SIRIUS_PREVIEW_GATE` | `true` du déploiement (étape 12) à l'ouverture (étape 12 bis), puis **absente** | décision | non (page d'attente ; `true` sans clé valide = site fermé à tous) | oui (commentée) |
| `SIRIUS_PREVIEW_KEY` | 64 hex (`openssl rand -hex 32`), Sensitive, retirée avec l'interrupteur | `openssl` | avec `SIRIUS_PREVIEW_GATE=true` seulement | oui (commentée) |

### 3.2 Reaper sur le VPS (`/opt/sirius/.env.vps`)

| Variable | Valeur attendue | Obligatoire | `deploy/vps/.env.example` |
|---|---|---|---|
| `SIRIUS_WORKER_IMAGE` | digest écrit par la pipeline | oui | oui |
| `DATABASE_URL`, `DATABASE_POOL_MAX`, `SIRIUS_REAPER_INTERVAL_MS` | pooler Neon mainnet, `5`, `30000` | oui | oui |
| `EVM_NETWORK` | `mainnet` | oui | oui |
| `EVM_RPC_URL` | RPC d'archive | oui (`mainnet-guard`) | oui |
| `SIRIUS_ESCROW_ADDRESS`, `SIRIUS_DATASET_ADDRESS`, `SIRIUS_USDC_ADDRESS`, `SIRIUS_KYB_ADDRESS` | étape 6 | oui | oui |
| `SIRIUS_LEGACY_ESCROW_ADDRESSES` | vide | interdite non vide | oui |
| `SIRIUS_BILLING_VERSION`, `SIRIUS_EVM_FINALITY`, `SIRIUS_EVM_CONFIRMATIONS` | `7`, `finalized`, `1` | oui | oui |
| `SIRIUS_REQUIRE_PHALA`, `TEE_MODE` | `true`, `phala` | oui | oui |
| `RUNNER_URL`, `RUNNER_TRANSPORT_SECRET`, `SIRIUS_LOCK_AUTHORIZER` | comme Next | oui | oui |
| `SIRIUS_EXPECTED_MRTD`, `SIRIUS_EXPECTED_COMPOSE_HASH`, `SIRIUS_EXPECTED_MASTER_KEY_CHAIN_SHA256`, `NEXT_PUBLIC_SIRIUS_INGRESS_KEY_SHA256` | comme Next | oui | oui |
| `SIRIUS_EXPECTED_RTMR3` | vide | non (ignorée) | oui |
| `SIRIUS_WITHDRAW_RELAYER_ENABLED` | `false` | non | non (dans `.env.example` racine) |
| `PINATA_JWT`, `SIRIUS_MASTER_KEY`, `MEZO_DEPLOYER_KEY`, `SIRIUS_KYB_VERIFIER_KEY` | **absentes** | interdites | — |

### 3.3 Runner dans la CVM (fichier `-e` de Phala)

| Variable | Valeur attendue | Obligatoire | `.env.example` |
|---|---|---|---|
| `EVM_NETWORK`, `EVM_RPC_URL` | `mainnet`, RPC d'archive | oui | oui |
| `PINATA_GATEWAY`, `PINATA_JWT` | production | oui | oui |
| `RUNNER_TRANSPORT_SECRET` | partagé avec Next et le reaper | oui | oui |
| `SIRIUS_ESCROW_ADDRESS`, `SIRIUS_USDC_ADDRESS`, `SIRIUS_KYB_ADDRESS`, `SIRIUS_DATASET_ADDRESS`, `SIRIUS_LOCK_AUTHORIZER` | étapes 4 et 6 | oui en actif | oui |
| `SIRIUS_LEGACY_ESCROW_ADDRESSES` | vide | interdite non vide | oui |
| `RUNNER_MONITOR_SECRET` | 32 octets base64 | oui en actif | **non** |
| `SIRIUS_EVM_CONFIRMATIONS` | `1` | oui en actif | **non** |
| `SIRIUS_COMPUTE_RECIPIENT`, `RUNNER_INITIAL_BUDGET_POLICY`, `RUNNER_INITIAL_BILLING_POLICY` | Safe, deux JSON | oui en `init` seulement, retirées ensuite | **non** |
| `DSTACK_DOCKER_REGISTRY`, `DSTACK_DOCKER_USERNAME`, `DSTACK_DOCKER_PASSWORD` | `ghcr.io`, jeton `read:packages` | oui (image privée) | **non** |
| Fixées par le Compose rendu, pas par le fichier : `TEE_MODE=phala`, `SIRIUS_BILLING_VERSION=7`, `SIRIUS_EVM_FINALITY=finalized`, `RUNNER_BOOTSTRAP_ONLY`, `RUNNER_REPLAY_DIR`, `RUNNER_BUDGET_FILE`, `RUNNER_BILLING_POLICY_FILE`, `RUNNER_TLS_ENABLED`, `RUNNER_TLS_HOSTNAME`, `SIRIUS_APP_ORIGIN`, `RUNNER_MAX_*`, `RUNNER_TRAINING_TIMEOUT_MS` | — | — | partiellement |

### 3.4 Poste d'opérateur (déploiement, préflight, invitations)

| Variable | Usage | Obligatoire | `.env.example` |
|---|---|---|---|
| `MEZO_DEPLOYER_KEY` | `deploy.ts`, étapes 5-6 | oui | oui |
| `SIRIUS_DEPLOY_NETWORK=mainnet`, `SIRIUS_ALLOW_MAINNET=true`, `SIRIUS_DEPLOY_DRY_RUN` | `deploy.ts` | oui | **non** |
| `SIRIUS_BILLING_VERSION=7` | `deploy.ts`, préflight | oui | **non** |
| `SIRIUS_USDC_ADDRESS`, `SIRIUS_USDC_CODE_HASH`, `SIRIUS_KYB_ADMIN`, `SIRIUS_KYB_VERIFIER`, `SIRIUS_LOCK_AUTHORIZER` | `deploy.ts` | oui | oui |
| `SIRIUS_DEPLOYER_ADDRESS`, `SIRIUS_COMPUTE_RECIPIENT`, `SIRIUS_EVM_FINALITY`, `SIRIUS_EVM_CONFIRMATIONS` | `check-phala-v7 --network=mainnet` | oui | **non** |
| `EVM_NETWORK`, `EVM_RPC_URL`, `SIRIUS_KYB_ADDRESS` | `kyb-invite.ts`, `runner:check-finality` | oui | oui |
| `RUNNER_URL`, `RUNNER_MONITOR_SECRET`, `SIRIUS_LOCK_AUTHORIZER`, `EVM_NETWORK` | `ops:runner-monitor` | oui | partiellement |

### 3.5 Environnement GitHub `production`

| Nom | Type | Valeur | Lu par |
|---|---|---|---|
| `EVM_NETWORK` | variable | `mainnet` | job Migrations (préflight EVM) |
| `SIRIUS_MIGRATION_ESCROW_ADDRESSES` | variable | vide (base neuve) | job Migrations |
| `EVM_RPC_URL` | secret | RPC d'archive | job Migrations |
| `DATABASE_URL` | secret | URL **directe** Neon mainnet | job Migrations |
| `VERCEL_TOKEN` | secret | existant | job Vercel |
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS` | secrets | existants | job Reaper |

### 3.6 Variables obligatoires sur mainnet absentes de `.env.example`

À signaler ; ce fichier ne les ajoute pas (documentation seule) :

| Variable | Rôle | Où elle est exigée |
|---|---|---|
| `SIRIUS_MAX_LOAN_USDC`, `SIRIUS_MAX_EXPOSURE_USDC` | Next | `instrumentation-node.ts`, `exposure-limits.ts`, `release-check.mjs` |
| `SIRIUS_BILLING_VERSION` | Next, reaper, runner, déploiement | `release-check.mjs`, `mainnet-guard.ts`, `deploy-policy.ts`, `phala-v7-preflight.ts` (présente dans `deploy/vps/.env.example`, pas à la racine) |
| `SIRIUS_EVM_FINALITY`, `SIRIUS_EVM_CONFIRMATIONS` | Next, reaper, runner | `release-check.mjs`, `phala-v7-preflight.ts` (idem) |
| `SIRIUS_COMPUTE_RECIPIENT` | préflight, initialisation du runner | `phala-v7-preflight.ts`, `compose.init-v7.yaml` |
| `SIRIUS_DEPLOYER_ADDRESS` | préflight | `phala-v7-preflight.ts` |
| `SIRIUS_ALLOW_MAINNET`, `SIRIUS_DEPLOY_NETWORK`, `SIRIUS_DEPLOY_DRY_RUN` | déploiement | `deploy-policy.ts`, `deploy.ts` (`SIRIUS_ALLOW_MAINNET` est citée en commentaire) |
| `RUNNER_MONITOR_SECRET` | runner actif, supervision | `compose.v7.yaml`, `runner-monitor.ts` |
| `RUNNER_INITIAL_BUDGET_POLICY`, `RUNNER_INITIAL_BILLING_POLICY` | initialisation | `compose.init-v7.yaml` |
| `DSTACK_DOCKER_REGISTRY`, `DSTACK_DOCKER_USERNAME`, `DSTACK_DOCKER_PASSWORD` | CVM, image privée | Phala |
| `SIRIUS_BILLING_POLICY_JSON` | Next, tarif affiché | `billing/config.ts` (présente en commentaire) |

Facultatives mais absentes aussi : `SIRIUS_ADMISSIONS_CLOSED`, `SIRIUS_PHALA_DEMO_ORIGIN`, `EVM_CHAIN_ID`.

## 4. Retour arrière, étape par étape

| Après l'étape | Que défaire | Comment | Limite |
|---|---|---|---|
| 1 RPC | Clé ou fournisseur | Révoquer la clé, en créer une autre | Aucune : rien n'est écrit on-chain |
| 2-3 Image, Compose | Fichiers rendus | Supprimer `.ops/mainnet/*.compose.json`, re-rendre | Aucune |
| 4 CVM amorcée | La machine | `cvms stop` puis suppression dans Phala, recréer | **Seulement tant que les contrats ne sont pas déployés** : après, l'adresse de règlement est gravée dans l'escrow |
| 5 À blanc | Rien | — | — |
| 6 Contrats | Impossible de les modifier | Déployer une nouvelle série complète ; ne jamais pointer l'application sur la mauvaise ; l'ancienne série reste sur la chaîne, vide | Tant qu'aucun prêt n'est verrouillé, le coût est le gas. Après un prêt : [runbook 1](../MAINNET-RUNBOOKS.md) |
| 7 Initialisation | Volumes | Jamais de suppression pour réessayer ; analyse opérateur ; si vraiment nécessaire, nouvelle CVM **et** nouvelle série de contrats (étape 6) | Un registre perdu après un prêt impose une restauration cohérente |
| 8 Activation | Mode actif | Redéployer `bootstrap.compose.json` sur la même CVM : identité conservée, aucune opération métier possible | Ne jamais recréer la CVM pour « réparer » |
| 9 Vercel | Variables | Vercel garde les versions précédentes des variables et des déploiements : restaurer, puis « Redeploy » du dernier déploiement vert | Le déploiement précédent est l'ancienne production testnet : ne le promouvoir qu'avec ses variables |
| 10 GitHub, VPS | Secrets, `.env.vps` | `cp -p .env.vps.avant-mainnet .env.vps` ; remettre `EVM_NETWORK=testnet` dans l'environnement GitHub | Aucun déploiement n'a eu lieu tant que l'étape 12 n'est pas approuvée |
| 11 release-check | Rien | — | — |
| 12 Fusion et déploiement | Le déploiement | Avant approbation : ne pas approuver, corriger sur staging, refusionner. Après : `SIRIUS_ADMISSIONS_CLOSED=true` sur Vercel et redéployer (plus aucun nouveau prêt, site en ligne), `docker compose -p sirius --env-file .env.vps stop reaper` sur le VPS, puis correction | Une fusion sur main ne se défait pas ; `git revert` puis nouvelle PR si le code est en cause |
| 12 bis Ouverture au public | La porte d'aperçu | Reposer `SIRIUS_PREVIEW_GATE=true` avec une **nouvelle** `SIRIUS_PREVIEW_KEY`, redéployer : le public revoit la page d'attente, l'équipe repasse par `/preview?key=…` | Les cookies posés avec l'ancienne clé ne valent plus rien ; les sessions wallet déjà ouvertes restent fermées derrière la porte tant qu'un cookie n'est pas reposé |
| 13 Invitations | Une attestation | `kyb-invite.ts revoke <wallet> --key-file=… --confirm` (une transaction du vérificateur) | — |
| 14 Premier prêt | Un prêt verrouillé | Laisser le délai de 3 jours puis `refund()` ; ou [runbooks 2-3](../MAINNET-RUNBOOKS.md) | L'escrow n'a ni pause ni rotation |
| 15 Clé retirée | Rien | — | Une clé effacée ne gouverne rien |

## 5. Points bloquants repérés en préparant cette checklist

- Le **RPC public ne sert pas l'état au bloc `finalized`** (section 6) : sans RPC d'archive, le préflight, le runner et le reaper échouent sur mainnet. C'est le premier pré-requis à lever.
- L'**ordre machine → contrats → initialisation** est imposé par le code : une CVM recréée après le déploiement des contrats oblige à redéployer l'escrow et le registre datasets.
- Le préflight exige `SIRIUS_KYB_ADMIN` = `SIRIUS_COMPUTE_RECIPIENT` : le Safe reçoit la part calcul **et** administre le KYB. Aucune autre configuration ne passe.
- Les **politiques mainnet** (budget et tarif) doivent être écrites avant l'étape 7 ; elles étaient encore « à décider » le 5 au matin ([17](17-audit-et-lancement-restants.md)).
- `.env.example` ne mentionne pas plusieurs variables obligatoires (section 3.6) : celui qui configure à partir du modèle les oubliera. À corriger après le lancement, pas dans cette PR documentaire.
- Le `release-check` ne peut pas lire un export Vercel (valeurs `[SENSITIVE]`) : les trois fichiers se composent à la main, à partir des valeurs posées.

## 6. RPC d'archive

### Pourquoi c'est obligatoire

L'application lit l'escrow au bloc **finalisé** (`SIRIUS_EVM_FINALITY=finalized`, imposé sur mainnet par `finality.ts`) : préflight, devis, règlement du runner, réconciliation du reaper. Un nœud non archive ne garde que l'état des derniers blocs.

### Ce que le RPC public sert vraiment (sonde du 5 octobre 2026, lecture seule)

`eth_getBalance` de le MUSD à différents blocs sur `https://mainnet.mezo.public.validationcloud.io` :

| Bloc demandé | Résultat |
|---|---|
| `eth_chainId` | `0x1237` (31612) |
| tête − 1 à tête − 5 000 | `0x0` (état servi) |
| tête − 20 000 | `historical state … is not available` |
| bloc `finalized` (8 517 blocs derrière la tête, ≈ 14 min) | `historical state … is not available`, pour `eth_getBalance` comme pour `eth_call decimals()` |
| bloc 1 048 576 | `historical state … is not available` |

Même comportement sur le testnet (`rpc.test.mezo.org`, 31611) : état servi jusqu'à tête − 5 000, refusé à tête − 20 000, au bloc `finalized` (6 278 blocs derrière) et sur les vieux blocs (`missing trie node`). Conclusion : le RPC public garde environ les derniers 5 000 à 20 000 blocs, **jamais le bloc finalisé**. Il est inutilisable pour Sirius sur les deux réseaux, et Mezo le réserve aux tests (« rate-limited and not recommended for production use »).

### Fournisseurs

Confirmés par la [documentation Mezo](https://docs.mezo.com/chain/connecting/), qui désigne Alchemy comme fournisseur recommandé et liste Chainstack, QuickNode, Blockdaemon, dRPC, Validation Cloud et GlobalStake, avec archive, en mainnet. Prix relevés le 5 octobre 2026 sur les pages publiques des fournisseurs ; à revérifier au moment de souscrire.

| Fournisseur | Mainnet 31612 | Testnet 31611 | Archive | Gratuit | Prix indicatif | Limite | Source |
|---|---|---|---|---|---|---|---|
| **Alchemy** | oui, `https://mezo-mainnet.g.alchemy.com/v2/<clé>` | oui, `mezo-testnet` | oui, incluse dans le gratuit | 30 M CU/mois | ≈ 0,45–0,53 $ par M CU au-delà | 500 CU/s ≈ 25 req/s en gratuit | [docs Mezo](https://docs.mezo.com/chain/connecting/), [alchemy.com/rpc/mezo](https://www.alchemy.com/rpc/mezo), [tarifs](https://www.alchemy.com/pricing) |
| **dRPC** | oui, `https://mezo.drpc.org` (public) et clé | annoncé (non vérifié) | oui | 210 M CU/mois sur nœuds publics | Growth ≈ 6 $ par M requêtes | nœuds publics partagés en gratuit | [docs Mezo](https://docs.mezo.com/chain/connecting/), [drpc.org](https://drpc.org/chainlist/mezo-mainnet-rpc), [comparatif Dwellir](https://www.dwellir.com/blog/best-mezo-chain-rpc-providers) |
| **Chainstack** | oui, `https://mezo-mainnet.core.chainstack.com/<id>` | oui | oui, **payant seulement** (Growth), 2 RU par requête archive | 3 M RU/mois sans archive, 25 req/s | Growth 49 $/mois (20 M RU), 250 req/s | archive absente du gratuit | [docs Chainstack](https://docs.chainstack.com/reference/mezo-getting-started), [tarifs](https://chainstack.com/pricing/) |
| **QuickNode** | oui, `https://<id>.mezo-mainnet.quiknode.pro/<jeton>` | oui (faucet QuickNode) | oui d'après Mezo ; conditions d'archive non précisées sur la page QuickNode | essai 10 M crédits, un mois | Build 49 $/mois (80 M crédits), dépassement ≈ 0,62 $/M | essai limité à un mois | [docs Mezo](https://docs.mezo.com/chain/connecting/), [annonce](https://www.quicknode.com/blog/quicknode-now-supports-mezo-chain-mainnet), [tarifs](https://www.quicknode.com/pricing) |
| **Dwellir** | oui | non vérifié | oui, HTTPS et WSS | 100 k requêtes/jour sans `eth_getLogs` | Developer 49 $/mois | `eth_getLogs` payant | [comparatif Dwellir](https://www.dwellir.com/blog/best-mezo-chain-rpc-providers), [dwellir.com/networks/mezo](https://www.dwellir.com/networks/mezo) |
| **Validation Cloud** | oui | annoncé | oui | 50 M CU/mois | non relevé | — | [docs Mezo](https://docs.mezo.com/chain/connecting/), [comparatif Dwellir](https://www.dwellir.com/blog/best-mezo-chain-rpc-providers) |
| **Blockdaemon**, **GlobalStake** | listés par Mezo | non vérifié | « supported » | non relevé | sur inscription | — | [docs Mezo](https://docs.mezo.com/chain/connecting/) |
| **Ankr** | page `ankr.com/rpc/mezo` existante, contenu non lisible ; **absent** de la liste Mezo | non vérifié | non confirmé | non relevé | — | — | [ankr.com/rpc](https://www.ankr.com/rpc/) |
| **Conduit** | **aucune mention** : Conduit héberge ses propres rollups, Mezo est opérée par Mezo | — | — | — | — | — | [docs Conduit](https://docs.conduit.xyz/) |
| RPC public Mezo | `https://mainnet.mezo.public.validationcloud.io` | `https://rpc.test.mezo.org` | **non** (sonde ci-dessus) | oui | gratuit | débit limité, sans SLA | [docs Mezo](https://docs.mezo.com/chain/connecting/) |

### Recommandation

**Alchemy, offre gratuite**, une clé « Sirius mainnet » : archive incluse, mainnet et testnet, fournisseur recommandé par Mezo, et déjà identifié en septembre comme la réponse au même blocage sur le testnet ([PHALA-V7-STAGING.md](../PHALA-V7-STAGING.md), où le RPC d'archive de staging est configuré sans que le fournisseur soit nommé). Le volume de la bêta (un reaper toutes les 30 s, quelques prêts par jour) reste très loin des 30 M CU mensuels et des 25 requêtes par seconde.

Garder en secours une clé **dRPC** (Growth, facturé à la requête) ou **Chainstack Growth** (49 $/mois) : un second fournisseur se pose en quelques minutes dans `EVM_RPC_URL` si Alchemy tombe. Ne pas prendre Chainstack gratuit (sans archive) ni QuickNode en essai (expire après un mois).

Même clé dans : `EVM_RPC_URL` de Vercel production, de `.env.vps`, du fichier runner de la CVM, et le secret `EVM_RPC_URL` de l'environnement GitHub `production`. Vérifier chaque emplacement avec la sonde de l'étape 1 avant la fusion.

## 7. Après la mise en production

Tests : [18-a-tester-au-passage-mainnet.md](18-a-tester-au-passage-mainnet.md). Exploitation : [MAINNET-RUNBOOKS.md](../MAINNET-RUNBOOKS.md), surveillance à 12h et 20h. Décision : [00-PLAN-GLOBAL.md](00-PLAN-GLOBAL.md).
