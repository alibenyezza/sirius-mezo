# Wallet et profil

Fichiers : `src/app/(app)/wallet/page.tsx`, `src/components/wallet/*`, `src/components/layout/Sidebar.tsx`, `src/app/api/onramp/route.ts`, `src/lib/wallet/onramp.ts`.

## Ce qu'on a dit

- Retirer le bouton Wallet du menu latéral.
- Un bouton profil, en haut à droite ou en bas à gauche, avec : profil, accès au wallet, réglages et KYB, déconnexion.
- Solde, historique des transactions, lien vers l'explorateur, adresse.
- Un moyen d'ajouter des MUSD plutôt que des USDC : MoonPay ou transfert crypto.
- Une section de retrait générale.
- Un retrait par dataset plus explicite, et un bouton pour tout retirer d'un coup, peut-être avec gas sponsorisé.

---

## Avant le 6 — P1

### Bouton profil

- **Position** : en haut à droite. C'est l'emplacement standard des applications web3, et il reste visible quand le menu est replié.
- **Contenu du menu** :
  - adresse raccourcie, bouton copier, lien vers l'explorateur ;
  - badge réseau, « Mezo mainnet » ou « testnet » ([02](02-general.md)) ;
  - solde MUSD ;
  - Wallet, qui ouvre la page complète ;
  - Réglages et KYB ([13](13-reglages.md), [14](14-kyb.md)) ;
  - Visite guidée ([04](04-dashboard.md)) ;
  - Déconnexion.
- Le lien Wallet sort du menu latéral.

### Page Wallet, version de lancement

- Solde, adresse, lien explorateur, montants à retirer avec le bouton existant.
- **Ajout de fonds — livré le 4 octobre (PR #58, #59, #61).** Sur mainnet, « Add funds » ouvre une fenêtre à **deux choix** :
  - **Par carte** : MoonPay vend `musd_mezo` (et `btc_mezo` pour le gas) directement sur Mezo, minimum 5 USD, adresse du compte pré-remplie par le serveur (jamais par le navigateur). Le choix est **masqué** tant que les clés MoonPay live (`NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY` en `pk_live_`, `MOONPAY_SECRET_KEY`) ne sont pas dans Vercel production.
  - **Depuis un autre wallet** : QR code, adresse, bouton copier, avertissement « uniquement MUSD ou ETH, réseau Mezo ». Sorties confirmées : app Mezo (États-Unis hors New York) et Kraken.
  - Le pont (Relay) a été retiré de la fenêtre à la demande d'Ali ; le code serveur reste, désactivé (`bridge: false`).
- **Testnet** : le faucet de test est inchangé. Ni MoonPay ni le MUSD n'existent sur le testnet Mezo : tout se vérifie au passage mainnet ([18](18-a-tester-au-passage-mainnet.md)).
- Recherche du 4 octobre : Transak, Ramp et Squid ne gèrent pas Mezo ; Across et Relay livrent de le MUSD mais Across ne pré-remplit pas l'adresse ; un faux « MUSD » circule (`0x0A3B…954F`) : seule l'adresse `0x5fc5…d168` est valide.

---

## Après le 6 — V1.1

### Historique des transactions

- Liste des dépôts, emprunts, règlements, remboursements et retraits du wallet, chacun avec son lien explorateur.
- Source : les événements on-chain de l'escrow, déjà lus pour l'Explorer ([11](11-explorer.md)), et les transferts du jeton vers et depuis l'adresse.

### Retraits

- **Retrait général** : envoyer ses MUSD vers n'importe quelle adresse, avec vérification de l'adresse et confirmation.
- **Revenus par dataset** : pour chaque dataset, ce qui a été gagné et ce qui reste à retirer.
- **Tout retirer** : un bouton qui retire tous les crédits de l'escrow en une fois. Le relais de retrait sponsorisé existe déjà côté serveur (`withdraw-relayer`) : l'étendre plutôt que créer autre chose, avec un plafond de gas par jour.

### Ajout de fonds par carte

- Intégré (voir plus haut). Reste à obtenir un compte MoonPay entreprise et ses clés live ; MoonPay n'a pas de mode test pour le MUSD, le premier achat sera réel.
- V1.1 : adresse de dépôt Relay côté serveur (retrait depuis un exchange sans connecter de wallet), utile aux comptes Google.

## Terminé quand

- Avant le 6 : le bouton profil remplace le lien Wallet du menu et affiche le réseau. La page Wallet indique comment ajouter des MUSD.
- Après : historique complet, retrait général, revenus par dataset et retrait groupé.
