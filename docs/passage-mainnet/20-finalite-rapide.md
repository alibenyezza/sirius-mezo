# Finalité rapide des petits prêts — mise en service, vérification, retour arrière

Sur Mezo mainnet, le bloc `finalized` suit la finalité L1 et traîne un quart d'heure derrière la tête (≈ 8 500 blocs, relevé du 5 octobre). Un prêt attendait donc deux fois ~15 min : avant l'entraînement (le lock doit être sous le bloc stable) et après le release (le règlement n'est « réglé » qu'une fois finalisé). La finalité rapide accepte, pour les **petits prêts seulement**, le lock et le release après **30 confirmations L2** avec contrôle du hash canonique, soit quelques secondes.

Ce que ces confirmations garantissent, et ce qu'elles ne garantissent pas. Sur un rollup à séquenceur unique, 30 blocs L2 protègent d'une **vue RPC** en retard ou incohérente (nœud qui n'a pas encore le bloc, relecture d'une branche abandonnée par le RPC) ; elles ne protègent **pas** d'un séquenceur qui publierait deux histoires ou perdrait des blocs pas encore postés sur L1. Le palier rapide repose donc sur la confiance accordée au séquenceur de Mezo. Seuls `finalized`, ou `safe` (mesuré à 8–13 min, ce qui annulerait l'intérêt du palier), en sont indépendants : on garde 30 confirmations, en connaissance de cause. Décision des fondateurs, risque accepté : une défaillance du séquenceur après un règlement rapide pourrait faire disparaître un release alors que le modèle a été livré ; l'exposition à ce risque est bornée par prêt (25 MUSD) et au total (100 MUSD en cours, côté Next **et** côté enclave).

