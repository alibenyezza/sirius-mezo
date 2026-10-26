# Landing page

Fichiers : `src/app/page.tsx`, `src/components/3d/Blob.tsx`, `src/components/layout/SharedBlob.tsx`.

## Ce qu'on a dit

Ne pas en faire trop, ne pas surcharger la page.

- Refaire la page d'accueil : une vraie explication de ce que fait Sirius, dans la direction artistique du PBW, avec le bouton « accéder à l'app » au milieu et un défilement.
- Pousser la sphère : au début, elle est en bas de la page, avec une animation à réfléchir, en s'inspirant de warchest-app.vercel.app.
- Ajouter les conditions d'utilisation en bas, avec une animation sympa pour y accéder.

## Objectif

Un visiteur comprend en dix secondes ce que fait Sirius, pourquoi c'est sûr, et entre dans l'application en un clic.

## Avant le 6 — P1

- **Lien vers les conditions d'utilisation** en bas de la landing. La page `/terms` existe déjà, ainsi que le lien « État du protocole ».
- **Mention du réseau** dans le pied de page.
- **Avertissement court** sur la qualité des modèles en bêta, avec le contact.

## Après le 6 — V1.1

**Structure proposée, en défilement :**

1. **Accueil** : la sphère blanche en bas de l'écran, qui remonte au défilement. Une phrase : « Rent data. Never expose it. » Bouton « Launch app » centré.
2. **Comment ça marche**, en trois temps : le fournisseur chiffre et publie, l'emprunteur paie et lance l'entraînement dans l'enclave, chacun reçoit son dû et un certificat.
3. **Pourquoi c'est sûr** : chiffrement dans le navigateur, calcul dans une enclave attestée, règlement on-chain. Sans jargon.
4. **Pour qui** : fournisseurs de données, équipes IA.
5. **Bas de page** : conditions d'utilisation, état du protocole, X, contact.

**Animation de la sphère.** S'inspirer du mouvement de warchest-app.vercel.app : la sphère part du bas et suit le défilement. Garder les performances mobiles : la sphère est déjà allégée pour les téléphones, ne pas revenir en arrière. Respecter « réduire les animations » du système.

**Conditions d'utilisation.** Une transition douce vers `/terms`, sans effet qui gêne la lecture.

## Questions tranchées

- Texte de la landing : rédigé en anglais par Claude, validé par Ali et Ali.
- Direction artistique : celle du site actuel et du PBW, noir et sphère blanche, sans maquette supplémentaire.

## Terminé quand

- La landing tient sur mobile et ordinateur, sans saccade de la sphère sur un téléphone moyen.
- Le bouton d'entrée est visible sans défiler.
- Les conditions et l'état du protocole sont accessibles depuis le bas de page.
