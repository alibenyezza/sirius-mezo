# Décisions à prendre avant le déploiement mainnet

Les contrats mainnet sont déployés **lundi 5 octobre**. Ils sont immuables : toute décision qui touche ce qu'ils enregistrent doit être prise avant. Ce fichier liste les quatre décisions, l'option retenue et ce qu'elle implique dans le code.

Priorité : **P0**. Responsables : Ali et Ali.

---

## 1. Le jeton : MUSD

**Décision** : l'escrow mainnet est déployé avec **MUSD** (Mezo) au lieu de l'USDC natif.

**Ce que ça implique.** L'escrow n'accepte qu'un seul jeton, fixé dans son constructeur. Le code avait été préparé pour l'USDC natif `0x80e0…6ca8` : il impose maintenant le MUSD (slice A8, branche `feat/usdg`).

**Adresse confirmée le 4 octobre 2026** : `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` (en minuscules dans le code : `0x5fc5360d0400a0fd4f2af552add042d716f1d168`).

| Point | Résultat |
|---|---|
| Source officielle | Documentation Mezo, « MUSD on Main Networks », ligne Mezo (même adresse que dans « Mezo Token Contracts » de docs.mezo.com) |
| Lecture on-chain (RPC public `mainnet.mezo.public.validationcloud.io`, chaîne `0x1237` = 31612) | `name()` = « Mezo USD », `symbol()` = « MUSD », `decimals()` = **6**, `paused()` = false, `totalSupply()` ≈ 700 M MUSD |
| Forme du contrat | **Proxy ERC-1967** (170 octets, slot d'implémentation renseigné, slot d'admin vide : évolutif par l'implémentation, c'est-à-dire par Mezo) ; implémentation `0x68184c449e1a8f34fa18d289737129fd27b66f8f` ce jour-là |
| Code hash du proxy (`SIRIUS_USDC_CODE_HASH`) | `0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6` ; code hash de l'implémentation `0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf` |
| Décimales dans le code | `USDC_DECIMALS_BY_NETWORK.mainnet` reste à 6 : rien à changer, et `deploy.ts` revérifie on-chain avant d'envoyer |
| Frais de transfert, rebasage | Non observés dans les lectures (supply fixe entre deux appels, jeton réglementé à parité) ; **à confirmer à la main** sur l'explorateur (contrat vérifié, source Mezo, absence de `fee`/`rebase`) avant le déploiement, l'API de Blockscout étant derrière un défi anti-robot depuis la ligne de commande |
| Pouvoirs de Mezo | Pause globale et gel d'adresses par l'implémentation : un gel du Safe ou de l'escrow bloquerait règlements et remboursements. Risque accepté, documenté dans les runbooks |

**Vérifications d'origine, pour mémoire** :

1. Prendre l'adresse sur une source officielle : la page « contract addresses » de la documentation Mezo pour MUSD, ou la documentation de Mezo. Jamais une adresse trouvée sur un DEX ou un agrégateur : plusieurs jetons portent le même nom.
2. Vérifier sur l'explorateur `explorer.mezo.org` que le contrat est vérifié, nommé « Mezo USD », symbole MUSD, émis par Mezo.
3. Lire `decimals()` et le code hash avec l'exécution à blanc du script de déploiement (voir [17](17-audit-et-lancement-restants.md)). L'MUSD est annoncé à 18 décimales : à confirmer on-chain.
4. Vérifier qu'il n'a ni frais de transfert ni rebasage : l'escrow suppose qu'un `transferFrom` de N crédite exactement N.

**Fichiers adaptés** (slice A8) :

| Fichier | Changement |
|---|---|
| `src/lib/evm/stablecoin.ts` (nouveau) | Source unique : adresse MUSD, symbole, nom, décimales, `stablecoinSymbol(network)` |
| `scripts/deploy-policy.ts` | `MAINNET_STABLECOIN` = MUSD (alias `MAINNET_USDC` conservé) ; le code hash reste fourni par `SIRIUS_USDC_CODE_HASH` et contrôlé on-chain par `deploy.ts` |
| `scripts/initialize-runner-volume.ts` | Même constante pour la politique de facturation |
| `scripts/phala-v7-preflight.ts`, `scripts/operations/release-check.mjs` | Contrôle du jeton (MUSD uniquement) et de ses décimales |
| `src/lib/evm/networks.ts` | `USDC_DECIMALS_BY_NETWORK.mainnet` reste 6 (confirmé on-chain), commentaire mis à jour |
| Interface (`wallet`, `dashboard`, `/status`) | Libellé « MUSD » sur mainnet au lieu de « USDC » via `stablecoinSymbol` |
| `marketplace`, upload, train, explorer | **Non faits** : textes « USDC » dans les fichiers d'autres slices (N2, N3, N4, A7), à reprendre avec `stablecoinSymbol` |
| `src/app/api/onramp/route.ts` | Inchangé : Across livre bien de le MUSD sur Mezo (l'USDC envoyé depuis 13 chaînes arrive en MUSD ; le MUSD d'Ethereum passe directement). Le pont correspond donc enfin au jeton de l'escrow |
| `docs/MAINNET-RUNBOOKS.md` | Commande d'exécution à blanc avec l'adresse et le code hash MUSD, note sur le proxy évolutif |

