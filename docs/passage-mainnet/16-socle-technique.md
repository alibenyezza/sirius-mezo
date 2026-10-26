# Socle technique partagé

Les briques dont plusieurs features ont besoin. À construire **en premier**, vendredi matin, avant les pages qui en dépendent.

Responsable proposé : **Ali**. Le schéma de la base et les migrations sont dans son couloir.

---

## 1. Table des utilisateurs — P0

Aujourd'hui, la base n'a pas de table des utilisateurs : un compte n'existe qu'à travers ses datasets, ses prêts et ses sessions. Les tutos, les réglages et le KYB ont besoin d'un endroit où mémoriser l'état d'un wallet.

**Nouveau modèle `UserProfile`**, une ligne par wallet :

| Champ | Usage |
|---|---|
| `address` | Clé, adresse du wallet en minuscules. La base refuse toute adresse qui n'est pas `0x` suivi de 40 hexadécimaux minuscules (contrainte `UserProfile_address_lowercase`) : passer par `normalizeAddress()` avant toute écriture, y compris depuis un script ou l'admin |
| `tourCompletedAt` | Tuto de première connexion terminé ([04](04-dashboard.md)) |
| `featureTours` | Colonne historique des anciens tutos par page, plus lue ni écrite : l'état « vu » des visites de page du guide est dans `settings.guide.pages` ([02](02-general.md)) |
| `settings` | Réglages ([13](13-reglages.md)) : langue, menu replié |
| `kybStatus`, `kybCheckedAt` | Cache d'affichage du KYB ([14](14-kyb.md)). La source de vérité reste le contrat |
| `blockedAt`, `blockedReason`, `blockedBy` | Blocage côté site ([15](15-dashboard-admin.md)), après le 6 |
| `createdAt`, `lastSeenAt` | Suivi d'activité |