Références : [19-mise-en-production.md](19-mise-en-production.md) (étapes 3, 8, 9, 10, 11), [MAINNET-RUNBOOKS.md](../MAINNET-RUNBOOKS.md) (runbook 1 : identité de l'enclave), code : `src/lib/evm/fast-finality.ts`, `src/lib/sirius/finality-tier.ts`, `src/lib/sirius/fast-settlement-review.ts`.

## Règles

- Aucune valeur secrète ici ni dans le chat : seulement des **noms** de variables et des constantes publiques (seuils, confirmations).
- `SIRIUS_EVM_FINALITY=finalized` reste **obligatoire** sur mainnet. La finalité rapide s'y ajoute, elle ne la remplace pas ; le mode `confirmations` nu reste refusé partout (`finalityPolicy`, `mainnet-guard`, `release-check`, préflight).
- Coupe-circuit : `SIRIUS_FAST_FINALITY` absent ou `false` sur Next et le reaper ⇒ comportement historique **partout**, même pour les prêts déjà classés rapides (ils repassent en finalité complète ; seule la revérification des releases déjà réglés continue, elle est sans effet sur l'argent).
- Chaque geste réussi est consigné dans [MAINNET-LAUNCH.md](../MAINNET-LAUNCH.md) : heure, auteur, hash du Compose avant/après.

## Ce qui change, et où

| Décision de finalité | Avant | Avec le palier rapide (prêt FAST) |
|---|---|---|
| Lock avant entraînement, Next (`src/lib/sirius/settle.ts`, `prepareLoanResult`) | `assertBlockStable` : bloc finalisé ≥ bloc de lock | `assertLockStable` : reçu du lock relu, dans le bloc persisté, hash canonique, tête ≥ lock + 29 |
| Lock lu par l'enclave (`src/lib/evm/escrow.ts`, `assertLoanScope`) | `matchesScope` au bloc finalisé | `matchesScope` à tête − 29 |
| Reçu du release, enclave (`src/lib/billing/settlement.ts`, `confirm`) | canonique sous le bloc finalisé, sinon « pending-finality » | canonique sous tête − 29 |
| Livraison de la clé, enclave (`src/runner/handler.ts`, `loan-model-key` → `publishedFinalizedPreimage`) | idem | idem |
| Réconciliation du reaper et des reprises (`reconcileLoanEscrow`) | bloc finalisé | **inchangé** : toujours le bloc finalisé |
| Revérification d'un release rapide (`src/lib/sirius/fast-settlement-review.ts`) | — | 15 min après `settledAt`, sous le bloc finalisé ; divergence ⇒ alerte et revue |
| Affichage de l'attente (`GET /api/loans/[id]/finality`, page Train) | minutes | secondes, relecture toutes les 5 à 20 s |

Le palier d'un prêt est décidé au moment où l'entraînement peut démarrer : Next relit le montant sur le contrat (`getLoan`), vérifie qu'il égale le montant enregistré, calcule le palier candidat (somme des prêts rapides en cours, lecture seule), vérifie la profondeur du lock **à ce palier**, et seulement ensuite marque la ligne (`Loan.finalityTier = FAST`) dans une transaction sérialisable qui recompte la somme : un lock pas encore assez profond n'occupe jamais le plafond. Un palier FAST est acquis tant que le prêt avance ; un prêt rapide rendu à ESCROWED (entraînement échoué) et laissé sans lancement **dix minutes** est ramené à FULL par le reaper (`FAST_IDLE_REVERT_MS`) et repassera par la décision au prochain lancement. Un palier FULL est réévalué à chaque tentative.

L'enclave n'accepte le palier rapide que si **sa propre** politique (constantes du Compose attesté) l'admet : montant du devis qu'elle a signé ≤ `SIRIUS_FAST_FINALITY_MAX_USDC`, sinon refus explicite (`Finalité rapide refusée par l’enclave pour ce prêt`) ; et somme de **ses** prêts rapides verrouillés non libérés (table `fast_exposure` du registre `runner_budget`) ≤ `SIRIUS_FAST_FINALITY_TOTAL_USDC`. Cette part n'est réservée qu'au **lancement du calcul**, une fois le lock lu à la profondeur rapide ; jamais au règlement ni à la livraison de clé (le release l'a déjà rendue). Elle est rendue au release ou au remboursement confirmés et à l'échec définitif du règlement, et purgée après l'échéance du prêt. Plafond atteint au lancement : si le lock est déjà sous le bloc finalisé, le prêt est traité à finalité complète (journal runner : `plafond d'exposition rapide atteint`) ; sinon l'enclave répond « Paiement en attente de finalité du réseau… », le message que la page Train traite déjà comme une attente, sans compter d'échec ni consommer de crédit : Next garde son palier rapide et réessaie, le plafond se libérant au fil des releases. Elle n'applique jamais le palier rapide sans que Next le demande.

## Variables

| Variable | Next (Vercel) | Reaper (VPS) | Runner (CVM) | Défaut | Rôle |
|---|---|---|---|---|---|
| `SIRIUS_FAST_FINALITY` | `true` / `false` | identique à Next | **constante du Compose** : `"true"` | absent = `false` | coupe-circuit |
| `SIRIUS_FAST_FINALITY_MAX_USDC` | `25` | identique | **constante du Compose** : `"25"` | `25` | seuil par prêt (dataset + calcul), unités du jeton |
| `SIRIUS_FAST_FINALITY_TOTAL_USDC` | `100` | identique | **constante du Compose** : `"100"` | `100` | plafond des prêts rapides en cours ; ≥ `MAX_USDC`. Deux compteurs distincts : Next (base, statuts ESCROWED/TRAINING/SETTLING), enclave (registre, verrouillés non libérés) |
| `SIRIUS_FAST_FINALITY_CONFIRMATIONS` | `30` | identique | **constante du Compose** : `"30"` | `30` | confirmations L2, entre 1 et 100 |

Toute valeur illisible (drapeau autre que `true`/`false`, montant nul ou négatif, confirmations hors 1–100, seuil > plafond) **arrête le démarrage** du rôle concerné (Next : `instrumentation-node.ts` ; reaper : `mainnet-guard.ts` ; runner : `src/runner/config.ts`) et fait échouer `release-check`. `release-check` ne refuse que la direction nuisible : Next ou le reaper à `true` pendant que le runner est à `false` (chaque prêt rapide serait refusé par l'enclave), ou avec un seuil ou des confirmations différents des constantes attestées ; Next et le reaper doivent se lire pareil entre eux. Next et le reaper à `false` pendant que le Compose garde ses constantes est le retour arrière de niveau 1, autorisé. Le fichier privé du runner recopie les constantes du Compose pour cette vérification seulement : cette copie est **auto-attestée** (c'est l'opérateur qui l'écrit), elle ne prouve rien sur la CVM ; seule la capture de l'attestation, comparée au hash du Compose rendu, le prouve.

Deux plafonds globaux, volontairement : Next compte en base ce qu'il a classé rapide (statuts ESCROWED, TRAINING, SETTLING), l'enclave compte dans son registre ce qu'elle a réellement admis en rapide et pas encore vu libéré. Ni l'un ni l'autre ne suffit seul : Next peut être contourné par un autre appelant, l'enclave ne voit pas les prêts que Next n'a pas lancés.

## Pourquoi la CVM change

`deploy/phala/compose.v7.yaml` porte désormais les trois constantes du runner. Elles sont couvertes par le **hash du Compose**, donc par l'attestation : personne ne peut relever le seuil ou baisser les confirmations de l'enclave sans que Next et le reaper le voient (ils comparent `SIRIUS_EXPECTED_COMPOSE_HASH` à chaque capture). La contrepartie : activer le palier rapide côté enclave est une **mise à niveau de la CVM** suivie d'un **ré-épinglage**, exactement comme l'étape 8 de [19](19-mise-en-production.md). Changer les constantes plus tard (autre seuil, autres confirmations) repasse par la même procédure.

## Procédure

**Qui** : Ali (CVM), Ali (Vercel, VPS). **Aucune transaction on-chain.** Durée : une heure, dont une demi-heure d'attente des prêts en cours.

### 0. Pré-requis

- La branche contenant la finalité rapide est fusionnée sur `staging`, CI verte, image runner publiée (digest `IMG` dans `.ops/mainnet/`), test complet passé sur testnet avec `SIRIUS_FAST_FINALITY=true` (lock et release d'un prêt ≤ 25 en quelques secondes, revérification du reaper journalisée).
- Migration Prisma `20261007020000_add_loan_finality_tier` **déjà appliquée** sur la base mainnet par le job Migrations (colonnes additives avec défauts : l'ancien code continue de tourner dessus ; le nouveau code ne tourne **pas** sans elles). Vérifier : `prisma migrate status` sans migration en attente.
- Clone à jour, `pnpm install --frozen-lockfile`, profil Phala `sirius` connecté, accès VPS.

### 1. Fermer les admissions et laisser finir les prêts en cours

**Qui** : Ali.

1. Vercel Production : `SIRIUS_ADMISSIONS_CLOSED=true`, redéployer. Les prêts déjà verrouillés continuent (entraînement, règlement, livraison) ; aucun nouveau lock.
2. Attendre que la base ne contienne plus de prêt ESCROWED, TRAINING ni SETTLING (page d'état, ou `SELECT status, count(*) FROM "Loan" GROUP BY status`). Ces prêts ont été lancés contre l'ancienne enclave : les laisser se régler avec elle évite tout prêt à cheval sur deux Compose.

**Vérifier** : plus aucun prêt actif ; le reaper journalise `passe ok` avec `prêts=0`.

### 2. Rendre le Compose actif avec les constantes

**Qui** : Ali.

```bash
pnpm phala:compose-v7 active "$IMG" .ops/mainnet/active.fast.compose.json --origin=https://sirius-data.tech
```

**Vérifier** : dans le JSON rendu, `services.runner.environment` contient `SIRIUS_FAST_FINALITY: "true"`, `SIRIUS_FAST_FINALITY_MAX_USDC: "25"`, `SIRIUS_FAST_FINALITY_TOTAL_USDC: "100"`, `SIRIUS_FAST_FINALITY_CONFIRMATIONS: "30"` ; `SIRIUS_EVM_FINALITY: finalized` toujours présent (`scripts/render-phala-v7.test.mjs` le garantit). Le fichier précédent (`active.compose.json`) est conservé pour le retour arrière.

### 3. Mettre à niveau la CVM

**Qui** : Ali. Même geste que l'étape 8 de [19](19-mise-en-production.md), même fichier d'environnement chiffré (`runner.active.env`, rien à y ajouter : les trois valeurs sont des constantes du Compose).

```bash
pnpm dlx phala@1.1.22 deploy --profile sirius --cvm-id <cvm-id> \
  -c .ops/mainnet/active.fast.compose.json -e .ops/mainnet/runner.active.env --wait
```

**Vérifier** : le runner redémarre en mode actif ; son journal (privé) ne contient pas `Politique de finalité rapide invalide`. Le volume `runner_budget` (registre et politiques) est inchangé : même CVM, même master key, même adresse de règlement.

**Si ça échoue** : repasser le Compose précédent (`active.compose.json`) sur la même CVM, puis reprendre à l'étape 2 après correction. Tant que l'adresse de règlement est la même, rien n'est gravé de travers ; si elle a changé, **arrêter** : runbook 1.

### 4. Recapturer et ré-épingler

**Qui** : Ali (capture), Ali (variables).

1. `RUNNER_URL=https://<app-id>-4100s.<gateway-domain> pnpm runner:capture-ra-tls` : noter le **nouveau** hash du Compose. Comparer au document brut de `pnpm dlx phala@1.1.22 cvms attestation <cvm-id> --profile sirius`.
2. Contrôler que **seul le hash du Compose a changé** : MRTD identique, chaîne KMS identique, clé d'ingestion identique, adresse de règlement identique. RTMR3 est informatif, pas épinglé (il a survécu au redémarrage du 5 octobre ; l'identité est prouvée par MRTD, le hash du Compose et le journal d'événements rejoué) : le noter, sans en faire un critère. Tout autre changement : ne pas ré-épingler, runbook 1.
3. Vercel Production : `SIRIUS_EXPECTED_COMPOSE_HASH` = nouveau hash (`vercel env add … production --sensitive`, valeur sur l'entrée standard). Poser en même temps `SIRIUS_FAST_FINALITY=true`, `SIRIUS_FAST_FINALITY_MAX_USDC=25`, `SIRIUS_FAST_FINALITY_TOTAL_USDC=100`, `SIRIUS_FAST_FINALITY_CONFIRMATIONS=30`.
4. VPS `/opt/sirius/.env.vps` : mêmes cinq valeurs (`SIRIUS_EXPECTED_COMPOSE_HASH`, les quatre `SIRIUS_FAST_FINALITY*`), puis `docker compose -p sirius --env-file .env.vps up -d reaper` et `check-reaper.sh`.
5. Fichier privé du runner pour la vérification de sortie : y recopier `SIRIUS_FAST_FINALITY=true`, `SIRIUS_FAST_FINALITY_MAX_USDC=25`, `SIRIUS_FAST_FINALITY_TOTAL_USDC=100`, `SIRIUS_FAST_FINALITY_CONFIRMATIONS=30`. Cette copie est auto-attestée (écrite par l'opérateur) : elle sert à la cohérence des trois fichiers, pas à prouver ce que fait la CVM, qui est prouvé par la capture de l'étape 4.1.
6. `pnpm ops:check-release --network=mainnet .ops/mainnet/next.env .ops/mainnet/reaper.env .ops/mainnet/runner.env` (étape 11 de [19](19-mise-en-production.md)) : `configurationReady: true`, aucun `divergence.SIRIUS_FAST_FINALITY*`.
7. Redéployer Next (relancer le job Vercel ou pousser sur `main` selon la procédure en vigueur).

**Vérifier** : logs Vercel au démarrage : `[sirius] finalité rapide active : prêts ≤ 25 (plafond en cours 100), 30 confirmations` ; reaper démarré sans `Reaper mainnet refusé` ; le rapport de budget attesté (`pnpm ops:runner-monitor …`) passe avec le nouveau hash.

### 5. Rouvrir et tester

**Qui** : Ali et Ali, wallets d'équipe.

1. Retirer `SIRIUS_ADMISSIONS_CLOSED` (ou `false`), redéployer.
2. Prêt de test **≤ 25 MUSD** : après le lock, la page Train affiche « Confirmation du paiement : ~N s » et l'entraînement démarre seul en quelques secondes ; le règlement passe en SETTLED et le modèle se télécharge sans attendre un quart d'heure. En base : `finalityTier = 'FAST'`.
3. Prêt de test **> 25 MUSD** (si le plafond de la bêta le permet) : la page affiche les minutes, comportement historique, `finalityTier = 'FULL'`.
4. Quinze à vingt minutes après le règlement rapide : le reaper journalise `[reaper] prêt EVM <id> : release rapide confirmé à finalité complète` et `finalityVerifiedAt` est renseigné.

**Vérifier** : aucune ligne `[reaper] ALERTE finalité rapide` ; `check-reaper.sh` vert.

## Retour arrière

| Niveau | Geste | Effet | Délai |
|---|---|---|---|
| Désactiver (recommandé en premier) | Vercel et `.env.vps` : `SIRIUS_FAST_FINALITY=false` ; redéployer Next, `up -d reaper` | Plus aucun prêt ne demande le palier rapide, y compris ceux déjà marqués FAST (ils attendent le bloc finalisé). L'enclave garde ses constantes : inoffensives tant que Next ne demande rien. Les releases rapides déjà réglés restent revérifiés par le reaper | minutes, aucune CVM |
| Resserrer | Baisser `SIRIUS_FAST_FINALITY_TOTAL_USDC` ou `SIRIUS_FAST_FINALITY_MAX_USDC` sur Next et le reaper | Moins de prêts admis en rapide ; `MAX_USDC` côté Next ne peut qu'être **≤** à celui du Compose pour rester cohérent (l'enclave refuserait sinon le surplus, `release-check` refuse déjà la divergence) | minutes |
| Retirer de l'enclave | **D'abord** le niveau 1 (Next et reaper à `false`, redéployés) ; puis étapes 1 à 4 avec l'ancien `active.compose.json`, ré-épingler l'ancien hash | Compose sans les constantes : la CVM refuse tout palier rapide, quoi que demande Next (`Finalité rapide désactivée pour ce rôle`). Sans le niveau 1 préalable, `release-check` refuserait (`runner-disabled`) et chaque prêt rapide demandé par Next serait refusé par l'enclave | une heure |

Ne jamais retirer `SIRIUS_EXPECTED_COMPOSE_HASH` ni laisser Next et le reaper sur deux hashes différents : l'un des deux refuserait l'enclave.

## Alerte : `[reaper] ALERTE finalité rapide`

Le reaper a revérifié un release rapide sous le bloc finalisé et la chaîne le contredit. Il a posé `Loan.finalityReview` (motif) et `finalityReviewAt`, compté une erreur dans sa passe (visible dans le battement `erreurs=`), et le prêt est **gelé** : plus de livraison de clé (`POST /api/loans/[id]/key` répond 409 « Règlement en cours de revue »), plus de certificat. Le statut reste SETTLED : le modèle peut déjà avoir été livré, rien n'est annulé ni retenté automatiquement.

| Motif | Ce qui s'est passé | Décision |
|---|---|---|
| `release disparu après réorganisation : escrow encore verrouillé` | Le release a été réorganisé hors de la chaîne et n'a pas été réinclus ; le fournisseur n'a pas été payé, l'emprunteur a peut-être le modèle | Avant l'échéance : **rejouer le release** avec les preuves conservées (ci-dessous), sans ouvrir l'enclave. Sinon laisser l'échéance passer et l'emprunteur se rembourser. Montant en jeu ≤ 25 MUSD : perte acceptée si aucune des deux voies n'aboutit |
| `bloc du release réorganisé après le règlement rapide` | Le reçu existe mais son bloc n'est plus canonique ; vérifier sur l'explorateur si la transaction a été réincluse ailleurs | Si réincluse et escrow libéré : clore la revue (ci-dessous). Sinon, comme la ligne précédente |
| `release finalisé mais escrow non libéré on-chain (…)` | Incohérence entre le reçu et l'état du contrat : ne devrait pas arriver | Vérifier le RPC (archive, bonne chaîne) ; si confirmé, arrêter les admissions et ouvrir une analyse, runbook 1 |
| `release introuvable mais escrow libéré par une autre transaction` | Le fournisseur a été payé par un autre release (reprise, remplacement de frais) | Vérifier la transaction sur l'explorateur, puis clore la revue en corrigeant `settleTxHash` |

**Rejouer un release rapide disparu.** Dès qu'un prêt rapide passe en SETTLED, Next conserve sur la ligne (`settlement-evidence.ts`, au mieux, jamais bloquant) la transaction signée brute du release reconstituée depuis le RPC (`Loan.settleRawTx`) et le préimage devenu public (`Loan.settlePreimage`). Avant l'échéance du prêt (`Loan.evmDeadline`), dans l'ordre :

1. Rediffuser telle quelle : `eth_sendRawTransaction` avec `settleRawTx` (par exemple `cast publish <settleRawTx> --rpc-url <RPC mainnet>`). Même nonce, même signature : accepté tant que le wallet runner n'a pas consommé ce nonce depuis ; refusé (`nonce too low`) sinon.
2. Sinon, rejouer l'appel depuis n'importe quel wallet d'équipe : `release(bytes32 loanKey, bytes32 preimage)` de `SiriusEscrowV7` est sans permission dès que le préimage est connu (`cast send <escrow> "release(bytes32,bytes32)" <evmLoanKey> <settlePreimage> --rpc-url … --private-key …`). Le fournisseur et la trésorerie sont crédités comme si le runner avait réglé.
3. Vérifier sur l'explorateur que l'escrow est `Released`, corriger `settleTxHash` si la transaction gagnante est la nouvelle, puis clore la revue. Le registre du runner garde l'ancienne opération pour réussie : rien à y toucher.

Si `settleRawTx`/`settlePreimage` sont vides (capture échouée, journal `[settle] preuves de rediffusion non enregistrées`), le préimage se relit sur le contrat tant que le release y figure (`preimageOf`) ; s'il a disparu avec le release, seule l'enclave le connaît : runbook 1.

Clore une revue, une fois la décision prise et consignée : `UPDATE "Loan" SET "finalityReview" = NULL, "finalityVerifiedAt" = now() WHERE id = '<id>' AND "finalityReview" IS NOT NULL;` (livraison et certificat redeviennent possibles). Si la finalité rapide est suspectée, désactiver d'abord (retour arrière, niveau 1).

## Risques résiduels, assumés

- Séquenceur qui équivoque ou perd des blocs non postés sur L1 après un règlement rapide : 30 confirmations L2 n'y changent rien (elles ne couvrent que la vue RPC) ; le modèle est livré, le release peut disparaître ; borné à 25 MUSD par prêt et 100 MUSD en cours (Next et enclave) ; détecté par le reaper, rejouable avec les preuves conservées, jamais réparé seul.
- Le lock lu par l'enclave à tête − 29 n'a pas de reçu à comparer (seul Next relit le reçu du lock) : une réorganisation du lock pendant l'entraînement produirait un modèle pour un escrow disparu ; l'enclave ne livre la clé qu'après un release confirmé, donc rien ne sort sans paiement.
- La somme des prêts rapides en cours est celle de la base : un prêt rapide dont la ligne serait perdue ne compterait plus. La transaction sérialisable couvre la concurrence, pas l'incohérence base/chaîne, déjà couverte par le reaper.
- Le palier est annoncé à l'affichage (`GET …/finality`) avant d'être décidé au lancement : si le plafond se remplit entre les deux, la page repasse en minutes à la lecture suivante.
