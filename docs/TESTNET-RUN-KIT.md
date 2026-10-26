# Kit de preuve du parcours réel à deux wallets

Préparation B2.4 du 25 septembre 2026, Ali, pour le point 5 du [plan de travail](WORK-PLAN-1-7.md). Il sert pendant le créneau Phala de Ali : chaque scénario de la matrice navigateur est encadré par deux relevés en lecture seule, dont la différence est la preuve. Aucun outil de ce kit ne signe ni n'envoie de transaction.

## Outils

| Commande | Rôle | Écrit quelque chose ? |
|---|---|---|
| `ops:testnet-evidence snapshot --accounts=… --escrows=… [--loans=…] [--tx=…]` | Relevé au bloc stable : soldes ETH et USDC, crédits dus dans chaque escrow, comptabilité des escrows, état des prêts suivis, reçus canoniques | Non |
| `ops:testnet-evidence diff avant.json apres.json` | Deltas d'une étape : mouvements USDC, crédits, état du prêt, nouvelles transactions et gas | Non |
| `ops:escrow-events` (A2) | Événements des escrows jusqu'au bloc stable | Non |
| `ops:reconcile` (A2) | Classement comptable ; prend `receiptsForReconcile` du relevé comme `--receipts` | Non |
| `runner:budget export` (A1, dans la CVM) | Export du registre runner pour le rapprochement | Non |

`ops:testnet-evidence` est une commande à ajouter au manifeste par Ali ; en attendant : `NODE_OPTIONS=--conditions=react-server node --import tsx scripts/operations/testnet-evidence-cli.ts`. Elle lit `EVM_NETWORK` et `EVM_RPC_URL` (archive) dans l'environnement explicite, jamais un `.env`. Le bloc stable suit la politique de finalité de l'application ; l'USDC et ses décimales sont lus sur le premier escrow.

## Comptes et adresses à suivre

Pour la remise à zéro staging décidée le 25 septembre, utiliser seulement le nouvel escrow `0x5f9d8d8035b32657f9fd5d03149d86c06ead5f6c`. Provider : `0xe07abf7ef148d0ecf04906239deb2b1b54e9aa55` ; borrower : `0x75773bf175273eb37cd89016324176e257d114ce`. Les exemples multi-escrows ci-dessous servent aux inventaires historiques ; ils ne sont pas requis pour ce parcours neuf. La commande `ops:testnet-evidence` est intégrée au manifeste.

| Libellé | Rôle | Source |
|---|---|---|
| `provider` | Wallet A, publie le dataset | Wallet de test dédié, distinct de la trésorerie |
| `borrower` | Wallet B, emprunte | Idem |
| `recipient` | Bénéficiaire compute de Sirius | `SIRIUS_COMPUTE_RECIPIENT` de [PHALA-V7-STAGING.md](PHALA-V7-STAGING.md) |
| `runner` | Compte de règlement Phala, paie le gas | `SIRIUS_LOCK_AUTHORIZER` |
| escrows | v7 nouveau, v6 `0x805a…cba0`, v5 `0xede8…700e` | Nouvelles adresses après déploiement ; historiques inchangés |

Exemple, adresses à compléter :

```bash
export EVM_NETWORK=testnet EVM_RPC_URL=<endpoint-archive-testnet> NODE_OPTIONS=--conditions=react-server
node --import tsx scripts/operations/testnet-evidence-cli.ts snapshot \
  --accounts=provider:0xA,borrower:0xB,recipient:0xb6acf8a998bb8efa34a954cd6334ccc15da7f919,runner:0x3b31923ee7cb2a15fc85abbeeae1fc32afc08c8d \
  --escrows=v7:0xNOUVEL_ESCROW,v6:0x805a2c2deaa3a8926e85fed6b341dacb54cacba0,v5:0xede81141d007593d4bfce2de4778f753d167700e \
  --loans=0xNOUVEL_ESCROW:0xLOAN_KEY --tx=0xHASH_LOCK,0xHASH_RELEASE > .ops/run/N5-apres.json
```

## Déroulé par scénario

Pour chaque ligne de la matrice navigateur (N1 à N8, I1 à I10) :

1. **Relevé avant** : `snapshot` avec les comptes, les escrows et les prêts déjà connus → `.ops/run/<scénario>-avant.json`.
2. **Action** dans le navigateur, par le wallet concerné. Noter l'heure UTC, ce qui a été cliqué, ce qui s'est affiché, les hashes de transaction montrés par le wallet.
3. **Attendre le bloc stable** qui contient la dernière transaction : le relevé refuse un reçu au-delà du bloc stable, il faut donc attendre plutôt que forcer.
4. **Relevé après** : `snapshot` avec en plus `--tx=` tous les hashes de l'étape → `.ops/run/<scénario>-apres.json`.
5. **Diff** : `diff avant apres` → `.ops/run/<scénario>-diff.json`. Vérifier que les deltas correspondent à l'attendu de la matrice.
6. **Comptabilité** : en fin de session, `runner:budget export` dans la CVM, `ops:escrow-events` sur les trois escrows, puis `ops:reconcile` avec l'export, le relevé d'événements et `receiptsForReconcile` du dernier relevé. Aucun écart critique attendu.

Ce que le diff doit montrer, par exemple :

| Scénario | Deltas attendus |
|---|---|
| N4 verrouillage | `borrower.usdcAtomicDelta` = −(dataset + compute) ; escrow v7 `lockedAtomicDelta` = +total ; prêt `locked` |
| N5 règlement | prêt `released` ; `provider.creditsDelta[v7]` = +dataset ; `recipient.creditsDelta[v7]` = +compute ; `runner.ethWeiDelta` négatif du gas ; `gasSpentWei` = gas du release |
| N7 retrait provider | `provider.creditsDelta[v7]` = −dataset ; `provider.usdcAtomicDelta` = +dataset |
| I5 échec mesuré | prêt `failed` ; `borrower.creditsDelta[v7]` = +(total − retenue) ; `recipient.creditsDelta[v7]` = +retenue ; `consumedComputeDelta` = retenue |
| I8 remboursement à échéance | prêt `refunded` ; `borrower.creditsDelta[v7]` = +total si rien n'a été consommé |

Un solde net des comptes suivis différent de zéro est normal quand l'escrow bouge : l'escrow n'est pas un compte suivi, sa comptabilité l'est.

## Preuves à conserver

Dans `.ops/run/` (privé) : les relevés, les diffs, l'export runner, le relevé d'événements, le rapprochement, et un journal horodaté par scénario. Dans la documentation : une synthèse par scénario sans secret, avec les hashes publics et les blocs, à reporter dans la matrice navigateur (colonne « Testnet »).

## Limites

- Le kit lit l'état, il ne prouve ni l'attestation Phala ni la confidentialité du calcul : ce sont les mesures RA-TLS et les contrôles de Ali.
- Un RPC qui ne sert pas l'état historique au bloc stable fait échouer le relevé : utiliser l'endpoint archive retenu pour v7.
- Les scénarios I6, I7 et I10 (coupure du runner, réponse perdue, panne RPC) demandent une intervention pendant le calcul ; le kit ne relève que leurs conséquences on-chain.