- Créée à la première connexion réussie (`/api/auth/verify`), sans jamais faire échouer ni suspendre la connexion : une base qui répond par une erreur est rattrapée, une base qui ne répond pas est abandonnée après deux secondes, et seule la classe de l'erreur est journalisée.
- Migration **additive** uniquement : aucune colonne existante modifiée. Elle passe sur la base de staging puis sur la base neuve de production lundi.
- Les routes qui lisent ou écrivent ce profil vérifient la session : un wallet ne touche que son propre profil. `GET /api/profile` renvoie le profil du wallet connecté, le crée au besoin et date le passage (`lastSeenAt` avance à chaque lecture, pas seulement à la connexion) ; `PATCH /api/profile` n'accepte que `tourCompletedAt` (booléen : `true` pose la date côté serveur sans déplacer une date déjà posée, `false` l'efface pour relancer le tuto), et `settings` (`language` parmi `en`, `sidebarCollapsed` et `onboardingDismissed` booléens, `guide` pour la progression du guide Sirio, fusionnés clé par clé avec l'existant). L'ancien `featureTours` est ignoré sans erreur (onglet ouvert avant sa suppression) et n'est plus renvoyé. Toute autre clé est refusée en 400 : le KYB et le blocage ne sont jamais modifiables par cette route. Les deux routes sont limitées en débit par wallet (60 lectures et 20 modifications par minute) et par instance (1 000 lectures et 400 modifications par minute toutes sessions confondues, comme les autres routes du dépôt) : si le shell de l'application lit le profil à chaque page, ce plafond global est à relever avec le trafic. La réponse contient `blockedAt`, `kybStatus` et `kybCheckedAt`, mais jamais `blockedReason` ni `blockedBy` : si un motif doit être montré à l'utilisateur après le 6, il lui faudra un champ public distinct.

## 2. Nouveaux champs sur `Dataset` — P0

| Champ | Usage |
|---|---|
| `category` | Catégorie, liste fixe ([07](07-upload.md), [08](08-marketplace.md)). Texte libre en base, la liste est tenue par le code de l'upload |
| `listingExpiresAt` | Fin de la durée de publication ([01](01-decisions-avant-samedi.md)). Absent sur les datasets publiés avant ce champ |
| `trainingConsentAt`, `trainingConsentVersion`, `trainingConsentRevokedAt` | Consentement à l'amélioration des modèles ([07](07-upload.md)). La révocation pose `trainingConsentRevokedAt` sans effacer la date ni la version du consentement initial. **Omis par défaut** dans le client Prisma (`src/lib/db.ts`), comme `wrappedKey` : les routes publiques du catalogue projettent la ligne entière, et le consentement est une trace contractuelle du fournisseur, pas une donnée de marketplace. La fiche du fournisseur et l'admin les ré-incluent avec `omit: { trainingConsentAt: false, … }` |

**Pas de colonne `listingStatus`.** La pause d'un dataset ([06](06-mes-datasets.md)) réutilise l'enum `DatasetStatus` existant : mettre en pause fait passer `status` de `LISTED` à `UNLISTED`, remettre en ligne fait l'inverse. Une colonne séparée aurait créé deux sources de vérité pour la visibilité et obligé chaque lecteur du catalogue à croiser les deux.

Conséquences pour les pages qui s'appuient dessus :

- la marketplace n'affiche que `status = LISTED` **et** `listingExpiresAt` absent ou dans le futur ;
- la carte Mes datasets dérive l'état affiché : *En pause* = `UNLISTED`, *Expiré* = `LISTED` avec `listingExpiresAt` passé, *Détruit* = `DELETED` ;
- `UNLISTED` garde aujourd'hui son sens « semi-privé, empruntable par lien direct ». Un dataset en pause reste donc empruntable par quelqu'un qui en connaît l'identifiant. Si la pause doit aussi fermer l'emprunt direct, c'est au couloir des prêts de l'ajouter ; le socle ne tranche pas.

Les champs sont posés par la migration `20261003000000_add_user_profiles` (A1). Aucune route ne les écrit encore : l'upload ([07](07-upload.md)) et la fiche ([06](06-mes-datasets.md)) les remplissent dans leurs couloirs.

## 3. Journal des accès — P1

Pour le traçage déclaré ([06](06-mes-datasets.md)) : une table `DatasetAccessLog` avec le dataset (`datasetId`, clé étrangère), le wallet (`address`, minuscules, contrainte `DatasetAccessLog_address_lowercase` en base), le prêt (`loanId`, sans clé étrangère pour survivre à tout nettoyage), la date (`createdAt`), le modèle livré (`modelCid`) et son empreinte (`modelFingerprint`). Index sur `datasetId` et `address`. La clé étrangère est en `ON DELETE RESTRICT` : un dataset journalisé ne peut plus être supprimé physiquement, ce qui convient au modèle actuel où la suppression est le statut `DELETED` ; un futur script de purge devra détacher les journaux d'abord. Écrite au moment de la livraison de la clé du modèle par `recordDatasetAccess()` de `src/lib/users/profile.ts`, qui accepte une transaction pour s'inscrire dans celle de la livraison. La fonction existe et est testée ; son branchement sur la livraison reste à faire. Lecture réservée à l'admin : aucune route ne l'expose.

## 4. Textes d'avertissement communs — P0

Un seul fichier source, pour que le même texte apparaisse partout et se modifie en un endroit : `src/lib/copy/disclaimers.ts`.

| Clé | Texte | Où |
|---|---|---|
| `modelQuality` | « Sirius currently trains baseline models: linear and logistic regression on tabular data. Results depend on the data. New models are in development. » | Dashboard, upload, marketplace, train, tutos |
| `contactUs` | « Need a stronger model or specific data? Contact us at sirius.data.contact@gmail.com. » | Mêmes endroits |
| `betaLimits` | « Beta: invitation-only access, capped amounts per loan and in total. » | Dashboard, tuto, landing |
| `retrainDeterministic` | « Linear and logistic regression are deterministic: retraining on the same data gives the same model. » | Train |
| `dataLimits` | « CSV up to 3 MB, 100 to 20,000 rows, numeric columns, up to 31 input features. » | Upload, tuto |

Les limites citées viennent du code (`MAX_DATASET_BYTES`, `MAX_CSV_ROWS`, `MIN_TRAINING_ROWS`, `MAX_TRAINING_FEATURES`). Les textes lisent ces constantes plutôt que de les recopier, pour rester justes si elles changent.

Les textes passent par les fichiers de traduction existants : le test des traductions vérifie qu'aucun n'est oublié.

## 5. Direction artistique — P1

- Pas de maquette supplémentaire : on part du site actuel, fond noir, sphère blanche, typographie actuelle.
- Un jeu de composants communs, à créer une fois et à réutiliser partout :
  - **carte de dataset**, partagée par Mes datasets et la marketplace ;
  - **pastille d'état** ;
  - **encart d'avertissement** ;
  - **décomposition de prix**, partagée par l'upload et la fiche marketplace.
- Ces composants vivent dans `src/components/ui/` et `src/components/datasets/`, pour que les deux couloirs les utilisent sans se marcher dessus. Celui qui les crée en premier les publie, l'autre les réutilise.

## 6. Conditions d'utilisation — P0

Ajouts à `src/app/terms/page.tsx` avant le lancement :

- l'enregistrement des accès et des empreintes de modèles pour détecter les fuites ([06](06-mes-datasets.md)) ;
- le consentement facultatif à l'amélioration des modèles, révocable ([07](07-upload.md)) ;
- la possibilité de suspendre un compte en cas d'abus ([15](15-dashboard-admin.md)) ;
- le délai de sécurité de 3 jours et la règle de remboursement en cas d'échec ([01](01-decisions-avant-samedi.md)) ;
- le jeton MUSD.

## Terminé quand

- Migration additive appliquée sur staging, testée, prête pour la base de production.
- Fichier de textes communs utilisé par toutes les pages concernées.
- Composants partagés publiés avant que les pages datasets et marketplace ne les utilisent.
- Conditions d'utilisation mises à jour.
