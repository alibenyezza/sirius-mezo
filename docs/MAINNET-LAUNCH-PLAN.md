# Plan de lancement mainnet — 6 octobre 2026

Établi le 1er octobre 2026 à partir de [l'audit pré-mainnet du 1er octobre](AUDIT-2026-10-01.md) et de l'état réel du projet (staging `f97f89a`). Cible : Mezo mainnet, chainId `31612`, USDC ponté `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8` (18 décimales, vérifié on-chain le 28 septembre).

Deux équipes travaillent en parallèle : **Ali** (règlement, runner, enclave, contrats) et **Ali** (application, sécurité, configuration, lancement). Chaque lot a un propriétaire, des fichiers réservés, une branche et une preuve de fin. Le journal d'exécution est tenu dans [MAINNET-LAUNCH.md](MAINNET-LAUNCH.md).

## Ce que ce plan permet

L'audit chiffre le travail complet à 10 à 13 jours pour une personne. À deux, en parallèle strict, il tient en cinq jours **à condition de réduire le périmètre du lancement** : bêta mainnet plafonnée, KYB sur invitation, démo Phala hors mainnet, aucun audit externe revendiqué.

Rien ne part en production sans franchir la [porte go/no-go](#porte-gono-go--dimanche-5-octobre-20h) du dimanche 5 octobre à 20h. Si elle n'est pas franchie, le 6 octobre devient une annonce (démo testnet, date mainnet confirmée), pas un lancement partiel avec de l'argent réel.

## Périmètre du 6 octobre

### Inclus

- Contrats **v7 uniquement** : `SiriusKybRegistry` strict, `SiriusDatasetRegistry`, `SiriusEscrowV7`. Aucun escrow v6 sur mainnet.
- Calcul uniquement dans une **CVM Phala dédiée à la production**, attestée, mesures épinglées (MRTD, RTMR0-3, hash Compose, chaîne de clé, empreinte d'ingestion). Aucun calcul en processus Next.
- USDC ponté `0x80e0…6cA8`, `decimals() == 6` vérifié au déploiement et au démarrage.
- Connexion wallet et Google, avec confirmation visible de chaque signature et transaction du wallet embarqué.
- **Plafonds applicatifs** : 50 USDC par prêt, 500 USDC d'exposition totale verrouillée. Refus côté serveur avant tout devis.
- **KYB sur invitation** : attestations signées par nos vérificateurs pour des partenaires identifiés, durée 90 jours.
- Trésorerie (`computeRecipient`) et administration du registre KYB sur un **Safe 2 sur 2** (Ali, Ali).
- Page « État du protocole » : mainnet bêta, non audité, plafonds affichés, distinction mainnet / testnet / démo.

### Exclu du lancement

| Élément | Raison | Ce qu'on fait à la place |
|---|---|---|
| Démo Phala self-train | Reste l'instance staging testnet (D-26) | Aucun lien depuis le mainnet |
| Achat MoonPay | Livre l'USDC sur Ethereum L1, pas sur Mezo | Bouton masqué, pont Across indiqué |
| Faucet, KYB automatique de démo | Interdits par `instrumentation-node.ts` hors démo | Vérifier qu'ils ne sont pas exposés |
| Relayeur de retraits automatique | Seuil, plafond et clé non décidés | Retraits manuels par le bouton |
| Upload direct, jobs longs, modèles à arbres | Phase 1 de la roadmap | Après le lancement |
| KYB ouvert au public | Gouvernance à un seul niveau | Après deux semaines sans incident |

## À faire le mercredi 1er octobre, à deux

| Action | Détail | Preuve |
|---|---|---|
| Décision D-27 | Date, périmètre, plafonds et critères go/no-go de ce plan ajoutés à [DECISIONS.md](DECISIONS.md), validés par les deux | Commit de la décision |
| Safe 2 sur 2 | Safe sur Mezo mainnet, signataires Ali et Ali. Reçoit la part compute et devient admin KYB | Adresse du Safe notée dans le journal |
| Clés | Clé de déploiement neuve, jamais en CI, 0,03 ETH. Deux clés de vérificateur KYB distinctes, hors serveur | Adresses publiques dans le journal |
| Phala production | Carte ajoutée, sans recharge automatique, plafond fixé. Identifiants GHCR en lecture seule | Capture du tableau de bord |
| Base Neon vierge | Nouveau projet pour mainnet. Jamais la base testnet | Nom du projet dans le journal |
| Mesure de finalité | `scripts/check-runner-finality.ts` sur le RPC mainnet toutes les 10 min pendant 48 h | Tableau des retards `finalized` |

## Couloir Ali — règlement, runner, enclave, contrats

**Fichiers réservés** : `src/lib/runner/**`, `src/lib/billing/**`, `src/lib/evm/finality.ts`, `src/lib/sirius/settle.ts`, `src/lib/sirius/escrow.ts`, `src/runner/**`, `scripts/initialize-runner-volume.ts`, `scripts/render-phala-v7.mjs`, `scripts/runner-budget.ts`, `contracts/**`.

### N1 — Coupe-circuit ouvert par des erreurs utilisateur (audit B1)

- **Branche** : `fix/budget-failures`
- **Problème** : `runBudgetedOperation` appelle `ledger.finish(id, fp, false)` sur toute exception, y compris les 4xx imputables à l'utilisateur. `failures` ne redescend jamais ; à 3, `assertAdmission` coupe la plateforme pour tous.
- **À faire** :
  - ne compter dans `failures` que les échecs post-admission non imputables à l'appelant (≥ 500, IPFS, RPC, budget) ;
  - vérifier la signature du grant côté Next avant d'appeler le runner ;
  - commande opérateur `reset-failures` dans `scripts/runner-budget.ts`, journalisée.
- **Preuve** : test où deux CSV invalides et vingt grants forgés laissent `failures` à 0 ; test de la commande de réarmement.

### N2 — Finalité mainnet sans échecs garantis (audit B2)

- **Branche** : `fix/finality-pending`
- **Problème** : sur mainnet, la finalité L1 prend 15 min à plus d'une heure, mais `sendBilledAction.confirm()` attend 15 s puis exige le bloc finalisé. Chaque prêt normal produit 4 à 7 échecs comptés et épuise les 16 crédits `requests` du workflow.
- **À faire** :
  - une tentative dont l'issue est « en attente de finalité » ne consomme aucun crédit et ne compte pas d'échec : réponse 202 avec le hash, finalisation par `reconcileRunnerTransactions` ;
  - refuser `run-loan-job` et `settle-loan` côté Next tant que le bloc de lock ou de release n'est pas finalisé, avec un état d'attente visible dans l'interface ;
  - dimensionner `requests`, `maxFailures`, timeouts et intervalle du reaper avec la mesure de finalité de 48 h.
- **Preuve** : recette staging en mode `finalized` où un prêt complet passe sans aucun échec compté.

### N3 — Prêt rendu irréglable par un échec transitoire (audit B3)

- **Branche** : `fix/budget-failures` (même chantier que N1)
- **Problème** : l'identifiant d'opération est déterministe par prêt. Si `prepare()` échoue (timeout RPC, gas au-dessus du plafond, ETH insuffisant), l'opération passe `failed` et tout `settle-loan` suivant est refusé. Le préimage étant dans l'enclave, le prêt finit remboursé et le fournisseur n'est jamais payé.
- **À faire** :
  - distinguer « refusé avant signature » (réservation libérée, relançable) de « signé puis reverté » (seul cas `failed`) ;
  - commandes opérateur pour rouvrir ou abandonner une opération ;
  - alerte sur le solde ETH de l'adresse de règlement avant tout règlement.
- **Preuve** : test où un timeout de `estimateGas` puis une reprise règlent le prêt normalement.

### N4 — Transaction rejetée par le séquenceur (audit M6)

- **Branche** : `fix/finality-pending`
- **Problème** : l'erreur de `io.send` est avalée ; une opération `reserved` avec hash est rediffusée à l'identique puis figée, et l'index `pending_wallet` bloque toutes les transactions runner suivantes.
- **À faire** : journaliser et classer l'erreur, re-signer au même nonce avec un nouveau fee si `getTransactionCount('latest')` n'a pas bougé, commande opérateur `abandon`.
- **Preuve** : test d'un rejet « max fee per gas less than block base fee » suivi d'une re-signature réussie.

### N5 — Outillage runner pour mainnet (audit M5, partie runner)

- **Branche** : `feat/mainnet-runner-tooling`
- **À faire** :
  - `initialize-runner-volume.ts` : chainId, décimales et USDC pris dans la configuration du réseau, décimales lues on-chain ;
  - `render-phala-v7.mjs` : origine de l'application en paramètre (`https://sirius-data.tech` pour la production), plus aucune origine staging forcée ;
  - politiques budget et facturation mainnet : USDC 18 décimales, `computeRecipient` = Safe, réserve et coûts calés sur la mesure de finalité.
- **Preuve** : rendu Compose de production et initialisation simulée avec chainId 31612 et 18 décimales.

### N6 — Script de déploiement des contrats (audit M1)

- **Branche** : `feat/mainnet-runner-tooling`
- **À faire** : refuser mainnet sans `SIRIUS_BILLING_VERSION=7` explicite ; interdire `SIRIUS_ALLOW_SHARED_ROLES` hors testnet ; exiger quatre adresses distinctes (déployeur, admin KYB, vérificateurs, lockAuthorizer) ; vérifier `SIRIUS_USDC_ADDRESS == 0x80e0…6cA8` et `decimals() == 6` sur 31612.
- **Preuve** : exécution à blanc sur un fork ou contre le RPC mainnet en lecture seule.

### N7 — CVM de production

- **Vendredi matin** : création d'une CVM dédiée à `sirius-data.tech` (la CVM `e8a8b8cb…` reste la démo staging), amorçage, capture de l'adresse de règlement.
- **Samedi** : initialisation des volumes avec les politiques mainnet, activation, recapture et épinglage des mesures (y compris RTMR0-2) dans Next, reaper et collecteur. Redémarrage de vérification : même adresse de règlement.
- **Preuve** : sortie de `runner:capture-ra-tls` en mode actif, rapport de budget attesté.

### N8 — Contrats mainnet

- **Samedi** : déploiement avec la clé de déploiement neuve et `SIRIUS_ALLOW_MAINNET=true` sur décision D-27 :
  1. `SiriusKybRegistry` strict, admin = Safe, deux vérificateurs ;
  2. `SiriusDatasetRegistry` ;
  3. `SiriusEscrowV7` avec `lockAuthorizer` = adresse attestée de la CVM de production.
- **Après** : vérification sur l'explorer, clé de déploiement retirée de toute machine de service, 0,05 ETH envoyé à l'adresse de règlement.

## Couloir Ali — application, sécurité, configuration, lancement

**Fichiers réservés** : `src/lib/wallet/**`, `src/lib/auth/**`, `src/app/api/**` hors routes runner, `src/components/**`, `src/app/(app)/**`, `prisma/**`, `deploy/vps/**`, `scripts/operations/release-check.mjs`, `scripts/phala-v7-preflight.ts`, `scripts/check-phala-v7.ts`, `package.json`, `pnpm-lock.yaml`.

### A1 — Wallet Google sans confirmation (audit M3)

- **Branche** : `fix/wallet-next`
- **À faire** : `walletServicesConfig: { confirmationStrategy: "modal", enableKeyExport: false }` dans `src/lib/wallet/embedded.ts`, vérification du réglage du projet Web3Auth de production.
- **Preuve** : test navigateur où un `eth_sendTransaction` affiche une confirmation avec le montant.

### A2 — Next.js et audit de dépendances (audit M10)

- **Branche** : `fix/wallet-next`
- **À faire** : `next` et `eslint-config-next` en 16.3.7, lockfile régénéré, audit des dépendances ramené à zéro sans abaisser le niveau.
- **Preuve** : job Vérification vert.

### A3 — Plafonds applicatifs

- **Branche** : `feat/mainnet-caps`
- **À faire** : `SIRIUS_MAX_LOAN_USDC` (50) et `SIRIUS_MAX_EXPOSURE_USDC` (500), obligatoires sur mainnet ; refus côté serveur avant tout devis si le prix dépasse le plafond ou si l'exposition verrouillée totale serait dépassée ; message clair dans l'interface.
- **Preuve** : tests unitaires et e2e des deux refus.

### A4 — Connexion : délégation courte et SIWE (audit M2)

- **Branche** : `fix/auth-siwe`
- **À faire** : délégation runner ramenée de 7 jours à 24 h (indispensable) ; message de connexion au format EIP-4361 avec domaine, URI, chainId 31612, nonce et expiration (si le temps le permet jeudi).
- **Preuve** : test de rejet d'une signature pour un autre domaine ou une autre chaîne.

### A5 — Limiteur sur l'autorisation de prêt (audit M4)

- **Branche** : `fix/auth-siwe`
- **À faire** : 3 appels par minute par prêt sur `/api/loans/[id]/authorize`, réutilisation de l'autorisation tant qu'elle n'est pas expirée.

### A6 — Base liée à la chaîne (audit M8)

- **Branche** : `feat/mainnet-db-guard`
- **À faire** : colonne `evmChainId` sur `Dataset` (migration additive), refus au démarrage et au préflight si la base contient des lignes d'une autre chaîne, `SIRIUS_LEGACY_ESCROW_ADDRESSES` vide sur mainnet.
- **Preuve** : préflight qui échoue sur une copie de la base testnet.

### A7 — Reaper VPS (audit M9)

- **Branche** : `feat/mainnet-db-guard`
- **À faire** : variables obligatoires (`:?`) dans `deploy/vps/compose.yaml` ; `worker/reaper.ts` refuse de démarrer sur mainnet si `TEE_MODE != phala`, `SIRIUS_BILLING_VERSION != 7` ou `RUNNER_URL` absent ; `check-reaper.sh` vérifie une ligne de log récente.

### A8 — Préflight et contrôle de release mainnet (audit M5, partie application)

- **Branche** : `feat/mainnet-preflight`
- **À faire** : `--network=mainnet` dans `release-check.mjs`, `phala-v7-preflight.ts` et `check-phala-v7.ts`, avec contrôle de `SIRIUS_USDC_ADDRESS == 0x80e0…6cA8` et `decimals() == 6`.
- **Preuve** : `release-check` vert sur la configuration mainnet du samedi, rouge sur une configuration testnet.

### A9 — Interface mainnet

- **Branche** : `feat/mainnet-caps`
- **À faire** : MoonPay masqué sur mainnet avec indication du pont Across ; faucet et KYB démo vérifiés absents ; libellé « test MUSD » remplacé ; vérification de la cible et du calldata avant signature pour retrait, refund, mint, destroy et KYB ; badge « REFUNDED » et libellé traduit sur le registre d'audit.

### A10 — KYB sur invitation

- **Branche** : `feat/kyb-invite`
- **À faire** : script qui fait signer par un vérificateur une attestation pour une adresse donnée, expiration 90 jours ; acceptation par le partenaire depuis le site (`acceptAttestation`) ; procédure de révocation.
- **Preuve** : attestation émise et acceptée sur staging, puis révoquée.

### A11 — Lancement

- Page « État du protocole », conditions d'utilisation de la bêta, annonce et messages du 6, liste des premiers partenaires invités.

## Calendrier

| Jour | Ali | Ali | Ensemble |
|---|---|---|---|
| **Mer. 1** | N1, N3 ; lancer la mesure de finalité | A1, A2, A3 | Décision D-27, Safe, clés, carte Phala, base Neon |
| **Jeu. 2** | N2, N4, commandes opérateur | A4, A5, A6, A7, A9 | Revue croisée des PR le soir, CI verte |
| **Ven. 3** | N5, N6 ; CVM de production en amorçage | A8, A10, A11 | Fusion dans staging, recette testnet en mode finalisé (3 parcours, 3 pannes). **Gel du code à 20h** |
| **Sam. 4** | N7, N8 ; ETH sur l'adresse de règlement | Vercel production en mainnet, base migrée, reaper production, `release-check` vert | Fusion staging → main ; premier prêt réel de 5 USDC avec un jour de délai |
| **Dim. 5** | Tests de panne sur mainnet | Parcours réels à petits montants | Remboursement à échéance du prêt de samedi ; **go/no-go à 20h** |
| **Lun. 6** | Surveillance runner | Invitations KYB, annonce | Astreinte, points à 12h et 20h |

## Porte go/no-go — dimanche 5 octobre, 20h

Tous les points doivent être vrais, chacun avec une preuve (hash, capture ou sortie de commande) dans le journal. Un seul point manquant donne no-go.

### Code

- [ ] N1, N2, N3, N4 fusionnés et testés sur staging en mode `finalized`.
- [ ] N5, N6, A1 à A9 fusionnés.
- [ ] Plafonds 50 / 500 USDC refusés côté serveur, test à l'appui.
- [ ] Pipeline main verte, sans contournement de l'audit de dépendances.

### Chaîne

- [ ] Escrow v7 : `usdc()` = `0x80e0…6cA8`, `decimals()` = 6, `lockAuthorizer` = adresse attestée de la CVM de production.
- [ ] Registre KYB strict, admin = Safe, deux vérificateurs distincts.
- [ ] `computeRecipient` = Safe ; clé de déploiement retirée de tout service.

### Enclave

- [ ] Quote `UpToDate` ; MRTD, RTMR0-3, hash Compose et chaîne de clé épinglés dans Next, reaper et collecteur.
- [ ] Redémarrage de la CVM : même adresse de règlement.
- [ ] Rapport de budget attesté conforme ; solde ETH de règlement ≥ 0,03.

### Parcours réels sur mainnet

- [ ] Prêt réglé : fournisseur payé, part compute sur le Safe, modèle ouvert par l'emprunteur.
- [ ] Échec d'entraînement : reçu enregistré, montants corrects.
- [ ] Remboursement à échéance réussi.
- [ ] Retraits fournisseur et emprunteur réussis.

### Pannes

- [ ] Runner arrêté pendant un calcul : reprise sans double règlement.
- [ ] RPC coupé puis rétabli : aucun prêt définitivement bloqué.
- [ ] ETH de règlement à zéro : alerte reçue, reprise après recharge.
- [ ] Aucun coupe-circuit ouvert par une erreur utilisateur.

### Exploitation

- [ ] Runbooks écrits : clé de règlement compromise, coupe-circuit ouvert, transaction bloquée, enclave arrêtée.
- [ ] Alertes : solde ETH, échecs runner, reaper silencieux.
- [ ] Astreinte du lundi au mercredi répartie.
- [ ] Page d'état, conditions d'utilisation et annonce relues.

### Si la porte n'est pas franchie

Le 6 octobre reste une date d'annonce : démo confidentielle sur testnet, registre d'audit, whitepaper et date mainnet confirmée publiquement avec ce qui reste à faire. Les points manquants passent en priorité et la porte est rejouée dès qu'ils sont prouvés.

## Runbooks à écrire avant le samedi

| Runbook | Contenu minimal |
|---|---|
| Clé de règlement compromise | Le contrat n'a ni pause ni rotation : arrêt du runner, plus aucun nouveau lock côté application, remboursements à échéance, redéploiement escrow et registre, republication des titres |
| Coupe-circuit ouvert | Lire le rapport de budget attesté, identifier la cause, `reset-failures` seulement après correction |
| Transaction runner bloquée | Lire l'opération, vérifier le nonce, re-signer ou `abandon` |
| Enclave arrêtée | Ne jamais recréer la CVM (identité perdue) ; redémarrer la même, vérifier l'adresse de règlement et les mesures |
| Reaper silencieux | Contrôler la dernière ligne de log, redémarrer, vérifier les prêts expirés |

## Règles de travail à deux

### Git

- Une branche par lot depuis `staging`, une PR par branche, revue par l'autre équipe avant fusion.
- Rien sur `main` avant le samedi soir, et uniquement par fusion de `staging`.
- Aucune fusion vers `staging` pendant une recette ou une session de démo ouverte.
- Gel du code vendredi 20h : ensuite, seuls les correctifs issus de la recette.

### Secrets

- Aucune clé dans le chat, la documentation ou la CI. Clé de déploiement et clés de vérificateur sur une machine locale, puis retirées.
- Les assistants ne voient que des noms de variables et des longueurs.
- Toute transaction mainnet est signée par un humain.

### Coordination

- Point de 15 minutes à 10h et 20h chaque jour, journal dans [MAINNET-LAUNCH.md](MAINNET-LAUNCH.md).
- Un blocage de plus de deux heures est signalé immédiatement.
- Chaque équipe reste sur ses fichiers réservés ; un besoin dans les fichiers de l'autre passe par une demande explicite.

## Budget du lancement

| Poste | Montant | Note |
|---|---|---|
| ETH mainnet (déploiement, règlement, tests, Safe) | ≈ 0,1 ETH | Ponté via Across depuis Base ou Arbitrum |
| USDC pour la répétition | ≈ 60 USDC | Récupérés en grande partie par les retraits |
| CVM Phala de production | ≈ 45 $/mois | Carte, sans recharge automatique |
| Base Neon mainnet | offre actuelle | Projet séparé |

## Après le lancement

- **Semaine 1** : surveillance quotidienne du registre runner et du reaper ; plafonds relevés seulement après sept jours sans incident.
- **Semaine 2** : points restants de l'audit (sessions révocables, limiteurs persistants, image runner épinglée par digest, empreintes liées au report data).
- **Ouverture du KYB** à des entreprises non invitées après deux semaines sans incident.
- **Audit externe** des contrats dès le financement obtenu, avant tout relèvement important des plafonds.
