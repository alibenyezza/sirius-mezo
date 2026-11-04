# Serveur MCP de Sirius (lecture seule)

Sirius expose un serveur [MCP](https://modelcontextprotocol.io) public à `POST /api/mcp`. Un agent (Claude, Cursor,
un agent maison, un autre écosystème) peut y parcourir le catalogue, lire une fiche, connaître les profils
d'entraînement, lire l'état du protocole et vérifier un certificat d'exécution. **Aucun achat, aucune signature,
aucune donnée de compte** : mêmes données que les pages publiques `/marketplace`, `/status` et `/certificate/[loanId]`.

Première étape de la feuille de route « Sirius pour les agents » : une interface indépendante de tout écosystème
(ACP ou autre), à laquelle on ajoutera ensuite le parcours payant.

## Se connecter

URL : `https://sirius-mezo.vercel.app/api/mcp` (Mezo testnet). Transport Streamable HTTP, sans authentification.

- **Claude Code** : `claude mcp add --transport http sirius https://sirius-mezo.vercel.app/api/mcp`
- **Claude (web, bureau)** : Paramètres → Connecteurs → Ajouter un connecteur personnalisé → coller l'URL.
- **Cursor** et clients à fichier `mcp.json` :
  ```json
  { "mcpServers": { "sirius": { "url": "https://sirius-mezo.vercel.app/api/mcp" } } }
  ```
- **Test manuel** : `npx @modelcontextprotocol/inspector`, transport « Streamable HTTP », même URL.

## Outils

Tous annotés `readOnlyHint: true`, `destructiveHint: false`, avec un `outputSchema` : la réponse arrive en
`structuredContent` (JSON validé) et en texte encadré pour les clients qui ne lisent que le texte.

| Outil | Entrée | Sortie |
|---|---|---|
| `search_datasets` | `query`, `category`, `trainingProfile`, `verifiedProvidersOnly`, `sort` (`recent`, `borrowed`, `price`), `page` | 24 datasets par page : id, nom, lien, catégorie, profil, prix, lignes, colonnes, emprunts, KYB du fournisseur |
| `get_dataset` | `datasetId` | fiche : description, prix détaillé (part du fournisseur, frais de calcul indicatifs, total), taille, adresse du fournisseur, délai de remboursement, historique ; `found: false` si le dataset n'est pas en vente |
| `list_training_profiles` | — | profils du registre (`MODEL_REGISTRY`), ce qu'ils prédisent, leurs métriques, ce que reçoit l'acheteur |
| `get_protocol_status` | — | réseau, jeton, mode de calcul confidentiel, plafonds, tarif, contrats, audit |
| `verify_certificate` | `loanId` | verdict du certificat (`verified` seulement si toutes les vérifications passent), contrôles, mesures, règlement on-chain |

## Code

- `src/lib/agent/tools.ts` : schémas d'entrée et de sortie, projections champ par champ, nettoyage du texte des
  fournisseurs. Module pur.
- `src/lib/agent/tools-server.ts` : sources réelles (catalogue et fiche de la marketplace, état du protocole de Sirio,
  certificat).
- `src/lib/agent/mcp.ts` : serveur MCP (SDK `@modelcontextprotocol/server` v2, révision 2026-07-28) et contrôles
  avant le SDK.
- `src/app/api/mcp/route.ts` : interrupteur, débit, origine.
- Tests : `src/lib/agent/tools.test.ts`, `src/lib/agent/mcp.test.ts`.

## Garde-fous

- **Interrupteur** `SIRIUS_MCP_ENABLED=true` sur le projet Vercel. Absent ou autre valeur : la route répond 404 dès
  le redéploiement.
- **Sans état** : une instance de serveur par requête, rien n'est gardé entre deux appels. Les clients 2025
  (poignée de main `initialize`) sont servis de la même façon, sans session.
- **Pas de flux ouvert** : `subscriptions/listen` est refusé (405). Il garderait une fonction ouverte sans rien
  envoyer, les outils ne changeant qu'au déploiement. `maxDuration` de 30 s.
