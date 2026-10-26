# Publication d'un dataset (upload)

Fichiers : `src/app/(app)/datasets/new/page.tsx`, `src/lib/datasets/client.ts`, `src/app/api/datasets/**`, `src/lib/billing/quote.ts`, `src/lib/billing/config.ts`.

Priorité : **P0, avant le 6**. Responsable proposé : **Ali**.

## Ce qu'on a dit

- Adapter la direction artistique au reste du site.
- Période de remboursement : quelle utilité ? La transformer en temps d'activité sur la marketplace.
- Le prix : le fournisseur choisit combien il veut gagner, mais il faut afficher le minimum et le prix réellement payé par l'emprunteur.
- Upload en plusieurs parties : d'abord le fichier, le nom, la description et l'entraînement, avec une animation de chiffrement. Ensuite le prix, les frais et des estimations, puis l'envoi.
- Avertissement : modèles de bas niveau, nous contacter pour s'assurer de la qualité du modèle.
- Une case à cocher : accepter que Sirius améliore ses modèles et en développe de nouveaux grâce à ce dataset.

## Objectif

Publier un dataset en deux écrans clairs, en sachant exactement ce qu'on va gagner et ce que l'emprunteur va payer.

---

## Étape 1 — La donnée

- **Fichier** : glisser-déposer un CSV. Limites affichées avant le dépôt : 3 Mio, 20 000 lignes au plus, au moins 100 lignes, colonnes numériques, 31 variables explicatives au maximum.
- Contrôle immédiat dans le navigateur : nombre de lignes et de colonnes, colonnes numériques détectées. Un fichier refusé l'est avec la raison exacte.
- **Nom**, **description**.
- **Catégorie**, nouvelle, obligatoire, liste fixe pour les filtres de la marketplace ([08](08-marketplace.md)) : Finance, Santé, Commerce, Industrie, Mobilité, Énergie, Marketing, Autre.
- **Modèle d'entraînement** : régression linéaire ou logistique, avec la colonne cible.
- **Animation de chiffrement** au passage à l'étape 2 : le fichier se chiffre dans le navigateur, avant tout envoi. L'animation montre ce qui se passe réellement : « chiffré sur votre appareil, la donnée en clair ne quitte jamais votre navigateur ». Courte, deux à trois secondes, et elle ne masque pas une erreur.

## Étape 2 — Prix et publication

- **Ce que je veux gagner par emprunt**, en MUSD.
- Affichage calculé en direct à partir du tarif en vigueur :

  | Ligne | Exemple |
  |---|---|
  | Vous recevez | 20,00 MUSD |
  | Frais de calcul (enclave Phala) | 3,00 MUSD |
  | **Prix payé par l'emprunteur** | **23,00 MUSD** |

- Le minimum imposé par le tarif est affiché, et le champ refuse moins.
- Pas de commission supplémentaire pendant la bêta ([01](01-decisions-avant-samedi.md)).
- **Durée de publication** : 30 jours par défaut, 7, 30 ou 90 au choix, renouvelable depuis la fiche du dataset. Remplace le champ « période de remboursement ». Le délai de sécurité de l'escrow est fixé à 3 jours par Sirius et n'est plus demandé au fournisseur.
- **Estimations** : nombre de lignes et de colonnes, taille chiffrée, modèle choisi.
- **Avertissement**, avant le bouton de publication, texte commun de [16](16-socle-technique.md) :
  > « Sirius currently trains baseline models (linear and logistic regression). Results depend on your data. Need a stronger model or want to check model quality on your dataset? Contact us at sirius.data.contact@gmail.com. »
- **Case de consentement**, facultative et décochée par défaut :
  > « Allow Sirius to use this dataset, inside the enclave only, to evaluate and develop new models. You can withdraw this consent at any time for future use. »
  - Le choix est enregistré avec sa date et la version du texte.
  - La donnée n'est jamais déchiffrée hors de l'enclave, y compris pour cet usage.
  - Le retrait du consentement est possible depuis la fiche du dataset.
- **Publier** : chiffrement, envoi, scellement par l'enclave, inscription on-chain. Chaque étape affiche sa progression.

## Direction artistique

Les mêmes cartes, typographies et couleurs que la mosaïque ([06](06-mes-datasets.md)) et la marketplace. Indicateur d'étape « 1 / 2 » en haut.

## Base de données

Champs sur `Dataset` : catégorie, expiration de l'annonce, consentement avec date et version du texte. Détail dans [16](16-socle-technique.md).

## Terminé quand

- Un dataset se publie en deux étapes, avec contrôle du fichier, animation et décomposition du prix.
- Le champ « période de remboursement » a disparu. Le devis utilise 3 jours.
- Le consentement est enregistré et modifiable depuis la fiche.
- Un fichier invalide est refusé avant tout envoi, avec la raison.
