# Général

Sujets transverses issus de la réunion du 2 octobre.

## Ce qu'on a dit

- Un tuto par feature au premier passage, qui explique les limites, et qu'on peut revoir.
- Vérifier si plusieurs personnes peuvent louer le même dataset en même temps, et comment les escrows le gèrent.
- Améliorer la connexion, en lien avec le KYB. Question ouverte : à quoi sert vraiment la connexion ?
- Réfléchir à stocker un modèle déjà entraîné pour le revendre au même prix.
- Afficher le réseau : Mezo mainnet.

---

## 1. Tutos par feature — P0, avant le 6

Voir [04-dashboard.md](04-dashboard.md) pour le tuto de première connexion et [16-socle-technique.md](16-socle-technique.md) pour la table des utilisateurs qui mémorise leur progression.

**À faire**

- Chaque page principale (Dashboard, Mes datasets, Upload, Marketplace, Train, Explorer, Wallet) affiche un court tuto à la première visite : à quoi sert la page, ce qu'on peut y faire, ses limites.
- Un bouton « ? » discret sur chaque page relance son tuto.
- Le tuto de chaque page rappelle les limites des modèles et le contact `sirius.data.contact@gmail.com` quand c'est pertinent (upload, marketplace, train).
- Textes en anglais, rédigés par Claude, validés par Ali et Ali.
- Livré par les visites de page du guide Sirio (`src/lib/guide/pages.ts`, `src/components/guide/GuideHost.tsx`), qui remplacent l'ancien `ProductTour.tsx` et `src/components/tour/` (supprimés). L'état « vu » de chaque page est stocké en base par compte, dans `settings.guide.pages` du profil, pour suivre l'utilisateur d'un appareil à l'autre.

**Terminé quand** : chaque page a son tuto, relançable, et la progression survit à un changement de navigateur.

---

## 2. Emprunts simultanés d'un même dataset — P0, à tester vendredi

**Ce que dit le code**

- Chaque emprunt a sa propre entrée dans l'escrow, identifiée par l'emprunteur et l'identifiant du prêt. Deux personnes peuvent donc emprunter le même dataset en même temps : leurs fonds et leurs règlements sont séparés.
- Le moteur Phala n'entraîne qu'**un modèle à la fois**. Les entraînements simultanés sont mis en file d'attente.
- Le moteur n'envoie qu'**une transaction de règlement à la fois**. Sur mainnet, chacune attend la finalité, environ 16 minutes. Environ quatre règlements par heure, ce qui suffit pour une bêta restreinte.

**À faire**

- Inclure le scénario dans le test complet de vendredi ([17](17-audit-et-lancement-restants.md)) : deux comptes empruntent le même dataset à quelques secondes d'écart, les deux reçoivent leur modèle, le fournisseur est payé deux fois.
- Afficher un message d'attente clair quand un entraînement est en file.

---

## 3. La connexion — à quoi elle sert

**Ce qu'elle fait aujourd'hui.** La connexion prouve qu'on contrôle un wallet, par une signature. Elle ouvre une session de 24 heures et une délégation qui autorise le moteur à agir pour ce wallet : publier, emprunter, recevoir une clé de modèle.

**Avis.**

- Garder la connexion pour toutes les actions privées : upload, mes datasets, emprunt, récupération d'un modèle, retraits.
- **Permettre de parcourir la marketplace et la landing sans connexion.** Demander la connexion seulement au moment d'agir. Un visiteur doit voir ce qu'il peut louer avant de signer quoi que ce soit.
- **Améliorer après le lancement** avec la connexion standard anti-phishing (SIWE), reportée par l'audit ([17](17-audit-et-lancement-restants.md)).
- Le lien avec le KYB est traité dans [14-kyb.md](14-kyb.md).

**Avant le 6** : marketplace consultable sans connexion, si elle ne l'est pas déjà, et message clair au moment où la connexion devient nécessaire.

---

## 4. Revendre un modèle déjà entraîné — après le lancement

**L'idée.** Quand un modèle a déjà été entraîné sur un dataset, le revendre tel quel à un nouvel emprunteur, sans refaire le calcul, au même prix.

**Avis.** Intéressant, mais pas pour le lancement :

- Juridique : le fournisseur doit avoir accepté que le modèle issu de sa donnée soit revendu, et le premier emprunteur ne doit pas avoir payé une exclusivité.
- Technique : le modèle est chiffré pour son premier emprunteur. Le revendre suppose un nouveau mode de livraison et sans doute un nouveau contrat, puisque l'escrow actuel règle un entraînement.
- Économique : partage des revenus entre fournisseur et Sirius à définir.

Priorité : **après la V1.2**.

---

## 5. Afficher le réseau — P0, avant le 6

- Un badge « Mezo » visible en permanence, dans le bouton profil ([05](05-wallet.md)) : « mainnet » en production, « testnet » sur staging, avec une couleur différente.
- Les liens d'explorateur pointent vers le bon explorateur selon le réseau.
- La page `/status` affiche déjà le réseau : la garder cohérente.
