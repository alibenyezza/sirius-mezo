# Marketplace

Fichiers : `src/app/(app)/marketplace/page.tsx`, `src/app/(app)/borrow/page.tsx`, `src/components/loans/ComputeQuoteDialog.tsx`, `src/app/api/datasets/**`.

Priorité : **P0, avant le 6**. Responsable proposé : **Ali**.

## Ce qu'on a dit

- Cliquer sur chaque dataset pour avoir plus d'informations et de statistiques.
- La rendre plus lisible, comme Mes datasets.
- Des filtres comme Hugging Face.
- Emprunter = payer la donnée + un entraînement.
- Avertissement sur la qualité, et « contactez-nous pour toute demande de donnée précise ».

## Objectif

Trouver en quelques secondes un dataset adapté, comprendre exactement ce qu'on achète, et emprunter en confiance.

---

## Consultation sans connexion

La marketplace se consulte sans être connecté ([02](02-general.md)). La connexion est demandée au clic sur « Emprunter ».

## Grille

- Même mosaïque que Mes datasets ([06](06-mes-datasets.md)) : nom, catégorie, modèle, lignes, prix total payé par l'emprunteur, nombre d'emprunts, fournisseur vérifié ou non.
- Seuls les datasets *en ligne* apparaissent : ni en pause, ni expirés, ni détruits.

## Filtres et recherche

Barre de recherche sur le nom et la description, et filtres à gauche, façon Hugging Face :

| Filtre | Valeurs |
|---|---|
| Catégorie | Liste fixe de l'upload ([07](07-upload.md)) |
| Modèle | Régression linéaire, régression logistique |
| Prix total | Fourchette |
| Taille | Nombre de lignes, fourchette |
| Fournisseur | Vérifié KYB uniquement |
| Tri | Plus récents, plus empruntés, prix croissant |

Si le temps manque avant le 6, on livre d'abord la recherche, la catégorie et le modèle. Les fourchettes et le tri suivent dans la V1.1.

## Fiche d'un dataset

Un clic ouvre la fiche publique :

- description, catégorie, colonnes et leur type, nombre de lignes, taille ;
- modèle d'entraînement et ce qu'il produit ;
- statistiques publiques : nombre d'emprunts, date de publication, taux de réussite des entraînements ;
- fournisseur : adresse raccourcie, vérifié ou non ;
- lien vers la preuve publique `/proof/[id]` ;
- **ce que vous payez**, avec la même décomposition que l'upload : part du fournisseur, frais de calcul, total ;
- **ce que vous obtenez** : « un accès à cette donnée et un entraînement dans l'enclave. Vous recevez le modèle entraîné, jamais la donnée. Chaque nouvel entraînement est un nouvel emprunt » ([01](01-decisions-avant-samedi.md)) ;
- **ce qui se passe en cas d'échec** : seul le calcul réellement consommé est retenu, le reste est remboursé. Sans règlement après 3 jours, l'emprunteur récupère ses fonds ;
- bouton **Emprunter**.

## Avertissements

Encart sur la grille et sur chaque fiche, texte commun de [16](16-socle-technique.md) :

> « Models are baseline (linear and logistic regression) during the beta. Looking for specific data or a stronger model? Contact us at sirius.data.contact@gmail.com. »

## Terminé quand

- La grille, la recherche et au moins les filtres catégorie et modèle fonctionnent, sans connexion.
- Chaque dataset a sa fiche avec décomposition du prix, explication de l'offre et avertissement.
- L'emprunt depuis la fiche aboutit au flux existant.
