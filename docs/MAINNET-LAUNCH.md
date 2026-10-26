# Journal du lancement mainnet

Journal d'exécution du [plan de lancement](MAINNET-LAUNCH-PLAN.md). Une entrée par action réalisée, avec sa preuve. Aucun secret : adresses publiques, hashes, noms de variables et sorties de commande uniquement.

## Références publiques

| Élément | Valeur |
|---|---|
| Réseau | Mezo mainnet, chainId `31612` |
| RPC | `https://mainnet.mezo.public.validationcloud.io` |
| USDC | `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8`, 18 décimales |
| Safe 2 sur 2 | à renseigner |
| Clé de déploiement (adresse publique) | à renseigner |
| Vérificateurs KYB | à renseigner (deux adresses) |
| CVM de production | à renseigner (identifiant, app ID) |
| Adresse de règlement attestée | à renseigner |
| `SiriusKybRegistry` | à renseigner |
| `SiriusDatasetRegistry` | à renseigner |
| `SiriusEscrowV7` | à renseigner |
| Base Neon mainnet | à renseigner (nom du projet) |

## Suivi des lots

| Lot | Propriétaire | Branche | PR | État |
|---|---|---|---|---|
| N1 Coupe-circuit | Ali | `fix/budget-failures` | | à faire |
| N2 Finalité | Ali | `fix/finality-pending` | | à faire |
| N3 Échec transitoire | Ali | `fix/budget-failures` | | à faire |
| N4 Transaction rejetée | Ali | `fix/finality-pending` | | à faire |
| N5 Outillage runner | Ali | `feat/mainnet-runner-tooling` | | à faire |
| N6 Script de déploiement | Ali | `feat/mainnet-runner-tooling` | | à faire |
| N7 CVM de production | Ali | — | | à faire |
| N8 Contrats mainnet | Ali | — | | à faire |
| A1 Wallet Google | Ali | `fix/wallet-next` | | à faire |
| A2 Next.js | Ali | `fix/wallet-next` | | à faire |
| A3 Plafonds | Ali | `feat/mainnet-caps` | | à faire |
| A4 Connexion | Ali | `fix/auth-siwe` | | à faire |
| A5 Limiteur | Ali | `fix/auth-siwe` | | à faire |
| A6 Garde base / chaîne | Ali | `feat/mainnet-db-guard` | | à faire |
| A7 Reaper | Ali | `feat/mainnet-db-guard` | | à faire |
| A8 Préflight mainnet | Ali | `feat/mainnet-preflight` | | à faire |
| A9 Interface mainnet | Ali | `feat/mainnet-caps` | | à faire |
| A10 KYB sur invitation | Ali | `feat/kyb-invite` | | à faire |
| A11 Lancement | Ali | — | | à faire |

## Mesure de finalité mainnet

| Date et heure (UTC) | Bloc tête | Bloc `finalized` | Retard (min) |
|---|---|---|---|
| 2026-10-01 11:51 | 77 352 186 | 77 342 377 | 16,5 (bloc `safe` : 10,5) |

## Entrées

### 1er octobre 2026

- Plan de lancement établi et publié dans `docs/`.
- Le RPC public `mainnet.mezo.public.validationcloud.io` **n'est pas un nœud d'archive** : toute lecture d'état au bloc `finalized` échoue (« historical state is not available »). L'application et le préflight lisent l'état au bloc finalisé : un RPC d'archive mainnet (fournisseur payant) est obligatoire avant samedi, et doit être renseigné dans `EVM_RPC_URL` de Next, du reaper, du runner et du collecteur.
- Code hash du bytecode USDC mainnet relevé le 28 septembre : `0x487e3e7ba0f6ef76ccd39c373954f0edcdfe15c8817bdca4ef73f6df3963e694` (`SIRIUS_USDC_CODE_HASH` du préflight et du script de déploiement).