- **Débit** : 60 appels par minute par client (si `SIRIUS_TRUST_PROXY_HEADERS=true`) et 1 200 par instance, comme
  le catalogue public. Le catalogue est lu depuis un cache de 10 s. `verify_certificate` débite le même limiteur que
  la page `/certificate/[loanId]` et la vérification matérielle garde ses propres plafonds.
- **Taille** : corps de requête limité à 64 Kio (413 au-delà, avant lecture).
- **Origine** : un client MCP n'envoie pas d'en-tête `Origin` et passe. Un navigateur en envoie un : seul le site
  lui-même est accepté (protection contre le rebinding DNS demandée par la spec).
- **Texte des fournisseurs** : le nom et la description d'un dataset partent dans le contexte du modèle de l'agent.
  Ils sont nettoyés (caractères de contrôle, de direction et invisibles retirés), tronqués (80 et 600 caractères),
  signalés comme données non vérifiées dans chaque réponse et dans la description des outils.
- **Erreurs** : une source en panne rend un message générique, jamais le message d'origine (qui pourrait citer
  une URL de base ou de RPC). Une entrée hors schéma est refusée avant toute lecture.
- **Aucune donnée privée** : aucune session ni cookie lus ; les projections ne contiennent ni clé, ni CID de
  dataset, ni pièces brutes d'attestation.

## Activation

1. Poser `SIRIUS_MCP_ENABLED=true` sur le projet Vercel `sirius-mezo`, puis `vercel --prod`.
2. Couper : `SIRIUS_MCP_ENABLED=false` (ou supprimer la variable), redéployer.

## Prédictions payées par x402

Un agent peut payer une prédiction à l'appel, sans compte ni session : `GET /api/x402/predict`
décrit l'API (prix, actif, réseau, colonnes attendues, exemple), `POST /api/x402/predict` sans
paiement répond `402 Payment Required`, et un client x402 (`@x402/fetch`) signe une autorisation
Permit2 + EIP-2612 en MUSD. Le facilitateur Mezo (`https://facilitator.vativ.io`) vérifie, règle
le transfert sur le testnet et paie le gas en BTC : l'agent n'a besoin que de MUSD.

- Prix par défaut : 0,001 MUSD (`SIRIUS_X402_PRICE`), versé à `SIRIUS_X402_PAY_TO`.
- Réglé seulement si la prédiction réussit : une entrée invalide répond 400 et ne coûte rien.
- Paiement direct, sans escrow ni remboursement : réservé aux micro-paiements. L'entraînement
  reste payé par l'escrow.
- Modèle servi : un modèle de démonstration entraîné par le code du runner sur le dataset public
  `public/examples/regression/energy-demand-train.csv` (`src/lib/x402/demo-model.json`). Les modèles
  des acheteurs restent chiffrés pour eux et ne sont jamais servis.
- Agent de démonstration : `X402_BUYER_KEY=0x… node --import tsx scripts/x402-agent.ts`, ou
  `node --env-file=.env.local --import tsx scripts/x402-agent.ts --demo-wallet` (wallet du fournisseur de démo).
- Activation : `SIRIUS_X402=true` et `SIRIUS_X402_PAY_TO` sur le projet Vercel, puis redéployer.
- Premier règlement réel (4 nov. 2026) : 0,001 MUSD du wallet de démo vers la trésorerie,
  [`0x50e71f23…11c20ed0`](https://explorer.test.mezo.org/tx/0x50e71f23b2cabd4fa3070cf542aa9af102bf65da13d2315a44106b9211c20ed0),
  gas payé par le facilitateur.

## Suite (non construite)

Parcours payant pour un agent : authentification par signature du wallet de l'agent (jeton court, budget plafonné,
séparé du cookie du site), invitation KYB automatique acceptée on-chain par l'agent, devis signé et transactions
préparées par Sirius mais signées par l'agent (Sirius ne détient jamais de clé), suivi du job, livraison chiffrée du
modèle à la clé de l'acheteur. À construire avec un acheteur pilote identifié.
