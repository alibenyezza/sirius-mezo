# Dashboard

Fichiers : `src/app/(app)/dashboard/page.tsx`, `src/components/layout/Sidebar.tsx`, `src/components/guide/GuideHost.tsx` (guide Sirio, qui remplace l'ancien `ProductTour.tsx`), `src/components/wallet/EscrowCredits.tsx`.

## Ce qu'on a dit

- Tuto de première connexion, accessible de nouveau quand on veut. Il faut une table des utilisateurs, qui servira aussi pour le KYB.
- Landing v2.
- Montrer l'état de mes datasets : à l'entraînement, entraîné, loué.
- Texte d'avertissement un peu partout.
- Dire que les modèles issus de l'entraînement sont basiques, qu'on peut nous contacter pour des modèles plus performants, et que de nouveaux modèles sont en développement.
- La section « Confiance EVM » est bizarre, à repenser.
- Liens vers les autres fonctions.
- Revoir le solde et ce qui est à retirer.
- Accéder aux détails de mes datasets et de mes entraînements.
- Inspiration : le dashboard de Phala pour le contenu et la quantité d'information, en beaucoup mieux.
- Pouvoir masquer le menu, avec une animation ni trop bizarre ni trop sobre.

---

## Avant le 6 — P0

### Tuto de première connexion

- S'ouvre à la première connexion d'un wallet, une seule fois.
- Relançable à tout moment : bouton « Visite guidée » dans le menu profil ([05](05-wallet.md)).
- Étapes proposées :
  1. **Bienvenue** : ce que fait Sirius en une phrase.
  2. **Emprunter** : trouver un dataset sur la marketplace, payer, lancer l'entraînement, recevoir le modèle.
  3. **Publier** : chiffrer et mettre en vente un dataset, être payé à chaque emprunt.
  4. **Wallet** : solde, ajout de fonds, retraits.
  5. **Limites de la bêta** : modèles de base (régression linéaire et logistique), données tabulaires, plafonds par prêt, accès sur invitation.
  6. **Besoin de plus ?** : « Vous voulez des modèles plus performants ou une donnée précise ? Écrivez-nous : sirius.data.contact@gmail.com. De nouveaux modèles sont en développement. »
- Progression stockée en base par wallet ([16](16-socle-technique.md)).

### Avertissement sur les modèles

Un encart permanent, discret, sur le dashboard, reprenant l'étape 5 et 6 du tuto. Texte commun défini dans [16](16-socle-technique.md).

### État de mes datasets — P1

Une carte « Mes datasets » qui compte : publiés, en cours d'emprunt, entraînés, revenus à retirer. Chaque chiffre mène à la page correspondante.

---

## Après le 6 — V1.1

### Dashboard v2

- **En haut** : solde, montant à retirer avec un bouton, réseau.
- **Activité** : mes datasets avec leur état, mes entraînements en cours et terminés, chacun cliquable vers sa fiche.
- **Raccourcis** : publier un dataset, explorer la marketplace, ouvrir l'Explorer.
- **Densité** : inspirée du dashboard Phala, avec plus d'information visible d'un coup d'œil, mais hiérarchisée et lisible.

### « Confiance EVM »

Aujourd'hui, la section affiche des éléments techniques peu parlants. Proposition : la remplacer par une carte « Preuves » avec trois lignes simples. Contrats vérifiés sur l'explorateur, enclave attestée avec un lien vers son certificat, dernier règlement on-chain. Les détails techniques restent sur `/status`.

### Menu masquable

- Le menu latéral se replie en icônes, avec une transition courte, autour de 200 ms.
- Le choix est mémorisé par compte, dans les réglages ([13](13-reglages.md)).
- Sur mobile, le menu devient un tiroir.

## Terminé quand

- Avant le 6 : un nouveau compte voit le tuto, peut le relancer, et voit l'avertissement sur les modèles.
- Après : le dashboard v2 remplace l'actuel, et chaque élément mène à sa fiche.