Les variables d'environnement gardent leur nom historique `SIRIUS_USDC_ADDRESS` : renommer partout pour le lancement ajouterait du risque pour rien.

**Terminé quand** : l'exécution à blanc du déploiement passe avec l'adresse MUSD (à lancer par Ali ou Ali avec la clé de déploiement : voir la commande des [runbooks](../MAINNET-RUNBOOKS.md)), et les tests de `deploy-policy` couvrent le refus d'un autre jeton (fait : l'ancien USDC natif et tout autre jeton sont refusés sur mainnet, dans les quatre scripts).

---

## 2. Le ré-entraînement : un nouvel emprunt complet

**Décision** : chaque ré-entraînement est **un nouvel emprunt complet**. La donnée est payée à nouveau, plus le calcul.

**Pourquoi.** Le contrat v7 refuse un prêt dont le montant de la donnée vaut zéro (`ZeroAmount`). Faire payer seulement le calcul demanderait de modifier le contrat avant le déploiement, sans audit de cette modification : un risque disproportionné à deux jours du lancement.

**Ce que ça implique** :

- Aucun changement de contrat ni de moteur.
- L'interface présente clairement l'offre : « un emprunt = l'accès à la donnée + un entraînement ». Le bouton « ré-entraîner » ouvre un nouvel emprunt avec le prix complet affiché ([09](09-train-et-certificat.md)).
- Un ré-entraînement au prix du calcul seul reste une évolution possible, avec un futur contrat v8 ([02](02-general.md)).

---

## 3. La période de remboursement : fixée par Sirius, durée d'activité gérée par le site

**Aujourd'hui.** Le fournisseur choisit à l'upload une « période de remboursement » de 1 à 30 jours. C'est en réalité le **délai de sécurité de l'escrow** : si le prêt n'est pas réglé avant ce délai, l'emprunteur peut récupérer ses fonds. Il protège l'emprunteur, pas le fournisseur, et il n'a rien à voir avec la durée de mise en vente.

**Décision** :

- Le délai de sécurité est **fixé par Sirius à 3 jours** pour tous les datasets. Le fournisseur ne le choisit plus. Trois jours couvrent la finalité mainnet, environ 16 minutes, une panne de la machine Phala un week-end, et une intervention opérateur, sans bloquer longtemps l'argent de l'emprunteur en cas d'échec.
- On ajoute une **durée d'activité sur la marketplace**, choisie par le fournisseur : 30 jours par défaut, renouvelable. Elle est gérée par le site, dans la base, sans toucher au contrat.

**Ce que ça implique** :

- Contrat inchangé : `challengeDays` reste un paramètre du devis, valeur 3.
- Base de données : un champ d'expiration de l'annonce sur `Dataset` ([16](16-socle-technique.md)).
- Upload : le champ « période de remboursement » disparaît, remplacé par « durée de publication » ([07](07-upload.md)).
- Les datasets déjà publiés sur testnet gardent leur valeur actuelle.

---

## 4. Le prix : le fournisseur fixe son gain, pas de commission en plus pendant la bêta

**Décision** :

- Le fournisseur fixe **ce qu'il veut gagner** par emprunt.
- Le prix payé par l'emprunteur = son gain + les **frais de calcul** du tarif Sirius (le montant compute du devis, qui va au Safe).
- **Aucune commission supplémentaire** pendant la bêta. Les frais de calcul couvrent le coût Phala et une marge.
- À l'upload, on affiche les trois montants : ce que le fournisseur touche, les frais de calcul, le total payé par l'emprunteur. On affiche aussi le minimum imposé par le tarif.

**Ce que ça implique** : aucun changement de contrat. Le devis v7 sépare déjà `datasetAmount` et `computeAmount`. C'est un travail d'affichage ([07](07-upload.md), [08](08-marketplace.md)).

---

## Récapitulatif

| Décision | Choix | Touche le contrat ? |
|---|---|---|
| Jeton | MUSD | Oui : adresse au déploiement |
| Ré-entraînement | Nouvel emprunt complet | Non |
| Délai de sécurité | Fixé à 3 jours, durée d'activité côté site | Non |
| Prix | Gain du fournisseur + frais de calcul, sans commission | Non |
