# Runbooks d'exploitation — bêta mainnet

Procédures à suivre pendant la bêta mainnet ouverte le 6 octobre 2026. Elles complètent le [plan de lancement](MAINNET-LAUNCH-PLAN.md) et le [journal](MAINNET-LAUNCH.md). Toute action est consignée dans le journal avec son heure et sa preuve. Aucune clé ni secret dans les messages ou les documents.

Rappels qui valent pour tous les runbooks :

- Le contrat d'escrow n'a **ni pause ni rotation** : on agit en amont (application, runner) et on laisse le contrat rembourser à l'échéance.
- **Ne jamais recréer la CVM de production** : son identité (app ID) porte la clé de règlement inscrite dans l'escrow. Redémarrer la même CVM, jamais en créer une autre pour « réparer ».
- Toute transaction mainnet est signée par un humain, après vérification de la cible.

## 1. Clé de règlement ou enclave compromise

**Signes** : release ou reçus d'exécution non initiés par le service, attestation qui ne correspond plus aux mesures épinglées, alerte du collecteur.

1. Couper les admissions : ajouter `SIRIUS_ADMISSIONS_CLOSED=true` sur Vercel production et redéployer. Plus aucun nouveau prêt n'est préparé ni autorisé ; le site, la confirmation des locks déjà signés, Rembourser, Retirer et `/status` restent en ligne. **Ne pas toucher aux plafonds** `SIRIUS_MAX_LOAN_USDC` / `SIRIUS_MAX_EXPOSURE_USDC` : une valeur nulle, invalide ou un plafond par prêt supérieur à l'exposition totale empêche l'application de démarrer. Réouverture : retirer la variable (ou la passer à `false`) et redéployer, après la décision écrite de l'étape 5.
2. Arrêter la CVM de production depuis le VPS (`sirius-phala cvms stop <cvm> --profile sirius`). Plus aucune release ni reçu ne peut être signé.
3. Publier un message sur la page d'état et sur X : admissions fermées, fonds verrouillés remboursables à l'échéance.
4. Lister les prêts verrouillés (registre d'audit, `ops:escrow-events`). À l'échéance de chacun, déclencher `refund()` (bouton Refund ou n'importe quel wallet) : les emprunteurs récupèrent leurs fonds.
5. Remplacement : nouvelle CVM, nouvel escrow lié à sa nouvelle adresse, nouveau registre datasets, republication des titres par les fournisseurs. Décision écrite à deux avant toute réouverture.

## 2. Coupe-circuit financier ouvert

**Signes** : réponses 503 « Coupe-circuit financier runner ouvert » sur publication, entraînement, prêt.

Depuis N1, seules les pannes côté runner comptent : 5xx, RPC, IPFS, exceptions techniques, revert d'une transaction signée. Une erreur d'utilisateur (4xx, grant refusé, dataset inexploitable), une attente de finalité ou un refus avant signature ne comptent plus.

1. Lire le rapport de budget attesté (`ops:runner-monitor`) : nombre d'échecs, opérations réservées ou en échec, solde ETH.
2. Identifier la cause dans le journal des opérations : RPC, IPFS, gas, revert.
3. Corriger la cause (recharger l'ETH de règlement, attendre le RPC, etc.).
4. Seulement ensuite, réarmer dans la CVM, puis consigner la cause dans le journal de lancement :

```bash
pnpm runner:budget reset-failures /var/lib/sirius-runner/budget/ledger.sqlite /var/lib/sirius-runner/budget/budget-policy.json --actor=<prénom> --reason="<cause corrigée>"
pnpm runner:budget journal /var/lib/sirius-runner/budget/ledger.sqlite /var/lib/sirius-runner/budget/budget-policy.json
```

Un règlement clos en échec (revert) peut être rouvert après vérification sur l'explorer que le prêt est toujours verrouillé. Le règlement suivant relit l'escrow avant tout envoi :

```bash
pnpm runner:budget reopen <registre> <politique> release:<chainId>:<escrow>:<loanKey> --actor=<prénom> --reason="<diagnostic>"
```

## 3. Transaction runner bloquée

**Signes** : opération `reserved` qui ne progresse plus, nouvelles transactions runner refusées, prêts bloqués en SETTLING.

Une seule transaction runner est en vol à la fois. Sur mainnet, chacune attend la finalité, soit environ 16 minutes : les autres règlements patientent sans compter d'échec. Une opération réservée de moins d'une heure n'est donc pas bloquée.

1. Lire l'opération bloquée (hash, nonce) dans le rapport du runner.
2. Comparer au nonce de l'adresse de règlement sur l'explorer (`getTransactionCount`).
3. Si la transaction est minée : laisser la réconciliation la finaliser (`pnpm runner:transactions reconcile`).
4. Si elle est introuvable : `pnpm runner:transactions rebroadcast`. Un refus du séquenceur pour frais trop bas déclenche automatiquement une re-signature au même nonce, avec des frais à jour, journalisée sous l'auteur `runner-auto`.
5. Si son nonce est déjà consommé par une autre transaction, ou si elle n'a jamais été signée, l'abandonner. La commande refuse tant que la transaction peut encore être incluse :

```bash
pnpm runner:transactions abandon <id-operation> --actor=<prénom> --reason="<diagnostic>"
```

6. Vérifier que les règlements suivants repartent.

## 4. Enclave arrêtée ou injoignable

**Signes** : attestation indisponible, erreurs de transport runner, CVM `stopped` ou `error`.

1. État de la CVM : `sirius-phala cvms get <cvm> --profile sirius`.
2. Redémarrer **la même** CVM (`cvms start`). Ne jamais en créer une nouvelle.
3. Recapturer l'attestation et vérifier : même adresse de règlement, MRTD, compose hash, empreinte de la chaîne KMS et clé d'ingestion identiques aux valeurs épinglées, journal d'événements qui rejoue vers le RTMR3 de la quote. **RTMR3 seul change à chaque redémarrage de la CVM : ce n'est pas une compromission et il n'est plus épinglé** (décision du 5 octobre, audit A-01, A-02) ; rien à ré-épingler. Si MRTD, le compose hash, la chaîne KMS, la clé d'ingestion ou l'adresse de règlement change, ne pas rouvrir : runbook 1.
4. Contrôler le rapport de budget attesté avant de considérer le service rétabli.

## 5. Reaper silencieux

**Signes** : `check-reaper.sh` en erreur, aucune ligne `[reaper] passe ok` depuis plusieurs minutes, lignes `[reaper] passe échouée` répétées, prêts échus non remboursés.

1. `docker compose -p sirius --env-file .env.vps logs --tail 100 reaper` dans `/opt/sirius`.
2. Erreur de configuration au démarrage : corriger `.env.vps` (le reaper mainnet refuse une configuration incomplète).
3. Redémarrer : `docker compose -p sirius --env-file .env.vps up -d reaper`, puis relancer `check-reaper.sh`.
4. Contrôler les prêts échus restés verrouillés et déclencher les remboursements manquants.

## 6. Solde ETH de règlement bas

**Seuil d'alerte** : 0,02 ETH sur l'adresse de règlement de l'enclave. Le runner journalise aussi `[runner][alerte-eth]` avant chaque règlement quand le solde ne couvre plus cinq transactions au plafond de gas. Sous un plafond, le règlement est refusé avant signature et se relance seul une fois le solde rechargé.

1. Envoyer du BTC depuis le Safe ou un wallet d'équipe vers l'adresse de règlement (adresse publique dans le journal).
2. Vérifier le solde sur l'explorer et dans le rapport de budget attesté.

## Surveillance quotidienne pendant la bêta

À 12h et 20h, par la personne d'astreinte :

- rapport de budget attesté : échecs à 0, aucune opération bloquée, solde ETH au-dessus du seuil ;
- reaper : dernière ligne `[reaper] passe ok` de moins de deux minutes, sans `[reaper] passe échouée` plus récente ;
- exposition verrouillée totale comparée au plafond ;
- page d'état à jour.

## Préparation de la production (N5, N6)

### Compose de la CVM de production

L'origine de l'application n'a plus de valeur par défaut hors démonstration. Pour la production :

```bash
pnpm phala:compose-v7 init ghcr.io/alibenyezza/sirius-runner@sha256:<digest> /tmp/prod-init.json --origin=https://sirius-data.tech
pnpm phala:compose-v7 active ghcr.io/alibenyezza/sirius-runner@sha256:<digest> /tmp/prod-active.json --origin=https://sirius-data.tech
```

Le conteneur d'initialisation reçoit `EVM_NETWORK` et n'a pas de réseau. Il vérifie la chaîne et les décimales attendues pour ce réseau : 31612 et 6 sur mainnet. Les décimales on-chain sont vérifiées avant, par `phala:preflight-v7 --network=mainnet`.

### Politiques mainnet du runner

Le code refuse une politique mainnet qui ne respecte pas ces règles :

| Champ | Règle imposée |
|---|---|
| `chainId` (budget et tarif) | 31612 |
| `usdc` | MUSD de Mezo `0x5fc5360d0400a0fd4f2af552add042d716f1d168`, en minuscules ; l'ancien USDC natif `0x80e0…6ca8` est refusé |
| `usdcDecimals` | 6 |
| `computeRecipient` | adresse non nulle, distincte du wallet runner ; le Safe en production |
| `earnedMarginUsdMicros`, `cashUsdMicros` | strictement positifs : ni crédits d'essai ni sponsor |
| `trial`, `sponsored` | absents |

Restent à décider par Ali et Ali, avant samedi : la marge acquise, les liquidités et la réserve fixe (valeurs comptables justifiées), les coûts par requête, scellement et entraînement, et les plafonds de gas (`maxGas`, `maxFeePerGasWei`, `maxTransactionWei`, `totalWei`). Les plafonds de gas se calent sur la mesure de finalité et le prix du gas observés sur mainnet. Comme les attentes de finalité ne consomment plus de crédit, les seize requêtes par devis suffisent.

### Contrats mainnet

Le jeton de règlement mainnet est **MUSD** (« Mezo USD », Mezo), `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`. Les variables gardent leur nom historique `SIRIUS_USDC_ADDRESS` et `SIRIUS_USDC_CODE_HASH` : elles désignent le MUSD.

Toujours commencer par une exécution à blanc. Elle vérifie sur le RPC mainnet le code et les décimales de le MUSD, que l'admin KYB est bien un contrat, et n'envoie rien :

```bash
SIRIUS_DEPLOY_NETWORK=mainnet SIRIUS_ALLOW_MAINNET=true SIRIUS_BILLING_VERSION=7 SIRIUS_DEPLOY_DRY_RUN=true \
SIRIUS_USDC_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 \
SIRIUS_USDC_CODE_HASH=0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6 \
SIRIUS_KYB_ADMIN=<Safe> SIRIUS_KYB_VERIFIER=<vérificateur 1> SIRIUS_LOCK_AUTHORIZER=<adresse attestée de la CVM> \
pnpm contracts:deploy:testnet
```

La clé de déploiement se charge sans passer par l'historique du shell, avant la commande : `read -rs MEZO_DEPLOYER_KEY && export MEZO_DEPLOYER_KEY`. Le nom du script contient « testnet » pour des raisons historiques : c'est `SIRIUS_DEPLOY_NETWORK` qui choisit le réseau.

Sur mainnet, le script refuse : la v6, le KYB ouvert, les rôles partagés, tout jeton autre que le MUSD (l'ancien USDC natif `0x80e0…6cA8` compris), un admin KYB sans code, et toute adresse commune entre déployeur, admin KYB, vérificateur et signataire de lock. Le second vérificateur s'ajoute ensuite par le Safe.

**Ce que prouve le code hash de le MUSD, et ce qu'il ne prouve pas.** Le contrat MUSD est un **proxy ERC-1967** de 170 octets. Le hash ci-dessus est celui du proxy, relevé sur le RPC public `https://mainnet.mezo.public.validationcloud.io` le 4 octobre 2026 (`eth_getCode` puis keccak256), avec `name()` = « Mezo USD », `symbol()` = « MUSD », `decimals()` = 6, `paused()` = false ; l'implémentation pointée ce jour-là était `0x68184c449e1a8f34fa18d289737129fd27b66f8f` (code hash `0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf`). Conséquences :

- Le contrôle du code hash garantit qu'on déploie contre **le même proxy**, pas que la logique du jeton est inchangée : Mezo peut remplacer l'implémentation (nouvelle version, correctif, gel d'adresses) sans que ce hash bouge. C'est l'adresse épinglée dans `deploy-policy.ts` qui identifie le jeton ; le hash ne fait que détecter une adresse vide ou un contrat d'une autre forme.
- Les décimales sont lues à travers le proxy, donc sur l'implémentation courante : ce contrôle-là reste significatif à chaque exécution (déploiement, préflight, initialisation du runner).
- Si l'exécution à blanc refuse le code hash alors que l'adresse est la bonne, relever le nouveau hash on-chain (`eth_getCode` sur `0x5fc5…d168`, keccak256), vérifier sur `explorer.mezo.org` que le proxy est toujours celui de Mezo, puis mettre à jour cette commande. Ne jamais contourner le contrôle.
- Mezo conserve, par l'implémentation, le pouvoir de geler des adresses et de mettre le jeton en pause : un gel du Safe, de l'escrow ou d'un utilisateur bloquerait les règlements et les remboursements. L'escrow ne peut rien contre cela ; c'est un risque accepté de tout stablecoin réglementé, à surveiller (`paused()`, et les événements de gel de l'implémentation).
