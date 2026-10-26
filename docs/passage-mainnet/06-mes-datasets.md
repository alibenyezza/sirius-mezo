# Mes datasets

Fichiers : `src/app/(app)/datasets/page.tsx`, `src/app/(app)/provider/page.tsx`, `src/app/api/datasets/**`, `src/lib/sirius/provider.ts`, `src/lib/sirius/metrics.ts`, `prisma/schema.prisma`.

Priorité : **P0, avant le 6**. Responsable proposé : **Ali**, avec l'upload ([07](07-upload.md)) et la marketplace ([08](08-marketplace.md)).

## Ce qu'on a dit

- Rendre la page plus lisible : police, affichage en mosaïque avec une tuile « + » pour ajouter, état de chaque dataset. Pratique et beau, en s'inspirant de Hugging Face.
- Nombre d'emprunts par dataset.
- Pouvoir cliquer sur un dataset, modifier certains réglages, voir des statistiques.
- De notre côté, tracer et relier les accès, pour nos tests de fuite.

## Objectif

Un fournisseur voit d'un coup d'œil tous ses datasets, leur état et ce qu'ils lui rapportent, et gère chacun depuis sa fiche.

---

## À faire

### Mosaïque

- Une grille de cartes, trois ou quatre colonnes sur ordinateur, une sur mobile.
- La première tuile est « + Publier un dataset » et ouvre l'upload.
- Chaque carte affiche : nom, modèle d'entraînement, taille et nombre de lignes, prix, **état**, **nombre d'emprunts**, revenus totaux.
- **États**, avec une pastille de couleur :
  - *En ligne* : publié, empruntable ;
  - *Emprunté* : au moins un emprunt en cours ;
  - *En pause* : retiré temporairement de la marketplace ;
  - *Expiré* : durée de publication dépassée ([01](01-decisions-avant-samedi.md)) ;
  - *Détruit* : clé détruite, irrécupérable.
- Tri par date, revenus ou nombre d'emprunts.

### Fiche d'un dataset

Un clic sur une carte ouvre `/datasets/[id]`.

- **Description** : nom, description, modèle, colonnes, taille, date de publication, lien vers la preuve publique `/proof/[id]` qui existe déjà.
- **Statistiques** :
  - nombre d'emprunts, total et par semaine ;
  - revenus gagnés, retirés, à retirer ;
  - dernier emprunt ;
  - entraînements réussis et échoués.
- **Réglages modifiables** :
  - nom et description ;
  - mise en pause et remise en ligne ;
  - prolongation de la durée de publication ;
  - destruction définitive, avec double confirmation (fonction existante).
- **Non modifiable : le prix.** Il est inscrit dans le reçu signé par l'enclave au moment du scellement. Le changer imposerait de re-sceller le dataset. Pour le lancement, un fournisseur qui veut changer de prix détruit et republie. Une modification de prix propre viendra après le lancement.

### Traçage pour les tests de fuite

**Avis retenu : on trace, et on le dit.** Un traçage caché sur des données d'utilisateurs pose un problème au regard du RGPD. Le déclarer ne retire rien à son utilité.

- **Ce qu'on enregistre** : pour chaque accès à un dataset, le wallet, le prêt, la date, le modèle livré et son empreinte. La plupart de ces informations sont déjà en base ou on-chain.
- **Ce qu'on relie** : quel modèle a été livré à quel wallet, pour retrouver l'origine d'un modèle qui circulerait.
- **Ce qu'on écrit dans les conditions d'utilisation** : « Sirius enregistre les accès aux datasets et l'empreinte de chaque modèle livré afin de détecter et d'investiguer les fuites. »
- La consultation de ce journal est réservée au dashboard admin ([15](15-dashboard-admin.md)).

### Base de données

Sur `Dataset` : statut de publication (en ligne, en pause), date d'expiration de l'annonce, catégorie ([07](07-upload.md)), consentement à l'amélioration des modèles ([07](07-upload.md)). Détail dans [16](16-socle-technique.md).

## Terminé quand

- La mosaïque remplace la liste actuelle, avec la tuile d'ajout.
- Chaque carte ouvre sa fiche avec statistiques et réglages.
- Pause, reprise et prolongation fonctionnent et se reflètent sur la marketplace.
- Le traçage est en place et mentionné dans les conditions d'utilisation.
