# Points de contrôle pour l'audit

Chaque slice du passage au mainnet remplit **sa propre section**, déjà réservée ci-dessous. Une slice ne touche jamais la section d'une autre : les fusions restent ainsi sans conflit.

L'audit interne final vérifie chacun de ces points **en plus** de l'audit général du code. Une section restée « À remplir » est elle-même un point à signaler.

Références : [plan global](00-PLAN-GLOBAL.md), [audit du 1er octobre](../AUDIT-2026-10-01.md), [runbooks](../MAINNET-RUNBOOKS.md).

## Points transverses

### Ajoutés par Ali et Ali
_Points supplémentaires à prendre en compte pendant l'audit interne._

### Rappels du premier audit
- Connexion anti-phishing (SIWE) reportée après le lancement : vérifier que les sessions restent limitées à 24 heures et que la délégation runner aussi.
- Une seule transaction runner en vol à la fois : vérifier qu'aucune slice n'introduit d'envoi de transaction hors du registre de budget.
- Aucun contrôle d'accès ne doit reposer sur le masquage d'un lien dans l'interface.
- Aucune signature d'assistant dans les commits, les PR et les fichiers.

---

## A1 — Socle base de données

> Mise à jour (octobre 2026) : `featureTours` n'est plus lu, écrit ni renvoyé par `/api/profile` ; la colonne reste en base. Un PATCH qui l'envoie encore est ignoré sans erreur. Les vérifications ci-dessous qui le citent décrivent l'état d'origine.

Branche `feat/socle-profils`, PR vers `staging`, six commits (`27d3f35` implémentation ; `aa9bb6c`, `e9ed707`, `3dbd044`, `f515d25` et `eb1b09d` correctifs issus des trois passages de revue interne). Tout ce qui suit est vérifiable depuis `git diff staging...HEAD` (15 fichiers plus cette section).

### 1. Ce qui a changé

**Base de données**

| Objet | Détail |
|---|---|
| `prisma/schema.prisma` | Nouveau modèle `UserProfile` ; nouveau modèle `DatasetAccessLog` ; cinq colonnes ajoutées à `Dataset` (`category`, `listingExpiresAt`, `trainingConsentAt`, `trainingConsentVersion`, `trainingConsentRevokedAt`) et la relation `accessLogs`. Aucun modèle, enum, colonne ou index existant modifié. |
| `prisma/migrations/20261003000000_add_user_profiles/migration.sql` | Migration additive écrite à la main dans le style des migrations générées : cinq `ALTER TABLE "Dataset" ADD COLUMN` (toutes nullables, sans défaut) ; `CREATE TABLE "DatasetAccessLog"` avec clé primaire, clé étrangère vers `Dataset` (`ON DELETE RESTRICT ON UPDATE CASCADE`, nommée `DatasetAccessLog_datasetId_fkey` comme Prisma le ferait) et contrainte `CHECK ("address" ~ '^0x[0-9a-f]{40}$')` ; deux `CREATE INDEX` (`datasetId`, `address`) ; `CREATE TABLE "UserProfile"` avec `address` en clé primaire et le même `CHECK`, `featureTours` et `settings` en `JSONB NOT NULL DEFAULT '{}'`, `createdAt` et `lastSeenAt` en `TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`. Aucun `DROP`, aucun `ALTER` de colonne existante, aucune contrainte posée sur une table existante. Prisma ignore les `CHECK` : `migrate diff` entre base migrée et schéma reste vide. |

Colonnes de `UserProfile` : `address` (clé, minuscules, vérifiées par la base), `tourCompletedAt`, `featureTours`, `settings`, `kybStatus`, `kybCheckedAt`, `blockedAt`, `blockedReason`, `blockedBy`, `createdAt`, `lastSeenAt`.
Colonnes de `DatasetAccessLog` : `id` (cuid), `datasetId` (clé étrangère), `loanId` (texte, sans clé étrangère), `address` (minuscules, vérifiées), `modelCid`, `modelFingerprint`, `createdAt`.

**Code serveur**

| Fichier | Rôle |
|---|---|
| `src/lib/users/profile.ts` (nouveau) | `ensureUserProfile` (upsert sans transaction propre, `createdAt` et `lastSeenAt` de la même horloge, reprise unique sur P2002 en ceinture), `ensureUserProfileWithin` (le même upsert dans une transaction courte sous `lock_timeout` et `statement_timeout`, utilisé par GET), `readUserProfile` (lecture sans création), `updateUserProfile` (validation stricte puis délais PostgreSQL, fusion clé par clé en transaction sérialisable, création par upsert si le profil manque, 409 quand les reprises sont épuisées), `validateProfilePatch`, `sanitizeFeatureTours`, `sanitizeSettings`, `toUserProfileView`, `normalizeProfileAddress`, `touchUserProfileAfterLogin` (ne lève jamais : délai de garde de 2 s, délais PostgreSQL du même ordre, au plus deux mises à jour en vol par instance, classe d'erreur seule en journal), `recordDatasetAccess` (journal des accès, accepte une transaction, P2003 converti en 404), constantes `FEATURE_TOUR_KEYS`, `PROFILE_LANGUAGES`, `MAX_PROFILE_PATCH_CHARS`, `PROFILE_DB_TIMEOUT_MS`, `LOGIN_PROFILE_TIMEOUT_MS`, `MAX_IN_FLIGHT_LOGIN_TOUCHES`. |
| `src/app/api/profile/route.ts` (nouveau) | `GET` : profil du wallet de la session, créé au besoin, `lastSeenAt` daté. `PATCH` : modification validée. Les deux passent par `requireAuth` et `errorResponse`, un `FixedWindowRateLimiter` chacun (60 lectures, 20 modifications par minute et par wallet), `cache-control: private, no-store`. |
| `src/app/api/auth/verify/route.ts` | Après `verifyChallenge`, appel de `touchUserProfileAfterLogin(verifiedAddress)` avant la pose du cookie. Quatre lignes ajoutées, rien d'autre ne change. |
| `src/lib/db.ts` | `omit` global étendu de `wrappedKey` aux trois colonnes de consentement de `Dataset` : elles ne sortent plus par défaut d'aucune lecture Prisma, donc jamais sur le catalogue public dont `datasetResponse()` projette la ligne entière. Les lectures qui en ont besoin les ré-incluent avec `omit: { trainingConsentAt: false, … }`. |
| `src/lib/i18n/errors-en.ts` | Quatorze traductions pour les nouveaux messages `AppError`, dont les deux messages d'adresse construits par gabarit dans `normalizeAddress`. |
| `scripts/operations/db-inventory.mjs` | L'outil du runbook de migration lit désormais les `CREATE TABLE` : tables, colonnes et clé primaire annoncées ; écarts `table-not-added`, `column-not-added` (tables neuves) et `index-not-added` en critique ; une table annoncée n'est plus un `table-unexpected`. |
| `package.json` | `src/lib/users/profile.test.ts` ajouté au script `test`. |

**Tests et documentation**

| Fichier | Rôle |
|---|---|
| `src/lib/users/profile.test.ts` (nouveau) | Seize tests `node:test` : normalisation, validation, fusion, vue, journal des accès, hook de connexion (panne, base gelée, plafond en vol, délais PostgreSQL), délais sur GET et PATCH sans imbrication de transaction, 409 sous contention, et les deux routes chargées dans un contexte VM avec leurs dépendances simulées (motif de `audit-regressions.test.ts`). |
| `src/lib/db.test.ts` | Un test ajouté : garde de source sur l'`omit` global (`wrappedKey` et les trois colonnes de consentement). |
| `src/lib/postgres.integration.test.ts` | Après le rejeu de toutes les migrations : une adresse en casse mixte est refusée par `UserProfile_address_lowercase` et `DatasetAccessLog_address_lowercase`, la forme minuscule passe, les JSON par défaut sont `{}`. |
| `scripts/operations/db-inventory.test.ts` | Attentes de la migration A1 (tables, colonnes, index), comparaison avec et sans attentes, table, colonne ou index annoncés mais absents. |
| `docs/passage-mainnet/16-socle-technique.md` | Section 1 : comportement exact des routes et du hook de connexion. Section 2 : suppression de `listingStatus`, pause via `UNLISTED`, règles d'affichage dérivées, consentement omis par défaut. Section 3 : colonnes réelles du journal, `RESTRICT`, état du branchement. |
| `docs/MIGRATION-RUNBOOK.md` | Description de `ops:db-inventory expect` étendue aux tables ; paragraphe sur les écarts attendus pour une migration qui crée des tables, la limite connue de l'outil, et le fait que `prisma migrate deploy` n'applique pas un fichier en une transaction (procédure en cas d'échec). |

**Non touché** : `src/app/(app)/**`, `src/components/**`, `contracts/**`, `src/runner/**`, `src/lib/runner/**`, aucun composant, aucune page, aucun contrat. Vérifié par `git diff --name-only staging...HEAD` (section 9).

### 2. Décisions et écarts par rapport au cahier des charges

- **Pas de `listingStatus`** (demandé explicitement). La pause d'un dataset = `status` de `LISTED` à `UNLISTED`. Conséquence documentée dans 16 § 2 : `UNLISTED` signifie aujourd'hui « semi-privé, empruntable par lien direct », donc un dataset en pause reste empruntable par qui connaît son identifiant. Le socle ne tranche pas ; c'est au couloir des prêts ou de la marketplace de fermer l'emprunt direct si la pause doit l'interdire.
- **`listingExpiresAt` absent = sans expiration** pour les datasets publiés avant ce champ. La migration ne remplit pas la colonne : le cahier des charges impose une migration purement additive, et une date arbitraire aurait fait expirer des annonces existantes.
- **Contraintes `CHECK` sur les adresses** des deux tables créées (ajout du second tour de revue). Le cahier des charges limite la migration à `CREATE TABLE`, `ADD COLUMN` et `CREATE INDEX` : une contrainte déclarée dans le `CREATE TABLE` d'une table nouvelle reste dans cette lettre (comme la clé primaire et la clé étrangère), ne touche aucune table existante, et ferme un vrai trou : sans elle, une écriture manuelle en casse EIP-55 (script, correction en `psql`, futur outil de blocage) créait un second profil que l'application, qui lit toujours en minuscules, ne voyait jamais. Prisma ignore les `CHECK` et les préserve.
- **`tourCompletedAt` en booléen côté API** sous le même nom que la colonne : `true` pose la date serveur si elle n'existe pas encore (renvoyer `true` deux fois ne déplace pas la date), `false` l'efface pour permettre de relancer le tuto depuis Réglages. Le cahier des charges ne précisait pas le cas `false` ; l'alternative (ignorer `false`) aurait empêché la fonction « relancer le tuto » de 13-reglages.md de se persister. Documenté dans 16 § 1 pour qu'un client n'envoie pas `false` par défaut.
- **Fusion clé par clé** de `featureTours` et `settings` plutôt que remplacement : une page qui marque son tuto n'efface pas celui des autres. Réalisée dans `serializableTransaction` (lecture puis écriture, reprise automatique ×3 sur conflit) : deux PATCH simultanés sur des clés différentes conservent les deux. Vérifié de bout en bout sur PostgreSQL (section 9).
- **Clé inconnue refusée (400), pas ignorée** : un client qui envoie `kybStatus`, `blockedAt`, `address` ou `__proto__` reçoit « Champ de profil non modifiable ». Même règle à l'intérieur de `featureTours` et `settings`. Choix volontaire pour qu'une tentative d'écriture d'un champ protégé soit visible, pas silencieuse.
- **Modification vide refusée** (« Aucune modification de profil », 400) plutôt qu'acceptée comme no-op.
- **Bornes** : `MAX_PROFILE_PATCH_CHARS = 2048` caractères JSON (413 au-delà), corps HTTP limité à 4096 octets par `readJson` (413 « Requête trop volumineuse » avant lecture complète). La plus grande modification légitime (toutes les clés) fait environ 160 caractères.
- **Vue renvoyée** : `blockedAt` est exposé (l'utilisateur doit pouvoir savoir qu'il est bloqué), `blockedReason` et `blockedBy` ne le sont pas (notes internes et adresse de l'admin). Si un motif doit être montré après le 6, il faudra un champ public distinct plutôt que rouvrir `blockedReason`. `kybStatus` et `kybCheckedAt` sont exposés (cache d'affichage, c'est leur raison d'être). Les dates sont des chaînes ISO 8601.
- **Lecture défensive** : `featureTours` et `settings` sont re-filtrés à la lecture (clés connues, valeurs bien typées). Une ligne JSONB altérée à la main ne remonte jamais de clé inconnue et n'empêche pas la fusion ; le PATCH suivant la réécrit proprement.
- **`GET` crée le profil** (`ensureUserProfileWithin`) et date `lastSeenAt` à chaque lecture : une session ouverte avant la migration obtient son profil au premier GET. `PATCH` crée aussi le profil s'il manque. `readUserProfile` (lecture pure) est exporté pour les usages serveur qui ne doivent pas créer de ligne, mais aucune route ne l'utilise encore.
- **Limite de débit sur GET aussi** (60/min/wallet, 1000/min global), en plus du PATCH demandé (20/min/wallet, 400/min global) : GET écrit `lastSeenAt`, donc coûte une écriture. Clé `subject:<adresse de session>` comme dans `settle/route.ts`. Le limiteur précède la validation (un corps invalide reçoit 429 une fois le quota atteint).
- **Reprise unique sur P2002** dans `ensureUserProfile` : sur PostgreSQL, Prisma compile cet upsert en `INSERT … ON CONFLICT DO UPDATE`, atomique, donc la reprise n'est jamais exercée (vérifié au journal des requêtes et avec vingt premières connexions simultanées : une ligne, aucune erreur). Conservée comme ceinture, documentée comme telle, jamais en boucle.
- **Délais PostgreSQL sur GET et PATCH** (troisième passage) : l'upsert de GET et la transaction de PATCH commencent par `SET LOCAL lock_timeout` et `statement_timeout` à 5 s (`PROFILE_DB_TIMEOUT_MS`). Sans cela, une ligne de profil verrouillée par une autre session (futur chemin admin sur la même ligne, opération manuelle, transaction oubliée) suspendait chaque GET du wallet sans borne et cinq GET retenaient tout le pool de l'instance. Vérifié sous verrou réel : GET et PATCH échouent en 5 s (erreur 57014, 500 opaque pour le client, qui réessaie) et le pool reste libre. Piège rencontré et couvert par un test : le client de transaction Prisma expose encore `$transaction` à l'exécution, donc `ensureUserProfile` n'ouvre jamais de transaction lui-même (une imbrication épuisait le pool) ; seule `ensureUserProfileWithin`, appelée avec le client racine, en ouvre une.
- **409 sous contention** : quand les trois reprises de `serializableTransaction` sont épuisées (P2034), `updateUserProfile` répond 409 « Profil modifié en même temps, réessaie » plutôt qu'un 500 opaque. Mesures des relecteurs : aucun rejet avec deux à quatre écrivains simultanés, un rejet occasionnel à sept, treize à quinze sur quarante écrivains simultanés sur la même ligne avec un pool de cinq. Aucune écriture perdue dans tous les cas. La fusion atomique en SQL (`jsonb ||` dans l'`ON CONFLICT`) supprimerait cette classe de conflits : notée en reste à faire, pas entreprise si près du gel.
- **Hook de connexion en trois gardes** : `touchUserProfileAfterLogin` est `await`é (en serverless, une promesse non attendue peut être tuée) mais ne lève jamais. (1) Une base qui répond par une erreur : rattrapée, journal `[auth] profil utilisateur non mis à jour (<classe>)` sans adresse ni cause. (2) Une base qui ne répond pas : `Promise.race` avec un délai de 2 s, et l'upsert lui-même tourne dans une transaction courte sous `SET LOCAL lock_timeout` et `statement_timeout` égaux à ce délai, pour que PostgreSQL annule la requête et rende la connexion au pool au lieu de la garder. (3) Au plus deux mises à jour en vol par instance ; au-delà, la mise à jour est sautée (`ProfileSkipped`) : cinq connexions simultanées ne peuvent plus saturer le pool de cinq connexions depuis cette route. Les valeurs passées à `SET LOCAL` sont un entier calculé par le code, jamais une entrée.
- **`DatasetAccessLog.loanId` sans clé étrangère** (le cahier des charges demande `loanId String?` sans relation) : le journal doit survivre à tout nettoyage de prêts. `datasetId` a une clé étrangère `RESTRICT` : un dataset ne peut pas être supprimé physiquement tant qu'il a des accès journalisés, ce qui correspond au modèle actuel où `DELETED` est un statut et non une suppression de ligne ; les seuls `delete` physiques du dépôt (`pipeline.ts`) visent des brouillons `DRAFT` sans contenu, jamais journalisés. Un futur script de purge devra détacher les journaux d'abord (16 § 3).
- **Bornes du journal** : `datasetId` et `loanId` ≤ 64 caractères, `modelCid` ≤ 256, `modelFingerprint` ≤ 128, tous sur l'alphabet `[A-Za-z0-9:_.-]` (cuid, CID IPFS, hexadécimal, préfixes `sha256:`). Le format exact de l'empreinte n'est pas imposé : il sera fixé par le couloir qui branche la livraison. Un `datasetId` inconnu est refusé en 404 « Dataset introuvable » (clé étrangère).
- **`recordDatasetAccess` n'est branché nulle part** (demandé : « testée, pas encore branchée »). Il accepte un client de transaction pour s'inscrire plus tard dans la transaction de livraison du modèle.
- **Consentement omis par défaut** (`src/lib/db.ts`, correctif du premier tour) : la slice crée les colonnes, et `datasetResponse()` projette la ligne `Dataset` entière vers `GET /api/datasets` (anonyme) et `GET /api/datasets/[id]` (public pour `LISTED`/`UNLISTED`). Sans cet `omit`, la date, la version et la révocation du consentement du fournisseur auraient été visibles de tout visiteur dès que l'upload les remplira. Le vote des contradicteurs l'avait jugé non bloquant tant qu'aucune route n'écrit ces colonnes ; corrigé quand même parce que le coût est de quatre lignes et que le motif `wrappedKey` existe déjà. Conséquence pour les couloirs N1 et N2 : la fiche du fournisseur lit ces colonnes avec `omit: { trainingConsentAt: false, trainingConsentVersion: false, trainingConsentRevokedAt: false }` (documenté dans 16 § 2) ; l'écriture n'est pas affectée.
- **Outil d'inventaire du runbook étendu** (`scripts/operations/db-inventory.mjs`, correctifs des deux tours) : sans cela, l'étape 6 du runbook sur cette migration aurait signalé quatre écarts « warning » (`UserProfile`, `DatasetAccessLog` et leurs `_pkey`) et rendu le code de sortie 1. Limitation préexistante (déjà vraie pour `OperatorCodeAttempt`), corrigée ici parce que cette migration est la première que le runbook de production devra passer avec des tables neuves. Fichier hors de la liste initiale de la slice, mais dans le couloir « schéma et migrations » ; le relecteur conformité a jugé le périmètre légitime.
- **Tests de route dans `profile.test.ts`** en plus de la validation demandée : les deux routes sont chargées par `ts.transpileModule` + `runInNewContext` avec `requireAuth`, `@/lib/db` et le module profil simulés, ce qui prouve que l'adresse vient de la session et que le vrai code de validation est exercé par la route.
- **Aucune interface** : pas de composant, pas de page, pas d'appel client. Les couloirs tutos et réglages consomment `GET`/`PATCH /api/profile`.

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès, route par route**

- `GET /api/profile` : `requireAuth(req)` (`src/lib/auth/require-auth.ts`) lit le cookie de session signé HMAC ; sans session → 401 avant toute lecture de base. L'adresse est `session.address`, jamais un paramètre. `assertMutationOrigin` ne contrôle pas l'origine sur GET (comme pour toutes les routes GET du dépôt), le cookie `sameSite: lax` protège la lecture croisée.
- `PATCH /api/profile` : `requireAuth` applique `assertMutationOrigin` (en-tête `Origin` égal à `SIRIUS_APP_ORIGIN`, `Sec-Fetch-Site` same-origin ou none) puis la session. L'adresse vient de la session ; un champ `address` dans le corps est refusé en 400 par la validation (clé inconnue). Vérifié par test et par requêtes forgées contre la vraie route (section 10) : le profil de l'autre wallet reste intact.
- `POST /api/auth/verify` : inchangé en termes de contrôle ; le profil est touché **après** `verifyLoginSignature` et `verifyChallenge`, avec l'adresse vérifiée. Une signature invalide ou un challenge refusé ne crée aucun profil (testé).
- Aucune route ne lit ni n'écrit `DatasetAccessLog` : aucune exposition.
- Aucune route ne modifie `kybStatus`, `kybCheckedAt`, `blockedAt`, `blockedReason`, `blockedBy`. Ils ne sont écrits par aucun code de cette slice.
- Aucun contrôle ne repose sur un lien masqué : les gardes sont serveur, route par route.

**Validation et bornes de chaque entrée**

- Corps du PATCH : `readJson(req, 4096)` exige `content-type: application/json`, refuse `Transfer-Encoding`, `Content-Encoding` non identity, `Content-Length` > 4096 (413 avant lecture), un JSON non objet (`null`, tableau, chaîne → 400 « JSON invalide »).
- `validateProfilePatch` : objet simple obligatoire ; `JSON.stringify(input).length > 2048` → 413 ; clés autorisées `tourCompletedAt` (booléen), `featureTours` (objet simple, clés parmi sept, valeurs booléennes), `settings` (`language` ∈ {`en`}, `sidebarCollapsed` booléen) ; toute autre clé → 400 ; objet vide → 400. `__proto__` et `constructor` créés par `JSON.parse` sont des propriétés propres et tombent dans « clé inconnue ».
- Adresse : `normalizeAddress` de `src/lib/evm/address.ts` (viem `isAddress` non strict puis minuscules) ; 400 « adresse du profil EVM invalide » sinon. Jamais contournable depuis le client puisque l'adresse vient de la session. La base refuse en plus toute adresse qui ne serait pas `0x` + 40 hexadécimaux minuscules.
- `recordDatasetAccess` : voir les bornes en section 2.
- `SET LOCAL lock_timeout = <n>` et `statement_timeout = <n>` : `n` est `Math.max(1, Math.floor(timeoutMs))`, calculé par le code (`LOGIN_PROFILE_TIMEOUT_MS` ou le paramètre de test), jamais une entrée utilisateur.

**Fuites possibles**

- Réponses : la vue est construite champ par champ (`toUserProfileView`), jamais par `...row`. `blockedReason`, `blockedBy` absents (testé : clés de la réponse énumérées).
- Journaux : `touchUserProfileAfterLogin` n'écrit que la classe d'erreur (`PrismaClientInitializationError`, `ProfileTimeout`, `ProfileSkipped`, `AppError`…) ; testé avec une erreur contenant l'adresse, un mot de passe et un hôte : aucun ne figure dans le message. `errorResponse` (existant) ne journalise que la classe des erreurs techniques.
- Cache : `cache-control: private, no-store` sur GET et PATCH.
- Un wallet ne peut pas deviner si un autre a un profil : aucune route n'accepte d'adresse.
- Catalogue public : les trois colonnes de consentement sont omises par défaut par le client Prisma ; vérifier qu'aucune lecture future n'utilise `select` explicite sur ces colonnes dans une route publique (l'`omit` ne s'applique pas à un `select`).

**Impact sur l'argent, l'escrow, les contrats, le moteur Phala**

- Aucun. Aucune transaction, aucun appel RPC, aucun appel runner. `kybStatus` est un cache d'affichage non alimenté : la source de vérité KYB reste le contrat (`src/lib/sirius/access.ts`, inchangé). Vérifier que personne ne lit `UserProfile.kybStatus` pour une décision d'accès dans un couloir futur.

**Base de données**

- Rejouer `prisma migrate deploy` sur une copie de staging : la migration est appliquée une fois, en une transaction, et ne touche pas aux lignes existantes.
- `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` après déploiement : « No difference detected » (section 9), y compris avec les `CHECK` que Prisma ignore.
- `src/lib/postgres.integration.test.ts` rejoue toutes les migrations dans l'ordre sur une base neuve puis lance huit processus concurrents : vert (section 9).
- `scripts/check-evm-migration.ts` : « Préflight EVM validé » sur la base migrée (section 9).
- `UserProfile.address` : clé primaire plus `CHECK` minuscules ; `DatasetAccessLog.address` : `CHECK` minuscules. Toute écriture du code passe par `normalizeProfileAddress`/`normalizeAddress`.
- `featureTours` et `settings` : `JSONB NOT NULL DEFAULT '{}'`. La fusion se fait en mémoire dans une transaction `Serializable` (`serializableTransaction`, reprise ×3 sur 40001/40P01/P2034).
- Transaction de connexion : `$transaction` interactif Prisma avec l'adaptateur pg exécute `SET LOCAL` et l'upsert sur la même connexion ; un `lock_timeout` dépassé lève 55P03 côté PostgreSQL, rattrapé comme `PrismaClientKnownRequestError`.
- Runbook : `ops:db-inventory expect --migrations=20261003000000_add_user_profiles` doit lister `tablesAdded: [DatasetAccessLog, UserProfile]`, cinq colonnes sur `Dataset`, les colonnes des deux tables et quatre index ; `compare` avant/après ne doit donner aucun écart.

**Interface**

- Rien de rendu par cette slice. Les valeurs renvoyées sont des booléens, des chaînes fermées (`en`, statuts) et des dates ISO : aucun contenu libre fourni par l'utilisateur n'est stocké dans le profil.

**Textes**

- Aucun texte utilisateur nouveau en dehors des messages d'erreur, tous traduits dans `errors-en.ts` et vérifiés par `english.test.ts` (littéraux) et `profile.test.ts` (messages construits par gabarit, que `english.test.ts` ne voit pas). Aucune promesse sur les modèles ou la sécurité.

### 4. Cas limites à essayer à la main sur staging

Préparation : une session ouverte dans le navigateur sur staging ; ouvrir la console et utiliser `fetch` avec `credentials: "include"`. Les PATCH doivent partir du site lui-même (en-tête `Origin` vérifié).

1. **Création au premier GET** : `fetch("/api/profile").then(r => r.json())` → 200, objet avec `address` en minuscules égal au wallet connecté, `featureTours: {}`, `settings: {}`, `tourCompletedAt: null`, `createdAt` égal à `lastSeenAt`. Rejouer : `createdAt` identique, `lastSeenAt` avancé.
2. **Sans session** : même appel en navigation privée → 401 `{"error":"Authentification requise"}`.
3. **Marquer un tuto** : `fetch("/api/profile",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({featureTours:{dashboard:true}})})` → 200, `featureTours: {dashboard: true}`.
4. **Fusion** : PATCH `{featureTours:{upload:true}}` → `featureTours: {dashboard: true, upload: true}` (le premier n'a pas disparu).
5. **Tuto terminé** : PATCH `{tourCompletedAt:true}` → `tourCompletedAt` daté. Rejouer → même date. PATCH `{tourCompletedAt:false}` → `null`.
6. **Champ protégé** : PATCH `{kybStatus:"ACCEPTED"}` → 400 « Champ de profil non modifiable », et GET montre `kybStatus: null`.
7. **Adresse dans le corps** : PATCH `{address:"0x000…dead", featureTours:{train:true}}` → 400 ; GET sur le wallet montre `train` absent.
8. **Tuto inconnu** : PATCH `{featureTours:{admin:true}}` → 400 « Tuto de profil inconnu ». `{featureTours:{dashboard:"yes"}}` → 400 « Tutos de profil invalides ».
9. **Langue** : PATCH `{settings:{language:"fr"}}` → 400 « Langue non prise en charge » ; `{settings:{language:"en",sidebarCollapsed:true}}` → 200.
10. **Vide et non-objet** : PATCH `{}` → 400 « Aucune modification de profil » ; corps `[]` ou `null` → 400 « JSON invalide » ; `content-type: text/plain` → 415.
11. **Trop gros** : PATCH avec une clé de 3000 caractères → 413 « Modification de profil trop volumineuse » ; corps de 10 Ko → 413 « Requête trop volumineuse ».
12. **Débit** : 21 PATCH en moins d'une minute → le 21ᵉ répond 429 « Trop de requêtes — réessaie plus tard », même avec un corps invalide. 61 GET → 429 au 61ᵉ.
13. **Origine** : depuis une autre origine (par exemple la console d'un autre site), PATCH → 403 « Origine de requête non autorisée ».
14. **Connexion** : se déconnecter, se reconnecter avec le wallet → la connexion réussit ; en base, `lastSeenAt` du profil est mis à jour. Avec un nouveau wallet, la ligne est créée.
15. **Base indisponible pendant la connexion** (environnement de recette seulement) : pointer `DATABASE_URL` vers un port fermé, se connecter → la connexion réussit, le journal serveur contient `[auth] profil utilisateur non mis à jour (PrismaClientInitializationError)` sans adresse.
16. **Base qui ne répond pas** (recette seulement) : en `psql`, `BEGIN; SELECT * FROM "UserProfile" WHERE address = '<wallet>' FOR UPDATE; SELECT pg_sleep(30);` puis se connecter avec ce wallet → la connexion réussit en environ 2 s, journal `(ProfileTimeout)` ; `SELECT count(*) FROM pg_stat_activity WHERE state <> 'idle' AND query ILIKE '%UserProfile%'` ne montre que la session `psql` (la requête abandonnée a été annulée par `lock_timeout`). Trois connexions simultanées du même wallet dans cet état : au plus deux `(ProfileTimeout)`, les autres `(ProfileSkipped)`, les trois connexions réussies.
17. **Ligne altérée** : en base, `UPDATE "UserProfile" SET "featureTours" = '{"dashboard":true,"junk":1}'` → GET montre `{dashboard: true}` ; PATCH `{featureTours:{upload:true}}` → `{dashboard: true, upload: true}` et la clé `junk` a disparu de la ligne.
18. **Casse** : `INSERT INTO "UserProfile" (address) VALUES ('0xABAB…')` → refusé par `UserProfile_address_lowercase` ; `SELECT address FROM "UserProfile"` : tout en minuscules, une seule ligne par wallet.
19. **Consentement non public** : `UPDATE "Dataset" SET "trainingConsentAt" = now(), "trainingConsentVersion" = 'test' WHERE id = '<dataset LISTED>'` puis `GET /api/datasets/<id>` sans session → la réponse ne contient aucune clé `trainingConsent*` ni `wrappedKey`, mais contient `category` et `listingExpiresAt` (nuls). Remettre les deux colonnes à `NULL` ensuite.
20. **Migration** : `SELECT column_name FROM information_schema.columns WHERE table_name='Dataset' AND column_name IN ('category','listingExpiresAt','trainingConsentAt','trainingConsentVersion','trainingConsentRevokedAt')` → cinq lignes ; `SELECT count(*) FROM "DatasetAccessLog"` → 0 ; `SELECT conname FROM pg_constraint WHERE conrelid = '"UserProfile"'::regclass` → `UserProfile_pkey`, `UserProfile_address_lowercase`.
21. **Runbook** : `node scripts/operations/db-inventory.mjs expect --migrations=20261003000000_add_user_profiles` → `tablesAdded` avec les deux tables ; `compare` d'une photo prise avant et d'une photo prise après (avec `--before`) → `ok: true`, aucun écart.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

`src/lib/users/profile.test.ts`, quinze tests, dans le script `test` de `package.json` :

1. normalisation et refus des adresses invalides, y compris sur `ensureUserProfile` et `readUserProfile` ; `createdAt = lastSeenAt` à la création ; traductions explicites des trois messages construits par gabarit ;
2. `ensureUserProfile` crée puis ne fait que dater ;
3. reprise unique sur P2002, remontée des autres erreurs ;
4. vue sans `blockedReason`/`blockedBy`, filtrage d'une ligne altérée (`__proto__` comme propriété propre créée par `JSON.parse`) ;
5. `validateProfilePatch` : tous les refus (non-objet, vide, clés protégées, types, tutos et réglages inconnus, langue) ;
6. borne de taille à 413, et la plus grande modification légitime passe ;
7. fusion clé par clé, pose et effacement de la date du tuto, création du profil manquant par upsert avec dates cohérentes, course où la ligne apparaît entre la lecture et l'écriture, rien d'écrit si la validation échoue ;
8. `recordDatasetAccess` : normalisation, champs optionnels, dix-huit entrées invalides refusées sans écriture et avec un message traduit, P2003 → 404, autres erreurs inchangées ;
9. `touchUserProfileAfterLogin` : ne lève jamais, journal sans adresse ni cause, classe seule ;
10. base gelée abandonnée après le délai de garde (50 ms en test), avertissement `(ProfileTimeout)`, constante entre 1 et 5 s ;
11. plafond de deux mises à jour en vol (`ProfileSkipped`), reprise une fois les touches terminées, instructions `SET LOCAL lock_timeout`/`statement_timeout` émises avec le délai demandé quand le client sait ouvrir une transaction ;
11 bis. délais PostgreSQL de GET (`ensureUserProfileWithin`) et de PATCH, une seule transaction même quand le client de transaction expose `$transaction`, `ensureUserProfile` n'en ouvre jamais, P2034 épuisé → 409 traduit, autres erreurs inchangées ;
12. `GET /api/profile` : 200, `no-store`, clés de la réponse énumérées, 401 sans session, casse mixte ;
13. `PATCH /api/profile` : isolation entre wallets, refus d'`address` et des champs protégés, codes 400/413/415/401 ;
14. limites de débit : 20 PATCH puis 429 y compris sur un corps invalide (le limiteur précède la validation), 60 GET puis 429 ; sur la même instance de route (donc les mêmes limiteurs), un autre wallet passe et le premier reste refusé ;
15. `POST /api/auth/verify` : profil touché avec l'adresse vérifiée en minuscules, connexion réussie malgré une base en panne et malgré une base gelée, aucun profil sans preuve de possession ni quand le challenge est refusé.

`src/lib/db.test.ts` : garde de source sur l'`omit` global (les quatre colonnes doivent rester `true`).
`scripts/operations/db-inventory.test.ts` (dans `test:operations`) : attentes lues dans la migration A1 (tables, colonnes, clés primaires, index), table historique à colonne énumérée (`KeyGrant.status`) correctement lue, comparaison avec et sans attentes (`ok` vrai, aucun écart), table, colonne ou index annoncés mais absents en critique ; le test PostgreSQL existant rejoue toutes les migrations dont A1. Les bases gelées des tests de connexion sont libérées en `afterEach` : un échec d'assertion ne laisse plus de touche en vol pour les tests suivants.

**Ce qu'ils ne couvrent pas**

- Le vrai client Prisma : les tests utilisent une base en mémoire. Le comportement réel (upsert `ON CONFLICT`, transaction sérialisable, JSONB, clé étrangère, `CHECK`, annulation par `lock_timeout`) a été vérifié par des scripts manuels sur PostgreSQL 16 local (section 9), non versionnés.
- La concurrence réelle de PATCH et le verrou de ligne (couverts par les scripts manuels et par les relecteurs, pas par un test automatique).
- `assertMutationOrigin` sur PATCH : `requireAuth` est simulé dans les tests de route ; l'origine est couverte par les tests existants de `src/lib/http/security.test.ts` et a été éprouvée par les relecteurs avec la vraie garde.
- Le limiteur global (`maxGlobal`).
- L'`omit` global n'est vérifié que sur la source de `db.ts` (le client ne l'expose pas), plus un essai manuel (cas 19).
- Les contraintes `CHECK` sont vérifiées par le test d'intégration PostgreSQL, mais l'outil d'inventaire ne les photographie pas : leur disparition lors d'une future migration ne serait pas signalée par `compare`.
- La fausse base ne modélise pas P2025 ; P2003 est simulé par un stub qui lève.
- Le build Next.js de la route est couvert par `pnpm build` (section 9), pas par un test.

### 6. Hypothèses

- Prisma 7 avec `@prisma/adapter-pg` compile l'upsert en `INSERT … ON CONFLICT` (vérifié au journal des requêtes sur PostgreSQL 16 local), et exécute une transaction interactive sur une seule connexion (vérifié : `SET LOCAL` suivi de l'upsert, annulation observée). Non vérifié sur Neon ou derrière un pooler en mode transaction ; `SET LOCAL` reste correct derrière PgBouncer en mode transaction puisque tout est dans une transaction.
- La base de staging accepte `JSONB`, `CURRENT_TIMESTAMP` et les `CHECK` avec expression régulière sans extension (PostgreSQL ≥ 9.4).
- Les sessions ouvertes avant le déploiement restent valides (cookie inchangé) et obtiennent leur profil au premier GET ou PATCH.
- `FixedWindowRateLimiter` et le compteur de mises à jour en vol sont en mémoire par instance : sur Vercel, chaque instance a les siens. Même limite que les autres routes du dépôt.
- `serializableTransaction` reprend au plus trois fois ; au-delà, l'erreur remonte en 500 opaque « Erreur interne — réessaye. ». Jugé acceptable pour une écriture de confort (tutos, réglages) : observé une fois sur cinq tours de sept PATCH simultanés sur la même ligne, jamais avec deux à quatre écrivains.
- `Dataset.category` est stocké en texte libre ; la liste fermée est tenue par le code de l'upload (couloir N2). Une valeur hors liste en base n'est pas empêchée par un `CHECK`.
- Le format de `modelFingerprint` sera fixé par le couloir qui branche la livraison (hexadécimal SHA-256 attendu).
- `prisma migrate dev --create-only` sur une base jetable produit une migration vide avec les `CHECK` en place (vérifié par un relecteur) ; `migrate dev` et `reset` rejouent les fichiers SQL et les recréent ; seul `prisma db push` les perdrait, et le dépôt ne l'utilise pas.
- `prisma migrate deploy` n'applique pas un fichier de migration en une transaction (démontré par un relecteur avec un fichier dont le second ordre échoue : le premier reste appliqué). La migration A1 est donc à appliquer par la pipeline sur une base sauvegardée, avec la procédure du runbook en cas d'échec.

### 7. Risques résiduels et limites connues

- **Pause = `UNLISTED`** : un dataset en pause reste empruntable par lien direct tant que le couloir des prêts n'en décide pas autrement. Documenté dans 16 § 2.
- **`listingExpiresAt` absent** sur les datasets existants : la marketplace doit traiter `null` comme « sans expiration » sous peine de masquer tout le catalogue actuel.
- **Limiteurs par instance** : la limite réelle sur Vercel est multipliée par le nombre d'instances chaudes ; même chose pour le plafond de mises à jour en vol.
- **`blockedAt` exposé** sans mécanisme de blocage effectif : aucune route ne refuse encore un wallet bloqué. Le blocage est prévu après le 6 (15-dashboard-admin.md).
- **`kybStatus` non alimenté** : reste `null` tant que le couloir KYB ne l'écrit pas ; l'interface ne doit pas interpréter `null` comme « non vérifié » sans consulter le contrat.
- **`DatasetAccessLog` non alimenté** : le traçage annoncé dans les conditions d'utilisation ne sera effectif qu'une fois `recordDatasetAccess` branché sur la livraison du modèle.
- **Connexion plus lente d'un aller-retour base**, au plus 2 s de plus si la base ne répond pas ; au-delà de deux mises à jour en vol, `lastSeenAt` n'est pas daté pour les connexions suivantes tant que la base ne répond pas (journal `ProfileSkipped`).
- **Contention extrême sur un même profil** : un 409 « Profil modifié en même temps, réessaie » après trois reprises sérialisables (mesuré : jamais avec deux à quatre écrivains simultanés, environ un tiers des écritures avec quarante) ; aucune écriture perdue, le client rejoue.
- **Ligne verrouillée par une autre session** : GET et PATCH échouent en 5 s (500 opaque) au lieu d'attendre ; la connexion continue sans profil après 2 s.
- **`omit` global et `select`** : une future lecture qui utilise `select` explicite sur les colonnes de consentement n'est pas protégée par l'`omit`.
- **Outil d'inventaire** : il vérifie l'existence d'une table créée, ses colonnes, sa clé primaire et ses index, mais pas les types ni les contraintes `CHECK` d'une table neuve.

### 8. Reste à faire

| Priorité | Quoi | Où |
|---|---|---|
| P0 | Brancher `recordDatasetAccess` sur la livraison de la clé du modèle, dans la même transaction | couloir N4 ou livraison (`src/lib/sirius/*`) |
| P0 | Faire lire `status = LISTED` et `listingExpiresAt` (null ou futur) par la marketplace et dériver les états des cartes | couloirs N1, N3 |
| P0 | Écrire `category`, `listingExpiresAt`, `trainingConsent*` à l'upload et depuis la fiche, en ré-incluant le consentement à la lecture (`omit: { …: false }`) | couloirs N2, N1 |
| P1 | Décider si la pause ferme l'emprunt par lien direct (`UNLISTED`) | couloir des prêts |
| P1 | Alimenter `kybStatus`/`kybCheckedAt` depuis le contrat, et préciser que `null` = inconnu | couloir A6 |
| P1 | Poser `connectionTimeoutMillis`, `statement_timeout` ou `lock_timeout` globaux dans `src/lib/db.ts` : toutes les routes partagent aujourd'hui un pool sans délai, la slice n'a protégé que la connexion | socle, après le 6 |
| P2 | Refus des wallets bloqués (`blockedAt`) dans `requireAuth` ou une garde dédiée, et route admin de blocage | après le 6 (15) |
| P2 | Lecture admin du journal des accès | après le 6 (15) |
| P2 | Fusion atomique en SQL (`ON CONFLICT … SET "featureTours" = "featureTours" \|\| EXCLUDED."featureTours"`) pour supprimer la classe des conflits sérialisables sur le profil | socle |
| P2 | Photographier les contraintes `CHECK` dans `ops:db-inventory` pour que `compare` signale leur disparition | outillage |

### 9. Résultats des vérifications

Environnement : conteneur Linux, Node 22.22.0, pnpm 11.18.0, PostgreSQL 16.14 lancé localement à partir des binaires du système (Docker indisponible dans le conteneur : `docker info` échoue, aucun démon ; `initdb` lancé sous l'utilisateur `postgres`). Toutes les commandes lancées depuis la racine du dépôt sur la branche `feat/socle-profils`, à son état final (`eb1b09d`, après le dernier correctif), avec `DATABASE_URL="postgresql://ci:ci@localhost:5432/ci?schema=public"` comme en CI. La même séquence avait été passée en vert sur chaque état intermédiaire (`27d3f35`, `aa9bb6c`, `e9ed707`, `f515d25`).

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | `Done in 553ms using pnpm v11.18.0`, code 0 (premier passage, cache vide : `Done in 3.8s`, `postinstall: ✔ Generated Prisma Client (7.8.0)`). Sans `DATABASE_URL`, le postinstall échoue sur `PrismaConfigEnvError` : comportement préexistant du dépôt, la CI fournit la variable. |
| `pnpm prisma generate` | `✔ Generated Prisma Client (7.8.0) to ./src/generated/prisma`, code 0 |
| `pnpm prisma validate` | `The schema at prisma/schema.prisma is valid` |
| `pnpm prisma migrate deploy` sur une base neuve | `All migrations have been successfully applied`, 13 migrations dont `20261003000000_add_user_profiles` |
| `pnpm prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` (base neuve migrée) | `No difference detected`, code 0 |
| `pnpm prisma migrate status` | `13 migrations found`, `Database schema is up to date!` |
| `INSERT` en casse mixte dans `UserProfile` et `DatasetAccessLog` (base neuve) | `violates check constraint "UserProfile_address_lowercase"` et `"DatasetAccessLog_address_lowercase"` ; l'insertion en minuscules passe |
| `EVM_NETWORK=testnet node --import tsx scripts/check-evm-migration.ts` (base migrée) | `Préflight EVM validé`, code 0 |
| `pnpm exec tsc --noEmit` | code 0, aucune erreur |
| `pnpm lint` | code 0, aucune remarque |
| `pnpm test` (après `pnpm datasets:generate` comme en CI) | `# tests 446`, `# pass 446`, `# fail 0`, code 0 |
| `node --import tsx --test src/lib/users/profile.test.ts` | `# tests 16`, `# pass 16`, `# fail 0` |
| `pnpm test:operations` (avec `SIRIUS_TEST_DATABASE_URL`, donc le test PostgreSQL de l'inventaire inclus) | `# tests 83`, `# pass 83`, `# fail 0`, `# skipped 0`, code 0 |
| `pnpm test:postgres` | `ok 1 - migrations additives et quotas sur PostgreSQL entre huit processus`, `# pass 1`, code 0 |
| `pnpm test:phala-demo` | `# tests 24`, `# pass 24`, code 0 |
| `pnpm audit:deps` | `2 vulnerabilities found`, `Severity: 1 low \| 1 high (1 ignored)`, code 0 : état identique à `staging`, aucune dépendance ajoutée |
| `pnpm build` | `✓ Compiled successfully` (34,7 s au premier passage complet, 1,2 s avec le cache au dernier), route `ƒ /api/profile` présente, code 0 |
| Script manuel sur PostgreSQL local : dix tours de quatre écritures concurrentes sur un profil absent (trois PATCH sur des clés différentes et une connexion) | « 40 réussites, 0 rejets », fusion complète et une seule ligne à chaque tour |
| Script manuel sur PostgreSQL local : `ensure`, `patch`, trois PATCH concurrents sur des clés différentes, `tourCompletedAt`, `recordDatasetAccess`, clé étrangère, dix connexions simultanées | Fusion complète `{dashboard, upload, train}` et `{language, sidebarCollapsed}` ; `P2003` sur un dataset inexistant (désormais 404) ; une seule ligne après dix `touchUserProfileAfterLogin` simultanés ; JSONB brut conforme |
| Script manuel : ligne du profil verrouillée par `SELECT … FOR UPDATE` en `psql` pendant 12 s, puis `ensureUserProfileWithin` (chemin de GET) et `updateUserProfile` (chemin de PATCH) | « GET échoue en 5038 ms : DriverAdapterError / 57014 », « PATCH échoue en 5017 ms : DriverAdapterError / 57014 », « pool libre : SELECT 1 en 2 ms » |
| Script manuel : ligne du profil verrouillée par `SELECT … FOR UPDATE` en `psql` pendant 6 s, quatre `touchUserProfileAfterLogin` simultanés avec un délai de 300 ms | « 4 touches sous verrou rendues en 302 ms », journal : deux `(ProfileTimeout)`, deux `(ProfileSkipped)` ; « requêtes encore actives sur UserProfile après le délai : 1 (celle de psql) » ; « pool libre : SELECT 1 en 1 ms » |
| Script manuel : `datasetResponse()` sur un dataset avec consentement rempli | clés `trainingConsent*` et `wrappedKey` absentes, `category` et `listingExpiresAt` présentes ; ré-inclusion par `omit: { …: false }` fonctionnelle |
| `git diff --name-only staging...HEAD` | 15 fichiers : `docs/MIGRATION-RUNBOOK.md`, `docs/passage-mainnet/16-socle-technique.md`, `package.json`, `prisma/migrations/20261003000000_add_user_profiles/migration.sql`, `prisma/schema.prisma`, `scripts/operations/db-inventory.mjs`, `scripts/operations/db-inventory.test.ts`, `src/app/api/auth/verify/route.ts`, `src/app/api/profile/route.ts`, `src/lib/db.test.ts`, `src/lib/db.ts`, `src/lib/i18n/errors-en.ts`, `src/lib/postgres.integration.test.ts`, `src/lib/users/profile.test.ts`, `src/lib/users/profile.ts` (plus `docs/passage-mainnet/audit.md`, cette section). Aucun fichier interdit. |
| `git log staging..HEAD --format=%B` passé au crible des motifs de signature d'assistant (nom de l'assistant, ligne de co-auteur, mention de génération automatique, lien de session) et de `[skip ci]` | aucune occurrence ; aucun fichier ni dossier de configuration d'assistant dans l'arbre (ceux que le cahier des charges interdit de versionner) |

### 10. Revue interne de la session

Méthode : quatre relecteurs indépendants, chacun sous un angle (sécurité et contrôle d'accès ; exactitude, migration et cohérence de la base ; tests et cas limites ; conformité au cahier des charges et aux conventions), avec accès au dépôt, à la base PostgreSQL locale migrée et au droit d'écrire des scripts d'attaque hors du dépôt. Chaque défaut remonté a ensuite été soumis à trois contradicteurs indépendants chargés de le réfuter, chacun sous une lentille distincte (exploitabilité, lecture du code, importance). Un défaut est « confirmé » quand au moins deux contradicteurs sur trois le jugent réel et digne d'une correction. Le premier passage a été interrompu volontairement pendant la phase de vote, une fois les défauts importants confirmés et corrigés : les votes restants auraient porté sur un code déjà modifié, et un second passage complet a été relancé sur le code corrigé (deux commits), avec la liste des défauts du premier passage, pour vérifier les corrections et chercher autre chose, jusqu'à deux tours consécutifs sans rien de nouveau. « Non voté » ci-dessous signifie que l'interruption est survenue avant les trois votes ; la suite donnée repose alors sur la reproduction par le ou les relecteurs et sur ma propre lecture.

**Ce que les relecteurs ont tenté sans trouver de défaut** (synthèse des quatre rapports) :

- requêtes forgées contre la vraie route avec le vrai `requireAuth` (`assertMutationOrigin` + cookie HMAC signé) et le vrai Prisma, `NODE_ENV=production` : PATCH sans `Origin` → 403, `Origin` tiers → 403, `sec-fetch-site: cross-site` → 403, GET sans cookie → 401 ; aucune façon de passer une adresse hors session ;
- champs protégés (`kybStatus`, `kybCheckedAt`, `blockedAt`, `blockedReason`, `blockedBy`, `address`, `createdAt`, `lastSeenAt`) refusés en 400 ; `blockedReason` et `blockedBy` absents de la réponse ;
- pollution de prototype (`__proto__`, `constructor.prototype`, `toJSON`, `toString`, clés unicode et zéro-largeur) → 400 sans effet sur `Object.prototype` ;
- bornes : 2048 caractères pile acceptés puis rejetés sur clé inconnue, 2049 → 413 ; corps de 4096 octets → 413 « Modification de profil trop volumineuse », 4097 → 413 « Requête trop volumineuse » ; `Content-Length` faux, `transfer-encoding`, `content-encoding: gzip`, `text/plain`, BOM, JSON imbriqué sur 500 niveaux, clés JSON dupliquées, `Date`, `NaN`, booléens en chaîne : tous refusés comme attendu ;
- débit : 21ᵉ PATCH → 429, 61ᵉ GET → 429, clé non forgeable (adresse de session signée) ;
- concurrence sur la vraie base : 5 PATCH simultanés sur un profil absent → 5 × 200 et une seule ligne ; 2, 3 et 4 écrivains concurrents sur 5 tours → aucune clé perdue ; 10 `touchUserProfileAfterLogin` simultanés → une ligne ;
- lignes JSONB altérées (`'null'`, `'[1,2]'`, `'"x"'`, `42`, objet avec `__proto__` et clés inconnues) → lues comme `{}` ou filtrées, puis réécrites proprement par PATCH ;
- migration : `prisma migrate diff` vide sur la base migrée et sur une base neuve après `migrate deploy` ; SQL généré par Prisma depuis l'état précédent équivalent au SQL manuscrit (seule différence : clé étrangère inline au `CREATE TABLE` plutôt qu'un `ALTER` séparé, sans effet) ; strictement additive ; `postgres.integration.test.ts` et `check-evm-migration.ts` non affectés ; la clé étrangère `RESTRICT` n'entrave aucun chemin existant (`pipeline.ts` ne supprime que des `DRAFT` sans CID) ;
- journaux : seule la classe d'erreur est écrite, aucune adresse ni cause pendant les scénarios de panne ; le profil est touché après `verifyLoginSignature` et `verifyChallenge`, avant `setSession` ;
- aucun autre test ne charge `verify/route.ts` par VM (pas de « Dépendance inattendue ») ; aucun fichier interdit touché ; aucune signature d'assistant ; doc 16 cohérente avec le schéma.

**Défauts remontés, vote des contradicteurs et suite donnée**

| Défaut | Angle | Gravité annoncée | Vote (réel / 3) | Suite |
|---|---|---|---|---|
| Une base qui ne répond pas (connexion acceptée, aucune réponse, pool saturé) suspend `/api/auth/verify` au lieu de laisser la connexion réussir : seul le cas « erreur levée » était rattrapé. Reproduit avec un serveur TCP muet : encore en attente après 15 s. | tests ; conformité | moyenne ; faible | non voté (voir note) | **Corrigé** : `touchUserProfileAfterLogin` court contre un délai de garde de 2 s (`LOGIN_PROFILE_TIMEOUT_MS`) via `Promise.race`, journalise `(ProfileTimeout)` et laisse la connexion continuer ; la requête en cours est abandonnée à son sort. Tests ajoutés : fonction seule avec un upsert qui ne résout jamais, et route de connexion avec base gelée → 200 et session posée. |
| `lastSeenAt` antérieur à `createdAt` sur un profil créé : `now` était capturé côté Node pour `lastSeenAt` et `tourCompletedAt`, `createdAt` posé par le défaut SQL quelques millisecondes plus tard. | sécurité ; base ; tests ; conformité | info à faible | 2 / 3 (deux fois, remonté sous deux titres) | **Corrigé** : `createdAt: now` passé explicitement dans les deux chemins de création. La fausse base des tests date désormais `createdAt` après coup comme `CURRENT_TIMESTAMP`, et trois assertions vérifient `createdAt = lastSeenAt` à la création et `tourCompletedAt` jamais antérieur à `createdAt`. |
| « adresse du profil EVM invalide » et « adresse du journal des accès EVM invalide » (messages construits par gabarit dans `normalizeAddress`) tombaient sur la règle dynamique et donnaient « Invalid EVM adresse du profil » ; `english.test.ts` ne voit que les littéraux. | sécurité ; tests ; conformité | info à faible | 2 / 3 | **Corrigé** : deux entrées explicites dans `errors-en.ts`, et une assertion dans `profile.test.ts` que la traduction ne contient plus « adresse ». |
| L'outil d'inventaire du runbook (`scripts/operations/db-inventory.mjs`) ne lisait pas les `CREATE TABLE` : la comparaison avant/après de cette migration aurait signalé quatre écarts « warning » (`UserProfile`, `DatasetAccessLog` et leurs `_pkey`) et rendu le code de sortie 1 à l'étape 6 du runbook. Limitation préexistante (déjà vraie pour `OperatorCodeAttempt`). | base | faible | 2 / 3 | **Corrigé** : `expectedChanges()` lit `CREATE TABLE` en `tablesAdded` et ajoute `<table>_pkey` aux index attendus ; `compareInventories()` ne signale plus une table annoncée et signale en critique (`table-not-added`) une table annoncée mais absente. Tests ajoutés dans `db-inventory.test.ts` (attentes de la migration A1, comparaison avec et sans attentes, table manquante). |
| Les nouvelles colonnes de consentement de `Dataset` sortiraient telles quelles sur les routes publiques du catalogue (`datasetResponse()` fait `{ ...dataset }`), dès que l'upload les remplira : trace contractuelle du fournisseur visible par un visiteur anonyme. | sécurité | faible | 1 / 3 | **Corrigé malgré un vote minoritaire** (deux contradicteurs sur trois l'ont jugé réel mais non bloquant tant qu'aucune route n'écrit ces colonnes) : la correction coûte quatre lignes et suit le motif existant de `wrappedKey`. `src/lib/db.ts` omet globalement `trainingConsentAt`, `trainingConsentVersion` et `trainingConsentRevokedAt` ; la fiche du fournisseur et l'admin les ré-incluent avec `omit: { …: false }` (documenté dans 16 § 2). Vérifié sur la base locale : `datasetResponse()` ne contient plus ces clés, `category` et `listingExpiresAt` restent publics, la ré-inclusion fonctionne. Pas de test automatique sur l'`omit` global (non introspectable) : point à vérifier à la main (section 4, cas 19). |
| La reprise sur P2002 dans `ensureUserProfile` ne peut pas s'exécuter sur PostgreSQL : Prisma compile l'upsert en `INSERT … ON CONFLICT DO UPDATE`, atomique. Le commentaire et le test décrivaient un chemin inexistant en production. | base | info | non voté (voir note) | **Corrigé dans le commentaire** : la reprise est présentée comme une ceinture pour le cas où Prisma retomberait sur le chemin non natif ; le code et le test sont conservés (ils ne nuisent pas et garantissent l'absence de boucle). |
| Sous forte contention sur un même profil (7 PATCH simultanés, 5 tours), une tentative a dépassé les trois reprises de `serializableTransaction` et a répondu 500 « Erreur interne — réessaye. » au lieu d'un statut réessayable ; aucune écriture perdue. | base | info | non voté (voir note) | **Écarté** : comportement commun à toutes les routes du dépôt, aucune perte de donnée, 2 à 4 écrivains simultanés n'y arrivent jamais, et le message invite déjà à réessayer. Noté en risque résiduel (section 7). |
| Limite de débit ajoutée sur GET, GET avec effet de bord (création et `lastSeenAt`). | conformité | info | non voté (voir note) | **Assumé et documenté** (16 § 1, section 2 ci-dessus) : GET écrit, donc il est limité. |
| `tourCompletedAt: false` efface la date ; `true` ne déplace pas une date déjà posée. | conformité | info | non voté (voir note) | **Assumé et documenté** dans 16 § 1 pour que le client n'envoie pas `false` par défaut. |
| `blockedAt`, `kybStatus`, `kybCheckedAt` exposés, `blockedReason` et `blockedBy` masqués. | conformité | info | non voté (voir note) | **Assumé et documenté** dans 16 § 1 : si un motif doit être montré après le 6, il lui faudra un champ public distinct. |
| Clé étrangère `DatasetAccessLog.datasetId` en `ON DELETE RESTRICT` : un futur script de purge devra détacher les journaux d'abord. | conformité | info | non voté (voir note) | **Assumé et documenté** dans 16 § 3. |

**Second passage, sur le code corrigé** (quatre relecteurs, mêmes angles, avec la liste ci-dessus) :

| Défaut | Angle | Gravité annoncée | Vote (réel / 3) | Suite |
|---|---|---|---|---|
| Le délai de garde rend la main mais l'upsert abandonné continue et garde sa connexion du pool (cinq par instance, sans `connectionTimeoutMillis`) ; reproduit avec un `SELECT … FOR UPDATE` tenu sur la ligne : sept connexions « réussies » en 300 ms, pool saturé derrière, écritures en rafale à la levée du verrou. Cinq connexions suffisent à bloquer toutes les routes de l'instance. | sécurité | moyenne | 1 / 1 collecté (les deux autres contradicteurs ont échoué faute de crédits d’usage) | **Corrigé** : l'upsert de connexion tourne dans une transaction courte sous `SET LOCAL lock_timeout` et `statement_timeout` égaux au délai de garde, pour que PostgreSQL annule la requête et rende la connexion ; et un compteur par instance (`MAX_IN_FLIGHT_LOGIN_TOUCHES = 2`) saute la mise à jour (`ProfileSkipped`) quand deux sont déjà en vol. Vérifié sur la base locale avec une ligne verrouillée : quatre connexions rendues en 301 ms, aucune requête du pool encore active après le délai, `SELECT 1` immédiat. Tests ajoutés : plafond en vol, reprise une fois les touches terminées, instructions `SET LOCAL` émises avec le délai demandé. |
| La casse minuscule de l'adresse n'est garantie que par le code : une écriture manuelle ou un futur chemin admin en casse EIP-55 crée un second profil invisible pour l'application (blocage ou cache KYB sans effet). Reproduit en psql : deux lignes pour un même wallet. | base ; sécurité | faible | non voté (crédits épuisés) ; remonté indépendamment par trois relecteurs (base, sécurité, tests) et reproduit en psql | **Corrigé** : contrainte `CHECK ("address" ~ '^0x[0-9a-f]{40}$')` posée dans le `CREATE TABLE` de `UserProfile` et de `DatasetAccessLog` (toujours additif, tables nouvelles seulement ; Prisma ignore les `CHECK` et `migrate diff` reste vide). Vérifié : insertion en casse mixte refusée, en minuscules acceptée, `migrate deploy` sur base neuve puis `migrate diff` « No difference detected ». |
| `recordDatasetAccess` sur un dataset inexistant lève une `PrismaClientKnownRequestError` P2003 brute (500 opaque une fois branchée). | base | info | non voté (crédits épuisés) ; reproduit sur la base locale | **Corrigé** : P2003 converti en `AppError("Dataset introuvable", 404)` (chaîne déjà traduite) ; test ajouté, les autres erreurs remontent telles quelles. |
| Le runbook de migration décrivait `ops:db-inventory expect` sans les tables, et ne disait pas que `table-not-added` est critique. | conformité | faible | non voté (crédits épuisés) | **Corrigé** : description de l'outil et paragraphe sur les migrations qui créent des tables dans `docs/MIGRATION-RUNBOOK.md`. |
| `compare` ne contrôlait ni les colonnes des tables créées ni les index annoncés mais absents. | conformité ; tests | info | non voté | **Corrigé** : `expectedChanges` lit les colonnes de chaque `CREATE TABLE` (y compris un type énuméré entre guillemets, piège trouvé par le test sur `KeyGrant.status`) ; `compare` signale `column-not-added` sur une table neuve et `index-not-added` en critique ; tests ajoutés. Limite restante (types et `CHECK` d'une table neuve non vérifiés) documentée dans le runbook. |
| GET écrit `lastSeenAt` à chaque lecture, ce que la doc 16 ne disait pas. | conformité | info | non voté | **Corrigé dans la doc** (16 § 1). |
| L'`omit` global du consentement n'était couvert par aucun test. | tests | faible | non voté | **Corrigé** : garde de source dans `src/lib/db.test.ts` sur les quatre clés de l'`omit`. |
| « Entrée du journal des accès invalide » (message passé en paramètre, invisible pour `english.test.ts`) n'était asserté par aucun test. | tests | faible | non voté | **Corrigé** : chaque rejet de `recordDatasetAccess` est vérifié traduit ; la boucle des messages par gabarit l'inclut. |
| Test de débit PATCH au message trompeur, limite GET non exercée. | tests | info | non voté | **Corrigé** : corps invalide après le quota → 429 (prouve l'ordre limiteur puis validation) ; 61ᵉ GET → 429 ; limite par wallet. |
| L'ordre « profil après `verifyChallenge` » n'était pas établi par le test de connexion. | tests | info | non voté | **Corrigé** : un challenge refusé avec signature valide ne touche aucun profil et ne pose aucune session. |
| Périmètre des correctifs (`src/lib/db.ts`, `scripts/operations/*`). | conformité | info | non voté | **Jugé légitime** par le relecteur : petits, testés, dans le couloir « schéma et migrations ». |

Le second passage s'est arrêté pendant la phase de vote et avant son second tour de recherche : les agents contradicteurs ont échoué faute de crédits d'usage (49 agents sur 54). Les suites données ci-dessus reposent sur la reproduction par les relecteurs (chaque défaut porte un script ou une commande exécutée contre la base locale) et sur ma propre vérification avant correction.

**Troisième passage, sur le code final** (quatre relecteurs, mêmes angles, avec la liste des deux premiers passages) :

| Défaut | Angle | Gravité annoncée | Vote (réel / 3) | Suite |
|---|---|---|---|---|
| Dans `updateUserProfile`, la branche « profil absent » faisait `findUnique` puis `create` : si la ligne apparaissait entre les deux (connexion dans un autre onglet, GET du shell), le `create` levait une violation d'unicité (P2002) que `serializableTransaction` ne reprend pas (elle ne couvre que 40001/40P01/P2034), d'où un 500 opaque. Reproduit sur la base locale en insérant la ligne entre la lecture et l'écriture. | sécurité | faible | 0 / 3 sur le code final (déjà corrigé quand les contradicteurs ont voté ; un contradicteur a confirmé le défaut sur `e9ed707`) | **Corrigé** : la création passe par `upsert` (`INSERT … ON CONFLICT`, atomique) ; test de course ajouté (la ligne apparaît après la lecture, l'écriture aboutit, une seule ligne) ; quarante écritures concurrentes sur profil absent (trois PATCH et une connexion par tour, dix tours) sur PostgreSQL : aucun rejet, fusion complète à chaque tour. |
| Le paragraphe ajouté au runbook disait que l'outil d'inventaire ne vérifie pas les colonnes d'une table créée, alors que le même commit ajoutait ce contrôle. | base | faible | 0 / 1 collecté (déjà corrigé par `3dbd044` quand le contradicteur a voté) | **Corrigé** : phrase remplacée par ce que l'outil vérifie réellement (existence, clé primaire, colonnes, index annoncés) et sa vraie limite (types, nullabilité, défauts et `CHECK` d'une table neuve). |
| Plafond global du limiteur de lecture (1 000/min/instance) atteignable avec dix-sept sessions : 429 pour tous les wallets de l'instance pendant la minute. Motif commun du dépôt. | sécurité | info | 0 / 3 (comportement voulu, commun au dépôt, documenté) | **Documenté** dans 16 § 1 : plafonds globaux explicités, à relever si le shell lit le profil à chaque page. |
| `GET /api/profile` (et `PATCH`) sans délai PostgreSQL : une ligne de profil verrouillée par une autre session suspendait chaque GET du wallet sans borne, et cinq GET retenaient tout le pool de l'instance (reproduit : « STILL PENDING après 9002 ms », `dataset.count()` bloqué derrière). Le correctif du second passage ne couvrait que la connexion. | tests | moyenne | non voté (revue arrêtée) ; reproduit sur la base locale par le relecteur et par moi | **Corrigé** : `ensureUserProfileWithin` (transaction courte sous `SET LOCAL lock_timeout`/`statement_timeout` à 5 s) pour GET, mêmes délais en tête de la transaction de PATCH. Une première version faisait ouvrir la transaction par `ensureUserProfile` quand le client le permettait : le client de transaction Prisma expose encore `$transaction` à l'exécution, l'appel s'imbriquait jusqu'à épuiser le pool (découvert à l'essai réel, pas par le test, dont le faux client n'avait pas `$transaction`). Corrigé avant commit, test de non-régression ajouté (une seule transaction même avec un faux client fidèle), vérifié sous verrou réel : échec en 5 s, pool libre. |
| Assertion « la limite est par wallet » tautologique : chaque chargement de la route recréait les limiteurs. | tests | moyenne | non voté | **Corrigé** : session mutable sur une seule instance de route ; le quota épuisé pour un wallet, un autre wallet passe (GET et PATCH) et le premier reste refusé. |
| Bases gelées libérées en fin de corps de test, pas en `finally` : un échec en cascade masquerait la cause. | tests | faible | non voté | **Corrigé** : toute base gelée est enregistrée et libérée en `afterEach`. |
| Filtre mort dans le test de table créée (`column-not-added:Dataset.*`), qui laissait croire à des écarts tolérés. | tests | info | non voté | **Corrigé** : filtre retiré, `ok` vrai et aucun écart assertés, commentaire sur ce que la photo synthétique ne couvre pas. |
| Le runbook affirmait que `prisma migrate deploy` applique chaque fichier en une transaction « tout ou rien » ; démontré faux par le relecteur (fichier dont le second ordre échoue : le premier reste appliqué, migration marquée non terminée). | conformité | moyenne | non voté ; reproduit par le relecteur | **Corrigé** : phrase remplacée par la réalité et la procédure en cas d'échec (constater l'état, nettoyer, `migrate resolve --rolled-back`, relancer). Hypothèse ajoutée en section 6. |
| Les `CHECK` n'étaient couverts par aucun test. | conformité | faible | non voté | **Corrigé** : assertions dans `src/lib/postgres.integration.test.ts` (casse mixte refusée avec le nom de la contrainte, minuscules acceptées, sur les deux tables). La photographie des `CHECK` par l'inventaire est en reste à faire. |
| Docs 16 ne mentionnait pas la contrainte de casse que les scripts et le couloir admin doivent connaître. | conformité | faible | non voté | **Corrigé** : phrases ajoutées en 16 § 1 et § 3. |
| Le message du commit `f515d25` disait « quarante écritures concurrentes sans rejet » ; le relecteur mesure treize à quinze rejets P2034 sur quarante écrivains simultanés avec un pool de cinq. | conformité | info | non voté | **Précisé** : ma mesure portait sur dix tours successifs de quatre écrivains simultanés (quarante écritures, zéro rejet) ; à quarante écrivains simultanés sur la même ligne, un tiers échoue après les reprises. Depuis `eb1b09d`, cet échec répond 409 réessayable ; la fusion atomique en SQL est en reste à faire. |

Le troisième passage a été arrêté pendant la phase de vote : les votes collectés (sept) portaient sur des défauts déjà corrigés par les commits intermédiaires, et chaque constat restant avait été reproduit par son relecteur avec une commande ou un script contre la base locale.

Ce que le troisième passage a vérifié sans trouver de défaut (relecteurs base et sécurité, par exécution) : base neuve, `migrate deploy`, `migrate diff` vide, redéploiement idempotent ; `prisma migrate dev --create-only` sur base jetable produit une migration vide (les `CHECK` ne sont pas vus comme une dérive et sont préservés) ; les deux `CHECK` rejettent la casse EIP-55, une adresse de 41 octets et un retour à la ligne final ; transaction interactive sur une seule connexion (`pg_backend_pid()` identique), `SHOW lock_timeout` à la valeur demandée dans la transaction et 0 hors transaction ; ligne verrouillée par une autre session → touche abandonnée au délai, backend vu en `ROLLBACK` puis idle, aucune ligne fantôme après `ROLLBACK` du détenteur ; `statement_timeout` précède `lock_timeout` à budget égal (erreur 57014, classe `DriverAdapterError` journalisée sans adresse) ; pool de cinq saturé par cinq transactions tenues → les touches reviennent après l'attente maximale de Prisma, compteur en vol libéré ; base « trou noir » → compteur libéré en moins de 3 s ; le plafond en vol ne peut pas être tenu par un attaquant (la seule attente contrôlable est un verrou sur son propre profil, et aucun chemin client ne garde une transaction ouverte) ; `$executeRawUnsafe` ne reçoit qu'un entier calculé par le code ; l'`omit` global n'est contourné par aucun `select` ni `$queryRaw` du dépôt ; pollution de prototype à tous les niveaux → 400 ; bornes exactes 4096/4097 octets et 2048/2049 caractères ; session à adresse non EVM → 400 sans écriture ; `FOREIGN KEY RESTRICT` sans régression ; `postgres.integration.test.ts` et `db-inventory.test.ts` verts sur PostgreSQL ; suite complète 445/445, typage et lint propres.

**Angles morts signalés par les relecteurs, non corrigés** : la fausse base des tests ne modélise ni P2003 ni P2025 (un `recordDatasetAccess` sur un dataset inconnu donne un 500 opaque, observé sur la vraie base : acceptable tant que `datasetId` vient d'un prêt) ; le limiteur GET et les en-têtes `Content-Length` faux ne sont pas testés dans `profile.test.ts` (couverts par `security.test.ts` et vérifiés à la main) ; l'assertion « la plus grande modification légitime passe la borne » compare environ 150 caractères à 2048 et n'apporte presque rien.

**Vérifications relancées après correction** (section 9, colonne « après revue ») : typage, lint, suite complète, tests d'exploitation avec PostgreSQL, test d'intégration PostgreSQL, tests Phala, audit des dépendances, build.

---

## A2 — Composants et textes partagés

Branche `feat/composants-partages`, partie de `staging` (2990a9f). Aucune page existante n'est modifiée : les composants ne sont donc utilisés par aucune page tant que les autres slices ne les branchent pas. Tout ce qui suit décrit du code **non encore exercé en production**.

### 1. Ce qui a changé

Aucune route, table, colonne, migration, contrat ni appel réseau. Uniquement des fichiers sous les chemins autorisés (`git diff --name-only staging...HEAD` : 17 fichiers, tous listés ici).

**Textes communs (`src/lib/copy/`)**
- `disclaimers.ts` : `CONTACT_EMAIL` (`sirius.data.contact@gmail.com`), `DISCLAIMER_IDS`, `DISCLAIMERS` (clé française + variables pour `modelQuality`, `contactUs`, `betaLimits`, `retrainDeterministic`, `dataLimits`), `disclaimerText(id, t)`, `dataLimitsVariables(limites)`, `contactMailtoHref(objet?)`. Les limites sont **lues** : `MAX_DATASET_BYTES` (`src/lib/tee/contract.ts`), `MAX_CSV_ROWS` (`src/lib/sirius/metrics.ts`), `MIN_TRAINING_ROWS` et `MAX_TRAINING_FEATURES` (`src/lib/tee/train.ts`).
- `numbers.ts` : `groupDigits`, `formatCount`, `formatLimitBytes` (séparateur de milliers écrit à la main, pas de `toLocaleString`, pour que serveur et navigateur produisent la même chaîne).

**Composants d'interface (`src/components/ui/`)**
- `DisclaimerNote.tsx` : `<DisclaimerNote variant="info"|"warning" messages={DisclaimerId[]} className>{contenu de page}</DisclaimerNote>`. Par défaut `modelQuality` puis `contactUs`. Le texte de contact devient un lien `mailto:` vers `CONTACT_EMAIL`.
- `StatusPill.tsx` + `status.ts` : `<StatusPill status="online|borrowed|paused|expired|destroyed|pending|failed|refunded" />`. `status.ts` (pur) : `STATUS_KINDS`, `STATUS_META` (clé de libellé + variante de `Badge`), `STATUS_DOT_CLASS`, `isStatusKind`, `statusMeta` (repli « Unknown status » pour une valeur inattendue).
- `safe-href.ts` : `safeInternalHref(valeur)` ne laisse passer qu'un chemin interne (`/…`).
- `shared-components.render.tsx` (+ `shared-components.test.ts`) : script de rendu HTML statique, voir §5.

**Composants de datasets (`src/components/datasets/`)**
- `PriceBreakdown.tsx` + `price.ts` : `<PriceBreakdown providerAtomic computeAtomic token={{symbol, decimals}} minimumAtomic? perspective="neutral|provider|borrower" />`. `price.ts` (pur) : `parseAtomic`, `isValidDecimals`, `formatTokenAmount`, `formatTokenWithSymbol`, `computePriceBreakdown`.
- `DatasetCard.tsx` : `<DatasetCard name category? modelId? modelVersion? rowCount? columnCount? sizeBytes? priceAtomic? priceKind="borrowerPays|providerReceives" token status borrowCount revenueAtomic? verified? href? />` et `<DatasetAddTile href />` (tuile « + Publier un dataset »).

**Traductions**
- `src/lib/i18n/shared-en.ts` (nouveau) : traductions anglaises, fusionnées dans `EN_MESSAGES` par `src/lib/i18n/english.ts` (+2 lignes : un import et un `...SHARED_MESSAGES_EN`). Clés déjà existantes réutilisées, non redéfinies : « En attente », « Profil absent », « {count} lignes », « {count} colonnes ».

**Tests et script**
- `package.json` : 4 fichiers ajoutés à la fin du script `test` (`disclaimers.test.ts`, `price.test.ts`, `status.test.ts`, `shared-components.test.ts`). Aucune autre ligne touchée.

### 2. Décisions et écarts par rapport au cahier des charges

1. **Constantes importées là où elles sont, rien déplacé.** La consigne ne prévoit un déplacement que si un module est réservé au serveur. Vérifié : `contract.ts` n'a que des `import type`, `metrics.ts` n'a aucun import, `train.ts` n'importe que `registry.ts` (viem) et `metrics.ts`, aucun des trois n'atteint `server-only`, un module Node ou la base. Je n'ai de toute façon pas le droit de modifier `src/lib/tee/` ni `src/lib/sirius/`. Le test d'égalité prévu en cas de déplacement est remplacé par les tests décrits en §5.
2. **Coût de `train.ts` côté client.** Importer `train.ts` pour deux constantes embarque en théorie le code d'entraînement. Mesuré par un relecteur : tree-shaké, `train.ts` pèse 21 octets ; sans tree-shaking, 5,2 Ko minifiés. `process.env` et `performance.now()` n'apparaissent que dans des corps de fonction, jamais à l'évaluation du module. Extraire les deux constantes dans un module minuscule serait plus propre mais sort du périmètre.
3. **Texte `dataLimits` conservé mot pour mot, alors qu'il est optimiste (écart connu, voir §7).** Le propriétaire impose le texte de `16-socle-technique.md`. Je ne l'ai pas modifié et je le signale.
4. **Clés de traduction françaises, texte anglais identique à `16`.** Les cinq textes anglais sont ceux du tableau de la section 4, au mot près (test d'égalité exacte). `contactUs` utilise un paramètre `{email}` pour pouvoir en faire un lien.
5. **Fichier de traduction séparé** (`shared-en.ts`) au lieu d'ajouter des lignes à `english.ts`, pour limiter les conflits de fusion avec les autres slices qui complètent `english.ts`. Même mécanisme que `errors-en.ts` et `phala-en.ts`. Conséquence : l'objet est fusionné par *spread*, le dernier gagne, donc une clé identique ajoutée plus tard dans `english.ts` avec une autre traduction écraserait silencieusement la nôtre. Aucune collision aujourd'hui (vérifié par script), aucun garde-fou automatique.
6. **« MB » = Mio.** `formatLimitBytes` affiche 3 × 1024 × 1024 octets comme « 3 MB » (comme `formatBytes` existant et comme le texte de `16`). Un reste est tronqué, jamais arrondi vers le haut (2,99 Mio donne « 2.9 MB »).
7. **Formateur de montants propre à la slice, pas `formatUsdcAtomic`.** `formatUsdcAtomic` dépend de `USDC_DECIMALS` global (lu dans l'environnement, avec une exception au chargement du module si hors bornes) et supprime les zéros finaux ; or le composant reçoit les décimales en paramètre et le cahier montre « 20,00 ». J'ai réutilisé `formatUnits` de viem (déjà utilisé dans `train/page.tsx`, `ComputeQuoteDialog.tsx`), puis : au moins deux décimales (« 20.00 »), toutes les décimales significatives sinon, milliers séparés par des virgules, jamais d'arrondi. Un test vérifie l'accord numérique avec `formatUsdcAtomic`. Écart par rapport à « utilise les helpers existants » : partiel, justifié ci-dessus.
8. **Jeton passé en paramètre, sans valeur par défaut.** `token={{ symbol, decimals }}` est obligatoire pour `PriceBreakdown` et `DatasetCard`. Le site écrit « USDC » en dur partout ; le mainnet doit afficher « MUSD » (`01-decisions-avant-samedi.md`). Forcer l'appelant à choisir évite d'afficher le mauvais jeton ou de mauvaises décimales (6 sur mainnet, 18 sur le testnet, `USDC_DECIMALS_BY_NETWORK`). Il n'existe pas encore de fabrique centrale du jeton : chaque page devra le construire correctement.
9. **Bornes des montants.** `parseAtomic` n'accepte que `0` ou un entier décimal sans zéro de tête, au plus 29 chiffres et au plus 2⁹⁶−1 (borne uint96 de `quote.ts`) ; le total aussi. Décimales : entier de 0 à 36. Tout le reste donne « — » plus une alerte, jamais une exception ni un montant approché.
10. **Le minimum porte sur la part du fournisseur** (hypothèse, voir §6). `belowMinimum` est vrai si la part du fournisseur est strictement inférieure au minimum ; un minimum nul est accepté.
11. **Perspectives de `PriceBreakdown`.** Par défaut les libellés du cahier (« Provider receives / Compute fee (Phala enclave) / Borrower pays »). `perspective="provider"` donne « You receive », `"borrower"` donne « You pay ».
12. **Ajouts à `DatasetCard` au-delà de la liste du cahier :** `sizeBytes` (la fiche 06 demande « taille et nombre de lignes »), `priceKind` (prix payé par l'emprunteur ou gain du fournisseur), `verified` à trois états (`true` : badge « KYB-verified provider » ; `false` : « Provider not KYB-verified » ; absent : rien), `href` (chemin interne seulement), repli « Untitled dataset » pour un nom vide. Le badge dit « KYB » exprès : il atteste le fournisseur, pas la qualité de la donnée ni du modèle.
13. **Pas de dérivation d'état depuis la base.** `StatusPill` ne reçoit qu'un `StatusKind` déjà calculé. Les champs `listingStatus` / `listingExpiresAt` n'existent pas encore dans `prisma/schema.prisma` (slice A1). Le pont `DatasetStatus` / `LoanStatus` → `StatusKind` est à écrire par les pages.
14. **Test de rendu dans un processus enfant.** `pnpm test` lance tout avec `--conditions=react-server`, condition sous laquelle React n'expose ni contexte ni `react-dom/server`. `shared-components.test.ts` lance donc `shared-components.render.tsx` dans un processus sans cette condition (`NODE_OPTIONS` vidé) et vérifie le HTML. Effet de bord utile : les composants se chargent sans le contournement `server-only`.
15. **Identité des commits.** L'identité git globale de l'environnement est celle de l'assistant ; pour respecter « aucune signature d'assistant », l'auteur et le committeur de la branche sont réglés **localement** (`git config --local`) sur l'identité du propriétaire déjà présente dans l'historique (`alibenyezza <149864846+alibenyezza@users.noreply.github.com>`). `.claude/`, `CLAUDE.md` et `AGENTS.md` sont exclus par `.git/info/exclude` (local, non versionné). Les worktrees jetables de la revue avaient été capturés par erreur par un `git add -A` ; retirés avant tout push (jamais présents dans l'historique publié).
16. **Pas d'accord de pluriel** : « 1 rows » reste possible, comme avec les clés existantes `{count} lignes`. Un jeu de données publiable a au moins 100 lignes, donc le cas ne se présente pas pour les lignes.

### 3. Ce que l'audit doit vérifier

- **Contrôle d'accès côté serveur.** Aucune route ni accès serveur dans cette slice. Rien à vérifier route par route. Rappel : aucun contrôle d'accès ne doit reposer sur l'affichage de `verified` ou de `StatusPill` : ce sont des affichages, pas des gardes.
- **Validation et bornes des entrées.** `parseAtomic`, `isValidDecimals`, `safeInternalHref`, `statusMeta`, `modelSelection` (profil inconnu ou version inconnue → « Profil absent », jamais un profil valide), `formatCount`, `sizeBytes` (entier sûr strictement positif sinon « — »), `contactMailtoHref`. Relire les expressions régulières : `parseAtomic` est ancrée (rejette 10 millions de caractères en moins de 10 ms) ; `groupDigits` est quadratique mais ne reçoit que des chaînes de moins de 30 chiffres.
- **Aucun HTML injecté.** Rechercher `dangerouslySetInnerHTML`, `innerHTML`, `target="_blank"` dans la slice : aucun. Le texte traduit est coupé autour de l'adresse de contact et rendu par React (échappé) ; seule la constante `CONTACT_EMAIL` devient un lien. Nom, catégorie, symbole du jeton et `children` hostiles (`<img onerror>`, `"`) sont échappés (tests de rendu). Les attributs `data-status`, `data-variant`, `data-disabled` sont normalisés ou constants.
- **Liens `mailto:` sûrs.** `mailto:` + adresse constante ; l'objet éventuel passe par `encodeURIComponent` après remplacement des contrôles (C0, DEL, C1) par une espace et des substituts UTF-16 isolés par U+FFFD, coupure à 200 points de code. Un objet hostile (`\r\nBcc:`, `&cc=`, `?body=`) ne produit que le paramètre `subject`. Aucun composant de la slice ne passe d'objet aujourd'hui (`DisclaimerNote` appelle `contactMailtoHref()` sans argument). Relire l'appelant futur qui en passerait un.
- **Liens internes.** `DatasetCard` et `DatasetAddTile` refusent tout `href` qui n'est pas un chemin interne (`javascript:`, `https://`, `//hôte`, `/\hôte`, espaces, contrôles, plus de 2048 caractères). Un fuzz de 400 000 chaînes hostiles par un relecteur n'a trouvé aucun contournement.
- **Montants exacts, sans arrondi trompeur.** Tout est en `bigint`. Vérifier : `computePriceBreakdown` (total = somme exacte, au-delà de 2⁵³), `formatTokenAmount` (6 et 18 décimales, 1 unité atomique, zéro, plus grand uint96), « — » + alerte pour toute entrée invalide, jamais « 0 ». Un relecteur a comparé `formatTokenAmount` à une référence indépendante sur 200 000 tirages (décimales 0 à 36) : aucun écart.
- **Cohérence des textes avec les constantes.** `DISCLAIMERS` ne contient aucun littéral numérique (test AST) ; la clé `dataLimits` ne contient aucun chiffre. Si une constante change, le texte suit. Vérifier à la main après tout changement des quatre constantes que « CSV up to … » reste vrai (voir §7).
- **Aucune promesse fausse sur les modèles.** `modelQuality` : « baseline models: linear and logistic regression… Results depend on the data. New models are in development. » `retrainDeterministic` : vrai tant que `train.ts` n'introduit ni aléa ni dépendance à l'ordre des lignes (aucun `Math.random`, `crypto` ou tri dans `train.ts` aujourd'hui) ; le déterminisme est celui d'un même moteur numérique et d'un même ordre de lignes. Le badge « KYB-verified provider » ne dit rien de la donnée. **Réserve majeure : `dataLimits`, voir §7.**
- **Impact sur l'argent, l'escrow, les contrats, Phala.** Aucun : pas de transaction, pas de signature, pas de lecture de contrat. Ces composants **affichent** des montants fournis par l'appelant ; un montant faux fourni à `PriceBreakdown` s'affichera tel quel. L'exactitude de la décomposition affichée par rapport au devis réellement signé (`datasetAmount`, `computeAmount`, `maxFailureFee`, `tariffVersion`) doit être vérifiée **page par page** par l'audit des slices qui branchent le composant.
- **Fuites vers le bundle client.** Aucun `server-only`, module Node, `pg`, `prisma`, `better-sqlite3`, `@phala` atteignable depuis les modules de la slice (test du graphe d'imports + bundle navigateur esbuild vérifié par un relecteur : 162 Ko minifiés pour toute la page de test, dont 2,2 Ko pour `shared-en`).
- **Base de données.** Aucune.
- **Traductions.** Aucune clé française sans traduction (tests), paramètres `{…}` conservés. Collisions : voir §2.5.
- **Signatures d'assistant.** `git log staging..HEAD --format=%B` : aucune ligne `Co-Authored-By`, `Claude-Session`, lien claude.ai, « Generated with ». Vérifier aussi l'auteur des commits (§2.15).

### 4. Cas limites à essayer à la main sur staging

Les composants ne sont montés par aucune page à ce stade : ces essais valent **après branchement** par les slices pages. Les cas de rendu automatiques (HTML) sont dans `shared-components.render.tsx`.

1. **Décomposition 20 + 3.** Fournisseur 20 000 000 (18 décimales), calcul 3 000 000 → « 20.00 / 3.00 / 23.00 » avec le bon symbole. Sur le testnet (18 décimales), 20 × 10¹⁸ et 3 × 10¹⁸ → les mêmes affichages, sans décalage.
2. **Un cent atomique.** Montant 1 (18 décimales) → « 0.000001 », pas « 0.00 » ni « 0 ».
3. **Sous le minimum.** Part du fournisseur = minimum − 1 → texte rouge « Below the minimum set by the tariff… » et annonce par un lecteur d'écran ; égale au minimum → pas d'alerte. Minimum 0 → « Minimum set by the tariff: 0.00 … ».
4. **Montant invalide** (champ vide, `12.5`, `-1`, `1e6`, plus grand que 2⁹⁶−1) → trois « — » et une alerte « Amount unavailable », jamais de montant partiel.
5. **Très grand montant, écran 320 px** : pas de défilement horizontal, le montant passe à la ligne et reste aligné à droite.
6. **Encart.** Cliquer le lien de contact → le client de messagerie s'ouvre avec uniquement `sirius.data.contact@gmail.com` en destinataire. Variante `warning` : lisible, icône décorative non annoncée.
7. **Pastilles.** Les huit états s'affichent avec leur libellé ; un état venu de l'API que la page ne sait pas convertir doit être traité avant le composant (le composant affiche « Unknown status » en repli).
8. **Carte, clavier.** Tab : un seul arrêt par carte (le titre), anneau de focus visible, Entrée ouvre la fiche. Clic n'importe où sur la carte ouvre la fiche. Mode contraste forcé de Windows : le focus reste visible.
9. **Carte, contenus hostiles.** Nom de dataset `<img src=x onerror=alert(1)>`, nom de 300 caractères sans espace, nom vide, catégorie vide, version de modèle inconnue (`9.9.9`) → « Missing profile », prix `null` → « — », 0 emprunt, sizeBytes négatif → « — ». Aucun script exécuté, aucune mise en page cassée.
10. **Tuile d'ajout.** Mène à l'upload ; avec un `href` non sûr, elle s'affiche sans lien.
11. **Hydratation.** Charger une page avec des nombres de 5 chiffres et des montants, navigateur en français : pas d'avertissement d'hydratation, pas de « 12 345 » (séparateur uniquement la virgule).
12. **Traduction.** Chaque texte visible est en anglais ; aucune clé française ne s'affiche.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

Ajoutés (62 tests de plus que la ligne de base de `staging` : 429 → 491) :
- `src/lib/copy/disclaimers.test.ts` : textes anglais exacts (cahier §4), email, traduction et paramètres résolus, `dataLimits` recalculé indépendamment depuis les constantes et avec d'autres limites, absence de chiffre dans les clés et de littéral numérique dans `DISCLAIMERS` (AST), formatage (milliers, troncature, valeurs invalides), `mailto` (encodage, injection d'en-têtes, substituts isolés, bornes exactes D800–DFFF, contrôles, longueur), **graphe d'imports** de tous les modules de la slice (aucun `server-only`, module Node, `pg`, prisma, `@phala` atteignable, et les trois sources de constantes sont bien dans le graphe).
- `src/components/datasets/price.test.ts` : exemple 20 + 3, aucun arrondi, 0 / milliers / décimales 0–2 / 18 décimales, uint96 (valeur maximale, total à la borne, au-delà de 2⁵³), somme exacte, accord avec `formatUsdcAtomic`, minimum (égalité, nul, null), entrées invalides rejouées pour chaque champ.
- `src/components/ui/status.test.ts` : table complète des huit états (libellé, variante, point), traductions distinctes, repli pour `constructor`, `__proto__`, etc., liens internes sûrs et refusés.
- `src/components/ui/shared-components.test.ts` : HTML réel des composants dans un processus sans `react-server` : un seul lien `mailto`, échappement, couleurs exactes du point et de la bordure de chaque état, perspectives, 18 décimales, minimum nul et sous le minimum, entrées invalides, plus grand montant, carte complète / minimale / hostile / sans nom / profil inconnu / taille invalide / lien étiré, tuile, identifiants de titre distincts, identifiant d'encart répété.

Mutations jouées par moi, toutes détectées après correction des tests : point de pastille constant, repli « 0 » d'un montant invalide, limite codée en dur dans `disclaimers.ts`, garde du montant de calcul retirée, test de minimum falsy, version de modèle figée à « 1.0.0 ».

**Angles morts connus :**
- Aucun test en navigateur réel dans la suite (pas de Playwright pour ces composants) : focus, contraste, retour à la ligne, hydratation et rendu à 320–1280 px n'ont été vérifiés qu'**une fois**, à la main, par un relecteur dans un worktree jetable (`next dev` + page de prévisualisation supprimée, captures à 320, 360, 768 et 1280 px, aucun défilement horizontal, aucun avertissement d'hydratation, focus clavier observé). Rien de cela n'est rejouable depuis le dépôt.
- Les tests de rendu comparent du HTML par expressions régulières : ils ne détecteraient pas une classe Tailwind absente de la feuille de style générée.
- Le test AST de `DISCLAIMERS` détecte les littéraux numériques, pas des limites recopiées en chaînes de caractères.
- `next build` complet n'a pas été exécuté sur les composants : aucune page ne les importe, donc il ne les compilerait pas. Un relecteur n'a pas pu le faire dans son worktree (erreurs d'environnement Turbopack étrangères à la slice) ; il a compilé un bundle navigateur avec esbuild à la place.
- Pas de test d'accessibilité automatisé (axe) ni de lecteur d'écran.
- Les modèles et textes anglais de `07` et `08` (encarts de l'upload et de la marketplace) diffèrent de la source unique de `16` ; aucun test ne le contrôle, voir §7.
- Le test de rendu dépend de `tsx` lancé depuis la racine du dépôt (`cwd` fixé) ; il a été vérifié depuis d'autres répertoires de travail et sans variables d'environnement.

### 6. Hypothèses

- Le « minimum imposé par le tarif » (`07-upload.md`) s'applique à ce que reçoit le fournisseur. Dans le code actuel `MIN_PRICE_USDC_ATOMIC` (0,001) est un plancher de prix et `quote.ts` exige un total au moins égal à 10^(décimales−3). Si le minimum du tarif porte sur le total ou sur les frais de calcul, la page appelante doit passer le bon montant ; le composant ne le sait pas.
- Les montants fournis par les pages sont déjà en unités atomiques, décimales lues sur le contrat du réseau (6 sur mainnet pour le MUSD, « annoncé », **à confirmer on-chain** selon `01`).
- `verified` provient du registre KYB on-chain ; la slice ne le vérifie pas.
- `MAX_CSV_ROWS`, `MIN_TRAINING_ROWS`, `MAX_TRAINING_FEATURES` et `MAX_DATASET_BYTES` restent des constantes statiques lisibles dans un bundle client (aucun passage à une lecture d'environnement).
- Le texte « retraining on the same data gives the same model » suppose un même moteur numérique et un même ordre de lignes ; non testé à travers des versions de Node ou de plateformes différentes.
- « Beta: invitation-only access, capped amounts per loan and in total » est une affirmation de fonctionnement (accès sur invitation, plafonds) que la slice ne vérifie pas ; elle suppose que les plafonds par prêt et au total existent bien au lancement.
- L'adresse `sirius.data.contact@gmail.com` est donnée par le cahier ; elle n'a pas été vérifiée (boîte active, redirection).
- L'interface reste en anglais seul (`LocaleProvider` fixe `locale = "en"`).

### 7. Risques résiduels et limites connues

1. **`dataLimits` est plus optimiste que le code (promesse fausse possible).** Texte : « CSV up to 3 MB, 100 to 20,000 rows, numeric columns, up to 31 input features. » Vérifié par exécution de `validateTrainingDataset` :
   - minimum de lignes = max(100, 10 × (variables + 1)) : avec 31 variables il faut **320** lignes (319 refusées, 320 acceptées) ; avec 1 variable, 100 ;
   - plafond de lignes : 20 000 lignes **de données** sont refusées (« trop de lignes CSV (max 20000) »), le maximum accepté est 19 999 ;
   - budget de calcul (`MAX_TRAINING_OPERATIONS` = 20 000 000) : régression logistique à 31 variables, **3 125** lignes acceptées et 3 126 refusées ; régression linéaire à 31 variables, 19 531 acceptées et 19 532 refusées. Un CSV de 20 000 lignes avec 31 variables n'est donc jamais entraînable en logistique.
   Un fournisseur peut lire ce texte, déposer un fichier « dans les limites » et se voir refuser le fichier ou l'entraînement. Décision à prendre par le propriétaire : reformuler (par exemple en citant le minimum de lignes par variable et le budget de calcul) ou accepter l'écart. Les composants lisent déjà les constantes ; seule la clé de `dataLimits` changerait.
2. **Textes 07 et 08 non alignés sur 16.** Les encarts cités dans `07-upload.md` et `08-marketplace.md` sont des variantes plus longues de `modelQuality` + `contactUs`. Les composants suivent `16` (source unique). Si les pages veulent la variante de 07/08, elles doivent l'ajouter à `disclaimers.ts` plutôt que la recopier.
3. **« Provider receives » vrai seulement en cas de règlement.** La décomposition affiche ce que le fournisseur reçoit si le prêt est réglé ; en cas d'échec seul le calcul consommé est retenu et le reste est remboursé (`08`, « ce qui se passe en cas d'échec »). Cette mention n'est volontairement pas dans le composant ; la fiche marketplace doit l'afficher à côté.
4. **Jeton en dur sur le site.** Tant que les pages affichent « USDC » en dur, l'affichage mainnet (MUSD) dépend entièrement de chaque intégrateur. Aucune fabrique centrale.
5. **États de la carte sans pont.** Une page qui passerait un état erroné (par exemple « En ligne » pour un dataset expiré) afficherait faux : le composant n'a pas de source de vérité.
6. **Cartes hors liste.** `DatasetCard` rend un `article` ; la mosaïque doit être enveloppée dans une liste (`ul`/`li`) par la page pour l'accessibilité.
7. **Clés de traduction.** Fusion par *spread* sans détection de collision (§2.5). Clés au vouvoiement (« Contactez-nous ») alors que le reste de l'interface tutoie (« Colle le code… ») : sans effet visible (interface anglaise), mais à harmoniser si le français revient.
8. **Troncature du nom à deux lignes** avec le nom complet dans `title` : sur tactile, le nom complet n'est pas accessible depuis la carte.
9. **Dépendance du test de rendu** à un processus enfant : si `tsx` ou `--import` change de comportement, le test échoue bruyamment (jamais silencieusement).
10. **`pnpm audit:deps`** signale 2 vulnérabilités (1 faible, 1 haute, 1 ignorée), **identiques à `staging` avant ma branche** ; non traitées ici.

### 8. Reste à faire

- **P0** : décision du propriétaire sur le texte `dataLimits` (§7.1).
- **P0** : les slices pages (Mes datasets, upload, marketplace, train, dashboard, tutos) doivent brancher les composants, passer `token` correct (MUSD, décimales on-chain) et vérifier la décomposition affichée contre le devis.
- **P1** : fabrique unique du jeton (symbole + décimales par réseau) et pont `DatasetStatus` / `LoanStatus` / `listingStatus` → `StatusKind` testé.
- **P1** : texte de mention d'échec/remboursement à côté de la décomposition, côté marketplace.
- **P1** : test navigateur (Playwright) d'une page réelle utilisant les composants : focus, mobile, contraste forcé.
- **P2** : extraire les deux constantes de `train.ts` dans un module sans dépendance si le bundle client devient un sujet ; garde-fou de collision des clés de traduction ; enveloppe `ul`/`li` fournie par un composant de grille ; accessibilité automatisée (axe).

### 9. Résultats des vérifications

Environnement : Node v22.22.0, pnpm 11.18.0. `DATABASE_URL=postgresql://x:y@localhost:5432/z` (factice) exportée.

| Commande | Résultat exact |
|---|---|
| `pnpm install --frozen-lockfile` (sans `DATABASE_URL`) | **échec, exit 1** : le `postinstall` `prisma generate` lève `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. Cause : environnement, sans rapport avec la slice. |
| `pnpm install --frozen-lockfile` (avec `DATABASE_URL` factice) | `Already up to date`, `Prisma Client (7.8.0) généré`, exit 0 |
| `pnpm exec tsc --noEmit` | aucune sortie, exit 0 |
| `pnpm lint` | `eslint`, aucune sortie, exit 0 (vérifié sans worktree jetable dans `.claude/`) |
| `pnpm test` | `tests 491`, `pass 491`, `fail 0`, exit 0 (`staging` avant ma branche : 429 tests, 429 réussis) |
| `pnpm audit:deps` | `2 vulnerabilities found — Severity: 1 low | 1 high (1 ignored)`, exit 0 ; résultat identique avant ma branche |
| `git diff --name-only staging...HEAD` | 17 fichiers, tous dans les chemins autorisés (liste en §1) |
| `git log staging..HEAD --format=%B` | aucune signature d'assistant (recherche de `co-authored`, `claude`, `anthropic`, `generated`, `session`, `skip ci` : aucune occurrence) |

Non exécuté : `pnpm build` / `next build` (aucune page ne consomme les composants), tests e2e Playwright, tests de contrats.

Vérifications ponctuelles (hors suite) : exécution de `validateTrainingDataset` pour les limites de §7.1 ; recherche de collisions de clés entre `shared-en.ts`, `english.ts`, `errors-en.ts`, `phala-en.ts` (aucune) ; bundle navigateur esbuild par un relecteur.

### 10. Revue interne de la session

Méthode : cinq passes de revue adversariale, chacune avec six relecteurs indépendants aux angles différents (sécurité et injection ; exactitude des montants et des textes ; tests et cas limites avec **test de mutation** dans un worktree isolé ; accessibilité et rendu réel ; build et bundle client ; périmètre et conformité ; mécanisme de traduction et style), puis deux sceptiques par constat (l'un cherche à le reproduire, l'autre à le réfuter) ; un constat n'est retenu que si les deux le jugent réel. Soit 215 agents.

| Passe | Constats retenus | Écartés |
|---|---|---|
| 1 | 13 entrées (environ 8 problèmes distincts) | 25 |
| 2 | 2 | 23 |
| 3 | 2 | 7 |
| 4 | 3 | 11 |
| 5 | **0** | 4 |

**Retenus et corrigés :**
- `contactMailtoHref` levait une `URIError` sur un substitut UTF-16 isolé ou un emoji coupé à 200 unités (trouvé par deux angles) → coupure par points de code, substituts remplacés par U+FFFD, tests des bornes exactes.
- `DatasetCard` n'affichait pas la taille du fichier exigée par `06-mes-datasets.md` (trouvé par trois angles) → prop `sizeBytes`, valide seulement si entier sûr > 0, sinon « — ».
- Aucun indicateur de focus en mode contraste forcé sur la carte → `outline-hidden` à la place de `outline-none`.
- Montant aligné à gauche après retour à la ligne sur mobile ; très grands montants sans `wrap-anywhere` → `ml-auto text-right` et `wrap-anywhere`.
- Nom vide donnant un lien sans nom accessible → « Untitled dataset ».
- Variante inconnue de `DisclaimerNote` qui plantait ; identifiant répété affiché deux fois avec clés React dupliquées → repli sur `info`, dédoublonnage.
- `formatLimitBytes` affichait « 0 KB » sous 1 Ko ; helper de montant dupliqué (`formatTokenWithSymbol` inutilisé) → corrigés.
- Mutations survivantes dans les tests, corrigées une à une et rejouées : couleur du point de pastille (la sous-chaîne `bg-positive` était déjà dans le badge), repli « 0 » d'un montant invalide, limite codée en dur dans `disclaimers.ts`, garde sur les frais de calcul, minimum nul traité comme faux, `modelVersion` figé, états de carte, jeton à 18 décimales, bornes uint96, bornes D800–DFFF.
- Section A2 d'`audit.md` vide : remplie par ce texte.

**Écartés avec la raison :**
- `dataLimits` optimiste (trouvé par trois angles, les sceptiques divisés) : texte imposé mot pour mot par le propriétaire ; **consigné en §7.1 et dans la PR, non corrigé**.
- « Le plafond de 20 000 lignes est en réalité 19 999 » et « le budget de calcul n'est pas cité » : même sujet, regroupés en §7.1.
- Pluriels « 1 rows », vouvoiement des clés françaises, « Borrows » contre « Loan » : conventions existantes ou goût (§7.7).
- Absence de `ul`/`li` autour des cartes : rôle de la page (§7.6).
- `priceKind` par défaut `borrowerPays`, jeton sans fabrique, formateur à deux décimales, train.ts dans le bundle : choix documentés (§2) ou hors périmètre.
- Pas de pont `DatasetStatus` → `StatusKind`, pas d'état « en attente de saisie » pour `PriceBreakdown`, `revenueAtomic` absent contre `null` : rôle des pages ; précisions de documentation ajoutées.
- `role="alert"` sur les messages de `PriceBreakdown` : voulu pour une saisie en direct.
- Tuile inactive sans rôle, `aria-disabled` : attribut retiré (sans sens sur un `div`), pas de rôle ajouté.
- Textes 07/08 différents de 16 : 16 est la source unique (§7.2).
- Plusieurs mutations de style mineures (couleurs d'avertissement, `aria-hidden` du pictogramme, bornes 2048 de `safeInternalHref`, ordre par défaut) : coût de test disproportionné.
- `groupDigits` quadratique : entrée bornée à moins de 30 chiffres.
- Collisions de la ligne `test` de `package.json` avec d'autres slices : à résoudre à la fusion.

**Passe 5, sans constat retenu.** Les relecteurs ont, entre autres : fuzzé `safeInternalHref` sur 400 000 chaînes ; comparé `formatTokenAmount` et `formatLimitBytes` à des références indépendantes sur 200 000 tirages chacun ; rejoué environ 190 mutations ; vérifié le rendu réel dans Chromium (`next dev`, page de prévisualisation supprimée) à 320, 360, 768 et 1280 px, au clavier, avec espacement de texte WCAG et police à 200 % ; compilé un bundle navigateur (esbuild) et exécuté le rendu dans un contexte sans `Buffer`.

**Limite de la revue :** elle n'a pas pu lancer `next build` sur le dépôt (erreurs d'environnement Turbopack sans rapport avec la slice dans les worktrees jetables). Les constats écartés l'ont été sur avis de deux sceptiques IA, pas d'une relecture humaine.

---

## A3 — Tutos de première connexion et par page

> Mise à jour (octobre 2026) : les fichiers de cette section (`src/components/tour/`, `src/components/layout/ProductTour.tsx`, `src/lib/tour/`, `src/lib/i18n/tour-en.ts`) ont été supprimés et remplacés par le guide Sirio (`src/lib/guide/`, `src/components/guide/`), qui garde l'état vu par page dans `settings.guide.pages`. La marque e2e `sirius-tour-seen` n'existe plus. Ce qui suit décrit l'état d'origine.

Branche `feat/tutos`, partie de `staging` (e829cfc) puis rebasée sur `staging` (2f6ae81, journal des accès) ; seul conflit, la ligne du script `test` de `package.json`, résolu en gardant les deux ajouts. Aucune page n'est modifiée : le tuto de chaque page est monté depuis le layout de l'application selon le chemin courant. Aucune route, table, colonne, migration, contrat ni transaction : la slice lit et écrit le profil uniquement par la route `/api/profile` livrée par A1.

### 1. Ce qui a changé

`git diff --name-only staging...HEAD` : 16 fichiers, tous listés ici (dont ce fichier d'audit, section A3 seulement).

**Logique, sans React (`src/lib/tour/`)**
- `keys.ts` : `TOUR_PAGE_KEYS` (copie de `FEATURE_TOUR_KEYS` de `src/lib/users/profile.ts`, non importable côté navigateur à cause de `server-only` ; un test vérifie l'égalité), `isTourPageKey`, `tourKeyForPath(chemin)`. Correspondance exacte : `/dashboard` → `dashboard`, `/datasets` → `datasets`, `/datasets/new` → `upload`, `/marketplace`, `/train`, `/explorer`, `/wallet`. Une barre finale est tolérée ; tout autre chemin (fiches `/datasets/abc`, `/borrow`, `/phala`, `/provider`, chemins de plus de 256 caractères) n'a pas de tuto.
- `progress.ts` : lecture et écriture de la progression. `parseTourProgress(corps, adresse)` exige la forme exacte de la réponse de `GET /api/profile` (adresse égale au wallet affiché, `tourCompletedAt` présent, `featureTours` objet) ; toute autre réponse vaut « inconnue ». `fetchTourProgress` (GET), `saveTourProgress(patch, adresse)` (PATCH, confirmé seulement si la réponse est 2xx **et** porte le profil du wallet attendu), `tourPatchBody` (n'envoie que des `true`, jamais de modification vide), note locale de repli `readPending` / `writePending` / `reconcilePending`, décisions `isWelcomeDone` / `isPageSeen`, neutralisation e2e `toursSuppressedForE2e`. Aucune fonction ne lève.
- `controller.ts` : `TourController`, orchestrateur unique sans React (abonnement compatible `useSyncExternalStore`). Il tient le wallet suivi, la progression lue, le chemin courant et l'unique tuto ouvert (`active`). Méthodes : `start`, `setIdentity(adresse, authentifié)`, `setPath`, `leavePages`, `restartWelcome`, `openPage`, `close`.
- `content.ts` : textes des six étapes d'accueil (`WELCOME_STEPS`), des sept tutos de page (`PAGE_TOURS`) et libellés (`TOUR_UI`). Clés françaises traduites par `t()`. Les limites des modèles, de la bêta et des données ne sont jamais réécrites : ce sont des identifiants de `src/lib/copy/disclaimers.ts` (A2), affichés par `DisclaimerNote`.
- `tour.test.ts` : tests unitaires, voir §5.

**Interface (`src/components/tour/`, `src/components/layout/ProductTour.tsx`)**
- `TourDialog.tsx` : fenêtre modale commune (`role="dialog"`, `aria-modal`, `aria-labelledby` sur le titre, `aria-describedby` sur tout le contenu de l'étape), étapes, Précédent / Suivant / Passer / Compris, piège du focus, Échap, retour du focus, reste de l'application rendu `inert` pendant l'ouverture, `z-[60]`, défilement interne (`max-h-[calc(100dvh-2rem)]`, `overscroll-contain`).
- `PageTour.tsx` : monté une fois dans le layout ; transmet le chemin (`usePathname`) au contrôleur, affiche le tuto de la page et le bouton « ? » discret (fixe, en bas à droite, `z-20`, `aria-label` « Show this page's guide »). `leavePages()` au démontage.
- `tour-store.ts` : instance unique du contrôleur pour l'onglet, `useTourSnapshot()`, et les deux fonctions exportées `restartWelcomeTour()` (à brancher sur « Visite guidée » du menu profil, slice A5) et `openPageTour(clé)`.
- `ProductTour.tsx` (réécrit) : transmet au contrôleur l'adresse et l'état `connected && authenticated` du store wallet, affiche le tuto d'accueil. Réexporte `restartWelcomeTour`. L'ancien appel à `/api/account/status` et le marqueur `localStorage` `sirius-tour-seen` ne sont plus utilisés en production.
- `tour-dialog.render.tsx` + `tour-dialog.test.ts` : rendu HTML statique dans un processus sans la condition `react-server`, comme `shared-components.test.ts` (A2).

**Montage** : `src/app/(app)/layout.tsx`, +2 lignes (un import, `<PageTour />` juste après `<ProductTour />`).

**Traductions** : `src/lib/i18n/tour-en.ts` (nouveau, 29 clés), fusionné dans `EN_MESSAGES` par `src/lib/i18n/english.ts` (+2 lignes : import et `...TOUR_MESSAGES_EN`). Clés existantes réutilisées sans redéfinition : « Bienvenue sur Sirius », « Tableau de bord », « Mes datasets », « Publier un dataset », « Entraîner un modèle », « Explorer », « Étape {current} / {total} », « Passer », « Précédent », « Suivant », « Commencer ».

**Script** : `package.json`, deux fichiers ajoutés à la fin du script `test` (`src/lib/tour/tour.test.ts`, `src/components/tour/tour-dialog.test.ts`). Aucune autre ligne touchée.

### 2. Décisions et écarts par rapport au cahier des charges

1. **Un seul orchestrateur pour les deux sortes de tutos.** Le tuto d'accueil et le tuto de page partagent la même lecture du profil et le même état « tuto ouvert » : deux fenêtres ne peuvent pas s'empiler. Le tuto d'accueil passe d'abord ; la page sur laquelle il s'ouvre garde son propre tuto pour la visite suivante (pas deux fenêtres enchaînées). Dès la page suivante, son tuto s'ouvre.
2. **Quand le tuto d'accueil s'ouvre.** À la première page de l'application visitée avec un wallet connecté **et** une session signée (`authenticated` du store), si `tourCompletedAt` est nul en base. Écart avec l'ancien comportement : l'ancien tuto ne s'ouvrait que pour un compte sans activité (`/api/account/status` → `known: false`) et respectait `sirius-tour-seen` dans le navigateur. Le nouveau s'ouvre une fois pour **tout** wallet dont le profil n'a pas `tourCompletedAt`, y compris les comptes existants de staging, puis les tutos de page à leur première visite. Choix assumé : le contenu est nouveau (limites de la bêta, contact) et le cahier demande une progression par wallet ; à confirmer par Ali et Ali.
3. **Toute fermeture compte comme « vu ».** Terminer, Passer, Échap ou quitter la page par le bouton retour pendant un tuto de page : tout enregistre la clé. Sinon un utilisateur qui ferme sans finir reverrait le tuto à chaque visite. Le clic sur le fond ne ferme pas, pour qu'une fermeture accidentelle ne vaille pas « vu ».
4. **Progression en base, repli minimal dans le navigateur.** La base est la source de vérité. Le navigateur ne garde qu'une note « fermé, pas encore confirmé » par wallet (`localStorage`, clé `sirius-tour-pending:<adresse>`), posée avant chaque PATCH et retirée dès que le serveur confirme pour ce wallet. Elle empêche la réouverture en boucle si l'écriture échoue durablement (origine mal configurée, débit dépassé, base en panne) et elle est renvoyée en un seul PATCH au chargement suivant. Ce n'est pas un retour au stockage navigateur : elle disparaît dès que la base a l'information.
5. **Lecture en échec : rien ne s'ouvre tout seul.** Sur 401, 403, 429, 5xx, erreur réseau, JSON invalide ou réponse d'une autre forme, le contrôleur passe en « unavailable » : aucune fenêtre automatique, aucune nouvelle lecture à chaque navigation (une seule lecture par changement de wallet ou de session). Le bouton « ? » reste disponible. On préfère ne pas montrer un tuto plutôt que le montrer à tort en boucle.
6. **Validation stricte de la réponse, y compris l'adresse.** Une réponse `{}` (bouchon de test, proxy) ou le profil d'un autre wallet resté en session ne déclenche rien. Même règle pour le PATCH : sa réponse doit porter l'adresse attendue pour effacer la note locale (le cookie de session est partagé entre onglets ; voir §7).
7. **Fermetures pendant une lecture en vol.** Une fermeture faite pendant le GET l'emporte sur sa réponse (`closedHere`) : une lecture lente ne rouvre pas un tuto qu'on vient de fermer.
8. **Un tuto relancé à la main reste ouvert si la session change**, mais sa fermeture n'est enregistrée que pour le wallet sous lequel il a été ouvert (ou pour le premier wallet authentifié s'il a été ouvert sans session). Un tuto ouvert automatiquement est fermé sans écriture quand le wallet change ou se déconnecte.
9. **Relance du tuto d'accueil** : `restartWelcomeTour()` exporté depuis `src/components/tour/tour-store.ts` (et réexporté par `ProductTour.tsx`). Il ne remet pas `tourCompletedAt` à `false` : il ouvre la fenêtre directement, et sa fermeture n'écrit rien si la date est déjà posée (la date d'origine n'est pas déplacée). Le bouton « Visite guidée » du menu profil n'existe pas encore (A5) : à brancher par cette slice.
10. **Bouton « ? »** : un seul, monté depuis le layout, fixe en bas à droite, visible seulement sur les sept pages dotées d'un tuto, connecté ou non. Il n'est rendu qu'après le montage côté client (pas d'écart d'hydratation).
11. **Neutralisation pour l'e2e** : les tutos (lecture du profil, ouverture automatique et bouton « ? ») sont neutralisés uniquement si le build est celui des tests (`NEXT_PUBLIC_SIRIUS_E2E=1`) **et** que le test a posé le marqueur historique `localStorage` `sirius-tour-seen=1`, ce que toutes les specs existantes font déjà pour l'ancien tuto. Aucune spec n'a eu à changer. En production, `NEXT_PUBLIC_SIRIUS_E2E` n'est jamais posé, et `instrumentation-node.ts` refuse de démarrer avec cette variable quand `NODE_ENV=production` ; même si elle fuyait, un utilisateur ne pourrait que masquer ses propres tutos.
12. **Étapes 5 et 6 du tuto d'accueil, écart de rédaction.** L'étape 5 (« Beta limits ») affiche `modelQuality` puis `betaLimits` ; l'étape 6 (« Need more? ») affiche `contactUs` avec le lien `mailto:`. La phrase « De nouveaux modèles sont en développement » du cahier n'est pas répétée à l'étape 6 : elle termine déjà `modelQuality`, affichée juste avant. Aucun texte de limite n'est réécrit, tout vient des textes communs.
13. **Tutos de page.** Contact (`contactUs`) et limites des modèles (`modelQuality`) sur upload, marketplace et train, comme demandé ; `dataLimits` sur upload ; `retrainDeterministic` sur train ; `betaLimits` sur le tableau de bord. Mes datasets, Explorer et Wallet ont des limites propres, sans texte commun.
14. **Textes vérifiés contre le code, et corrigés après revue** (voir §10) : pas de « retrait vers une adresse tierce » (la page Wallet ne propose que l'ajout de fonds et le retrait des crédits d'escrow vers son propre wallet), pas de « file d'attente » (le moteur refuse un second entraînement en 503 « Runner saturé »), pas d'« inscription on-chain dès l'import » (l'import laisse un brouillon, la publication est une action séparée), pas de self-training (réservé à l'équipe depuis #37).
15. **Reste de l'application rendu `inert`, pas tout le `body`.** Pendant l'ouverture, les autres enfants du conteneur du layout (menu, page, bouton « ? ») reçoivent `inert` : ni la souris, ni Tab depuis la barre d'adresse, ni un lecteur d'écran n'y accèdent. Le reste du `body` n'est pas touché pour ne pas bloquer une fenêtre tierce (confirmation de signature du wallet embarqué) ; la fenêtre ne lui prend pas le focus et n'intercepte ni Tab ni Échap quand le focus y est.
16. **Pas de verrouillage du défilement de la page** : inutile, le fond couvre l'écran et la fenêtre a son propre défilement contenu.
17. **Fichier de traduction séparé** (`tour-en.ts`), comme `shared-en.ts` (A2), pour éviter les conflits sur `english.ts`. Un test vérifie qu'aucune clé n'écrase une traduction différente.
18. **Identité des commits** : auteur et committeur `alibenyezza` (configuration git du dépôt), aucune ligne de signature d'assistant (vérifié par `git log staging..HEAD --format=%B`).

### 3. Ce que l'audit doit vérifier

- **Contrôle d'accès côté serveur.** La slice n'ajoute ni ne modifie aucune route. Elle appelle uniquement `GET /api/profile` et `PATCH /api/profile` (A1), qui tirent l'adresse de la session signée (`requireAuth`), jamais du corps, et refusent toute clé autre que `tourCompletedAt`, `featureTours`, `settings` (400). Le client n'envoie que `{"tourCompletedAt":true}` et/ou `{"featureTours":{"<clé>":true}}` (test : chaque corps passe `validateProfilePatch`). Rien dans la slice ne fait office de garde : masquer un tuto ou le bouton « ? » n'ouvre ni ne ferme aucun accès.
- **Validation et bornes des entrées côté client.** `parseTourProgress` (forme exacte, adresse canonique égale à celle du wallet, `tourCompletedAt` chaîne non vide ou `null`, `featureTours` objet simple ; clés inconnues, `__proto__` et valeurs non booléennes ignorées). `readPending` (note bornée à 1 024 caractères, JSON invalide ignoré, clés filtrées par `isTourPageKey`). `tourKeyForPath` (chemin borné à 256 caractères, correspondance exacte via `Object.hasOwn`, `/constructor` et `/__proto__` sans tuto). `canonicalTourAddress` (regex ancrée `^0x[0-9a-f]{40}$`).
- **Fuites possibles.** Aucune donnée d'un autre wallet n'est lue : le GET ne renvoie que le profil de la session ; une réponse portant une autre adresse est ignorée. Aucun journal ni message d'erreur ajouté (les échecs sont silencieux par conception). La note locale contient l'adresse du wallet en clair dans la clé `localStorage` (`sirius-tour-pending:0x…`) tant qu'une écriture n'est pas confirmée ; elle n'est pas effacée à la déconnexion (voir §7, appareil partagé).
- **Impact sur l'argent, l'escrow, les contrats, Phala** : aucun. Pas de transaction, de signature, de lecture de contrat ni d'appel au moteur.
- **Base de données** : aucune migration, aucune nouvelle écriture hors des deux champs prévus. `tourCompletedAt=true` ne déplace pas une date déjà posée (comportement de la route A1). La slice n'envoie jamais `false`.
- **Débit** : un GET par changement d'identité (chargement de page, connexion, changement de réseau ou de compte), aucun par navigation ; au plus un PATCH par tuto fermé jamais vu, plus un renvoi groupé par chargement si une note locale existe. Bien en dessous des plafonds par wallet de la route (60 lectures, 20 écritures par minute). Le plafond global de 1 000 lectures par minute de l'instance (A1) compte toutefois une lecture de profil par chargement de page de chaque utilisateur connecté.
- **Interface : injection HTML, liens.** Aucun `dangerouslySetInnerHTML`, `innerHTML` ni `target="_blank"` (test de rendu). Tous les textes sont des constantes passées à `t()` et rendues par React. Le seul lien est le `mailto:` de `DisclaimerNote` vers la constante `CONTACT_EMAIL`. Aucun contenu fourni par l'utilisateur n'est affiché. Tous les boutons sont `type="button"`.
- **Accessibilité** : vérifier à la main (§4) le piège du focus, Échap, le retour du focus, `inert` posé puis retiré, la lecture par un lecteur d'écran (titre et contenu annoncés).
- **Textes : aucune promesse fausse.** Relire `src/lib/i18n/tour-en.ts` contre le code. Points sensibles déjà vérifiés : chiffrement dans le navigateur avant l'envoi (`encryptDatasetForRunner`, `src/app/(app)/datasets/new/page.tsx`), KYB exigé pour emprunter (`src/lib/sirius/borrower.ts`), un seul entraînement à la fois et refus si occupé (`src/runner/server.ts`, `RUNNER_MAX_CONCURRENT_JOBS` réglable jusqu'à 2 : si on le passe à 2, le texte « One training runs at a time » devient faux), retrait des crédits d'escrow vers son propre wallet (`EscrowCredits.tsx`), frais réseau en ETH. Le test `tour.test.ts` interdit quelques formulations (garanties, « best », « queue », « address you control »…). Les limites des modèles et de la bêta sont celles des textes communs (A2), y compris la réserve sur `dataLimits` signalée par A2.
- **Neutralisation e2e** : vérifier qu'aucun build de staging ou de production ne pose `NEXT_PUBLIC_SIRIUS_E2E`.
- **Signatures d'assistant** : `git log staging..HEAD --format=%B` ne contient aucune ligne de signature d'assistant (co-auteur, session, lien de session ni mention de génération).

### 4. Cas limites à essayer à la main sur staging

Préparer un wallet neuf (ou remettre `tourCompletedAt` à `NULL` et `featureTours` à `{}` dans `UserProfile` pour un wallet de test).

1. **Première connexion.** Se connecter et signer depuis `/dashboard`. Attendu : la fenêtre « Welcome to Sirius · Step 1 / 6 » s'ouvre, le focus est sur « Next ». Parcourir les six étapes ; l'étape 6 montre l'adresse de contact cliquable (`mailto:`). « Get started » ferme. En base : `tourCompletedAt` posé.
2. **Pas d'enchaînement.** Juste après, rester sur `/dashboard` : aucun tuto de page. Aller sur `/marketplace` : le tuto « Marketplace » s'ouvre (un seul bouton « Got it »). Revenir sur `/dashboard` : son tuto s'ouvre cette fois.
3. **Rien ne se rouvre.** Recharger chaque page déjà vue : aucune fenêtre. `featureTours` contient les clés vues.
4. **Autre navigateur, même wallet.** Se connecter ailleurs (navigation privée) : aucun tuto déjà vu ne se rouvre.
5. **Clavier.** Fenêtre ouverte : Tab et Maj+Tab restent dans la fenêtre ; Échap ferme et compte comme vu ; le focus revient à l'élément d'origine. Cliquer dans la barre d'adresse puis Tab : le focus ne va pas sur le menu derrière (inerte) et revient dans la fenêtre.
6. **Bouton « ? ».** Sur chaque page à tuto, cliquer « ? » : le tuto de la page s'ouvre, même déjà vu ; Échap le ferme et rend le focus au bouton. Aucune nouvelle écriture en base si la page était déjà vue.
7. **Sans connexion.** Ouvrir `/marketplace` sans wallet : aucune fenêtre ; « ? » fonctionne ; la page reste utilisable.
8. **API en panne.** Dans les outils du navigateur, bloquer `/api/profile` (ou couper la base de staging) puis se connecter : aucune fenêtre automatique, navigation normale.
9. **Écriture en panne.** Bloquer seulement le PATCH (`/api/profile`, méthode PATCH), fermer le tuto d'accueil, recharger : il ne se rouvre pas ; `localStorage` contient `sirius-tour-pending:<adresse>`. Débloquer et recharger : la note disparaît, `tourCompletedAt` est posé.
10. **Changement de compte.** Tuto d'accueil ouvert, changer de compte dans l'extension : la fenêtre se ferme sans rien écrire ; le nouveau compte voit son propre tuto selon sa progression.
11. **Mobile 320 px et texte agrandi (200 %).** La fenêtre tient dans l'écran, défile à l'intérieur, les boutons restent atteignables ; pas de défilement horizontal. Le bouton « ? » ne masque pas d'action indispensable en bas de page (le faire défiler jusqu'en bas de chaque page).
12. **Wallet embarqué (Google).** Compte neuf : pendant l'attestation KYB qui suit la connexion, si la confirmation Web3Auth s'affiche, elle reste utilisable (saisie, Tab, Échap) même si le tuto d'accueil s'ouvre en même temps.
13. **Lecteur d'écran (NVDA ou VoiceOver).** À l'ouverture : annonce d'une boîte de dialogue avec son titre et son contenu ; le reste de la page n'est pas parcouru.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

**`src/lib/tour/tour.test.ts`** (ajouté au script `test`), avec un faux serveur `/api/profile` qui applique la vraie validation `validateProfilePatch` (A1) à chaque PATCH :
- clés client identiques à `FEATURE_TOUR_KEYS` du serveur ; correspondance chemin → clé (pages, barre finale, fiches, `/constructor`, `/__proto__`, chemin trop long) ;
- lecture : réponse conforme, et « inconnue » pour `null`, `{}`, `{ known: true }`, profil d'un autre wallet, `tourCompletedAt` absent, vide, numérique ou booléen, `featureTours` nul ou tableau, adresse invalide ; clés inconnues, `__proto__` et valeurs non booléennes ignorées ; échecs réseau, HTTP et JSON sans exception ;
- écriture : corps du PATCH (seulement des `true`, jamais vide, accepté par la validation serveur), confirmation seulement sur 2xx avec le profil du wallet attendu (refus pour un autre wallet, `{}`, JSON invalide, HTTP en échec, exception) ;
- note locale : aller-retour, filtrage, suppression quand vide, note illisible ou trop longue, stockage interdit ; réconciliation ;
- neutralisation e2e : seulement build de test **et** marqueur, jamais en production ;
- contrôleur, quand ouvrir : rien sans session signée ; accueil une seule fois puis tuto de la page suivante, pas d'enchaînement sur la même page ; progression relue du serveur au rechargement ; autre navigateur ; pas de réouverture en repassant ; navigation pendant un tuto = vu ; neutralisé en e2e ;
- contrôleur, repli : lecture en échec (500, exception, `{}`, JSON invalide) → rien ne s'ouvre, une seule lecture ; bouton « ? » utilisable ; écriture en échec (500, 401, 403, 409, 429, exception) → pas de réouverture, renvoi groupé au chargement suivant, puis effacement de la note ; note déjà connue de la base effacée sans écriture ; stockage interdit ;
- courses et sorties : fermeture pendant une lecture lente (la réponse tardive ne rouvre rien) ; PATCH confirmé pour un autre wallet (note gardée puis renvoyée) ; sortie des pages pendant la lecture ; double montage StrictMode ; tuto relancé sous un wallet puis fermé sous un autre ;
- changements de wallet et relances : réponse tardive d'un wallet précédent ignorée ; déconnexion ferme sans écrire ; relance sans session sans écriture ; relance d'un tuto déjà fait sans écriture ni déplacement de date ; tuto manuel conservé à la connexion ; abonnement ;
- textes : six étapes du cahier, un tuto par page, contact et qualité des modèles sur upload / marketplace / train, toutes les clés traduites, aucune collision de traduction, liste de formulations interdites (garanties, « best », « queue », « address you control », « destination address »…).

**`src/components/tour/tour-dialog.test.ts`** (ajouté au script `test`), rendu HTML statique de `tour-dialog.render.tsx` dans un processus sans `react-server` : `role="dialog"`, `aria-modal`, `aria-labelledby` et `aria-describedby` reliés (la description contient aussi les textes communs), boutons `type="button"`, pas de HTML injecté ni `target="_blank"`, première et dernière étape (Passer / Suivant / Précédent / Got it), lien `mailto:` unique, un seul bouton par tuto de page, limites en liste, `dataLimits` lu dans le code, rien rendu côté serveur par `ProductTour` et `PageTour`.

**Vérifié dans un vrai navigateur, sans test versionné** (script Playwright temporaire, supprimé avant la PR, sur un port isolé) : ouverture à la connexion, focus sur « Next », Tab et Maj+Tab piégés, Tab depuis le corps ramené dans la fenêtre, menu et page `inert` puis plus aucun `inert` après fermeture, Précédent qui disparaît sans perdre le focus, lien `mailto:`, Échap, PATCH envoyés, tuto de page après navigation client, « ? » + Échap rend le focus au bouton, rien ne se rouvre après rechargement, écriture en échec sans réouverture puis renvoi, lecture en échec sans fenêtre, 320 px avec texte agrandi sans défilement horizontal, fenêtre tierce hors de l'application gardant le focus et la saisie, Échap qui ne remonte pas à un écouteur de `document`. 5 scénarios, 5 réussis.

**Ce qui n'est pas couvert**
- Aucun test e2e versionné du tuto : les fichiers `e2e/` ne font pas partie du périmètre de la slice. À ajouter (P1) en reprenant les scénarios ci-dessus.
- Lecteurs d'écran réels (NVDA, VoiceOver) et navigateurs autres que Chromium (Safari : `inert` et focus au clic).
- Le wallet embarqué Web3Auth réel (simulé par un champ hors de l'application).
- Plusieurs onglets ouverts en même temps (pas d'écoute de l'événement `storage` ; double écriture sans conséquence).
- La route `/api/profile` elle-même, déjà testée par A1 (`src/lib/users/profile.test.ts`).

### 6. Hypothèses

1. La route `/api/profile` se comporte comme décrit dans `16-socle-technique.md` et testé par A1 : réponse avec `address` canonique, `tourCompletedAt` (ISO ou `null`) et `featureTours`, `tourCompletedAt: true` qui ne déplace pas une date posée, fusion clé par clé de `featureTours`.
2. `authenticated` du store wallet (`src/stores/wallet.ts`) n'est vrai que lorsqu'une session serveur existe pour l'adresse affichée (posé par `signInWithWallet` ou `synchroniserSession` de `WalletConnector.tsx`). Sinon la lecture échoue en 401 et rien ne s'ouvre.
3. Le layout `src/app/(app)/layout.tsx` reste le seul point de montage, et ses enfants directs sont bien le menu, les tutos et le contenu : c'est ce conteneur que la fenêtre rend `inert`. Si une autre slice y ajoute un portail ou déplace le contenu, il faut revérifier.
4. Les fenêtres tierces qui doivent rester utilisables pendant un tuto (Web3Auth) sont rendues hors de ce conteneur (dans `body`).
5. `NEXT_PUBLIC_SIRIUS_E2E` n'est jamais posé hors de la suite e2e (`instrumentation-node.ts` refuse de démarrer avec en production).
6. Le moteur exécute un seul entraînement à la fois (`RUNNER_MAX_CONCURRENT_JOBS=1`, valeur par défaut et valeur des compose) ; le texte du tuto Train le dit.
7. Le self-training reste réservé à l'équipe (#37) : le tuto Train n'en parle pas.
8. Les pages gardent leurs chemins actuels (`/dashboard`, `/datasets`, `/datasets/new`, `/marketplace`, `/train`, `/explorer`, `/wallet`). Une page renommée perd son tuto sans erreur.

### 7. Risques résiduels et limites connues

1. **Écriture possible sur le profil d'un autre wallet (deux onglets).** Le cookie de session est partagé entre onglets. Si l'onglet 1 affiche le wallet A et qu'un onglet 2 a ouvert une session pour B, fermer un tuto dans l'onglet 1 pose la clé sur le profil de **B** (le serveur écrit pour la session). Le client le détecte (adresse de la réponse) et garde la note de A, mais ne peut pas empêcher l'écriture : la route refuse toute clé `address`. Conséquence limitée à un tuto non vu par B. Correction possible côté route (A1) : un en-tête d'adresse attendue et un 409 en cas d'écart.
2. **Comptes existants.** Tout wallet dont `tourCompletedAt` est nul voit le tuto d'accueil, puis chaque tuto de page à sa première visite, y compris les comptes de staging qui avaient vu l'ancien tuto (voir §2.2).
3. **Fermeture puis réouverture après une nouvelle signature.** `authenticated` repasse à `false` lors d'un changement de réseau, d'une délégation runner absente ou expirée, ou pendant une nouvelle signature : un tuto ouvert automatiquement se ferme alors sans rien écrire et se rouvre après la nouvelle authentification. Pas de boucle (une lecture par changement d'identité). Un wallet dont la session existe sans délégation runner (IndexedDB vidé) ne voit pas de tuto automatique tant qu'il n'a pas re-signé.
4. **Bouton « ? » fixe en bas à droite** (`z-20`, 36 px) : il peut recouvrir le coin droit du dernier élément d'une page en fin de défilement, surtout sur mobile, puisque aucune page ne réserve de marge pour lui. Le Toast (`z-50`) s'affiche au même endroit, par-dessus.
5. **Fenêtre tierce ouverte au moment exact de l'ouverture du tuto** (cas jugé peu probable par la revue, la signature précédant la vérification serveur) : le tuto ne lui prend pas le focus ; si elle le rend ensuite à son déclencheur devenu inerte, le focus tombe sur le corps de la page, Tab le ramène dans le tuto mais un lecteur d'écran n'annonce pas la fenêtre ; Échap avec le focus sur le corps fermerait alors le tuto plutôt que la fenêtre tierce.
6. **Élément ajouté au layout pendant l'ouverture** (par exemple le bouton « ? » réapparu après un retour arrière) : pas rendu `inert`, mais caché sous le fond et non atteint par Tab.
7. **Note locale** (`sirius-tour-pending:<adresse>`) : contient l'adresse du wallet tant qu'une écriture n'est pas confirmée, et n'est pas effacée à la déconnexion (appareil partagé). Elle ne contient aucune donnée privée de plus.
8. **Plusieurs onglets** : chacun peut ouvrir le même tuto avant que l'autre l'ait fermé (pas de synchronisation entre onglets) ; écriture en double sans conséquence.
9. **Charge de lecture** : une lecture de profil par chargement de page de chaque utilisateur connecté, comptée dans le plafond global de l'instance (1 000 lectures par minute, A1) ; à relever avec le trafic.
10. **Texte « One training runs at a time »** : devient faux si `RUNNER_MAX_CONCURRENT_JOBS` passe à 2.
11. **`dataLimits`** : réserve de A2 (texte du cahier jugé optimiste) reprise telle quelle dans le tuto Upload.

### 8. Reste à faire

- **P0, slice A5 (menu profil)** : brancher `restartWelcomeTour()` (`src/components/tour/tour-store.ts`, réexporté par `src/components/layout/ProductTour.tsx`) sur le bouton « Visite guidée ». Tant que ce n'est pas fait, le critère « peut le relancer » de `04-dashboard.md` n'est pas atteint (les tutos de page, eux, sont relançables par « ? »).
- **P0, Ali et Ali** : relire et valider les textes anglais de `src/lib/i18n/tour-en.ts` (exigé par `02-general.md`), et confirmer que les comptes existants doivent voir le nouveau tuto (§2.2).
- **P1** : test e2e versionné des tutos (reprendre les scénarios du §5), hors périmètre de cette slice.
- **P1** : essais manuels du §4 sur staging, en particulier lecteur d'écran, Safari et wallet embarqué réel.
- **P1, slices pages** : quand une page change de rôle ou de contenu (dashboard v2, Mes datasets, Upload en deux étapes, Explorer, Wallet), relire son texte dans `src/lib/tour/content.ts`.
- **P2, route `/api/profile` (A1)** : en-tête d'adresse attendue avec 409 en cas d'écart, pour fermer le risque §7.1.
- **P2** : effacer la note locale à la déconnexion, et synchroniser les onglets par l'événement `storage`.

### 9. Résultats des vérifications

Environnement : Windows 11, Node 22.16.0, pnpm 11.18.0 via `npx pnpm@11.18.0` (l'installation locale de pnpm 11.18.0 du poste est incomplète : `pnpm` échoue avec « Failed to switch pnpm to v11.18.0 », échec d'environnement sans lien avec la slice). Sous Windows, pnpm lance les scripts avec `cmd.exe`, qui ne comprend pas la syntaxe `NODE_OPTIONS=… node …` du script `test` (« 'NODE_OPTIONS' n'est pas reconnu… ») : `pnpm test` a donc été lancé avec `--config.script-shell=bash`, sans changer le script.

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | OK (« Already up to date » au dernier passage ; première installation complète en 8 min 56 s, `prisma generate` en postinstall) |
| `pnpm prisma generate` (`DATABASE_URL=postgresql://x:y@localhost:5432/z`) | OK, « Generated Prisma Client (7.8.0) » |
| `pnpm exec tsc --noEmit` | OK, aucune erreur |
| `pnpm lint` | OK, aucune erreur ni avertissement |
| `pnpm test` (bash) | 587 tests, 515 réussis, **72 échecs, identiques au test près à ceux de `staging` (2f6ae81) sur le même poste** (531 tests, 459 réussis, 72 échecs ; comparaison des listes `not ok` : identiques ; même constat avant le rebase contre e829cfc). Ces échecs viennent de l'environnement Windows (chemins à barres obliques inverses, par exemple « src/lib/tee/contract.ts absent du graphe » dans `disclaimers.test.ts`, résolution d'imports du self-training, scripts runner) et non de la slice. Les 56 tests ajoutés passent tous. La CI Linux du dépôt fait foi. |
| Tests de la slice seuls (`tour.test.ts`, `tour-dialog.test.ts`, `english.test.ts`) | 63 sur 63 |
| `pnpm audit:deps` | OK (code 0) : 1 faible (`elliptic` ≤ 6.6.1) et 1 haute ignorée par la configuration, préexistantes |
| `next build` (vérification supplémentaire, comme la CI) | OK |
| `playwright test` (suite e2e existante, 79 tests) | 79 sur 79 sur la version finale. Un passage intermédiaire sur le port 3100 a échoué (33 échecs `ERR_CONNECTION_REFUSED` / délais, y compris sur `/docs` hors slice) parce qu'une autre session utilisait le même port en parallèle ; relancé sur un port isolé avec une configuration temporaire identique (supprimée) : 79 sur 79, deux fois. Après le rebase : 84 sur 84 (les 79 existants et les 5 vérifications temporaires du tuto). |
| Vérification navigateur temporaire du tuto (§5) | 5 sur 5 |
| `git log staging..HEAD --format=%B` | aucune ligne de signature d'assistant (co-auteur, session, lien de session ni mention de génération) ; auteur et committeur `alibenyezza` |
| `git diff --name-only staging...HEAD` | 16 fichiers : les 15 du §1 et ce fichier d'audit |

### 10. Revue interne de la session

Trois passes de revue adversariale par des agents en lecture seule, plus la vérification navigateur.

**Première passe, accessibilité et non-blocage** — trouvé et corrigé :
- Textes faux : « withdraw to an address you control » et « A withdrawal is final: check the destination address » (la page Wallet ne retire que les crédits d'escrow vers son propre wallet) ; « others wait their turn » (aucune file : 503 « Runner saturé ») ; « then registered on-chain » à l'import (l'import laisse un brouillon, la publication est séparée) ; « recent activity » sur le tableau de bord ; tuto Train incomplet. Textes réécrits, formulations ajoutées à la liste interdite du test.
- Piège du focus contournable (barre d'adresse puis Tab vers le menu derrière, lecteur d'écran) : le reste de l'application est désormais `inert` pendant l'ouverture.
- `aria-describedby` vide sur les étapes sans paragraphe : la description couvre tout le contenu de l'étape.
- Focus pris à une fenêtre tierce à l'ouverture : n'est plus pris si le focus est hors de l'application.
- `Modal` du site pouvant passer au-dessus du tuto : tuto en `z-[60]`, `Modal` inerte dessous.
- Défilement propagé à la page : `overscroll-contain`.
- Écartés : verrouillage du défilement de `body` (inutile, fond couvrant) ; bouton « ? » pouvant recouvrir un coin de contenu (documenté §7.4, pages hors périmètre) ; nouveaux tutos pour les comptes existants (choix documenté §2.2).

**Première passe, persistance et e2e** — trouvé et corrigé :
- Une lecture lente rouvrait un tuto fermé pendant qu'elle était en vol (reproduit par script) : les fermetures de l'onglet l'emportent sur la réponse (`closedHere`), test ajouté.
- La note locale était effacée par un PATCH confirmé pour un autre wallet : confirmation exigeant l'adresse attendue, test ajouté ; l'écriture côté serveur reste possible (documenté §7.1).
- Chemin périmé après sortie des pages de l'application : `leavePages()` au démontage, sans écriture (sûr en StrictMode), tests ajoutés.
- Tuto relancé sous un wallet puis enregistré pour un autre : écriture limitée au wallet d'ouverture, test ajouté.
- Couverture : codes 401, 403, 409, 429 ajoutés aux tests d'écriture.
- Vérifié sans problème : compatibilité des corps PATCH avec la route, fréquence des appels, StrictMode, toutes les specs e2e qui visitent une page de l'application posent le marqueur, neutralisation impossible en production.
- Écarté : fichier e2e temporaire signalé comme risque de commit, supprimé avant la PR.

**Deuxième passe** — trouvé et corrigé :
- L'effet de changement d'étape, exécuté aussi au montage, reprenait le focus à une fenêtre tierce : il ne recentre plus que depuis le corps de la page.
- Échap fermait aussi le devis (`Modal`) resté sous le tuto : écoute en capture sur `window` et `stopImmediatePropagation()`. Vérifié en navigateur.
- Signalés et documentés, non corrigés dans la slice : `restartWelcomeTour()` à brancher par A5 (§8) ; écriture possible pour un autre wallet côté serveur (§7.1).
- Vérifié sans problème : restauration exacte de `inert` (StrictMode, remplacement d'une fenêtre par une autre), absence de boucle, textes conformes au code.

**Troisième passe** — rien de nouveau. Une limite notée (§7.5 : fenêtre tierce ouverte à l'instant exact de l'ouverture du tuto), jugée peu probable et laissée aux essais manuels (§4.12).

---

## A4 — Avertissements et conditions d'utilisation

Branche `feat/avertissements-conditions`, PR vers `staging`. Aucune base de données, aucun contrat, aucune route API touchés : la slice ne change que du texte et l'endroit où il s'affiche.

### 1. Ce qui a changé

| Fichier | Changement |
|---|---|
| `src/app/terms/page.tsx` | Conditions réécrites, en anglais, page serveur publique. Dix sections : nature de la bêta ; modèles ; paiements et MUSD ; délai de sécurité et remboursements ; enregistrement des accès ; consentement à l'amélioration des modèles ; suspension ; risques ; responsabilités ; engagements ; plus une section « Changes and contact ». Constante `LAST_UPDATED` = « 4 October 2026 ». Le jeton cité est MUSD (l'ancien texte disait USDC). Contact lu dans `CONTACT_EMAIL` (`src/lib/copy/disclaimers.ts`), sans le modifier. |
| `src/app/terms/terms.test.ts` (nouveau) | Test par inspection de source, neuf cas (voir section 5). Ajouté au script `test` de `package.json`. |
| `src/app/page.tsx` (landing) | Encart `DisclaimerNote` court (`betaLimits`, `modelQuality`) au-dessus du pied de page ; pied de page : lien `/terms` ajouté (le lien `/status` existait déjà), ligne de réseau « Mainnet beta on Mezo » ou « Testnet on Mezo » selon `NEXT_PUBLIC_EVM_NETWORK`. |
| `src/app/(app)/dashboard/page.tsx` | Un seul ajout : `DisclaimerNote` (`betaLimits`, `modelQuality`, `contactUs`) sous l'en-tête de la vue connectée, plus l'import. Libellé du jeton (« USDC ») et reste de la page inchangés. |
| `src/app/(app)/train/page.tsx` | Un seul ajout : `DisclaimerNote` (`modelQuality`, `retrainDeterministic`, `betaLimits`, `contactUs`) sous l'en-tête de la vue connectée, plus l'import. |
| `src/lib/i18n/legal-en.ts` (nouveau), `src/lib/i18n/english.ts` | Trois traductions du pied de page, dans un fichier séparé fusionné dans `EN_MESSAGES` (même méthode que `shared-en.ts`). Les textes d'avertissement avaient déjà leur traduction (A2). |
| `package.json` | `src/app/terms/terms.test.ts` ajouté au script `test`. |

Composants partagés (`DisclaimerNote`, `src/lib/copy/disclaimers.ts`, `shared-en.ts`) réutilisés sans modification.

### 2. Décisions et écarts par rapport au cahier des charges

- **Clauses écrites pour le produit cible, pas pour le code d'aujourd'hui.** Plusieurs comportements annoncés relèvent d'autres slices qui ne sont pas toutes fusionnées (voir section 6). Le cahier des charges demande ces clauses ; je les ai écrites telles que prévues par les fichiers de feature 01, 06, 07 et 15, et je liste ici ce qui doit être vrai au lancement.
- **Phrase de traçage** : reprise presque mot pour mot de `06-mes-datasets.md` (« Sirius records dataset accesses and the fingerprint of each delivered model in order to detect and investigate leaks »), suivie du détail (adresse, prêt, date, modèle, empreinte).
- **Aucune durée de conservation du journal** n'est promise : le dépôt n'en définit pas. Un texte sur la durée de conservation serait un engagement que le code ne tient pas encore. À trancher (RGPD).
- **Décision du 4 octobre (Ali)** : conservation de 24 mois après l'accès, puis suppression, ajoutée aux conditions. Aucune purge automatique n'existe encore : à implémenter avant octobre 2028, date des premières suppressions dues (P2, suivi dans la V1.2).
- **Remboursement** : décrit d'après `SiriusEscrowV7.sol` (`_refund` : montant de la donnée + calcul − calcul consommé ; le calcul consommé va au destinataire du calcul ; le reste devient un crédit de l'emprunteur, retiré ensuite). Le texte dit donc « credited back to the borrower's escrow balance, from which it can be withdrawn », pas « renvoyé sur le wallet ».
- **« Seul le calcul consommé est retenu »** : formulé « as measured and signed by the training environment » (reçu d'exécution signé, `recordExecution`).
- **Remboursement réservé aux échecs** : le texte dit que l'application ne le propose que sans modèle livré (règle de `09-train-et-certificat.md`), et ne promet pas que le contrat l'interdit. Au niveau du contrat, `refund()` est ouvert à tous après l'échéance tant que le prêt n'est pas réglé.
- **Suspension** : j'ai ajouté la phrase honnête de `15-dashboard-admin.md` (Sirius ne peut pas saisir ni geler les fonds déjà dans l'escrow) et la mention de la révocation de l'attestation KYB par le Safe.
- **Gel Mezo** : j'ai ajouté que le gel de l'adresse de l'escrow elle-même bloquerait les fonds de tous les prêts. C'est exact techniquement mais plus fort que la consigne ; à valider.
- **Section « Models »** reprend le texte commun `modelQuality` en l'élargissant (« no promise that a model will be accurate… »). Le texte anglais de l'encart partagé n'est pas modifié.
- **Landing** : l'encart est placé dans le pied de page, pas dans le héros épinglé par GSAP, pour ne pas toucher à l'animation. Le réseau affiché dépend de `NEXT_PUBLIC_EVM_NETWORK` (inliné au build).
- **Pas de page `/terms` traduite en français** : comme les autres pages serveur publiques (status), le texte est en anglais direct.
- **Formule « as is »** : « provided during the beta as is » est une formule juridique légère que j'ai ajoutée ; à relire.

### 3. Ce que l'audit doit vérifier

- **Contrôle d'accès côté serveur** : aucune route, aucune migration, aucune écriture. `/terms` est publique par conception (comme `/status`).
- **Validation des entrées** : aucune entrée utilisateur dans les pages modifiées. Le seul lien dynamique est `mailto:` construit sur la constante `CONTACT_EMAIL`, pas sur une valeur fournie par un utilisateur.
- **Fuites** : aucune donnée affichée. Le pied de page ne lit que `NEXT_PUBLIC_EVM_NETWORK` (publique).
- **Argent, escrow, contrats, Phala** : aucun impact technique. En revanche, les textes engagent Sirius sur ces points ; vérifier qu'ils sont vrais :
  - délai de sécurité de **3 jours** : vrai dans le contrat (`deadline`, paramètre `challengeDays` du devis) mais **pas encore dans l'upload** (`src/app/api/datasets/route.ts` accepte 1 à 30 jours choisis par le fournisseur, `datasets/new/page.tsx` a toujours le champ). Dépend de la slice upload (07) ;
  - remboursement hors calcul consommé : vrai dans `SiriusEscrowV7._refund` ;
  - MUSD : le code et l'interface disent encore USDC (`SIRIUS_USDC_ADDRESS`, `dashboard` et `wallet` affichent « USDC », la page `/status` liste « USDC » et parle de « real USDC »). Les conditions disent MUSD : **incohérence visible tant que le jeton n'est pas généralisé** ;
  - traçage : `recordDatasetAccess()` existe mais **n'est pas branché sur la livraison** (A1, section 3 de `16-socle-technique.md`). La clause annonce un enregistrement qui doit exister au lancement ;
  - consentement : colonnes présentes (A1), mais ni la case à l'upload ni le retrait depuis la fiche ne sont dans le dépôt à ce stade. La clause promet les deux ;
  - suspension : la liste de blocage (`UserProfile.blockedAt`) existe en base mais aucune route ne l'applique à la connexion, à la publication ni à l'emprunt (prévu « après le 6 » dans 15). La clause dit seulement que Sirius « can » suspendre.
- **Base de données** : sans objet.
- **Interface** : contenu entièrement statique ou issu de constantes ; pas de `dangerouslySetInnerHTML`. Les liens `/terms`, `/status` sont internes ; le lien X existant garde `rel="noopener noreferrer"`.
- **Textes, aucune promesse fausse** (point central) : relire la page de conditions phrase par phrase contre le code au moment du lancement. Phrases à plus fort risque : « visible only to Sirius administrators », « used for that purpose only », « off by default », « The app only offers a refund when no model was delivered », « Sirius cannot seize or freeze funds already locked ».

### 4. Cas limites à essayer à la main sur staging

1. Ouvrir `/terms` sans être connecté : la page s'affiche, la date « 4 October 2026 » est visible, le lien « status page » mène à `/status`, l'adresse de contact ouvre un `mailto:`.
2. Lire chaque section : les mots « MUSD » et « Mezo » apparaissent, pas « USDC ».
3. Landing `/` : descendre jusqu'au pied de page. Attendu : encart « Beta: invitation-only access… » et « Sirius currently trains baseline models… », liens Documentation, Protocol status, Terms, @Sirius_data, ligne « Mainnet beta on Mezo » (staging en testnet : « Testnet on Mezo »).
4. Landing en largeur mobile (360 px) : les quatre liens du pied de page passent à la ligne sans débordement horizontal.
5. Landing : l'animation de zoom et l'apparition du bouton de connexion se comportent comme avant (rien n'a été ajouté dans le héros).
6. Connecter un wallet, ouvrir `/dashboard` : encart sous l'en-tête avec lien mailto cliquable sur l'adresse de contact. Tableau de bord non connecté : pas d'encart (voulu).
7. Ouvrir `/train` connecté : encart avec les quatre textes, dont « Linear and logistic regression are deterministic… ». Vérifier qu'il ne chevauche pas le message d'erreur quand il y en a un.
8. Passer l'interface en français si le sélecteur existe : les encarts s'affichent en français (les clés sont françaises), le pied de page aussi. `/terms` reste en anglais.
9. Comparer, sur un prêt de test, le comportement réel du remboursement (échec, puis dépassement du délai) avec la section « Safety period and refunds ».

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

Ajouté : `src/app/terms/terms.test.ts`, neuf cas par inspection de source (`pnpm test`, tous passent) : phrase de traçage ; consentement facultatif, par défaut désactivé, enclave seule, retrait à tout moment ; suspension et limite sur les fonds de l'escrow ; délai de 3 jours (et aucun autre délai annoncé), calcul consommé, ré-entraînement = nouvel emprunt ; MUSD, Mezo, gel, et absence du mot « USDC » ; nature bêta, modèles de base, date lisible, contact ; absence de promesses absolues (« risk-free », « 100% », « guarantee the funds »…) ; branchement des encarts sur dashboard, train et landing ; liens `/terms`, `/status` et ligne de réseau dans le pied de page. `english.test.ts` passe avec les trois nouvelles clés.

Non couvert : le rendu réel de la page (pas de test de rendu, la page est un composant serveur) ; l'exactitude juridique ; la cohérence avec le comportement du code (le test vérifie le texte, pas que l'upload fixe 3 jours ou que le journal est écrit) ; l'affichage visuel des encarts et du pied de page sur mobile.

### 6. Hypothèses

- Les slices upload (07, délai fixé à 3 jours, case de consentement), fiche dataset (06, retrait du consentement, branchement du journal sur la livraison), dashboard admin (15, blocage appliqué) et jeton MUSD (01) seront fusionnées avant l'ouverture au public.
- Le Safe peut révoquer l'attestation KYB d'une adresse (décrit dans 15, non revérifié sur le contrat KYB ici).
- Le journal n'est lisible que par l'admin : aucune route ne l'expose (A1) ; non revérifié depuis.
- `NEXT_PUBLIC_EVM_NETWORK` vaut `mainnet` sur la production (imposé par `instrumentation-node.ts`).
- Mezo peut geler des adresses de MUSD : affirmation générale sur les stablecoins régulés, non vérifiée sur le contrat MUSD déployé sur Mezo.

### 7. Risques résiduels et limites connues

- Clauses en avance sur le code (traçage non branché, consentement absent, blocage non appliqué, 3 jours non imposé à l'upload) : si une slice manque au lancement, la clause correspondante devient une promesse fausse. Voir le point à relire en priorité.
- MUSD dans les conditions mais USDC dans l'interface et sur `/status` tant que le jeton n'est pas généralisé.
- Aucune durée de conservation, ni base légale RGPD, ni droit d'accès ou d'effacement des journaux n'est décrit.
- Le texte n'est pas une relecture juridique : c'est de l'anglais clair aligné sur le produit.
- Le test d'inspection de source est fragile aux reformulations : changer une phrase demande de mettre à jour le test (voulu, pour que les clauses ne disparaissent pas par accident).
- Les sections « Risks you accept » et « Your responsibilities » sont reprises de la version précédente sans changement de fond.

### 8. Reste à faire

- **P0 avant ouverture** : relecture humaine/juridique de `/terms` (voir ci-dessous), puis alignement du libellé de jeton (`dashboard`, `wallet`, `/status`, docs) sur MUSD une fois le jeton généralisé : hors périmètre de cette slice.
- **P0** : s'assurer que les quatre comportements annoncés existent avant le lancement (3 jours à l'upload, case de consentement et retrait, journal branché sur la livraison, blocage appliqué), sinon retirer ou adoucir la clause.
- **P1** : décider d'une durée de conservation du journal des accès et l'ajouter aux conditions ; ajouter un lien « Terms » dans la barre latérale ou le réglage une fois le layout ouvert (non touché ici) ; case d'acceptation des conditions à la première connexion (non demandée).
- **P2** : version française de `/terms` si le public francophone le demande.

### 9. Résultats des vérifications

Environnement : Windows 11, pnpm 11.18.0 lancé via l'installation globale npm (le pnpm « géré » du dépôt n'était pas installé dans `AppData\Local\pnpm\.tools`, `pnpm_config_manage_package_manager_versions=false`).

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | Succès (postinstall `prisma generate` inclus) |
| `pnpm prisma generate` (`DATABASE_URL` factice) | Succès, client 7.8.0 |
| `pnpm exec tsc --noEmit` | Succès, code 0 |
| `pnpm lint` | Succès, code 0, aucun avertissement |
| `pnpm test` | **539 tests, 464 réussis, 75 en échec**. Tous les nouveaux tests (9) réussissent, ainsi que `english.test.ts`, `shared-components.test.ts` et le reste de `disclaimers.test.ts` (un seul cas échoue dans ce fichier : « les modules des textes communs… » cherche `src/lib/tee/contract.ts` avec des `/` et échoue sur chemins Windows). Les autres échecs sont dans `budget.test.ts` (54), `replay.test.ts` (7), `initialize-runner-volume.test.ts` (4), `check-reaper.test.mjs` (3), `self-training-routes.test.ts` (3), `monitoring.test.ts`, `runner-cli.test.ts`, `server.test.ts` (1 chacun) : erreurs de droits de répertoire POSIX (« Répertoire privé requis »), fichiers temporaires et chemins Windows. Aucun de ces fichiers n'est touché par la slice. Le script `test` utilise la syntaxe `NODE_OPTIONS=… node` que `cmd.exe` ne comprend pas : je l'ai lancé en positionnant `NODE_OPTIONS` à la main avec la même liste de fichiers. **Ce sont des échecs d'environnement non masqués ; la CI Linux doit confirmer.** Je n'ai pas comparé avec un `staging` vierge sur cette machine. |
| `pnpm audit:deps` | Code 0 ; 2 vulnérabilités signalées (1 faible, 1 haute dont une ignorée par la configuration du dépôt), aucune ajoutée par la slice (aucune dépendance modifiée) |

### 10. Revue interne de la session

Une passe de revue adversariale par relecture de chaque phrase de `/terms` contre le code et les fichiers de feature :

- **Corrigé** : l'ancien texte annonçait « real USDC » → MUSD et Mezo. L'ancienne phrase « the borrower can be refunded after the deadline » était trop courte : remplacée par la règle complète (échec ou 3 jours, calcul consommé retenu, crédit retiré ensuite).
- **Corrigé** : une première version de la phrase de suspension disait que Sirius « can ask the contract administrator to revoke » ; reformulée en « can also revoke the on-chain verification of an address ». Le décideur réel est le Safe contrôlé par Sirius, il ne faut pas laisser croire à un tiers.
- **Ajouté** : risque d'un gel de l'adresse de l'escrow lui-même par Mezo ; limite explicite « Sirius cannot seize or freeze funds already locked » ; absence de promesse sur l'exactitude des modèles.
- **Écarté** : promettre la suppression du journal sur demande ou une durée de conservation (non implémenté) ; promettre que le contrat interdit le remboursement d'un prêt réussi (faux : `refund()` est ouvert après l'échéance) ; mettre l'encart dans le héros de la landing (risque pour l'animation GSAP) ; modifier le libellé « USDC » du dashboard (hors périmètre).
- **Constaté, non corrigé (hors périmètre)** : les clauses en avance sur le code décrites en section 3, et la page `/status` qui dit encore « real USDC ».

**À relire en priorité par un humain** : (1) clause de traçage et absence de durée de conservation (RGPD) ; (2) clause de consentement : « off by default » et retrait « for future use » ; (3) clause de gel Mezo, y compris le gel de l'escrow ; (4) clause de suspension et révocation KYB ; (5) clause de remboursement : « only the compute actually used is kept » et « a loan that succeeded is not refunded » ; (6) formule « provided as is ».

---

## A5 — Bouton profil et page Wallet

Branche `feat/profil-wallet`, PR vers `staging`. Spécification : [05-wallet.md](05-wallet.md) (P1 « avant le 6 »), [02-general.md](02-general.md) section 5, [13-reglages.md](13-reglages.md), [14-kyb.md](14-kyb.md). Tout ce qui suit est vérifiable depuis `git diff staging...HEAD`.

### 1. Ce qui a changé

**Aucune route serveur, aucune table, aucune colonne, aucun contrat, aucune variable d'environnement nouvelle.** Tout est côté navigateur.

| Fichier | Changement |
|---|---|
| `src/components/profile/ProfileMenu.tsx` (nouveau) | Bouton profil, monté dans le layout de l'application. Visible seulement connecté avec une adresse EVM valide. Fenêtre volante (`role="dialog"`, pas `role="menu"`) : badge réseau, avertissement « mauvais réseau », adresse raccourcie avec copie et lien explorateur, solde, liens Wallet, Settings, KYB, « Guided tour », « Log out ». Le solde n'est lu qu'à l'ouverture. |
| `src/components/profile/address.ts` (nouveau) | `normalizeAddress` (valide et met en casse EIP-55, `null` sinon) et `shortAddress` (`0x2f9B…D13D`). Toute adresse affichée, copiée, encodée en QR ou liée à l'explorateur passe par `normalizeAddress`. |
| `src/components/profile/network.ts` (nouveau) | `networkBadge` (libellé et couleur : mainnet vert, testnet ambre), `stablecoinSymbol` (« MUSD » sur mainnet, « test MUSD » sur testnet), `isWrongNetwork`, `formatTokenAmount` (séparateurs, troncature sans arrondi, « <0.0001 » pour un solde non nul trop petit). |
| `src/components/profile/guided-tour.ts` (nouveau) | Point d'accroche de la visite guidée : événement DOM annulable `sirius:guided-tour:start`, voir section 2. |
| `src/components/profile/useCopy.ts` (nouveau) | Copie dans le presse-papiers, ne lève jamais, annonce l'échec. |
| `src/components/wallet/add-funds.ts` (nouveau) | `addFundsOptions(network)` : choix du parcours (faucet, pont, transfert). |
| `src/components/wallet/qr.ts`, `QrCode.tsx` (nouveaux) | QR code local : matrice calculée par `qrcode-generator`, dessinée en SVG React (un seul `<path>`), noir sur blanc, zone de silence de 4 modules. |
| `src/components/wallet/ReceiveFunds.tsx` (nouveau) | Section « Add funds » par transfert : adresse complète, QR code, copie, lien explorateur, cinq mises en garde. Affichée seulement sur mainnet. |
| `src/components/wallet/logout.ts` (nouveau) | Déconnexion complète (`markWalletDisconnected`, `signOut`, `disconnectWallet`, puis `setDisconnected` dans un `finally`), extraite de `ConnectButton` pour être partagée avec le bouton profil. |
| `src/components/wallet/ConnectButton.tsx` | `handleDisconnect` appelle `logoutCurrentWallet()`. Comportement identique, trois imports devenus inutiles retirés. Rien d'autre. |
| `src/components/layout/Sidebar.tsx` | Une ligne retirée : le lien Wallet du menu latéral. |
| `src/app/(app)/layout.tsx` | Deux lignes ajoutées : l'import et `<ProfileMenu />` en tête du conteneur de contenu. |
| `src/app/(app)/wallet/page.tsx` | Lien « View on explorer » sous l'adresse ; `ReceiveFunds` sous la carte de solde sur mainnet ; le bouton historique s'appelle « Use the bridge » sur mainnet (« Add funds » sur testnet) et le message « Fonds de démarrage non reçus » (faucet) n'est affiché que sur testnet. La ligne du libellé du jeton (`"MUSD"` / `t("test MUSD")`) est intacte, une autre tranche la modifie. Cartes `EscrowCredits` (retraits) et `SecureAccountCard` inchangées. |
| `src/lib/i18n/profile-en.ts` (nouveau), `english.ts` | Traductions anglaises de la tranche, fusionnées dans `EN_MESSAGES` (deux lignes ajoutées à `english.ts`). |
| `package.json`, `pnpm-lock.yaml` | Dépendance `qrcode-generator` 2.0.4 ; trois fichiers de test ajoutés au script `test`. |
| `e2e/profile.spec.ts` (nouveau) | Dix tests e2e (voir section 5). |
| Tests | `src/components/profile/profile.test.ts`, `src/components/wallet/add-funds.test.ts`, `src/components/wallet/receive-funds.test.ts` (+ `receive-funds.render.tsx`, script de rendu). |

**Composants non touchés** : `EscrowCredits.tsx`, `src/lib/wallet/transaction-guard.ts`, `src/lib/wallet/**` (dont `onramp.ts`), `src/app/api/**`, `src/lib/evm/**`, composants partagés `src/components/ui/**` et `src/components/datasets/**`.

### 2. Décisions et écarts par rapport au cahier des charges

1. **Position du bouton : en flux, pas fixe.** La spécification dit « en haut à droite ». Une position `fixed` a été essayée puis écartée après revue : entre 768 et 1500 px de large elle recouvrait les actions à droite de l'en-tête de Marketplace et de Mes datasets (bouton « Configurer le KYB »). Le bouton est donc une ligne alignée à droite en tête du contenu, sur ordinateur et sur mobile. Conséquence : il défile avec la page et décale le contenu d'environ 48 px vers le bas sur toutes les pages de l'application. Il n'est donc pas visible en permanence après défilement. Un e2e vérifie l'absence de chevauchement à 1100 px et 390 px.
2. **Le bouton de connexion de la barre latérale reste.** Le cahier ne demande que de retirer le lien Wallet. Le bouton profil n'existe que connecté (la connexion et « Se connecter » par signature restent dans la barre latérale et l'en-tête mobile). Conséquence : le bouton affiche la même adresse que celui de la barre latérale. Pour que les tests e2e existants (qui cherchent un bouton nommé comme l'adresse, sans `exact` ambigu) ne trouvent pas deux boutons, le bouton profil a pour nom accessible « Profile menu ».
3. **Plus aucun lien vers `/wallet` quand on n'est pas connecté.** Conséquence directe du retrait du lien et du choix précédent. La page reste joignable par son URL et affiche alors le bouton de connexion. Voulu par la spécification, à confirmer.
4. **Fenêtre volante, pas `role="menu"`.** Le contenu mêle informations et actions, que le motif ARIA « menu » ne prévoit pas ; cela évite aussi toute collision avec les `getByRole("menu")` des e2e existants. Fermeture par Échap (le focus revient au bouton), clic à l'extérieur et choix d'un lien.
5. **Réseau affiché = réseau du site**, pas celui du wallet (`NEXT_PUBLIC_EVM_NETWORK`, via `resolveClientNetwork()`). Un écart avec le réseau du wallet est signalé par un message rouge, un point rouge sur le bouton, et le **solde n'est pas lu** dans ce cas (`eth_call` part sur la chaîne du wallet et rendrait le solde d'un autre jeton sous l'étiquette du jeton du site). Ajout par rapport au cahier, trouvé en revue.
6. **Libellé du jeton : « MUSD » sur mainnet** via `stablecoinSymbol`, conformément à [01-decisions-avant-samedi.md](01-decisions-avant-samedi.md). Le décompte du solde passe toujours par `fetchUsdcBalance` et `formatUsdcAtomic` : le nom des fonctions dit USDC, mais l'adresse du jeton vient de `SIRIUS_USDC_ADDRESS` (qui désignera le MUSD au déploiement, tranche A8) et les décimales de la table `USDC_DECIMALS_BY_NETWORK` (6 sur mainnet, valeur annoncée pour le MUSD et à confirmer on-chain, voir [01](01-decisions-avant-samedi.md)).
7. **Solde tronqué, jamais arrondi**, à quatre décimales, sans passage par un flottant (BigInt). Un solde non nul inférieur à 0,0001 s'affiche « <0.0001 » (pas « 0 »).
8. **Parcours d'ajout de fonds.**
   - testnet : inchangé (faucet ; le bouton garde son libellé « Add funds » et ses messages).
   - mainnet : le bouton historique appelle toujours `addFunds()` (`POST /api/faucet`, puis `GET /api/onramp` si le serveur répond 503, ce qui ouvre le pont Across). Il est renommé « Use the bridge ». En plus, la section « Add funds » affiche l'adresse, un QR code et l'explication du transfert de MUSD.
   - **Across n'a pas été vérifié** pour le MUSD (la spécification demandait de le vérifier). Le texte le dit : « le bouton de pont ouvre un service tiers, vérifie qu'il supporte MUSD avant de l'utiliser ».
9. **QR code.**
   - Bibliothèque : `qrcode-generator` **2.0.4**, licence MIT, sans dépendance, publiée le 7 août 2025 (largement plus d'une semaine), déjà présente dans `pnpm-lock.yaml` comme dépendance indirecte de `qr-code-styling` : aucun paquet nouveau dans l'arbre de dépendances, seulement une arête directe. Version épinglée exactement (pas de `^`).
   - Rendu : la bibliothèque ne sert qu'à calculer la matrice (`isDark`). Ses méthodes qui produisent du HTML (`createSvgTag`, `createImgTag`, `createDataURL`) ne sont pas utilisées (un test le vérifie) ; le dessin est du SVG React, sans `dangerouslySetInnerHTML`.
   - Contenu encodé : l'adresse seule, en casse EIP-55. Pas d'URI `ethereum:` (certains wallets y voient une demande de paiement en ETH), pas de montant, pas de numéro de chaîne.
   - Niveau de correction d'erreur M, version choisie automatiquement (42 octets, version 3, 29 modules).
10. **Visite guidée : point d'accroche, pas de lancement.** `ProductTour.tsx` n'est pas dans le périmètre (une autre tranche y travaille) et n'expose aucune fonction de relance. Le bouton émet l'événement `sirius:guided-tour:start` (annulable). Le composant de visite doit s'y abonner et appeler `event.preventDefault()` pour dire qu'il prend la demande en charge ; l'exemple complet est dans le commentaire de `src/components/profile/guided-tour.ts`. Sans abonné, le menu affiche « The guided tour will be available soon. » au lieu d'un clic sans effet. **Tant que `ProductTour` ne s'abonne pas, le bouton ne lance rien** (voir section 8).
11. **Réglages et KYB : liens seulement** (`/settings`, `/kyb`). Les pages n'existent pas dans cette branche (tranche A6) : les liens mènent à une page 404 jusqu'à sa fusion. La spécification donne « Réglages » en français ; l'interface est en anglais (« Settings »).
12. **Libellé du jeton de la page Wallet non modifié** (consigne : une autre tranche change cette ligne). Tant qu'elle n'est pas fusionnée, la carte de solde affiche « USDC » sur mainnet alors que le reste de la page dit « MUSD ». À vérifier à la fusion des deux tranches (section 8).
13. **Historique des transactions, retrait général, revenus par dataset, « tout retirer » et achat par carte** : non faits, ce sont des éléments « après le 6 — V1.1 » de la spécification.
14. **Déconnexion factorisée** dans `logout.ts` plutôt que dupliquée : une modification de la déconnexion (révocation de session, intention de l'utilisateur) vaut ainsi pour les deux boutons.

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès côté serveur, route par route.** Cette tranche n'ajoute, ne modifie ni ne supprime aucune route, aucun contrôle d'authentification, aucun cookie. Les seules routes appelées sont existantes et inchangées : `POST /api/faucet` et `GET /api/onramp` (bouton « Add funds » / « Use the bridge », comme avant), `GET /api/wallet/credits` (retraits, inchangé), `signOut` (déconnexion, inchangé). Le bouton profil lui-même n'appelle aucune route : le solde est lu par `eth_call` via le wallet de l'utilisateur. **Rappel transverse : le masquage du bouton profil et le retrait du lien Wallet ne sont pas un contrôle d'accès** ; `/wallet`, `/settings` et `/kyb` restent accessibles par URL et ne s'appuient que sur la session côté serveur pour les données.

**Validation et bornes de chaque entrée.**
- L'adresse (venue du store du wallet, rempli par le navigateur) est validée par `viem.isAddress` en mode strict avant tout affichage : mauvaise longueur, somme de contrôle fausse en casse mixte, espaces, préfixe étranger, URI, HTML et valeurs non textuelles sont refusés (liste testée). Une adresse refusée ne produit ni bouton profil, ni QR code, ni lien ; elle n'est jamais « corrigée ».
- L'adresse affichée, celle copiée, celle encodée dans le QR code et celle du lien explorateur sont la même chaîne `checksummed` (un test lit le HTML rendu).
- Le montant du solde est une chaîne décimale validée par expression régulière (40 chiffres au plus pour chaque partie) avant mise en forme ; tout le reste renvoie `null` (« Balance unavailable. »).
- Le réseau vient de `NEXT_PUBLIC_EVM_NETWORK` (`mainnet` ou `testnet`, sinon exception au chargement, comportement existant).

**Fuites possibles.**
- Le QR code est généré dans le navigateur : aucune requête réseau, aucun service tiers, l'adresse ne part nulle part (un test vérifie l'absence de `fetch`, `XMLHttpRequest`, `sendBeacon` et d'URL dans `qr.ts`, `QrCode.tsx`, `ReceiveFunds.tsx`).
- L'adresse est publique par nature. Aucun journal ajouté. Les erreurs de lecture du solde sont avalées (« Balance unavailable. »), sans message technique affiché.
- Seule l'adresse du compte connecté est affichée ; aucune donnée d'un autre wallet.
- Les liens vers l'explorateur sont construits par `addressExplorerUrl` (hôte issu de `EVM_CHAINS`, adresse passée par `encodeURIComponent`), ouverts avec `target="_blank" rel="noopener noreferrer"`. Un test impose `rel` sur chaque `target="_blank"` du bouton profil. Le pont Across est ouvert par `onramp.ts` (inchangé) avec `noopener,noreferrer`.

**Impact sur l'argent, l'escrow, les contrats, le moteur Phala.**
- Aucun contrat, aucune ABI, aucun moteur Phala touchés. `transaction-guard.ts`, `transaction-client.ts` et `EscrowCredits.tsx` sont intacts (aucun diff) : les retraits passent par la même garde. Le bouton profil n'envoie aucune transaction.
- **Risque nouveau principal, côté utilisateur : l'envoi d'un mauvais jeton ou sur un mauvais réseau vers l'adresse affichée.** Le texte le dit en toutes lettres (« Only send MUSD, on Mezo… may be lost permanently »), recommande un premier petit transfert, la comparaison du début et de la fin de l'adresse, et rappelle que le gas se paie en ETH. L'auditeur doit juger si ces mises en garde suffisent pour la bêta.
- Le QR code encode l'adresse du compte (celui du wallet connecté, qu'il soit externe ou le compte Google intégré). Vérifier que, pour un compte intégré, c'est bien l'adresse qui reçoit les fonds et peut les retirer.
- Le solde affiché dans le menu est lu par `eth_call` sur la chaîne du wallet ; il est masqué (« — ») quand le wallet n'est pas sur le réseau du site. La page Wallet garde sa lecture existante, qui n'a pas ce garde-fou (inchangée).

**Base de données.** Aucune migration, aucune table, aucune colonne.

**Interface : injection HTML, liens, contenus fournis par les utilisateurs.**
- Aucun `dangerouslySetInnerHTML` ni `innerHTML` dans les fichiers de la tranche (tests de présence). Le chemin SVG du QR code ne contient que des commandes numériques (`M x y h n v1 h-n z`), vérifiées par expression régulière dans un test.
- Les trois liens internes (`/wallet`, `/settings`, `/kyb`) sont des constantes.
- Aucun contenu fourni par un utilisateur n'est affiché (seulement l'adresse validée et les libellés fixes).

**Textes : aucune promesse fausse.**
- Aucune affirmation de sécurité sur les modèles ou les fonds. Le texte du pont dit qu'il s'agit d'un service tiers et qu'il faut vérifier qu'il supporte le MUSD. « Les fonds arrivent dès que le transfert est confirmé » est une affirmation sur le fonctionnement normal de la chaîne.
- **Écart à signaler : `src/lib/wallet/onramp.ts` (hors périmètre) affiche encore, après ouverture du pont sur mainnet, « Pont ouvert : envoie de l’USDC vers Mezo depuis un autre réseau »**, ce qui contredit « MUSD » sur la même page. À corriger avec la tranche A8 (MUSD).

**Autres points à vérifier.**
- Dépendance `qrcode-generator` 2.0.4 : épinglée, présente dans le fichier de verrouillage avec empreinte, MIT, sans dépendance. Une version 1.5.2 du même paquet reste dans l'arbre via `qr-code-styling` (inchangée).
- `pnpm audit` : exit 0 ; l'avis `GHSA-vfj7-8cjw-p6xm` est ignoré par la configuration existante.
- La déconnexion a été extraite sans changement d'ordre : `markWalletDisconnected()`, puis `signOut()`, puis `disconnectWallet()`, puis `setDisconnected()` dans le `finally`. Le bouton profil ferme son panneau avant d'appeler la déconnexion et avale une éventuelle erreur (le store est de toute façon vidé).
- Le panneau change de contenu si le compte change panneau ouvert (remontage par clé) ; la réponse tardive du solde d'un ancien compte est ignorée (`cancelled`).

### 4. Cas limites à essayer à la main sur staging

Staging est sur testnet : la vue mainnet (QR code, badge vert, « MUSD ») ne s'y voit pas. Pour la voir, lancer un build local avec `NEXT_PUBLIC_EVM_NETWORK=mainnet` et `EVM_NETWORK=mainnet`, ou attendre la production.

1. **Connecté, testnet.** Ouvrir une page de l'application : le bouton profil (point ambre, adresse courte `0x1234…abcd`) apparaît en haut à droite du contenu. Clic : badge « Mezo testnet » ambre, adresse, boutons « Copy address » et « Explorer », solde « N test MUSD », liens Wallet, Settings, KYB, « Guided tour », « Log out ». Résultat attendu : tout s'affiche, aucun lien Wallet dans le menu latéral.
2. **Copie.** « Copy address » : le bouton passe à « Address copied » pendant environ 2 s ; coller dans un champ : l'adresse complète en casse mixte (EIP-55).
3. **Explorateur.** « Explorer » ouvre un nouvel onglet sur `explorer.test.mezo.org/address/<adresse>` (production : `explorer.mezo.org`).
4. **Échap et clic à l'extérieur** ferment le menu ; avec Échap le focus revient au bouton profil.
5. **Mauvais réseau.** Basculer le wallet sur un autre réseau : message rouge « Wrong network — switch your wallet to testnet. », point rouge sur le bouton, solde remplacé par « — ».
6. **Changement de compte menu ouvert.** Choisir un autre compte dans le wallet : le menu affiche la nouvelle adresse et un solde rechargé, jamais celui de l'ancien compte.
7. **Déconnexion externe menu ouvert.** Déconnecter depuis le wallet : le bouton disparaît ; reconnecter : le menu est fermé.
8. **« Log out »** : session fermée, retour à l'état déconnecté, le bouton profil disparaît ; la barre latérale propose « Connect ».
9. **« Guided tour »** : message « The guided tour will be available soon. » tant que `ProductTour` ne s'abonne pas ; une fois abonné, le menu se ferme et la visite démarre.
10. **Settings, KYB** : 404 tant que la tranche A6 n'est pas fusionnée ; pages réelles ensuite.
11. **Page Wallet, testnet.** Adresse avec lien « View on explorer » ; bouton « Add funds » : comportement du faucet inchangé (`1000 USDC et … ETH envoyés` selon l'instance), message « Starter funds not received » si le faucet a échoué ; pas de section QR code.
12. **Page Wallet, mainnet (build local).** Carte « Add funds » : explication, QR code, adresse complète, copie, lien explorateur. Scanner le QR code avec un téléphone : le texte lu est exactement l'adresse affichée, en casse mixte, sans préfixe. Bouton « Use the bridge » : ouvre le pont (si connecté et authentifié) ; non authentifié, une erreur s'affiche.
13. **Retraits.** Avec un crédit dans l'escrow : le panneau « USDC available to withdraw » et le bouton « Withdraw » fonctionnent comme avant, le solde se rafraîchit après le retrait.
14. **Largeurs.** 390 px, 768 px, 1100 px, 1440 px : le bouton profil ne recouvre aucun titre ni bouton de page ; le panneau tient dans l'écran à 320 px.
15. **Texte agrandi / zoom 200 %** : le panneau reste lisible, l'adresse coupée proprement.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

**Tests unitaires** (ajoutés au script `test`, lancés avec `node --test`) :
- `src/components/profile/profile.test.ts` (13 tests) : badge réseau (libellés, couleurs distinctes, présence dans le dictionnaire anglais), jeton affiché, « mauvais réseau » (sept cas), raccourci d'adresse et refus de seize entrées invalides (null, nombres, espaces, `javascript:`, somme de contrôle fausse…), normalisation EIP-55, formatage des montants (troncature, grands nombres, « <0.0001 », entrées refusées), point d'accroche de la visite guidée (sans abonné, abonné qui accuse réception, abonné qui n'accuse pas), absence du lien Wallet dans `Sidebar.tsx`, présence de `<ProfileMenu />` dans le layout, liens du bouton profil, `rel="noopener noreferrer"` sur tout `target="_blank"`, absence d'`innerHTML`.
- `src/components/wallet/add-funds.test.ts` (7 tests) : choix du parcours mainnet et testnet, QR code (contenu = adresse EIP-55, matrice reconstruite depuis le chemin SVG identique à celle de la bibliothèque, motifs de repérage, zone de silence, refus de valeurs invalides, chemin purement numérique, aucun accès réseau ni HTML injecté dans le code).
- `src/components/wallet/receive-funds.test.ts` (3 tests, rendu serveur dans un processus à part) : sur mainnet, adresse affichée en EIP-55, QR code, textes, lien Blockscout mainnet, aucune trace de l'explorateur testnet ; sur testnet, jeton et explorateur de test ; adresse invalide : rien n'est rendu.
- `english.test.ts` passe (toute clé `t()` de la tranche a sa traduction).

**e2e** (`e2e/profile.spec.ts`, 10 tests Playwright, dont deux largeurs pour le non-chevauchement) : plus de lien Wallet dans le menu latéral ; contenu complet du bouton profil, lien de l'explorateur de test, navigation vers Wallet ; Échap, focus et message de visite guidée sans abonné ; abonné à l'événement de visite guidée ; page Wallet testnet (faucet conservé, pas de QR code, lien explorateur) ; pas de bouton profil déconnecté ; non-chevauchement à 1100 px et 390 px ; wallet sur un autre réseau (avertissement, solde « — », zéro appel `eth_call`) ; déconnexion externe menu ouvert (le menu ne se rouvre pas à la reconnexion). Les e2e existants `wallet.spec.ts`, `account-switch.spec.ts`, `audit-regressions.spec.ts` (dont le retrait d'un ancien escrow) et `responsive.spec.ts` passent avec ceux de la tranche : 70 tests réussis, 0 échec sur ces cinq fichiers. Aucun e2e existant ne cliquait sur le lien Wallet du menu latéral, il n'y a donc rien eu à adapter.

**Ce que les tests ne couvrent pas.**
- **Aucun test e2e du parcours mainnet** : la configuration Playwright fixe `NEXT_PUBLIC_EVM_NETWORK=testnet`. Le rendu mainnet n'est couvert que par le test de rendu serveur de `ReceiveFunds` (réseau passé en propriété) et par les tests unitaires.
- **Le QR code n'est pas décodé** par un lecteur : on vérifie qu'il reproduit la matrice de la bibliothèque et qu'il encode la bonne chaîne, pas qu'un téléphone le lit. À essayer à la main (cas 12).
- Le menu n'est pas testé avec un vrai wallet (extension, compte Google intégré) ni avec un wallet sur un autre réseau.
- La lecture du solde du menu n'est testée qu'avec un wallet simulé ; la gestion de la réponse tardive d'un ancien compte repose sur la relecture du code (drapeau `cancelled`), pas sur un test.
- Le bouton « Use the bridge » est piloté par `addFundsOptions(...).bridge` : le test unitaire fige les valeurs par réseau, aucun test ne vérifie son masquage quand `bridge` vaudrait faux.
- Un compte intégré (connexion sociale) : `fetchUsdcBalance` passe par `getExternalWallet()` ; pour un tel compte le menu affichera « Balance unavailable. », comme la page Wallet (préexistant, non testé).
- Pas de test de lecteur d'écran ni de navigation au clavier complète (le piège de focus du panneau n'existe pas : le focus n'est pas déplacé dans le panneau à l'ouverture).
- L'ordre exact des appels de déconnexion n'a pas de test automatisé propre (l'extraction repose sur la relecture et sur les e2e de connexion existants).

### 6. Hypothèses

- `NEXT_PUBLIC_EVM_NETWORK` est correctement défini au build de chaque environnement (`mainnet` en production, `testnet` sur staging). Si la production était construite avec `testnet`, le badge, les liens d'explorateur et la section d'ajout de fonds seraient ceux du testnet.
- L'MUSD a 18 décimales sur Mezo mainnet et `SIRIUS_USDC_ADDRESS` y désignera le MUSD ([01](01-decisions-avant-samedi.md)) ; la table `USDC_DECIMALS_BY_NETWORK` (6) et le contrôle du script de déploiement font autorité.
- L'adresse du store du wallet est celle qui reçoit et peut retirer les fonds de l'utilisateur (vrai pour un wallet externe ; non vérifié pour le compte Google intégré).
- Un transfert de MUSD standard vers cette adresse suffit à créditer le solde : l'adresse est un compte utilisateur normal, aucune étape côté Sirius.
- Les plateformes d'échange et wallets des utilisateurs supportent Mezo et le MUSD ; non vérifié. Le texte parle d'« une plateforme d'échange qui supporte ce réseau ».
- Le pont Across supporte le MUSD sur Mezo : **non vérifié** (le texte invite l'utilisateur à vérifier).
- Les pages `/settings` et `/kyb` seront créées par la tranche A6 avec ces chemins.
- `ProductTour` s'abonnera à `sirius:guided-tour:start` et appellera `preventDefault()`.
- Le navigateur de l'utilisateur fournit `navigator.clipboard` (contexte sécurisé) ; sinon « Copy failed » s'affiche.

### 7. Risques résiduels et limites connues

- **Envoi d'un mauvais jeton ou sur un mauvais réseau** par un utilisateur pressé : mitigé par le texte, pas par le code (aucun moyen de l'empêcher côté Sirius). Fonds potentiellement perdus pour l'utilisateur.
- **Contradiction de jeton affiché sur mainnet** tant que les tranches A8 et la ligne du libellé de la page Wallet ne sont pas fusionnées : « USDC » (page Wallet, message du pont de `onramp.ts`) contre « MUSD » (le reste). Source de confusion, voir sections 2 et 3.
- **Le bouton « Use the bridge » appelle d'abord `/api/faucet`** : sur mainnet le serveur répond 503, puis le pont s'ouvre. Tout autre statut (non authentifié, limitation de débit) affiche une erreur au lieu d'ouvrir le pont. `window.open` est appelé après deux appels réseau : Safari peut bloquer la fenêtre. Comportement hérité de `onramp.ts`, non modifié.
- **Le solde de la page Wallet n'est pas protégé contre une réponse tardive d'un appel plus ancien** (deux rafraîchissements qui se chevauchent : le dernier terminé gagne). Préexistant, non corrigé ici ; le changement de compte est couvert par le remontage de la page.
- **Le solde de la page Wallet est lu sur la chaîne du wallet** même en cas de mauvais réseau (préexistant).
- **Le bouton profil défile avec la page** (voir section 2, point 1).
- **Deux boutons affichant la même adresse** (profil et barre latérale) : redondant visuellement.
- **Liens Settings et KYB morts** jusqu'à la fusion de A6.
- **Visite guidée inopérante** jusqu'à ce que `ProductTour` s'abonne.
- La permission de copie du presse-papiers peut être refusée par le navigateur (« Copy failed »).
- Aucune règle de Content-Security-Policy n'a été ajoutée ; le QR code est du SVG intégré, donc sans impact sur une CSP stricte (pas d'image `data:`).

### 8. Reste à faire

Priorité haute (avant le lancement) :
1. **Fusionner la ligne du libellé du jeton** de `wallet/page.tsx` (autre tranche) : `t(stablecoinSymbol(NETWORK))` de `src/components/profile/network.ts` peut être réutilisé. Vérifier que la carte de solde dit « MUSD » sur mainnet.
2. **Corriger le message du pont dans `src/lib/wallet/onramp.ts`** (« envoie de l’USDC… » → MUSD) avec la tranche A8.
3. **Abonner `ProductTour`** à `GUIDED_TOUR_EVENT` (exemple dans `guided-tour.ts`), puis retirer le message « bientôt disponible » devenu inutile.
4. **Vérifier que le pont Across supporte le MUSD** ; sinon masquer le bouton « Use the bridge » sur mainnet via `addFundsOptions` (champ `bridge`) et ne garder que le transfert.
5. **Essayer le QR code à la main** avec au moins deux applications de wallet (cas 12).

Priorité moyenne :
6. Faire apparaître le lien Wallet pour un visiteur non connecté si le produit le souhaite (aujourd'hui l'URL seule).
7. Rendre le bouton profil visible en permanence (barre fixe qui réserve sa place) si un besoin produit le justifie ; voir section 2, point 1.
8. Protéger le solde de la page Wallet contre la réponse tardive d'un appel plus ancien, et le masquer en cas de mauvais réseau.
9. Test e2e du parcours mainnet (nécessite une seconde configuration Playwright avec `NEXT_PUBLIC_EVM_NETWORK=mainnet`).

V1.1 (spécification 05) : historique des transactions, retrait général avec vérification d'adresse, revenus par dataset, « tout retirer », achat par carte.

### 9. Résultats des vérifications

Environnement : Windows 11, Node, pnpm 11.18.0 lancé par `npx pnpm@11.18.0` (le lanceur local `pnpm` échoue avec « Failed to switch pnpm to v11.18.0 », problème d'installation locale, sans rapport avec le code). `DATABASE_URL=postgresql://x:y@localhost:5432/z`.

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | OK après ajout de la dépendance ; le premier essai sans `DATABASE_URL` échoue dans le `postinstall` (`prisma generate` exige la variable) : échec d'environnement, résolu en la fournissant. |
| `pnpm prisma generate` | OK (« Generated Prisma Client (7.8.0) »), exécuté par le `postinstall`. |
| `pnpm exec tsc --noEmit` | OK, aucune erreur (avec `--incremental false` : un fichier `tsconfig.tsbuildinfo` périmé produisait des erreurs fantômes, supprimé). |
| `pnpm lint` | OK, 0 erreur, 0 avertissement. |
| `pnpm test` | **Échec d'environnement Windows.** Le script `NODE_OPTIONS="…" node …` n'est pas exécutable par `cmd.exe` (« 'NODE_OPTIONS' n'est pas reconnu »). Même commande lancée à la main avec `NODE_OPTIONS` : 553 tests, 478 réussis, 75 échecs. **Les 75 mêmes échecs existent sur `origin/staging` seul** (530 tests, 455 réussis, 75 échecs ; comparaison des noms de tests : aucune différence). Causes : séparateurs de chemin Windows (`src\app\…` contre `src/app/…`), scripts bash et volumes du runner. Les 23 tests de la tranche passent. À rejouer sous Linux (CI). |
| `pnpm audit:deps` | OK, code de sortie 0 : « 2 vulnerabilities found, 1 low, 1 high (1 ignored) », sans lien avec la tranche (avis existant ignoré par la configuration). |
| `node --test` des trois fichiers de la tranche + `english.test.ts` | OK : 13 + 7 + 3 + 7 = 30 tests réussis, 0 échec. |
| Playwright : `profile.spec.ts`, `wallet.spec.ts`, `account-switch.spec.ts`, `audit-regressions.spec.ts`, `responsive.spec.ts` | 70 tests réussis, 0 échec (délai de test relevé à 120 s en local pour absorber la compilation à froid du serveur de développement ; `profile.spec.ts` fixe 90 s). |
| `git diff --name-only staging...HEAD` | Uniquement des fichiers autorisés (liste dans la PR). |
| `git log staging..HEAD --format=%B` | Aucune signature d'assistant, aucun `Co-Authored-By`, aucun lien de session. |

### 10. Revue interne de la session

Trois passes de revue adversariale (agents en lecture seule, angles distincts), plus mes propres relectures.

**Passe 1 — sécurité de l'adresse et du QR code.** Rien de bloquant. Confirmé : l'adresse affichée, copiée et encodée est une seule chaîne validée ; pas d'injection HTML ; liens protégés ; QR local ; dépendance correcte et présente dans le verrou ; capacité du QR suffisante.
- Corrigé : **solde lu sur la chaîne du wallet** même en cas de mauvais réseau → le menu ne lit plus rien dans ce cas et affiche « — » ; **solde non nul affiché « 0 »** par la troncature → « <0.0001 » ; test ajouté.
- Écarté, hors périmètre ou préexistant : libellé « USDC » de la carte de solde de la page Wallet (ligne réservée à une autre tranche : consigné en sections 2, 7 et 8) ; réponse tardive d'un ancien appel sur la page Wallet (préexistant, non régressif).
- Remarque prise en compte : `ReceiveFunds` ne rend rien si l'adresse est invalide (voulu).

**Passe 2 — non-régression et e2e.** Confirmé sans diff : `EscrowCredits.tsx`, `src/lib/wallet/**` ; `ConnectButton` équivalent (ordre, `finally`, imports) ; les sélecteurs des e2e existants ne rencontrent pas le bouton profil (nom accessible « Profile menu », `role="dialog"`) ; parcours testnet du faucet identique ; hooks dans l'ordre.
- Corrigé : **bouton fixe recouvrant les actions à droite des en-têtes** (Marketplace, Mes datasets, de 768 à 1500 px) → bouton en flux, deux e2e de non-chevauchement ajoutés ; **menu rouvert tout seul après une déconnexion externe** → fermeture quand l'adresse disparaît ; **libellé « Envoi en cours… » faux pour le pont** → « Opening the bridge… ».
- Écarté : le bouton « Use the bridge » appelle d'abord le faucet (comportement de `onramp.ts`, hors périmètre ; consigné en section 7) ; Échap qui ferme aussi un autre dialogue (le fond du panneau bloque l'interaction, cas improbable) ; absence de lien Wallet hors connexion (voulu par la spécification, consigné) ; « Guided tour » sans abonné (limite connue, documentée).

**Passe 3 — contrôle des correctifs des passes 1 et 2.** Aucune régression trouvée, aucun fichier hors périmètre (23 fichiers modifiés, tous autorisés) ; `setOpen` pendant le rendu validé (motif React autorisé, hooks dans l'ordre) ; toutes les clés `t()` des trois composants ont une traduction.
- Corrigé : focus perdu après « Guided tour » (retour au bouton profil quand la visite démarre) ; deux régions nommées « Profile menu » dans le dialogue (la navigation interne s'appelle « Navigation ») ; correctifs de la passe 1 sans test → deux e2e ajoutés (wallet sur un autre réseau : solde « — » et zéro `eth_call` ; déconnexion externe : menu non rouvert) ; champ `bridge` de `addFundsOptions` jamais lu → il pilote désormais l'affichage du bouton « Use the bridge » (le mettre à faux le masque si Across ne supporte pas le MUSD).
- Écarté : focus après un clic sur un lien du menu (le focus suit la navigation) ; solde périmé affiché un instant au retour sur le bon réseau (jusqu'à la fin de la nouvelle lecture).

**Corrections de mon fait, hors revue.** Erreur de TypeScript fantôme due à un fichier d'index incrémental périmé (supprimé) ; déclaration globale `window.__SIRIUS_E2E__` dupliquée dans mon e2e, qui entrait en conflit avec celle du pont de test (retirée, le type du pont est réutilisé) ; imports inutilisés dans un test.

---

## A6 — Réglages et KYB

Branche `feat/reglages-kyb`, PR vers `staging`. Tout ce qui suit est vérifiable depuis `git diff staging...HEAD`.

### 1. Ce qui a changé

**Pages (nouvelles)**
- `src/app/(app)/settings/page.tsx` : page `/settings`, simple enveloppe de `SettingsView`.
- `src/app/(app)/kyb/page.tsx` : page `/kyb`, simple enveloppe de `KybView`. Les deux sont sous le layout `(app)` existant (menu, bouton profil, tutos), sans le modifier.

**Route (nouvelle, lecture seule)**
- `src/app/api/kyb/status/route.ts` : `GET /api/kyb/status`. `requireAuth` (adresse tirée de la session, jamais de la requête), limiteur 30 requêtes par minute par wallet (300 au total), réponse `cache-control: private, no-store`. Lit sur le registre KYB `isKybValid(adresse)` et `attestationOf(adresse)` en parallèle, et renvoie `{ valid, expiresAt, revoked }` (`expiresAt` en secondes Unix, `null` sans attestation, c'est-à-dire quand `verifier` est l'adresse nulle). Lecture du contrat en échec : 503 « Statut KYB indisponible ». Aucune écriture, aucune base de données. C'est la seule route ajoutée ; elle est nécessaire parce que la date d'expiration n'est exposée par aucune route existante (`/api/account/status` ne rend que `known`).

**Composants (`src/components/settings/`, nouveaux)**
- `SettingsView.tsx` : réseau (lecture seule), langue, bouton « Restart guided tour », éléments « Soon ».
- `KybView.tsx` : état KYB, formulaire d'invitation existant (`KybInviteForm`, non modifié), contact, éléments « Soon ».
- `SoonItem.tsx` : élément grisé (`opacity-50`, non interactif) avec la mention « Soon ».
- `settings-logic.ts` : logique pure du réseau (`networkInfo`), de la langue (`savedLanguage`), constantes (`TESTNET_SITE_URL`, `KYB_CONTACT_EMAIL`, listes « Soon »).
- `kyb-state.ts` : logique pure de l'état KYB (`parseKybStatus`, `parsePublicKybStatus`, `showsInvitationForm`, `formatKybDate`).
- `settings.test.ts` : tests, voir §5.

**Branchement du bouton « Guided tour » (modifications minimales)**
- `src/components/tour/tour-store.ts` : nouvelle fonction `subscribeGuidedTourRequests(target = window, restart = restartWelcomeTour)` (+ un import de `GUIDED_TOUR_EVENT`). Elle écoute `sirius:guided-tour:start`, appelle `preventDefault()` (l'accusé de réception que `requestGuidedTour` attend) puis relance le tuto d'accueil. Elle renvoie la fonction de désabonnement.
- `src/components/layout/ProductTour.tsx` : un seul `useEffect(() => subscribeGuidedTourRequests(), [])` (+ l'import). `ProductTour` est monté une fois dans le layout `(app)`, comme `ProfileMenu` : l'abonné existe donc partout où le bouton existe. Le message « La visite guidée sera bientôt disponible. » n'apparaît plus (le code de repli du menu reste, inatteignable tant que `ProductTour` est monté ; il n'a pas été touché, `ProfileMenu.tsx` n'étant pas dans le périmètre).

**Traductions** : `src/lib/i18n/settings-en.ts` (nouveau), fusionné dans `EN_MESSAGES` par `src/lib/i18n/english.ts` (+2 lignes : import et `...SETTINGS_MESSAGES_EN`). Les textes de ces pages sont écrits directement en anglais (clé = valeur), sauf trois messages en français (`Connecte un wallet pour enregistrer tes réglages.`, `Connecte un wallet pour voir ton statut KYB.`, `Statut KYB indisponible`), et réutilisent `Réglages`, `Visite guidée`, `KYB`, `Connecter un wallet` déjà traduits.

**Tests** : `package.json`, `src/components/settings/settings.test.ts` ajouté à la fin du script `test` (une seule ligne touchée). `e2e/settings-kyb.spec.ts` (nouveau, 7 scénarios). `e2e/profile.spec.ts` modifié : l'ancien scénario « la visite guidée sans abonné dit bientôt disponible » décrivait le comportement supprimé ; il est remplacé par « Échap ferme le menu et rend le focus » et par « Guided tour relance le tuto d'accueil, sans message bientôt disponible ». Le scénario « un abonné à l'événement est prévenu » est inchangé.

**Base de données, contrats, tables, colonnes** : aucun changement. Pas de migration. `UserProfile.kybStatus` et `kybCheckedAt` ne sont ni lus ni écrits par cette slice (voir §2, point 4).

### 2. Décisions et écarts par rapport au cahier des charges

1. **Une route ajoutée alors que le cahier n'en prévoyait « qu'en cas de stricte nécessité ».** La date d'expiration n'est accessible par aucune fonction existante utilisable depuis le navigateur : `prepareKybAcceptance` / `persistAccepted` (`src/lib/sirius/kyb.ts`) sont des fonctions serveur qui lisent `attestationOf` mais écrivent dans la table `Credential` et ne sont pas exposées en lecture. Une route en lecture seule, sans effet de bord, est le plus petit ajout.
2. **Deux niveaux de lecture selon la session.** Avec une session signée : `GET /api/kyb/status` (état complet, date). Wallet connecté mais sans session : repli sur `GET /api/account/status?address=` (public, existant, `known` seulement) : on peut afficher « Verified » ou « Not verified » mais pas la date. Sans wallet : aucun appel, message de connexion.
3. **Cinq états plus « inconnu », pas deux.** « Vérifié », « expiré » (date passée), « révoqué », « inactif » (attestation ni expirée ni révoquée mais refusée par `isKybValid`, par exemple vérificateur retiré ou époque changée : jamais présentée comme « expirée » avec une date future), « absent », et « inconnu » (réponse en échec, 401, 429, 503, JSON invalide, forme inattendue). « Inconnu » n'affiche ni « Verified », ni « Not verified », ni le formulaire, seulement « Status unavailable » et « Retry » : une panne RPC ne doit jamais faire croire à un utilisateur vérifié qu'il ne l'est plus, ni l'inverse. Le formulaire n'apparaît que pour absent, expiré, révoqué, inactif.
4. **Source de vérité = le contrat.** Le statut affiché vient de `isKybValid` et `attestationOf`. La colonne `UserProfile.kybStatus` (cache d'affichage prévu en V1.2) n'est ni lue ni écrite : la lire aurait introduit une seconde source pouvant diverger. Le point « Alimenter `kybStatus` depuis le contrat » du tableau des priorités (couloir A6, ligne 234 de ce fichier) n'est donc **pas** traité par cette slice (voir §8).
5. **Date en UTC**, formatée côté navigateur (`toLocaleDateString` avec `timeZone: "UTC"`) et suffixée « (UTC) » : pas de décalage d'un jour selon le fuseau.
6. **Langue : un seul choix, un bouton « Save ».** Avec une seule option, un `<select>` ne déclenche jamais `onChange` ; l'enregistrement passe donc par un bouton, activé seulement si la valeur affichée diffère de celle enregistrée (`PATCH /api/profile` avec `{ settings: { language: "en" } }`, la seule valeur acceptée par `PROFILE_LANGUAGES`). Aucune écriture automatique à l'affichage de la page. Sans session, le bouton est désactivé avec une explication.
7. **Pas d'interrupteur testnet/mainnet.** Le réseau vient de `resolveClientNetwork()` (variable d'environnement du build), affiché en texte. Le lien « Try it on testnet » (`https://sirius-mezo-staging.vercel.app`, `rel="noopener noreferrer"`, nouvel onglet) n'existe que sur mainnet.
8. **Rôle du formulaire d'invitation** : `provider` (route `/api/provider/onboard`). Les deux routes d'onboarding (`provider` et `borrower`) sont strictement identiques (`diff` vide) : le choix n'a pas d'effet, et la page n'a pas de notion de rôle.
9. **Textes « Soon »** : les descriptions reprennent les listes de `13-reglages.md` et `14-kyb.md` (notifications ; préférences d'affichage ; menu replié par défaut ; vérification en ligne sans invitation ; avantages : badge « Fournisseur vérifié », plafonds plus élevés après la bêta, accès anticipé). Ces éléments sont grisés, sans bouton ni lien ; ce sont des annonces, pas des engagements de date.
10. **Textes écrits en anglais directement** (clé = valeur) plutôt qu'en français puis traduits, pour ces deux pages. L'interface n'a qu'une langue ; si le français arrive, ces textes devront recevoir une clé française.
11. **Modification de `e2e/profile.spec.ts`** hors de la liste des fichiers autorisés : inévitable, car le scénario testait précisément le comportement « bientôt disponible » que le cahier demande de supprimer.
12. **Identité des commits** : configuration git du dépôt, aucune ligne de signature d'assistant (vérifié par `git log staging..HEAD --format=%B`).

### 3. Ce que l'audit doit vérifier

- **Contrôle d'accès côté serveur.** Une seule route ajoutée : `GET /api/kyb/status`. Elle commence par `requireAuth(req)` (401 sans session) ; l'adresse lue est `session.address`, aucun paramètre ni corps n'est lu. Il est donc impossible d'interroger le statut d'un autre wallet par cette route. `GET`/`PATCH /api/profile` (A1) et `GET /api/account/status` (existant, public, par adresse, déjà limité à 30 requêtes par minute et par client) sont réutilisés sans modification. Les pages elles-mêmes ne contrôlent rien : le masquage ou l'affichage d'un lien n'est jamais un contrôle d'accès (règle transverse). Les deux pages sont publiques par construction ; elles n'affichent aucune donnée sans le wallet connecté.
- **Validation et bornes.** Aucune entrée utilisateur dans la route. Côté client, `parseKybStatus` n'accepte que `valid` et `revoked` booléens et `expiresAt` entier sûr positif ou nul ou `null` ; tout autre forme (y compris `valid: true` avec `revoked: true`, jamais produit par le contrat) donne « inconnu ». `parsePublicKybStatus` n'accepte que `known` booléen. La langue lue de `/api/profile` n'est retenue que si elle appartient à `["en"]`. Le seul champ saisi par l'utilisateur est le code d'invitation du formulaire existant (non modifié).
- **Fuites possibles.** La route ne renvoie que trois champs du wallet de la session (état, échéance, révocation) ; pas d'adresse du vérificateur, pas d'`issuedAt`, pas de `verifierEpoch`. Messages d'erreur : « Statut KYB indisponible » (503) sans détail RPC, le reste passe par `errorResponse` (401, 429). Aucun `console.log` ajouté. `cache-control: private, no-store`. Vérifier qu'un échec du RPC n'écrit pas l'URL du RPC dans les journaux serveur (`errorResponse` est inchangé).
- **Impact sur l'argent, l'escrow, les contrats, Phala.** Aucun. Lecture seule de deux fonctions `view` du registre KYB ; aucune transaction, signature ou écriture. Le seul flux qui écrit (acceptation d'une invitation, signature wallet puis transaction) est celui du formulaire existant, appelé tel quel.
- **Base de données.** Aucune migration, aucune requête. La route n'utilise pas Prisma. `PATCH /api/profile` est appelé avec `{ settings: { language: "en" } }` seulement ; il fusionne clé par clé (comportement A1) et ne touche ni `sidebarCollapsed` ni les tutos.
- **Interface : injection HTML, liens.** Aucun `dangerouslySetInnerHTML`. Textes en constantes passées à `t()`, valeurs dynamiques (`date`) passées par variables de traduction, rendues par React. Liens : `mailto:sirius.data.contact@gmail.com` (constante), `https://sirius-mezo-staging.vercel.app` (constante, `rel="noopener noreferrer"`). Aucun contenu fourni par un utilisateur n'est affiché.
- **Textes : aucune promesse fausse.** Relire `src/lib/i18n/settings-en.ts` et `settings-logic.ts`. Points sensibles : (a) « Business verification, recorded on-chain. It is required to lend and to borrow datasets on mainnet. » est exact d'après `14-kyb.md` (registre strict sur mainnet) ; (b) les avantages (badge, plafonds plus élevés, accès anticipé) sont présentés comme « Soon » et grisés, jamais comme acquis ; (c) « Online verification without an invitation ... be verified by a Sirius verifier » décrit la V1.2 prévue, sans date ; (d) « The status is read from the KYB registry contract. » est exact (`isKybValid`) ; (e) « We could not read your KYB status. This does not mean you are not verified. » ; (f) « Your attestation was revoked. Contact the Sirius team. » suppose que l'adresse de contact reste valide.
- **Non-régression du bouton profil et des tutos.** `ProfileMenu.tsx` n'est pas modifié. Seul changement de comportement : le clic sur « Guided tour » ferme le menu (le focus revient au bouton profil) et ouvre le tuto d'accueil. Vérifier que le tuto d'accueil ne s'écrit en base qu'à sa fermeture, pour un wallet authentifié (comportement A3, inchangé), et qu'une relance ne remet pas `tourCompletedAt` à zéro.
- **Remontage du composant d'état KYB.** `KybStatusCard` a une `key` `adresse:authenticated` : un changement de wallet ou l'ouverture de la session recharge l'état depuis zéro et annule la lecture en cours (drapeau `cancelled`). Vérifier qu'aucune réponse tardive d'un ancien wallet ne s'affiche.

### 4. Cas limites à essayer à la main sur staging

1. **Menu profil, « Guided tour ».** Connecté, ouvrir le menu, cliquer « Guided tour » depuis `/explorer`, `/marketplace` et `/settings`. Attendu : le menu se ferme, la fenêtre « Welcome to Sirius » s'ouvre à l'étape 1, aucun message « available soon ». Échap la ferme, le focus revient.
2. **Settings sans connexion.** Ouvrir `/settings` sans wallet. Attendu : message de connexion, réseau « Mezo testnet », aucun lien « Try it on testnet », trois éléments grisés « Soon », bouton « Restart guided tour » qui ouvre quand même le tuto.
3. **Settings connecté.** Cliquer « Save » : « Language saved. » et le bouton se désactive. Recharger : le bouton reste désactivé (valeur relue de `/api/profile`). Couper `/api/profile` (outils du navigateur) puis « Save » : message d'erreur, la page reste utilisable.
4. **Settings sur mainnet** (build avec `NEXT_PUBLIC_EVM_NETWORK=mainnet`). Attendu : « Mezo mainnet » et le lien « Try it on testnet » vers `https://sirius-mezo-staging.vercel.app`, qui s'ouvre dans un nouvel onglet.
5. **KYB, wallet non vérifié.** Attendu : « Not verified », formulaire « KYB invitation code », « No invitation? Write to us: sirius.data.contact@gmail.com ». Coller une invitation valide, confirmer dans le wallet : la page se recharge et affiche « Verified » avec « Attestation valid until <date> (UTC) ». Comparer la date à `attestationOf(adresse).expiresAt` sur l'explorateur.
6. **KYB, wallet vérifié.** Aucun formulaire. La date correspond à celle du contrat.
7. **KYB, attestation expirée** (inviter avec la durée minimale, attendre) : « Not verified » et « Your attestation expired on <date> (UTC) », formulaire visible.
8. **KYB, attestation révoquée** (`revoke` par le vérificateur) : « Your attestation was revoked. », formulaire visible.
9. **KYB, vérificateur retiré** de la liste après l'attestation : « Not verified », « no longer accepted by the registry », formulaire visible, **jamais** une date passée.
10. **KYB, RPC en panne** (bloquer `/api/kyb/status` ou couper le RPC) : « Status unavailable », bouton « Retry », ni « Verified » ni formulaire. « Retry » relit.
11. **KYB sans session signée** (wallet connecté, signature refusée) : « Verified » ou « Not verified » sans date ; invitation « Sign in with your wallet to accept an invitation. » à la place du formulaire.
12. **Changement de compte** dans l'extension pendant que `/kyb` est ouvert : l'état de l'ancien compte disparaît, celui du nouveau se charge.
13. **Mobile 320 px et texte agrandi.** Pas de défilement horizontal ; les cartes passent à la ligne.
14. **Accessibilité** : navigation au clavier (Tab dans l'ordre, champs étiquetés, `<select>` nommé « Language »), message « Language saved. » annoncé (`role="status"`), message d'erreur annoncé (`role="alert"`).

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

**`src/components/settings/settings.test.ts`** (ajouté au script `test`) :
- réseau : libellé et lien vers le testnet seulement depuis mainnet ;
- langue : valeur connue lue, tout le reste (`null`, texte, objet vide, `fr`, tableau) ignoré ;
- état KYB : valide, expiré (avec horloge injectée), inactif (non expiré mais refusé), révoqué, absent ; réponses douteuses (`null`, types faux, entier négatif ou décimal, `valid` et `revoked` ensemble, objet d'erreur) toujours « inconnu » ; état public seulement attesté ou non ;
- le formulaire d'invitation n'apparaît jamais pour « vérifié » ni « inconnu » ;
- date d'expiration en UTC (31 décembre / 1er janvier à la seconde près) et date hors bornes ;
- branchement de la visite guidée : `requestGuidedTour` rend `false` sans abonné, `true` avec, le tuto est relancé une fois, puis `false` après désabonnement.
`english.test.ts` (existant) vérifie que chaque clé statique des nouveaux fichiers a une traduction.

**`e2e/settings-kyb.spec.ts`** (7 scénarios, API simulées) : `/settings` sans connexion (réseau, pas de lien testnet, pas d'interrupteur, trois éléments « Soon », bouton de visite guidée) ; `/settings` connecté (PATCH exact `{ settings: { language: "en" } }`, message, bouton désactivé, relance du tuto) ; échec d'enregistrement ; `/kyb` sans connexion ; `/kyb` non vérifié (formulaire et `mailto:`) ; `/kyb` vérifié (date `January 1, 2027 (UTC)`, pas de formulaire) ; `/kyb` en échec (« inconnu », puis « Retry »). `e2e/profile.spec.ts` : nouveau scénario du bouton « Guided tour ».

**Ce que les tests ne couvrent pas** : la route `GET /api/kyb/status` n'a pas de test (elle dépend du client RPC et de `requireAuth`, sans harnais de test dans le dépôt) ; sa lecture du contrat n'a donc été vérifiée que par relecture et par `tsc` ; le rendu mainnet (lien testnet) est testé par la logique, pas par l'e2e (la suite tourne en testnet) ; l'état « expiré » et « révoqué » n'ont pas de scénario e2e ; le flux complet d'acceptation d'invitation n'est pas rejoué (formulaire existant) ; le comportement réel de focus et du lecteur d'écran n'est pas automatisé.

### 6. Hypothèses

- `isKybValid` retourne vrai exactement quand l'attestation existe, n'est pas révoquée, n'est pas expirée et que le vérificateur est actif avec la même époque (d'après `contracts/src/SiriusKybRegistry.sol`, lignes 224 à 232, relues mais pas rejouées on-chain).
- `attestationOf` d'une adresse sans attestation renvoie la structure à zéro, donc `verifier` est l'adresse nulle (comportement d'un `mapping` Solidity). La route s'en sert pour distinguer « absent ».
- Le contrat compare l'expiration à `block.timestamp`, la page à l'horloge du navigateur : un écart de quelques secondes peut afficher « expiré » ou « inactif » un instant avant ou après le contrat. Sans conséquence, seul le contrat décide.
- `NEXT_PUBLIC_EVM_NETWORK` est correctement posé au build de chaque site (production en `mainnet`, staging en `testnet`) ; la page n'affiche que cette valeur.
- `https://sirius-mezo-staging.vercel.app` est bien l'adresse du site de staging et `sirius.data.contact@gmail.com` une adresse relevée (valeurs données par le cahier des charges).
- Les deux routes d'onboarding sont équivalentes (vérifié par `diff`), donc `role="provider"` convient à tout utilisateur.
- Le store wallet distingue bien « connecté » (`connected`) et « session signée » (`authenticated`).

### 7. Risques résiduels et limites connues

- **Non vérifié sans session** : « Verified » vient de `/api/account/status`, mis en cache 30 secondes côté serveur ; juste après une acceptation, l'état peut mettre jusqu'à 30 secondes à se mettre à jour pour un wallet sans session. Avec session, la route n'a pas de cache.
- **Une lecture RPC par chargement de page** de `/kyb` pour un wallet connecté (limitée à 30 par minute et par wallet). Pas de partage avec le cache du catalogue.
- **Date affichée en anglais uniquement** (`en-US`) tant que `locale` est toujours `"en"`.
- **Éléments « Soon » non focalisables** et lus par un lecteur d'écran comme une liste ordinaire avec la mention « Soon » ; l'état « désactivé » n'est porté que visuellement (l'attribut ARIA `aria-disabled` n'est pas valide sur un `<li>`, signalé par le lint).
- **Dérive possible entre l'interface et `PROFILE_LANGUAGES`** : la liste des langues (`LANGUAGE_CHOICES`) est dupliquée côté client (le module profil est `server-only`). Si le français est ajouté côté serveur, il faut l'ajouter ici aussi (le serveur refuserait de toute façon une valeur inconnue, 400).
- **Tests Windows** : voir §9. Les échecs de la suite `pnpm test` en local sous Windows ne concernent pas cette slice.

### 8. Reste à faire

- **Priorité haute (avant mainnet)** : alimenter `UserProfile.kybStatus` et `kybCheckedAt` depuis le contrat (ligne du tableau de priorités du couloir A6), et préciser que `null` signifie « inconnu ». Non fait ici : la page lit directement le contrat. À faire dans une slice dédiée si un badge « Vérifié » doit s'afficher ailleurs sans lecture RPC.
- **Priorité moyenne** : test de la route `GET /api/kyb/status` avec un client RPC simulé ; scénarios e2e « expiré » et « révoqué » ; rendu e2e en mainnet.
- **Priorité moyenne** : relance de l'attestation avant expiration avec un rappel (V1.2 de `14-kyb.md`).
- **Priorité basse** : parcours de vérification sans invitation (V1.2) ; notifications, préférences d'affichage, menu replié par défaut (`sidebarCollapsed` existe déjà côté base et API mais n'est pas branché) ; français.
- **Priorité basse** : retirer de `ProfileMenu.tsx` le repli « bientôt disponible » devenu inatteignable (fichier hors périmètre de cette slice).

### 9. Résultats des vérifications

Environnement : Windows 11, Node via `npx -y pnpm@11.18.0 --config.script-shell=bash`, `DATABASE_URL=postgresql://x:y@localhost:5432/z`, Playwright sur un port autre que 3100.

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | installation faite ; le `postinstall` (`prisma generate`) échoue sans `DATABASE_URL` (comportement connu), `prisma generate` relancé à part avec l'URL factice : « Generated Prisma Client (7.8.0) » |
| `tsc --noEmit` | 0 erreur |
| `pnpm lint` | 0 erreur, 0 avertissement |
| `pnpm test` | voir ci-dessous |
| `pnpm audit:deps` | 2 vulnérabilités : 1 basse, 1 haute (1 ignorée par la configuration du dépôt) ; commande en succès (code de sortie 0) |
| Playwright (suite complète, port 3187, configuration temporaire non versionnée) | 105 scénarios : 103 réussis du premier coup, 2 en échec (`responsive.spec.ts`, « les profils du catalogue restent dans leur carte », 1024 px et 390 px texte agrandi : délai d'attente de la fiche marketplace pendant la compilation à froid du serveur de développement, sous la charge de la suite). Relancés seuls : 7 sur 7 réussis. Les 7 scénarios de `settings-kyb.spec.ts` et les scénarios de `profile.spec.ts` passent. |

`pnpm test` sous Windows : 694 tests, 622 réussis, 72 en échec. Les 72 échecs sont tous hors de cette slice et dus à l'environnement Windows : séparateurs de chemin `\` dans les tests de routes et d'imports (`self-training-routes.test.ts`, `disclaimers.test.ts`), et tests du runner, du budget et de l'anti-rejeu qui lancent des processus Linux ou SQLite (`initialize-runner-volume`, `runner-cli`, `budget`, `replay`, etc.). Aucun test de `english`, `settings`, `profile`, `tour`, `kyb` ou `marketplace` n'échoue ; le test `english.test.ts` « toutes les clés statiques … ont une traduction » passe. À confirmer sur la CI Linux.

### 10. Revue interne de la session

Deux passes de revue adversariale, menées par l'auteur de la slice (relecture du code et des états, sans agent séparé).

**Passe 1 — accès, exactitude des états KYB, bouton profil.**
- Trouvé : un état « expiré » affiché avec une **date future** quand l'attestation n'est ni expirée ni révoquée mais refusée par le contrat (vérificateur retiré ou époque changée). Corrigé : état « inactif » distinct, `parseKybStatus` reçoit l'horloge, test ajouté.
- Trouvé : le test e2e « lecture en échec » comptait les appels réseau et échouait à cause du double effet du mode de développement de React. Corrigé : l'échec est piloté par un drapeau et non par un compteur.
- Trouvé : `new Error("profile")` dans `SettingsView` faisait échouer le contrôle de traduction (qui traite tout `Error(...)` comme message exposé). Corrigé : retour anticipé avec état d'erreur, sans exception.
- Trouvé : un `<li>` avec `aria-disabled` (avertissement lint). Retiré (voir §7).
- Vérifié : l'adresse de la route vient de la session ; aucune donnée d'un autre wallet ; la réponse d'un ancien wallet est annulée au changement de `key`.

**Passe 2 — non-régression du menu profil et des tutos.**
- Trouvé : l'ancien scénario e2e « bientôt disponible » devenait faux. Remplacé (voir §1).
- Vérifié : `ProfileMenu.tsx` inchangé ; le désabonnement du `useEffect` est bien appelé au démontage ; `restartWelcomeTour` démarre le contrôleur s'il ne l'est pas ; un tuto relancé n'écrit rien en base sans wallet authentifié.
- Vérifié : l'abonnement est unique (un seul `ProductTour` dans le layout) : un seul tuto s'ouvre par clic.
- Écarté : afficher la date d'expiration aussi pour un wallet sans session (nécessiterait une route publique renvoyant l'échéance de n'importe quelle adresse : fuite d'information inutile).
- Écarté : lire `UserProfile.kybStatus` pour accélérer la page (deuxième source de vérité, voir §2).

Une troisième lecture n'a rien trouvé de nouveau.

---

## A7 — Explorer

Branche `feat/explorer`, base `staging` (tête `2990a9f` au moment du départ). Cahier des charges : [11-explorer.md](11-explorer.md), partie « Avant le 6 ».

### 1. Ce qui a changé

**Fichiers modifiés (tous dans le périmètre autorisé de la slice) :**

| Fichier | Changement |
|---|---|
| `src/app/(app)/audit/page.tsx` → `src/app/(app)/explorer/page.tsx` | Page déplacée (`git mv`, historique conservé) puis réécrite. L'ancien dossier `audit/` n'existe plus. Composant `AuditPage` → `ExplorerPage`. |
| `next.config.ts` | Ajout de `redirects()` : `/audit` → `/explorer`, `permanent: true` (HTTP 308). |
| `src/components/layout/Sidebar.tsx` | Une seule ligne : `{ href: "/audit", label: "Audit" }` → `{ href: "/explorer", label: "Explorer" }`. Le `href` change aussi : sinon chaque clic passerait par la redirection et l'onglet actif (`pathname === href`) ne s'allumerait jamais. |
| `src/lib/i18n/english.ts` | 6 clés exclusives à l'ancienne page supprimées, 13 clés ajoutées (voir ci-dessous). |
| `e2e/audit-regressions.spec.ts` | Test « Audit remplace l'historique… » renommé et adapté ; 8 tests ajoutés (voir §5). |
| `e2e/sirius.spec.ts` | `goto("/explorer")` et titre `Explorer` (au lieu de `Audit ledger`). |
| `e2e/responsive.spec.ts` | `openLayoutPage(page, "/explorer", …)`. |
| `docs/passage-mainnet/audit.md` | Cette section uniquement. |

**Routes :**

- Page `/explorer` (client, derrière le layout `(app)`), nouvelle.
- `/audit` : redirection permanente vers `/explorer`, définie dans la configuration Next (côté serveur, avant tout rendu).
- API `GET /api/audit` : **inchangée** (`src/app/api/audit/route.ts` est hors périmètre). La page continue de l'appeler. Le nom de la route API n'est donc pas renommé.

**Contenu de la page `/explorer`** (centrée sur le wallet connecté) :

- Compteurs : Borrowings, Datasets borrowed, Settled, Refunded, réseau.
- Une carte par emprunt : dataset (nom, titre on-chain avec lien vers sa transaction de mint), montant USDC, date, statut, lien « Verify » vers la transaction de lock, vers la transaction de règlement (« Release USDC ») ou de remboursement (« Refund USDC »), attestation TEE et reçu d'audit en texte, lien vers l'adresse du fournisseur (`addressExplorerUrl`), modèle, échéance.
- Badge **REFUNDED** : prêt `CANCELLED` **avec** `cancelTxHash` (logique identique à l'ancienne page, extraite dans `isRefunded`).
- États : non connecté (invite à connecter un wallet, aucun appel API), connecté non authentifié (« Sign in to see your borrowings. », aucun appel API), chargement, erreur, vide, tronqué.
- Helpers de `src/lib/evm/explorer.ts` utilisés : `transactionExplorerUrl` (lock, règlement, remboursement, mint) et `addressExplorerUrl` (fournisseur, **nouveau**). `tokenExplorerUrl` n'est pas utilisé (voir §2).

**Clés de traduction (`english.ts`)** — supprimées : `Registre d’audit`, `Connecte un wallet pour consulter ses preuves.`, `Chaîne de preuves Sirius recoupable sur EVM.`, `Registre indisponible — réessaie.`, `Chargement des preuves…`, `Aucun prêt auditable pour ce wallet.` (greps exhaustifs : plus aucune référence). Ajoutées (anglais, clé = valeur) : `Explorer`, `Connect a wallet to see your borrowings and their proofs.`, `Your borrowings, settlements and refunds, each verifiable on the chain explorer.`, `Borrowings`, `Datasets borrowed`, `Settled`, `Refunded`, `Sign in to see your borrowings.`, `Explorer unavailable — try again.`, `Loading your borrowings…`, `No borrowing for this wallet yet.`, `View provider {address} on the explorer`, `Only your {count} most recent loans were loaded: older borrowings may be missing.`

**Aucune** modification de : contrats, escrow, moteur Phala, base de données (pas de migration), `package.json`, API, parcours de remboursement (`/train`, `src/lib/loans/client.ts`, `/api/loans/[id]/cancel`).

### 2. Décisions et écarts par rapport au cahier des charges

1. **Vue limitée aux emprunts du wallet connecté (écart par rapport à l'ancienne page).** L'ancienne page affichait aussi les prêts où le wallet est fournisseur (l'API renvoie `OR borrower/provider`). Le cahier des charges demande « ses emprunts, ses datasets empruntés, ses règlements et remboursements » et « aucune donnée d'un autre wallet ». La page filtre donc `loan.borrower == wallet connecté` (`addressesEqual`, insensible à la casse). **Conséquence : un fournisseur ne voit plus nulle part le règlement reçu pour un de ses datasets emprunté.** La page « Mes datasets » (`src/app/(app)/datasets/page.tsx`) ne charge aucun prêt aujourd'hui : la vue fournisseur est une perte fonctionnelle réelle, à traiter avec la slice Mes datasets ([06](06-mes-datasets.md)). C'est le point à relire en priorité. Le filtre tient en une expression (`borrowings`, `useMemo`) : le retirer rétablit l'ancien comportement.
2. **API conservée telle quelle.** `src/app/api/audit/route.ts` n'est pas dans le périmètre. Vérifié (lecture) : `requireAuth(req)` puis `prisma.loan.findMany({ where: { OR: [{ borrower: session.address }, { provider: session.address }] }, take: 100, orderBy createdAt desc })` ; aucun paramètre client n'est utilisé. Le filtre par session est bien côté serveur, mais la réponse contient aussi les prêts où le wallet est fournisseur (donc l'adresse de l'emprunteur, le montant, le hash d'attestation). Le filtre de la page est une défense d'interface, **pas** un contrôle d'accès : un fournisseur qui ouvre l'onglet réseau voit ces lignes. Ce sont des prêts dont il est partie (même contenu que `GET /api/loans`), et l'adresse de l'emprunteur est publique on-chain, donc ce n'est pas une fuite entre tiers, mais ce n'est pas « aucune donnée d'un autre wallet » au sens strict. Correctif propre (hors périmètre) : `where: { borrower: session.address }`.
3. **Plafond de 100 prêts.** L'API coupe à 100 lignes, tous rôles confondus, avant le filtre de la page. Un wallet à la fois fournisseur très actif et emprunteur peut ne pas voir ses emprunts anciens. La page ne peut pas le corriger (pas de pagination côté API) : elle affiche un avertissement (`role="status"`) dès que la réponse contient 100 lignes ou plus, et n'affirme plus « aucun emprunt » dans ce cas. Le seuil `API_LOAN_LIMIT = 100` est dupliqué du `take: 100` de la route : si l'un change, l'autre doit suivre (commentaire dans le code).
4. **Parcours de remboursement : inchangé, et absent de l'Explorer.** L'action de remboursement (« Récupérer l'escrow », `cancelExpiredLoan`) vit dans `/train` et n'a jamais été sur la page Audit. La page ne fait que montrer le badge REFUNDED et le lien de la transaction de remboursement. Je n'ai pas ajouté de lien vers `/train` : non demandé, et le parcours est « repensé » après le 6.
5. **Libellé du badge.** Le cahier des charges parle du badge « Remboursé » ; l'interface étant en anglais et les badges de statut en capitales, il s'affiche `REFUNDED` (clé existante, déjà présente avant la slice).
6. **Redirection : source exacte `/audit` uniquement.** Pas de `/audit/:path*` : aucune sous-page n'a jamais existé, et un motif à paramètre recopierait du texte contrôlé par l'appelant dans la cible (risque de redirection ouverte). `permanent: true` = 308 (conserve la méthode). La requête (`?a=1`) est conservée par Next.
7. **Textes rédigés directement en anglais**, avec une entrée `clé = valeur` dans `english.ts`, parce que le test `english.test.ts` exige une traduction pour toute clé statique de `t()`. Les clés françaises existantes non liées au renommage (`Titre du dataset`, `Attestation TEE`, `Reçu d’audit`, `En attente`, `Vérifier …`, `modèle`, `échéance`) sont gardées telles quelles (« Audit receipt » désigne la signature HMAC du runner, pas la page).
8. **Pas de lien `tokenExplorerUrl`.** L'ancienne page n'en avait pas ; le titre du dataset est lié à sa transaction de mint. L'adresse du registre est lisible côté navigateur (`NEXT_PUBLIC_SIRIUS_DATASET_ADDRESS`), mais la réponse de l'API ne dit pas de quel registre (courant ou historique) vient le titre : un lien construit avec le registre courant pourrait pointer au mauvais endroit. Non fait par prudence.
9. **Certificat d'exécution : non fait.** Le cahier des charges parle de « son certificat (09) » ; il appartient à la slice N6, qui n'existe pas encore (aucune route ni page de certificat). La consigne de cette slice ne le demande pas.
10. **Auteur des commits.** L'identité git locale a été réglée sur celle du propriétaire du dépôt (celle de ses commits sur `staging`) et le premier commit a été réécrit avant tout push : l'identité par défaut de l'environnement était celle de l'assistant. Aucune ligne de co-signature, aucun identifiant de session, aucun lien vers l'outil, ni dans les commits ni dans les fichiers.
11. **Pas de test unitaire ajouté.** `pnpm test` énumère ses fichiers dans `package.json` (hors périmètre) : un nouveau fichier de test ne serait pas exécuté. La logique pure est petite et couverte par les e2e. Aucun test unitaire existant ne ciblait `/audit` (recherche de `/audit` dans `src/`, `e2e/`, `scripts/`).

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès côté serveur, route par route**

- `GET /api/audit` (seule route appelée par la page) : `requireAuth` → cookie de session signé ; l'adresse vient de la session, jamais de la requête ; aucune entrée client. À relire : `src/app/api/audit/route.ts`, `src/lib/auth/require-auth.ts`, `session.ts`. 401 générique sans session ; erreurs via `errorResponse` (messages d'`AppError` seulement, 500 opaque).
- Vérifier que le filtre de la page n'est **pas** le contrôle d'accès : si un jour la route cesse de filtrer par session, la page ne protège rien (le filtre ne porte que sur `borrower`).
- `/explorer` est une page : elle n'expose aucune donnée par elle-même ; tout vient de `/api/audit`. `/audit` ne sert rien (redirection avant rendu).

**Validation et bornes**

- La page valide la réponse : `network` doit être `mainnet` ou `testnet` (sinon l'état « Explorer unavailable », pas de plantage dans `EVM_CHAINS[network]`), `loans` doit être un tableau.
- Les liens explorateur : base fixe de `EVM_CHAINS`, segments passés par `encodeURIComponent` ; aucune valeur de la base ne peut changer le schéma ni l'hôte ; `target="_blank"` avec `rel="noreferrer"` partout.
- Redirection : source et destination fixes, aucun paramètre recopié. Observé sur le build de production (`next start`, `curl -i`) : `/audit` → 308 `/explorer` ; `/audit?a=1&b=2` → 308 `/explorer?a=1&b=2` ; `/audit/` → 308 `/audit` puis 308 `/explorer` (deux sauts, pas de boucle) ; `/Audit` → 308 `/explorer` (Next ignore la casse) ; `/audit?next=//evil.example` → `/explorer?next=%2F%2Fevil.example` (paramètre encodé, jamais interprété) ; `/audit//evil.example` → `/audit/evil.example` et `//evil.example/audit` → `/evil.example/audit` (normalisation des doubles barres par Next, chemin relatif au même hôte, pas par notre règle). `/audit/x` ne correspond à aucune règle. Aucune cible ne contient d'hôte externe.

**Fuites possibles**

- Données d'un autre wallet : voir §2.2. La charge réseau de `/api/audit` contient les prêts où le wallet est fournisseur (adresse de l'emprunteur incluse). Rien n'est affiché, mais c'est dans la réponse.
- Changement de compte pendant une requête : la page est remontée (`key = revision:authenticated`) à chaque changement de wallet, de réseau ou d'authentification ; la réponse tardive d'un ancien compte tombe dans une instance démontée. Test e2e existant, adapté.
- Cache : aucun en-tête `Cache-Control` explicite sur `/api/audit` ; Next 16.3.7 pose `private, no-cache, no-store` sur les réponses dynamiques (lu dans `base-server.js`, **non observé** sur un serveur réel).
- Messages d'erreur et journaux : la page n'écrit rien dans la console ; `catch` sans détail.

**Argent, escrow, contrats, Phala**

- Aucun impact : aucune transaction n'est construite ni envoyée par la page (lecture seule, liens sortants uniquement). Aucun contrat ni moteur touché. Aucune transaction runner introduite.
- Remboursement inchangé : `git diff staging...HEAD` ne touche ni `src/app/(app)/train`, ni `src/lib/loans/client.ts`, ni `src/app/api/loans/**`, ni `src/lib/sirius/cancel.ts`. Vérifier que `isRefunded` (`status === "CANCELLED" && cancelTxHash`) reste identique à l'ancien filtre `loan.status === "CANCELLED" && loan.cancelTxHash`.

**Base de données** : aucune migration, aucune colonne.

**Interface**

- Toutes les valeurs venant de l'API (nom du dataset, identifiants, hash) sont rendues comme du texte React (échappé) ; aucun `dangerouslySetInnerHTML`.
- La CSP (`src/proxy.ts`) couvre `/explorer` (seul `/api` est exclu du matcher) ; les liens sortants ne sont pas soumis à `connect-src`.
- Sidebar : libellé et lien `/explorer` ; actif sur `/explorer` et sous-chemins.

**Textes**

- Sous-titre : « each verifiable on the chain explorer » vaut pour emprunts (lock), règlements et remboursements ; l'attestation TEE et le reçu d'audit sont affichés en texte, sans lien, et ne sont pas présentés comme vérifiables sur la chaîne.
- Restes de « audit ledger » visibles **hors périmètre** : `src/app/status/page.tsx:77` (lien `/audit` + texte « audit ledger », fonctionne via la redirection), `src/app/terms/page.tsx:28` (« listed in the audit ledger »), commentaire de `src/lib/evm/explorer.ts:5` (« consommés par la page `/audit` »). À corriger par le propriétaire de ces fichiers.

### 4. Cas limites à essayer à la main sur staging

1. **Redirection** : ouvrir `/audit` → l'URL devient `/explorer`, la page s'affiche, pas de boucle. Ouvrir `/audit?utm=test` → `/explorer?utm=test`. Ouvrir `/audit/` → atterrit sur `/explorer`. Dans l'onglet réseau : statut 308 puis 200. Rechercher un favori ou un lien externe vers `/audit` (page Status) : il aboutit sur `/explorer`.
2. **Menu** : le lien « Explorer » existe (bureau et barre mobile), l'ancien « Audit » a disparu ; il est surligné sur `/explorer`.
3. **Sans wallet** : ouvrir `/explorer` déconnecté → titre « Explorer », bouton de connexion, aucun appel à `/api/audit` (onglet réseau).
4. **Wallet connecté mais pas authentifié** (avant « Sign in ») → message « Sign in to see your borrowings. », pas de message « No borrowing ».
5. **Wallet vierge authentifié** → « No borrowing for this wallet yet. », compteurs à 0, pas de bandeau jaune.
6. **Emprunt réglé** (wallet emprunteur d'un prêt `SETTLED`) → badge SETTLED, liens « Verify Lock USDC » et « Verify Release USDC » ouvrent la bonne transaction sur l'explorateur du réseau (testnet : `explorer.test.mezo.org/tx/<hash>`), « Settled 1 ».
7. **Emprunt remboursé** (annulé après échéance puis remboursé via `/train`) → badge REFUNDED, libellé « Refund USDC » avec lien, « Refunded 1 ». Un prêt `CANCELLED` dont le remboursement n'est pas encore confirmé reste `CANCELLED`, sans lien de remboursement (le libellé « Release USDC / Pending » est un comportement hérité).
8. **Remboursement depuis `/train`** : sur un prêt remboursable, cliquer « Récupérer l'escrow », signer, puis rouvrir `/explorer` : le prêt passe en REFUNDED. Le parcours doit être identique à avant la slice.
9. **Deux wallets** : emprunter avec A un dataset de B. Avec A : le prêt est visible. Avec B (fournisseur) : `/explorer` ne montre **pas** ce prêt (écart assumé, §2.1) ; vérifier dans l'onglet réseau que `/api/audit` le contient (comportement de l'API, §2.2).
10. **Changement de compte** dans le wallet pendant que la page charge → aucune ligne de l'ancien compte ne reste affichée.
11. **Adresse en casse mixte** (wallet qui renvoie l'EIP-55) → les emprunts s'affichent.
12. **Plus de 100 prêts** (ou un wallet fournisseur de plus de 100 prêts récents et emprunteur d'un prêt plus ancien) → bandeau jaune « Only your 100 most recent loans were loaded… » ; pas de « No borrowing ».
13. **Réponse invalide** (API en panne, 500) → bandeau rouge « Explorer unavailable — try again. », pas de plantage.
14. **Mobile (390 px) et texte agrandi** : cartes sans débordement horizontal (test e2e responsive).
15. **Navigateur ayant déjà vu la redirection** : un 308 est mis en cache durablement par les navigateurs ; après un éventuel changement futur de `/audit`, tester en navigation privée.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

**Modifiés** : `Audit remplace l'historique…` → `Explorer remplace l'historique lors d'un changement de compte authentifié` (le prêt suit maintenant l'emprunteur, sinon il serait filtré) ; `sirius.spec.ts` (titre `Explorer`, URL `/explorer`) ; `responsive.spec.ts` (URL `/explorer`).

**Ajoutés dans `e2e/audit-regressions.spec.ts`** :

1. `Explorer n'affiche jamais un prêt dont le wallet connecté n'est pas l'emprunteur` — adresses à lettres hexadécimales, casse mixte dans les deux sens (wallet minuscule/API mixte, puis l'inverse), prêt fournisseur masqué, adresse du wallet absente de la page, lien fournisseur correct. *Contre-épreuve faite* : en remplaçant `addressesEqual` par `===`, le test devient rouge.
2. `Explorer ne prétend pas qu'il n'y a aucun emprunt quand l'API atteint sa limite de 100 prêts`.
3. `Explorer annonce l'absence d'emprunt quand la réponse est complète et vide`.
4. `Explorer : remboursement confirmé, remboursement en attente, règlement et liens explorateur` — REFUNDED vs CANCELLED vs SETTLED, URL exactes des liens (lock, règlement, remboursement, fournisseur), absence de lien de remboursement sur un prêt annulé sans transaction, compteurs (3 emprunts, 2 datasets, 1 réglé, 1 remboursé).
5. `Explorer signale un registre illisible au lieu de planter` (réseau inconnu).
6. `Explorer sans wallet ne lit rien et invite à se connecter` (aucun appel `/api/audit`).
7. `/audit redirige définitivement vers /explorer, requête conservée, sans boucle` — 308 et `Location` exacts, barre finale, tentatives hostiles (`//evil`, `https://evil`, `?next=//evil`), suivi complet jusqu'à `/explorer`.
8. `le menu propose Explorer, pas Audit, et le marque actif sur /explorer`.

**Angles morts** :

- Tous les e2e moquent `/api/audit` : le filtrage par session **côté serveur** n'est testé nulle part de bout en bout (aucun test d'intégration de la route avec base). Les tests de la page prouvent seulement que la page n'affiche pas ce qu'elle ne doit pas afficher.
- Le test de redirection tourne sur `next dev` ; le comportement de production a été vérifié à la main (`curl` sur `next start`, voir §3), pas par un test automatique, ni sur le déploiement réel (Vercel).
- L'authentification réelle (SIWE, cookie) est remplacée par le pont de test `__SIRIUS_E2E__` qui force `authenticated = true`.
- Le plafond de 100 est simulé par une réponse moquée de 100 lignes ; le `take: 100` réel n'est pas testé, et la duplication de la constante n'est pas garde-fouillée par un test.
- Le test de compteurs s'appuie sur la classe CSS `.font-mono.uppercase` (fragile si le style change).
- Le clic sur « Verify » n'est pas suivi (liens vérifiés par leur `href`), l'explorateur externe n'est pas appelé.
- Aucun test unitaire (voir §2.11).
- Aucun test sur un nombre élevé de prêts affichés (performance de rendu).

### 6. Hypothèses

- Les adresses `borrower` sont stockées en minuscules (`prepareLoan` → `normalizeAddress`) et `session.address` aussi (`verify` → `normalizeAddress`) — lu dans le code, non rejoué avec une vraie base.
- Un prêt a toujours un `dataset.evmDatasetId` non nul (`prepareLoan` refuse sinon) : le repli du compteur « Datasets borrowed » sur le nom du dataset n'est qu'une garde ; la réponse de l'API ne donne pas d'identifiant interne de dataset.
- Un fournisseur ne peut pas emprunter son propre dataset (`borrower.ts:55`) : le filtre `borrower` ne peut donc pas masquer un prêt où le wallet serait les deux.
- Quand `authenticated` est vrai, l'adresse du store est celle de la session (`synchroniserSession` ferme la session sinon).
- Le `network` renvoyé par le serveur est celui des transactions listées (une même instance ne sert qu'un réseau).
- Next envoie bien `no-store` sur la route dynamique (lu, non observé).
- La redirection de `next.config.ts` est appliquée telle quelle par l'hébergement de production (Vercel) — non vérifié sur le déploiement.
- `NEXT_PUBLIC_EVM_NETWORK` et `EVM_NETWORK` désignent le même réseau que celui de l'API.

### 7. Risques résiduels et limites connues

1. **Over-fetch de l'API** : la réponse contient les prêts où le wallet est fournisseur (§2.2). Pas de fuite entre tiers étrangers, mais pas « aucune donnée d'un autre wallet » dans la charge réseau.
2. **Troncature à 100** (§2.3) : un fournisseur très actif qui emprunte aussi peut ne pas voir ses emprunts anciens ; seul un avertissement le signale.
3. **Perte de la vue fournisseur** (§2.1) : plus aucun écran ne montre à un fournisseur le règlement reçu.
4. **Redirection 308 mise en cache** par les navigateurs : si `/audit` est réutilisé plus tard (par exemple la vue globale d'équipe prévue après le 6), les navigateurs qui ont déjà suivi la redirection continueront d'aller sur `/explorer`.
5. **Compteurs à zéro** affichés pendant le chargement, en erreur ou sans session (un message explicite les accompagne, mais le « 0 » n'est pas masqué) ; réseau affiché « testnet » tant que la réponse n'est pas arrivée (valeur par défaut de l'état).
6. **Nom accessible des liens « Verify … on EVM »** identique d'une carte à l'autre (hérité de l'ancienne page).
7. **Prêt annulé sans remboursement confirmé** : affiché « Release USDC / Pending » (hérité).
8. **Seuil d'avertissement** : exactement 100 prêts déclenche l'avertissement à tort (conservateur, voulu).
9. **Textes hors périmètre** encore sur « audit ledger » (§3).
10. **Pas de lien d'action** de l'Explorer vers `/train` pour rembourser : un emprunteur doit connaître `/train`.

### 8. Reste à faire

Priorité haute (avant le 6 si possible) :

1. Corriger `src/app/api/audit/route.ts` : `where: { borrower: session.address }` et pagination par curseur (supprime l'over-fetch et la troncature, et permet de retirer l'avertissement et le filtre client). Éventuellement renommer la route en `/api/explorer` en gardant l'ancienne en alias.
2. Remplacer « audit ledger » / lien `/audit` dans `src/app/status/page.tsx` et `src/app/terms/page.tsx`, et le commentaire de `src/lib/evm/explorer.ts` (slices qui possèdent ces fichiers).
3. Décider où le fournisseur retrouve ses règlements (slice Mes datasets, [06](06-mes-datasets.md)).

Priorité moyenne :

4. Lien vers le certificat d'exécution quand la slice N6 existe.
5. Lien `tokenExplorerUrl` sur le titre du dataset, si l'API fournit l'adresse du registre d'origine.
6. Si un test unitaire est souhaité sur la logique pure, l'ajouter à la liste de `package.json`.
7. Masquer les compteurs tant que rien n'est chargé.
8. Lien « Rembourser dans Train » pour les prêts remboursables.

Après le 6 (déjà au cahier des charges) : filtres (type d'action, dataset, période, statut), indexeur, vue globale d'équipe, parcours de remboursement repensé.

### 9. Résultats des vérifications

Environnement : Node v22.22.0, pnpm 11.18.0, `DATABASE_URL=postgresql://x:y@localhost:5432/z` (factice). Playwright : le Chromium installé (`/opt/pw-browsers/chromium`, build 1194) n'est pas celui que la version de Playwright attend (1228) ; les e2e ont été lancés avec une configuration temporaire hors dépôt qui reprend `playwright.config.ts` et ajoute `executablePath: /opt/pw-browsers/chromium` et `--no-sandbox`. `playwright.config.ts` n'est pas modifié.

Résultats **finaux** (exécutés sur la tête de la branche, après les corrections de la revue) :

| Commande | Résultat exact |
|---|---|
| `pnpm install --frozen-lockfile` | Sortie 0. « Already up to date — Done in 710ms using pnpm v11.18.0 » (première installation à froid : 39,1 s, sortie 0, `postinstall: prisma generate` réussi). |
| `pnpm exec tsc --noEmit` | Sortie 0, aucune sortie (aucune erreur de type). |
| `pnpm lint` | Sortie 0, `eslint` sans aucun avertissement. |
| `pnpm test` | Sortie 0. `# tests 429`, `# pass 429`, `# fail 0`, `# cancelled 0`, `# skipped 0`. |
| `pnpm audit:deps` (`pnpm audit --audit-level=moderate`) | Sortie 0. « 2 vulnerabilities found — Severity: 1 low \| 1 high (1 ignored) ». La « high » ignorée est `braces` (GHSA-vfj7-8cjw-p6xm), ignorée par `auditConfig.ignoreGhsas` de `pnpm-workspace.yaml` (outillage Solidity de développement uniquement). La « low » est `elliptic <=6.6.1` (GHSA-848j-6mx2-7j84), sous le seuil `moderate`. Aucune des deux ne vient de la slice (aucune dépendance ajoutée ni modifiée). |
| `pnpm build` (avec `NEXT_PUBLIC_EVM_NETWORK=testnet EVM_NETWORK=testnet`, `DATABASE_URL` factice) | Sortie 0. La table des routes liste `ƒ /explorer` et plus `/audit`. |
| `playwright test` (suite complète, `e2e/`, hors `phala/`) | Sortie 0. **79 passed (1.7m)**, 0 échec, 0 ignoré. Inclut `audit-regressions.spec.ts` (17 tests), `sirius.spec.ts` (3 tests), `responsive.spec.ts` (35 tests) et les autres specs. |
| Redirection sur le build de production (`next start`, `curl -i`) | Voir §3 : 308 vers `/explorer` avec requête conservée, aucune boucle, aucun hôte externe. |
| Contre-épreuve du test de casse | Avec `addressesEqual` remplacé par `===` : `1 failed` (test attendu rouge) ; code rétabli ensuite (vérifié par `git diff`). |
| `git diff --name-only staging...HEAD` | Voir ci-dessous. |
| `git log staging..HEAD --format=%B` | Voir ci-dessous. |

**Échecs liés à l'environnement, non masqués :**

1. Le Chromium préinstallé (`/opt/pw-browsers/chromium`, build 1194) n'est pas celui que la version de Playwright du dépôt attend (1228). La première tentative a échoué avec `browserType.launch: Executable doesn't exist at …chromium_headless_shell-1228…` (15 tests en échec, sans rapport avec le code). Les résultats ci-dessus viennent d'une configuration temporaire hors dépôt qui ajoute `executablePath` et `--no-sandbox`. Le CI du dépôt installe son propre Chromium (`playwright install --with-deps chromium`) : ce contournement ne s'y applique pas.
2. `next start` en production répond 500 sur toute page tant que `SIRIUS_SESSION_SECRET` n'est pas défini (« SIRIUS_SESSION_SECRET obligatoire en production », `instrumentation`). Les vérifications de redirection par `curl` ne dépendent pas de ce secret (la redirection est appliquée avant le rendu), mais le rendu de `/explorer` n'a pas été vérifié sur le build de production, seulement sur `next dev` (e2e).
3. Non exécutés (hors périmètre de la consigne et nécessitent une base ou un compilateur de contrats) : `pnpm test:phala-demo`, `test:operations`, `test:postgres`, `contracts:test`, `test:billing`, `datasets:generate`, que le CI exécute en plus.

**Contrôles avant la PR** (exécutés sur la tête finale de la branche, une fois ce fichier commité) :

- `git diff --name-only staging...HEAD` : `docs/passage-mainnet/audit.md`, `e2e/audit-regressions.spec.ts`, `e2e/responsive.spec.ts`, `e2e/sirius.spec.ts`, `next.config.ts`, `src/app/(app)/explorer/page.tsx`, `src/components/layout/Sidebar.tsx`, `src/lib/i18n/english.ts` — tous dans le périmètre autorisé (le renommage `audit/page.tsx` → `explorer/page.tsx` apparaît comme un seul fichier). Aucun des fichiers de consignes d'assistant à la racine (non suivis, jamais ajoutés ; `next dev` en recrée un), ni le dossier de configuration de l'assistant.
- `git log staging..HEAD --format=%B` : recherche insensible à la casse des mentions de co-signature, de nom d'assistant, de domaine de son éditeur, de mention « généré par » et de marqueur d'omission de CI : aucune occurrence. Auteur et committer de chaque commit : l'identité du propriétaire du dépôt.


### 10. Revue interne de la session

Deux tours de revue adversariale, par des agents indépendants en lecture seule (angles : sécurité et contrôle d'accès ; exactitude et non-régression du remboursement ; tests et cas limites ; textes, traduction, accessibilité ; conformité au cahier des charges et au périmètre). Chaque constat était soumis à deux sceptiques chargés de le réfuter ; un constat n'est retenu que si le raisonnement survit à la lecture du code.

**Tour 1** (65 agents : 5 relecteurs, 2 sceptiques par constat) — 7 constats confirmés, 23 écartés.

Confirmés, et traitement :

| Constat | Gravité | Traitement |
|---|---|---|
| Le `take: 100` de l'API s'applique avant le filtre de la page : un wallet fournisseur actif et emprunteur peut perdre ses emprunts anciens, et la page affichait « No borrowing » (signalé par 4 relecteurs sous 4 formulations) | mineur à majeur | **Corrigé côté page** : bandeau `role="status"` dès 100 lignes, message « No borrowing » supprimé dans ce cas, test e2e. **Non corrigeable dans le périmètre** (route hors périmètre) : consigné §2.3, §7.2, §8.1. |
| Test de casse d'adresse vide : `A.toUpperCase()` d'une adresse sans lettre hexadécimale ne change rien, le test restait vert avec `===` | majeur (test) | **Corrigé** : adresses avec lettres, deux sens, contre-épreuve `===` rouge puis rétablie. |
| Commentaire de la page affirmant que les prêts fournisseur « appartiennent à Mes datasets » alors que cette page n'affiche aucun prêt ; perte de la vue fournisseur | mineur | **Commentaire corrigé** ; écart consigné §2.1, §7.3, §8.3. |
| Section A7 non remplie | mineur | Remplie (cette section). |

Écartés au tour 1 (avec la raison donnée par les sceptiques, que j'ai relue) :

- *La charge réseau de `/api/audit` contient des prêts d'autres wallets* : pas une régression (route inchangée), le fournisseur est partie au prêt, mêmes données que `/api/loans` ; **mais consigné** comme risque résiduel (§2.2, §7.1) car l'exigence « aucune donnée d'un autre wallet » est lue strictement.
- *Plafond de 100 → compteurs faux* (variante) : fusionné avec le constat confirmé ci-dessus.
- *Lien `/audit` dans la page Status, commentaire de `explorer.ts`, « audit ledger » dans les conditions d'utilisation* : réels mais hors périmètre ; la redirection les rattrape. Consignés §3 et §8.2.
- *Repli par nom du compteur « Datasets borrowed »* : inatteignable, `prepareLoan` exige `evmDatasetId` (consigné en hypothèse §6).
- *Test « sans wallet » ne peut pas échouer* / *assertions de redirection permissives* : faiblesses hypothétiques, pas des défauts ; le test de redirection vérifie statut et `Location` exacts.
- *Sous-titre qui promet trop*, *« Audit receipt » restant*, *nom accessible du lien fournisseur*, *« Release USDC / Pending » pour un prêt annulé* : textes ou comportements hérités de l'ancienne page, sans promesse fausse ; consignés §7.
- *`tokenExplorerUrl` non utilisé* : l'ancienne page ne l'utilisait pas ; la justification est précisée en §2.8 (l'écart de formulation a été relevé au tour 2 et corrigé ici).
- *Certificat d'exécution absent* : slice N6 (§2.9).
- *Badge REFUNDED ajouté sans demande* : faux, présent avant la slice.
- *Identité d'assistant comme auteur et committer du premier commit* : écarté par les sceptiques comme hors du texte de la règle (« fichiers »), mais **corrigé quand même**, la règle du propriétaire visant aussi les commits (§2.10).
- *Aucun e2e exécuté dans l'environnement de revue* : limite de l'environnement des relecteurs (Playwright interdit), pas un défaut ; les e2e ont été exécutés par la session (§9).

**Tour 2** (37 agents, sur les 2 commits corrigés) — **0 constat confirmé**, 16 écartés : charge réseau de `/api/audit` (déjà consignée) ; compteurs à zéro avant chargement (cosmétique, consigné §7.5) ; absence de test sur réponse tardive ou compte non authentifié (couverts par le remontage `key`, comportement correct) ; texte « Your 100 most recent loans » (exact : ce sont les 100 plus récents, tous rôles) ; nom accessible identique des liens « Verify » (hérité) ; sous-titre ; restes « audit ledger » hors périmètre ; couplage de la constante `API_LOAN_LIMIT` avec le `take: 100` de la route (hypothétique, mais documenté §2.3) ; « Audit receipt » ; sélecteur de compteurs fragile (correct aujourd'hui, noté §5) ; certificat ; commentaire de `explorer.ts` ; justification imprécise de `tokenExplorerUrl` (juste : l'adresse du registre est lisible côté navigateur ; la raison réelle est l'ambiguïté du registre d'origine, texte §2.8 corrigé en conséquence) ; auteur du premier commit encore à l'identité de l'assistant (corrigé avant le push par réécriture, §2.10).

Condition d'arrêt : le tour 2 n'a rien trouvé de nouveau ; la revue s'arrête là. **Limite de cette revue** : les relecteurs étaient en lecture seule et n'ont pas pu exécuter Playwright ni `next dev` (verrou et port partagés) ; seules les vérifications de la session (§9) ont été exécutées.

---

## A8 — Passage à MUSD

Branche `feat/usdg`, base `staging` (tête `e829cfc` au départ). Cahier des charges : [01-decisions-avant-samedi.md](01-decisions-avant-samedi.md), section 1. Jeton retenu : **MUSD** (« Mezo USD », Mezo), `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` sur Mezo mainnet (31612), à la place de l'USDC natif `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8`.

### 1. Ce qui a changé

**Fichiers modifiés (tous dans le périmètre autorisé) :**

| Fichier | Changement |
|---|---|
| `src/lib/evm/stablecoin.ts` (**nouveau**) | Source unique du jeton de règlement : `MAINNET_STABLECOIN_ADDRESS` (MUSD, minuscules), `MAINNET_STABLECOIN_SYMBOL` (« MUSD »), `MAINNET_STABLECOIN_NAME`, `MAINNET_STABLECOIN_DECIMALS` (6), `TESTNET_STABLECOIN_LABEL` (« test MUSD »), `stablecoinSymbol(network)`. Le commentaire d'en-tête consigne la lecture on-chain du 4 octobre (nom, symbole, décimales, proxy, code hashes). |
| `src/lib/evm/stablecoin.test.ts` (**nouveau**) | 5 tests : adresse officielle, minuscules et checksum EIP-55 ; nom/symbole/décimales alignés sur `USDC_DECIMALS_BY_NETWORK` ; **les quatre scripts imposent la même adresse** et leur alias `MAINNET_USDC` aussi ; `stablecoinSymbol` (mainnet → « MUSD », testnet → « test MUSD », réseau inconnu → erreur) ; cohérence avec les clés i18n. |
| `scripts/deploy-policy.ts` | `MAINNET_STABLECOIN` importé de `stablecoin.ts` (plus de littéral local), alias `@deprecated MAINNET_USDC` conservé ; message d'erreur « doit être l'MUSD de Mezo 0x5fc5…, aucun autre jeton, USDC compris ». Comparaison inchangée : `address()` normalise (trim, regex, minuscules) puis `usdc !== MAINNET_STABLECOIN`. |
| `scripts/initialize-runner-volume.ts` | Même constante pour la politique de facturation ; message « MUSD de Mezo uniquement… ». `billing.usdc` est déjà imposé en minuscules par `validateBillingPolicy` (regex `^0x[0-9a-f]{40}$`), la comparaison stricte est donc correcte. |
| `scripts/phala-v7-preflight.ts` | Même constante ; message « Jeton mainnet attendu : MUSD de Mezo 0x5fc5…d168 » ; message de code/précision rendu neutre (« jeton de règlement ») ; commentaire sur ce que prouve le code hash d'un proxy. |
| `scripts/operations/release-check.mjs` | Littéral MUSD local (module JavaScript sans chargeur TypeScript) **vérifié égal** à `stablecoin.ts` par `stablecoin.test.ts` ; alias `MAINNET_USDC` ; comparaison désormais après `trim().toLowerCase()`. |
| `scripts/check-phala-v7.ts` | Message d'échec : « code et décimales du jeton de règlement (MUSD de Mezo sur mainnet) ». |
| `src/lib/evm/networks.ts` | `USDC_DECIMALS_BY_NETWORK.mainnet` **reste 6** (confirmé on-chain). Seul le commentaire change : il nomme le MUSD, la date de lecture, et rappelle que les contrôles on-chain font autorité et relisent la valeur courante derrière le proxy. |
| `src/app/(app)/dashboard/page.tsx`, `src/app/(app)/wallet/page.tsx` | Ligne du libellé du solde : `network === "mainnet" ? stablecoinSymbol(network) : t("test MUSD")`, avec `const network = resolveClientNetwork()` (inliné au build par Next). Imports ajoutés. |
| `src/app/status/page.tsx` | `const symbol = stablecoinSymbol(network)` (composant serveur) ; ligne du contrat (`["MUSD", …]` → `[symbol, …]`) **et** les trois autres mentions mainnet du jeton (« with real USDC », plafond par prêt, exposition totale), voir §2.3. |
| `package.json` | Script `test` : ajout de `scripts/operations/release-check.test.mjs` (**n'était pas exécuté par la suite jusqu'ici**) et `src/lib/evm/stablecoin.test.ts`. |
| `scripts/deploy-policy.test.ts`, `scripts/initialize-runner-volume.test.ts`, `scripts/phala-v7-preflight.test.ts`, `scripts/operations/release-check.test.mjs` | Tests MUSD et refus de l'ancien USDC, voir §5. |
| `docs/MAINNET-RUNBOOKS.md` | Table des politiques runner (`usdc` = MUSD), commande d'exécution à blanc avec l'adresse MUSD et le **code hash du proxy**, paragraphe « ce que prouve le code hash, et ce qu'il ne prouve pas », pouvoirs de gel/pause de Mezo. |
| `docs/passage-mainnet/01-decisions-avant-samedi.md` | Section 1 : adresse confirmée, tableau des vérifications on-chain, état des fichiers adaptés, support d'Across. |
| `docs/passage-mainnet/audit.md` | Cette section uniquement. |

**Aucune** modification de : contrats, ABI, `contracts/scripts/deploy.ts`, `src/app/api/onramp/route.ts`, base de données (pas de migration), traductions (`src/lib/i18n/**` : aucune clé ajoutée ni retirée, voir §2.5), routes API, moteur Phala, variables d'environnement (noms `SIRIUS_USDC_ADDRESS`, `SIRIUS_USDC_CODE_HASH`, `NEXT_PUBLIC_SIRIUS_USDC_ADDRESS` conservés).

**Routes, tables, colonnes** : aucune.

### 2. Décisions et écarts par rapport au cahier des charges

1. **Source unique plutôt que quatre littéraux.** Les trois scripts TypeScript importent l'adresse depuis `src/lib/evm/stablecoin.ts` ; `release-check.mjs` garde un littéral (il est lancé en JavaScript pur sur le VPS, sans `tsx`), et `stablecoin.test.ts` vérifie que les quatre valeurs et les quatre alias sont identiques. Une dérive future casse la suite. Les contextes d'exécution ont été vérifiés : `node --import tsx` depuis la racine (scripts, `contracts/scripts/deploy.ts` qui importe déjà `src/lib/evm/networks`), `Dockerfile.runner` copie `src` en entier et `scripts/initialize-runner-volume.ts`, `tsconfig.json` racine a `allowJs` (import du `.mjs` dans le test).
2. **Code hash lu on-chain, mais c'est celui d'un proxy.** Accès réseau disponible : `eth_getCode` sur le RPC public puis keccak256 (viem). Le contrat MUSD est un **proxy ERC-1967** de 170 octets (slot d'implémentation renseigné, slot d'admin vide : la mise à niveau est pilotée par l'implémentation, donc par Mezo). Le hash `0x864cc9ad…36a6` est stable à travers les mises à niveau de Mezo ; il ne prouve pas que la logique du jeton est inchangée, seulement que l'adresse contient le même proxy. Conséquences documentées dans les runbooks : c'est **l'adresse épinglée** qui identifie le jeton ; les décimales sont relues à travers le proxy (contrôle utile à chaque exécution) ; en cas de refus du hash avec la bonne adresse, relever le nouveau hash et vérifier sur l'explorateur, jamais contourner. Implémentation du jour : `0x68184c449e1a8f34fa18d289737129fd27b66f8f`, hash `0x3a551ac5…3baf`, notés pour l'audit, non contrôlés par le code (voir §8).
3. **Page `/status` : quatre mentions au lieu d'une.** Le cahier des charges parle de « la ligne du libellé du jeton ». Dans ce fichier, trois autres chaînes n'apparaissent **que sur mainnet** et affirmaient « real USDC » et des plafonds « en USDC » : elles seraient fausses dès le lancement. Elles utilisent la même constante `symbol`. Le texte mainnet précise « (Mezo USD, issued by the Mezo protocol) » pour que l'utilisateur comprenne qu'il ne s'agit pas de l'USDC. Aucune autre ligne du fichier n'est touchée.
4. **Forme du libellé dans `wallet` et `dashboard`.** `src/lib/evm/balance.test.ts` (hors périmètre) exige la présence **littérale** de `t("test MUSD")` dans ces deux pages (« un solde libellé en dollars sans mention se lit comme de la vraie monnaie »). La forme `t(stablecoinSymbol(network))` la faisait échouer. Plutôt que de modifier un test hors périmètre, la ligne garde la branche testnet explicite et prend le symbole mainnet dans le helper : `network === "mainnet" ? stablecoinSymbol(network) : t("test MUSD")`. `stablecoin.test.ts` garantit par ailleurs que `stablecoinSymbol("testnet")` vaut cette même clé. Proposition (hors périmètre) : relâcher la regex de `balance.test.ts` vers `stablecoinSymbol\(` une fois les slices fusionnées.
5. **Traductions inchangées.** « MUSD » est un symbole, pas un texte : il ne passe pas par une clé (et `translateEnglish` renvoie une clé inconnue telle quelle, comportement couvert par `english.test.ts`). « test MUSD » garde sa clé existante. Les clés contenant « USDC » (`Montant (USDC)`, `Lock USDC`, `Remboursement USDC`, `Prix par entraînement (USDC)`, `Emprunt · escrow USDC`, `Acheter des USDC par carte (MoonPay)`, `Solde USDC indisponible`, `{usdc} USDC envoyés.`…) sont utilisées par des pages d'autres slices (marketplace, upload, train, explorer, composants partagés) : les changer sans toucher leurs appelants ne servirait à rien et créerait des conflits. Voir §8.
6. **Across : pas de changement, et une bonne nouvelle.** `src/app/api/onramp/route.ts` renvoie `https://app.across.to/bridge` sur mainnet. D'après l'annonce d'Across (« Bridge to Mezo with Across »), l'USDC envoyé depuis 13 chaînes **arrive sur Mezo en MUSD**, le MUSD d'Ethereum passe directement, et la sortie convertit le MUSD en USDC. Le pont livrait donc déjà de le MUSD : avant cette slice, un utilisateur qui ajoutait des fonds recevait un jeton que l'escrow USDC aurait refusé. Avec MUSD, le parcours d'ajout de fonds et l'escrow sont enfin alignés. Vérifié par lecture de la page d'Across (source secondaire : un billet de blog, pas une liste de routes signée) ; **à confirmer à la main** sur `app.across.to` avant le lancement (§4, cas 7).
7. **Décimales.** `USDC_DECIMALS_BY_NETWORK.mainnet` est déjà à 6 ; `decimals()` lu on-chain = 6. Aucun changement de valeur, commentaire mis à jour. Le testnet reste à 18.
8. **Constantes en minuscules.** Toutes les constantes sont en minuscules (vérifié par test), et chaque point de comparaison normalise son entrée : `deploy-policy` (`address()` : trim, regex, `toLowerCase`), `phala-v7-preflight` (`address()` : trim, `toLowerCase`, regex minuscules), `initialize-runner-volume` (`validateBillingPolicy` refuse toute majuscule), `release-check` (`trim().toLowerCase()`, ajouté). Une adresse MUSD checksummée collée telle quelle par un opérateur est donc acceptée.
9. **Identité des commits.** Commits au nom du propriétaire (identité git du worktree, identique aux commits de `staging`), sans ligne de co-signature, identifiant de session ni lien d'outil, ni dans les commits, ni dans la PR, ni dans les fichiers.

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès côté serveur** : aucune route touchée. Les scripts sont des outils d'opérateur, lancés à la main avec des variables d'environnement.

**Validation et bornes de chaque entrée (le point central de la slice)** :

- `scripts/deploy-policy.ts` `deploymentPlan()` : sur 31612, `SIRIUS_USDC_ADDRESS` doit, après trim et minuscules, valoir exactement `0x5fc5360d0400a0fd4f2af552add042d716f1d168`. Refusés : l'ancien USDC natif (toute casse), tout autre jeton, l'adresse nulle, une valeur vide ou absente, une valeur sans `0x`, une adresse tronquée. Sur 31611, aucun jeton n'est imposé (inchangé). Le message d'erreur contient l'adresse attendue et **jamais** la valeur reçue.
- `scripts/initialize-runner-volume.ts` `initializeRunnerVolume()` : cible mainnet ⇒ `billing.usdc === MUSD` (minuscules imposées par la validation de la politique), `usdcDecimals === 6`, `chainId === 31612`. La ligne de commande vérifie en plus `billing.usdc === SIRIUS_USDC_ADDRESS.trim().toLowerCase()`. Un refus n'écrit aucun fichier.
- `scripts/phala-v7-preflight.ts` `mainnetV7Configuration()` : `SIRIUS_USDC_ADDRESS` normalisée, doit valoir le MUSD ; `checkV7()` relit le code (hash attendu dans `SIRIUS_USDC_CODE_HASH`) et `decimals()` (6) au bloc finalisé, puis vérifie `escrow.usdc() == SIRIUS_USDC_ADDRESS`.
- `scripts/operations/release-check.mjs` `--network=mainnet` : pour chacun des trois rôles (Next, reaper, runner), `SIRIUS_USDC_ADDRESS` trim/minuscules doit valoir le MUSD, sinon `issue <rôle>.SIRIUS_USDC_ADDRESS.mainnet` ; `NEXT_PUBLIC_SIRIUS_USDC_ADDRESS` doit égaler `SIRIUS_USDC_ADDRESS` (inchangé).
- `contracts/scripts/deploy.ts` (hors périmètre, lecture) : appelle `deploymentPlan`, puis lit `getBytecode` et `decimals()` on-chain et refuse tout écart avec `SIRIUS_USDC_CODE_HASH` et `USDC_DECIMALS_BY_NETWORK`. Rien à changer dans ce fichier : le jeton vient de la politique.

**Fuites** : aucune donnée utilisateur manipulée. Les messages d'erreur des scripts ne reflètent pas la valeur d'entrée (test dédié dans `deploy-policy.test.ts`).

**Impact sur l'argent, l'escrow, les contrats, le moteur Phala** :

- L'escrow v7 est déployé avec l'adresse MUSD dans son constructeur, immuable. Un mauvais jeton ici rendrait tout prêt impossible ou gratuit ; d'où le triple contrôle (politique, code hash, décimales).
- **Proxy évolutif** : Mezo peut changer la logique de MUSD à tout moment, sans changer le code hash du proxy. Une mise à niveau introduisant des frais de transfert ou un rebasage casserait l'hypothèse de l'escrow (« `transferFrom` de N crédite exactement N »). Probabilité faible pour un stablecoin réglementé à parité ; à surveiller (§7).
- **Pouvoir de gel et de pause** : l'implémentation expose `paused()` (lu : `false`) et, selon le standard Mezo, un gel d'adresses. Un gel de l'escrow, du Safe (`computeRecipient`) ou d'un utilisateur bloque règlements et remboursements pour les prêts concernés. L'escrow ne peut rien contre cela ; c'est inhérent au choix d'un stablecoin réglementé. Aucune mitigation technique possible côté Sirius hors surveillance et communication aux utilisateurs.
- Le moteur Phala (runner) ne change pas : il lit `billing.usdc` depuis la politique validée à l'initialisation du volume.
- Pas de prêt existant sur mainnet : aucune migration de fonds.

**Base de données** : aucune.

**Interface** : aucun contenu utilisateur ; le libellé vient d'une constante. Sur testnet, l'affichage est identique à avant (« test MUSD » via `t()`). Sur mainnet, « MUSD » au lieu de « USDC » sur wallet, dashboard et `/status`. Les autres pages affichent encore « USDC » (§8).

**Textes** : `/status` annonce « real MUSD (Mezo USD, issued by the Mezo protocol) ». Aucune promesse ajoutée. `src/app/terms/page.tsx` (slice A4) dit encore « real USDC » : à corriger dans cette slice-là (§8).

### 4. Cas limites à essayer à la main sur staging

1. **Exécution à blanc mainnet avec MUSD** (par Ali ou Ali, clé de déploiement en main, voir runbooks) : `SIRIUS_DEPLOY_NETWORK=mainnet SIRIUS_ALLOW_MAINNET=true SIRIUS_BILLING_VERSION=7 SIRIUS_DEPLOY_DRY_RUN=true SIRIUS_USDC_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 SIRIUS_USDC_CODE_HASH=0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6 SIRIUS_KYB_ADMIN=<Safe> SIRIUS_KYB_VERIFIER=<vérif> SIRIUS_LOCK_AUTHORIZER=<CVM> pnpm contracts:deploy:testnet`. Attendu : « USDC : 0x5fc5… (18 décimales) », contrôle du Safe comme contrat, aucune transaction.
2. **Même commande avec l'ancien USDC** `0x80e0e24718dbFcad49ECAA6F1e6C89A190586cA8` : refus immédiat par la politique, message « doit être l'MUSD de Mezo … aucun autre jeton, USDC compris », avant toute lecture RPC.
3. **Même commande avec l'adresse MUSD en minuscules, puis avec des espaces autour** : acceptée dans les deux cas.
4. **Même commande avec un code hash faux** (par exemple l'ancien `0x487e3e7b…e694` de l'USDC) : la politique passe, puis `deploy.ts` refuse « Code hash USDC inattendu : 0x864c… » (il affiche le hash lu, utile pour mettre à jour la commande).
5. **`pnpm phala:preflight-v7 --network=mainnet`** avec `SIRIUS_USDC_ADDRESS` = MUSD et `SIRIUS_USDC_CODE_HASH` = hash du proxy, contrats non configurés : `chainChecksPassed` dépend des soldes, `usdc.decimals` = 6, `issues` contient `contracts.not_configured`. Avec l'ancien USDC : refus « Jeton mainnet attendu : MUSD de Mezo ».
6. **`node scripts/operations/release-check.mjs --network=mainnet <next> <reaper> <runner>`** avec un seul rôle sur l'ancien USDC : `configurationReady: false`, `issues` contient `<rôle>.SIRIUS_USDC_ADDRESS.mainnet`.
7. **Across** : ouvrir `https://app.across.to/bridge`, choisir destination Mezo, source Base/Arbitrum en USDC ; vérifier que le jeton de réception proposé est bien **MUSD** (`0x5fc5…d168`), et que le MUSD sur Ethereum est accepté en entrée. Si ce n'est pas le cas, la décision 1 du cahier des charges (autre moyen d'ajout de fonds) redevient ouverte.
8. **Staging (testnet)** : pages `/wallet` et `/dashboard` affichent toujours « test MUSD » à côté du solde, en anglais comme en français ; `/status` affiche « test MUSD » sur la ligne du contrat (au lieu de « USDC » auparavant).
9. **Production (mainnet, après déploiement)** : `/wallet` et `/dashboard` affichent « MUSD » ; `/status` affiche « real MUSD (Mezo USD, issued by the Mezo protocol) », « <n> MUSD » aux plafonds, et « MUSD » sur la ligne du contrat avec l'adresse `0x5fc5…`.
10. **Explorateur** : vérifier sur `explorer.mezo.org/address/0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` que le proxy et son implémentation sont vérifiés, nommés « Mezo USD », émis par Mezo, et que l'implémentation n'a ni fonction de frais ni de rebasage. L'API de l'explorateur répond par un défi anti-robot en ligne de commande : à faire dans un navigateur.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

**Ajoutés ou modifiés** :

- `src/lib/evm/stablecoin.test.ts` (nouveau, 5 tests, ajouté à `pnpm test`) : adresse officielle, minuscules, checksum EIP-55 (`getAddress` de viem : une faute de frappe casserait le test), différence avec l'ancien USDC ; nom/symbole/décimales et alignement avec `USDC_DECIMALS_BY_NETWORK` (mainnet 6, testnet 18) ; **égalité des constantes et des alias des quatre scripts** ; `stablecoinSymbol` sur les deux réseaux, jamais « test » sur mainnet, erreur sur `""`, `"Mainnet"`, `"31612"`, `undefined`, `null` ; « test MUSD » a une clé i18n et « MUSD » n'en a pas.
- `scripts/deploy-policy.test.ts` : constante et alias ; mainnet accepte le MUSD checksummé, minuscules, majuscules, avec espaces ; refuse l'ancien USDC (deux casses), l'adresse nulle, vide, absente, tronquée, sans `0x` ; le message ne reflète pas la valeur refusée ; le testnet accepte l'ancien USDC, le MUSD ou un jeton quelconque (inchangé).
- `scripts/initialize-runner-volume.test.ts` : constante et alias ; mainnet refuse l'ancien USDC (message `/MUSD/`), un jeton quelconque, le MUSD en majuscules (la politique validée est toujours en minuscules), 18 décimales, chaîne 31611 ; politique mainnet valide avec le MUSD.
- `scripts/phala-v7-preflight.test.ts` : constante et alias ; configuration mainnet normalise l'adresse checksummée en minuscules ; refuse l'ancien USDC (deux casses, message `/MUSD/`) ; le testnet accepte le MUSD comme l'ancien USDC sans imposer de jeton.
- `scripts/operations/release-check.test.mjs` (**désormais exécuté par `pnpm test`**) : constante et alias ; pour chacun des trois rôles, l'ancien USDC (deux casses), un jeton quelconque et la valeur vide produisent `<rôle>.SIRIUS_USDC_ADDRESS.mainnet` ; MUSD en minuscules côté serveur et checksummé côté public accepté ; testnet sans jeton imposé ; cas supplémentaires dans le test existant.

**Non couvert** :

- L'exécution à blanc réelle contre le RPC mainnet (`contracts/scripts/deploy.ts`) : demande la clé de déploiement, à faire par Ali ou Ali (§4, cas 1).
- Le préflight réel contre le RPC mainnet avec le hash du proxy (les tests mockent le client).
- Le rendu des pages (`/status`, `/wallet`, `/dashboard`) sur mainnet : aucun test e2e ne tourne en mode mainnet. Les tests e2e existants couvrent le testnet, inchangé.
- La table des routes d'Across (vérification manuelle, §4 cas 7).
- Les tests `initialize-runner-volume` qui écrivent des fichiers échouent **sur Windows** (contrôle de mode `0o077` et garde CLI sur `/`), avant comme après la slice (vérifié en relançant le fichier de test de `staging` sur ce poste : mêmes quatre échecs) ; ils passent sous Linux (CI). Les assertions MUSD de ces tests s'exécutent avant l'écriture et passent.

### 6. Hypothèses

1. L'adresse de la documentation Mezo (« MUSD on Main Networks », ligne Mezo) est l'adresse officielle, et c'est celle que donne aussi la page « Mezo Token Contracts » de docs.mezo.com (vu par recherche, pas relu dans le document lui-même).
2. Le RPC public `https://mainnet.mezo.public.validationcloud.io` renvoie l'état réel de la chaîne (chainId `0x1237` = 31612 vérifié dans la même session).
3. MUSD n'a ni frais de transfert ni rebasage : cohérent avec un stablecoin Mezo à parité et avec les lectures (`totalSupply` stable entre deux appels), mais la source de l'implémentation n'a pas été relue (explorateur inaccessible en ligne de commande). À confirmer (§4, cas 10).
4. Mezo ne mettra pas à niveau l'implémentation entre l'exécution à blanc et le déploiement d'une manière qui change `decimals()`. Si cela arrivait, `deploy.ts` refuserait (contrôle on-chain).
5. Across livre bien de le MUSD sur Mezo, d'après son annonce (§2.6).
6. `NEXT_PUBLIC_EVM_NETWORK` est renseigné à `mainnet` en production (sinon le libellé afficherait « test MUSD » sur de vrais fonds : `release-check` l'impose déjà, `next.NEXT_PUBLIC_EVM_NETWORK`).

### 7. Risques résiduels et limites connues

1. **Proxy évolutif, pouvoir de Mezo** : mise à niveau de la logique (frais, rebasage, nouvelles conditions), pause globale, gel d'adresses. Le code hash contrôlé ne détecte rien de cela. Impact : règlements ou remboursements bloqués pour les prêts en cours ; fonds immobilisés dans l'escrow tant que le gel dure. Mitigation : surveillance (`paused()`, événements de gel, annonces Mezo), et le fait que l'escrow v7 n'accepte que des montants bornés (plafonds d'exposition).
2. **Le code hash ne distingue pas deux proxys ERC-1967 identiques** : un autre jeton Mezo déployé avec le même proxy aurait le même hash. C'est l'adresse épinglée qui protège ; le hash ne couvre que « adresse vide » et « contrat d'une autre forme ».
3. **Libellés « USDC » restants** sur marketplace, upload, train, explorer, composants partagés, `terms` et `tariff-proposal.json` (`priceUnit: "MUSD"`) : un utilisateur mainnet verra « USDC » à côté de prix réglés en MUSD. Pas de risque de fonds, mais une incohérence visible le jour du lancement si les autres slices ne reprennent pas `stablecoinSymbol`.
4. **Liquidité et ajout de fonds** : si Across ne livrait pas de MUSD (hypothèse 5 fausse), les utilisateurs n'auraient aucun moyen simple d'obtenir le jeton de l'escrow.
5. **Fichier `release-check.mjs`** : littéral dupliqué, protégé par un test, mais un opérateur qui modifierait le `.mjs` sur le VPS sans passer par le dépôt ne serait pas protégé.

### 8. Reste à faire

| Priorité | Quoi | Qui |
|---|---|---|
| P0 | Exécution à blanc du déploiement mainnet avec la commande des runbooks (§4, cas 1 à 4) ; relever le code hash si Mezo a mis à niveau entre-temps | Ali ou Ali, samedi |
| P0 | Vérifier à la main sur l'explorateur que le proxy et l'implémentation sont vérifiés et émis par Mezo, sans frais ni rebasage (§4, cas 10) | Ali ou Ali |
| P0 | Confirmer sur `app.across.to` que la destination Mezo livre de le MUSD (§4, cas 7) | Ali ou Ali |
| P1 | Reprendre les libellés « USDC » des pages marketplace, upload, train, explorer, composants partagés (`PriceBreakdown` prend déjà un `token.symbol`) et `terms` avec `stablecoinSymbol` ; puis adapter les clés i18n correspondantes | slices N2, N3, N4, A7, A2, A4 |
| P1 | Relâcher `src/lib/evm/balance.test.ts` (regex `t\("test MUSD"\)`) vers `stablecoinSymbol\(` pour permettre `t(stablecoinSymbol(network))` dans les pages | après fusion |
| P1 | Rabattre le `stablecoinSymbol` de `src/components/profile/network.ts` (slice A5, mêmes valeurs) sur `src/lib/evm/stablecoin.ts` : une ligne de réexport. En attendant, `stablecoin.test.ts` vérifie que les deux coïncident | après fusion |
| P2 | Préflight : lire le slot d'implémentation ERC-1967 et rapporter son adresse et son code hash dans le rapport (`usdc.implementation`), pour tracer les mises à niveau de Mezo d'un préflight à l'autre ; optionnellement `paused()` | après lancement |
| P2 | `deploy/operations/tariff-proposal.json` : `priceUnit` « USDC » → « MUSD » lors de la prochaine proposition tarifaire mainnet | opérations |
| P2 | `docs/MAINNET-LAUNCH.md`, `docs/MAINNET-LAUNCH-PLAN.md`, `docs/AUDIT-2026-10-01.md` mentionnent encore l'USDC `0x80e0…` : documents historiques, hors périmètre ; ajouter une note de renvoi vers la décision MUSD | documentation |

### 9. Résultats des vérifications

Environnement : **Windows 11**, Node 22.16.0, pnpm 11.18.0 via `corepack`, Docker absent, `DATABASE_URL="postgresql://x:y@localhost:5432/z"` (factice, aucune base). Worktree de la branche `feat/usdg` après fusion de `origin/staging` (`ec0b768`, onze PR fusionnées pendant la slice : conflits résolus dans `package.json`, union des 92 fichiers de test sans perte ni doublon, et `src/app/(app)/wallet/page.tsx`, où la constante `NETWORK` introduite par A5 remplace mon `const network`).

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | `Done in 4.9s using pnpm v11.18.0`, `postinstall: ✔ Generated Prisma Client (7.8.0)`, code 0. Sans `DATABASE_URL`, le postinstall échoue sur `PrismaConfigEnvError` (préexistant). |
| `pnpm prisma generate` | `✔ Generated Prisma Client (7.8.0) to .\src\generated\prisma`, code 0 |
| `pnpm exec tsc --noEmit` | aucune erreur, code 0 (relancé après chaque correctif, dont la fusion) |
| `pnpm lint` | `eslint` sans sortie, code 0 (idem) |
| `pnpm audit:deps` | `2 vulnerabilities found — Severity: 1 low \| 1 high (1 ignored)`, code 0 (état préexistant du dépôt) |
| `pnpm test` | **Ne démarre pas tel quel sous Windows** : le script commence par `NODE_OPTIONS="…" node …`, que le shell Windows ne comprend pas (`'NODE_OPTIONS' n'est pas reconnu`). Équivalent lancé avec la variable exportée et la liste de fichiers lue dans `package.json`. Un premier passage global s'est **bloqué** après `scripts/runner-cli.test.ts` (processus enfant Windows jamais terminé) ; relancé fichier par fichier avec un délai maximal de 90 s par fichier : **92 fichiers, 633 tests passés, 72 échecs**, tous dans 8 fichiers et tous dus à l'environnement Windows, détaillés ci-dessous. |
| Tests de la slice (`stablecoin`, `deploy-policy`, `phala-v7-preflight`, `release-check`, plus les gardes `english` et `balance`) | `39 tests, 39 pass, 0 fail` (dernier passage, après fusion) |
| `scripts/initialize-runner-volume.test.ts` | 4 pass, 4 fail : `Registre anti-rejeu remplacé ou indisponible` ×3 et `Missing expected rejection` ×1. Reproduits à l'identique avec le fichier de test de `origin/staging` sur ce poste : contrôle de mode POSIX (`mode & 0o077`, Windows renvoie 0o666) et garde CLI sur `/`. Les assertions MUSD du test mainnet s'exécutent et passent avant l'écriture qui échoue. |
| Lecture on-chain (`eth_chainId`, `eth_getCode`, `eth_call`, `eth_getStorageAt` sur `https://mainnet.mezo.public.validationcloud.io`) | chaîne `0x1237` (31612) ; MUSD : code 170 octets, keccak256 `0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6`, `name` « Mezo USD », `symbol` « MUSD », `decimals` 6, `paused` false, `totalSupply` 700 104 924,001817, slot d'implémentation ERC-1967 → `0x68184c449e1a8f34fa18d289737129fd27b66f8f` (18 644 octets, keccak256 `0x3a551ac5c744af57e68a1d1431ac403c0f516ffd7d224a75746aee11fc4f3baf`), slot d'admin vide. Ancien USDC `0x80e0…` : 835 octets, keccak256 `0x487e3e7b…e694` (celui des anciens runbooks), 18 décimales, pas de proxy. Le second relecteur a refait la lecture indépendamment : mêmes valeurs. |
| API Blockscout (`/api/v2/smart-contracts/0x5fc5…`) | HTTP 403 / défi Cloudflare en ligne de commande : vérification du contrat à faire dans un navigateur (§4, cas 10). |
| `git log origin/staging..HEAD --format=%B` | aucun `Co-Authored-By`, `Claude`, lien de session ni `[skip ci]` ; auteur `alibenyezza` sur les deux commits. |

**Échecs d'environnement Windows (72), tous préexistants et sans lien avec la slice** : `src/lib/runner/replay.test.ts` (7, `Registre anti-rejeu…`), `src/lib/runner/budget.test.ts` (54, `Répertoire privé requis pour le budget runner` : mode POSIX), `src/runner/server.test.ts` (1, idem), `src/lib/runner/monitoring.test.ts` (1, idem), `scripts/runner-cli.test.ts` (1, CLI enfant Windows), `scripts/initialize-runner-volume.test.ts` (4, ci-dessus), `src/lib/auth/self-training-routes.test.ts` (3, chemins `src\app\…` contre `src/app/…`), `src/lib/copy/disclaimers.test.ts` (1, `src/lib/tee/contract.ts absent du graphe`, séparateur de chemin). Le reste de la suite, dont tous les tests ajoutés ou modifiés par la slice, passe. La CI tourne sous Linux et n'a pas ces échecs.

### 10. Revue interne de la session

Deux relecteurs adversariaux indépendants (sécurité : « aucun autre jeton sur mainnet » ; exactitude : testnet inchangé, décimales, docs), lancés sur le diff avant fusion. Aucun des deux n'a trouvé de point bloquant.

**Corrigé à la suite des revues** :

1. Tests trop faibles (`assert.throws` sans motif, ou alternance `/MUSD|non nulle/`) : `deploy-policy.test.ts` sépare désormais « jeton bien formé mais différent » (motif `/MUSD/`) et « valeur mal formée » (motif `/non nulle/`) ; `phala-v7-preflight.test.ts` exige `/MUSD/` pour `address(1)`, l'ancien USDC sous deux casses et avec espaces ; `initialize-runner-volume.test.ts` exige `/MUSD/` pour l'ancien USDC et un jeton quelconque, et garde `Error` seulement pour le MUSD en majuscules (refusé plus tôt, par la validation de la politique).
2. `phala-v7-preflight.ts` : le message d'épinglage interpole la constante au lieu d'une abréviation en dur ; « Empreinte USDC requise » devient « Empreinte du jeton de règlement requise : SIRIUS_USDC_CODE_HASH ».
3. `src/app/status/page.tsx` : « Mezo USD » vient de `MAINNET_STABLECOIN_NAME`.
4. Commentaire de `stablecoinSymbol` et nom du test associé : ils affirmaient que le résultat « passe par `t()` », ce qui n'est vrai que du libellé testnet. Reformulés.
5. Commentaire de l'alias `MAINNET_USDC` : « conservé pour les imports existants » alors qu'aucun importateur n'existe hors tests ; devient « gardé par compatibilité (cahier des charges A8)… Aucun importateur hors tests ».
6. `initialize-runner-volume.test.ts` : constante `LEGACY_USDC` déplacée après le bloc d'imports.
7. Après la fusion de `staging` : la slice A5 a ajouté une clé i18n `"MUSD": "MUSD"`, ce qui cassait mon assertion « aucune clé pour un symbole ». L'invariant réel est `t("MUSD") === "MUSD"` : test réécrit ainsi. A5 a aussi son propre `stablecoinSymbol` dans `src/components/profile/network.ts` (mêmes valeurs) : le test vérifie désormais que les deux helpers coïncident sur les deux réseaux, en attendant que celui de A5 soit rabattu sur `src/lib/evm/stablecoin.ts` (§8).

**Signalé par les revues et écarté ou reporté (hors périmètre de la slice, consigné en §8)** : libellés « USDC » dans `explorer`, `train`, `ComputeQuoteDialog`, `EscrowCredits`, `terms` ; `docs/MAINNET-LAUNCH.md`, `docs/MAINNET-LAUNCH-PLAN.md` (dont la case de checklist « `usdc()` = 0x80e0…6cA8 »), `docs/AUDIT-2026-10-01.md`, `.env.example` (« keccak256 du bytecode USDC »), `deploy/phala/compose.init-v7.yaml` (`Token testnet attendu requis` alors qu'il sert aussi à l'init mainnet) et le commentaire de `contracts/scripts/deploy.ts:87` (« l'USDC natif ») qui pointent encore l'ancien jeton ; `src/worker/mainnet-guard.ts` ne vérifie que la présence de `SIRIUS_USDC_ADDRESS`, pas sa valeur (atténué : jeton figé dans le constructeur de l'escrow, préflight qui compare `escrow.usdc()` à la configuration) ; double exécution inoffensive de `release-check.test.mjs` (`test` et `test:operations`) ; sur testnet, la ligne de contrat de `/status` s'intitule « TEST USDC » (cosmétique) ; message post-ajout de fonds « {usdc} USDC envoyés. » dans wallet/dashboard : il n'apparaît que sur le chemin faucet, donc jamais sur mainnet (sur mainnet, `addFunds` lève « Pont ouvert : envoie de l'USDC vers Mezo depuis un autre réseau », exact puisque l'utilisateur envoie de l'USDC et reçoit de le MUSD).

**Vérifié conforme par les revues** : normalisation et comparaison en minuscules dans les quatre scripts ; refus de l'ancien USDC testé partout ; alias cohérent ; messages sans reflet de l'entrée ; testnet strictement inchangé ; décimales cohérentes (table, constante, préflight, runner) ; `resolveClientNetwork()` déjà appelé au niveau module par d'autres composants (aucun nouveau cas de levée) ; aucun effet de bord à l'import des scripts dans le test croisé ; `tsc -p contracts/tsconfig.v7.json` (celui de la CI) passe.

---

## N1 — Mes datasets

Branche `feat/mes-datasets`, PR vers `staging`. Partie de `staging` à `e829cfc`, mise à jour par quatre fusions de `origin/staging` (`2f6ae81` journal des accès, `7156291` tutos et page Wallet, `41a91ed` upload en deux étapes N2, `fd3cefc` marketplace N3) ; conflits limités à la ligne `test` de `package.json` et aux imports de `english.ts`, résolus en gardant tous les ajouts. Tout ce qui suit se vérifie avec `git diff origin/staging...HEAD` (18 fichiers, liste en §1). Correctifs après la première CI : voir §11.

### 1. Ce qui a changé

Aucune table, colonne, migration ni contrat. La slice lit et écrit les colonnes posées par A1 (`listingExpiresAt`, `trainingConsentAt`, `trainingConsentVersion`, `trainingConsentRevokedAt`) et `status`, `name`, `description`, `listedAt` existants.

**Routes**

| Route | Méthode | Rôle | Garde |
|---|---|---|---|
| `/api/datasets/[id]/settings` (nouvelle) | GET | Vue du propriétaire : description, état affiché, annonce, consentement | session, propriétaire, 60/min/wallet |
| idem | PATCH | Nom et description (clés `name`, `description` seules ; le prix est refusé explicitement) | origine + session, propriétaire, 20/min/wallet |
| `/api/datasets/[id]/settings/listing` (nouvelle) | POST | `pause` (LISTED → UNLISTED), `resume` (UNLISTED ou PRIVATE titré → LISTED, jamais en démo Phala), `extend` (7, 30 ou 90 jours) | origine + session, propriétaire, grant `set-dataset-visibility` pour `pause`, `resume` et la prolongation d'une annonce LISTED expirée, 20/min/wallet |
| `/api/datasets/[id]/settings/consent` (nouvelle) | POST | Retrait du consentement à l'amélioration des modèles (`{ action: "revoke" }` seul) | origine + session, propriétaire, 10/min/wallet |
| `/api/datasets/[id]/stats` (nouvelle) | GET | Emprunts (total, en cours, 8 semaines glissantes, dernier), revenus gagnés et bloqués dans l'escrow, entraînements livrés et remboursés | session, propriétaire, 60/min/wallet |
| `/api/datasets/[id]` (modifiée) | PATCH | Sélecteur de visibilité existant : propriété désormais vérifiée dans la requête (404 uniforme au lieu de 403/404), et mêmes règles de passage à Public que la fiche (`assertVisibilityChange`) | inchangée sinon (grant, `setDatasetVisibility`) |

Toutes les réponses privées portent `cache-control: private, no-store`.

**Fichiers**

| Fichier | Rôle |
|---|---|
| `src/lib/datasets/manage.ts` (nouveau) | Règles partagées navigateur/serveur, sans `server-only` ni client Prisma à l'exécution (types seulement) : `displayStatus` (statut → pastille), `isListingExpired`, `visibilityTransition`, `assertVisibilityChange`, `extendedListingExpiry`, `extensionRelists`, `parseListingRequest`, `parseConsentRequest`, `validateDetailsPatch`, `aggregateLoanStats`, `isCountedBorrow`, `providerShareAtomic`, `sortDatasets`, `formatUtcDate(Time)` ; accès base à client injecté : `loadOwnedDataset`, `applyVisibility`, `applyExtension`, `applyDetails`, `revokeTrainingConsent`, `readOwnerView`, `toOwnerView` (dont `canRelist`), `readDatasetStats`. |
| `src/lib/datasets/manage.test.ts` (nouveau) | 35 tests (§5). |
| `src/app/api/datasets/[id]/settings/route.ts`, `settings/listing/route.ts`, `settings/consent/route.ts`, `stats/route.ts` (nouveaux) | Routes ci-dessus, minces : session → limite → corps → propriété → règle → écriture conditionnelle → vue. |
| `src/app/api/datasets/[id]/route.ts` | PATCH seulement (voir tableau). GET, POST et DELETE inchangés. |
| `src/app/(app)/datasets/page.tsx` | Réécrite : mosaïque de `DatasetCard` (1 à 4 colonnes), `DatasetAddTile` vers `/datasets/new` en premier, tri date / revenus / emprunts (mémorisé en `localStorage`), légende sous la carte quand la pastille ne suffit pas, bouton de publication sous la carte d'un brouillon, KYB repris de l'ancienne page. |
| `src/app/(app)/datasets/[id]/page.tsx` (nouveau) | Composant serveur qui passe l'identifiant à la fiche ; aucun contrôle (les routes le font). |
| `src/app/(app)/datasets/[id]/DatasetDetail.tsx` (nouveau) | Fiche : description, prix non modifiable expliqué, statistiques, publication d'un brouillon (reprise de l'ancienne liste), nom et description, publication sur la marketplace (pause, remise en ligne, « Rendre privé », prolongation), consentement, destruction en double confirmation. |
| `src/app/(app)/datasets/[id]/settings-client.ts` (nouveau) | Appels de la fiche vers les routes privées ; émission des grants. |
| `src/app/(app)/datasets/[id]/PublishDraftButton.tsx` (nouveau) | Bouton « Publier le titre / Réconcilier / Réimport requis / Upload incomplet » d'un brouillon, partagé par la carte de la mosaïque et la fiche (règles de l'ancienne liste). |
| `e2e/datasets.spec.ts`, `e2e/account-switch.spec.ts` | Adaptés à la mosaïque et à la fiche sans retirer de vérification (§11), avec l'autorisation explicite du coordinateur. |
| `src/lib/i18n/datasets-en.ts` (nouveau) + `src/lib/i18n/english.ts` (+2 lignes) | Traductions anglaises de toutes les nouvelles chaînes, fusionnées dans `EN_MESSAGES`. |
| `package.json` | `src/lib/datasets/manage.test.ts` ajouté à la fin du script `test`. |
| `docs/passage-mainnet/audit.md` | Cette section. |

**Non touché** : `src/app/(app)/datasets/new/**`, `src/app/api/datasets/route.ts`, marketplace, `layout.tsx`, Sidebar, dashboard, `src/components/ui/**`, `src/components/datasets/**`, `src/lib/datasets/client.ts`, `src/lib/sirius/**`, `prisma/**`, contrats, runner.

### 2. Décisions et écarts par rapport au cahier des charges

1. **États de la pastille** (`displayStatus`) : DELETED → *Détruit* ; DRAFT et LISTING → *En attente* ; LISTED, UNLISTED ou PRIVATE avec au moins un prêt ESCROWED, TRAINING ou SETTLING → *Emprunté* (prioritaire : c'est l'information urgente) ; UNLISTED et PRIVATE → *En pause* ; LISTED dont `listingExpiresAt` est atteinte → *Expiré* ; sinon *En ligne*. Un statut inconnu donne *En attente*, jamais *En ligne*. Une date d'expiration illisible vaut expirée.
2. **Écart composant : il manque des états à `StatusPill`.** `status.ts` (A2, non modifiable ici) n'a ni *Suspendu/Archivé*, ni *Privé*, ni *Brouillon*. Choix : SUSPENDED → *Échoué* (pastille rouge, « à regarder »), PRIVATE → *En pause*, DRAFT/LISTING → *En attente*, avec une **légende sous la carte** (« Archivé par Sirius : plus disponible à l'emprunt. », « Privé : visible par toi seul. », « Brouillon : publication non terminée. »…) et l'explication complète dans la fiche. **Demande pour A2** : ajouter `archived` (ou `suspended`), `private` et `draft` à `STATUS_KINDS`, puis remplacer le pont dans `displayStatus`.
3. **Pause = LISTED → UNLISTED, et c'est dit.** Comme décidé en A1 (16 § 2), UNLISTED reste empruntable par lien direct. La fiche l'écrit en toutes lettres (« Une personne qui a déjà son lien direct peut encore l'emprunter »). Pour fermer aussi le lien direct, la fiche propose **« Rendre privé »**, qui passe par la route de visibilité existante (refusée par `setDatasetVisibility` pendant un emprunt en cours ou réservé). L'ancien sélecteur à trois positions a disparu de l'interface (la route reste).
4. **Pause et remise en ligne permises pendant un emprunt**, contrairement à `setDatasetVisibility` qui refuse tout changement si un prêt est PENDING à SETTLING. LISTED et UNLISTED sont tous deux dans `BORROWABLE_STATUSES` et `borrower.ts` (préparation et blocage) accepte les deux : un prêt en cours n'est pas affecté (vérifié en lecture par deux relecteurs). Le passage en PRIVATE, qui le serait, garde la règle stricte de la route existante.
5. **Démo Phala et datasets privés.** En démo (`SIRIUS_PHALA_DEMO=true`), `markDatasetListed` crée les datasets en PRIVATE : **rien n'y repasse en ligne** (reprise, prolongation d'une annonce LISTED expirée, PATCH vers LISTED, PATCH PRIVATE → UNLISTED). Hors démo, tout dataset titré a été publié LISTED à sa création ; un PRIVATE ou UNLISTED titré peut donc repasser en ligne, même si `listedAt` est nul (la migration du 27 septembre ne l'a rempli que pour les LISTED : s'appuyer sur `listedAt` bloquait à tort ces anciens datasets, constat de la passe 4). Un PRIVATE sans titre EVM ne passe ni en UNLISTED ni en LISTED. Les mêmes règles s'appliquent au PATCH existant (`assertVisibilityChange`), y compris le détour PRIVATE → UNLISTED → LISTED ; LISTED → LISTED y reste accepté comme avant. La vue du propriétaire porte `canRelist` (faux en démo) pour que la fiche ne propose pas une action qui ferait signer un grant pour un refus certain.
6. **Remise en ligne d'une annonce expirée refusée** (« prolonge-la d'abord »), sur la fiche comme sur le PATCH existant.
7. **Prolongation** : 7, 30 ou 90 jours (07-upload.md), ajoutés à la fin actuelle si elle est future, à maintenant sinon ; horizon plafonné à 365 jours (choix de la slice, pour éviter une annonce quasi permanente) ; refusée pour une annonce sans date (`listingExpiresAt` nul = publiée avant le champ, n'expire jamais : la prolonger lui imposerait une fin) ; permise pour LISTED, UNLISTED et PRIVATE (sinon un privé expiré ne pourrait plus jamais être republié). **Prolonger une annonce LISTED déjà expirée la remet sur la marketplace : le même grant que la remise en ligne est alors exigé**, et la base refuse d'écrire si l'annonce a expiré entre la décision de la route et l'écriture sans grant.
8. **Grants** : `pause`, `resume` et la prolongation qui remet en ligne réutilisent l'opération existante `set-dataset-visibility` avec l'intention `[id, statut visé]`, exactement comme le PATCH existant. Un grant signé pour une route vaut donc pour l'autre, pour le même identifiant et la même cible ; le nonce est consommé une seule fois dans la table `MutationGrant` commune. Ajouter une opération dédiée aurait demandé de modifier `src/lib/runner/authorization*` (hors périmètre). Nom, description et retrait du consentement n'exigent pas de grant : écritures en base uniquement, sans effet sur l'argent ni la visibilité, comme `PATCH /api/profile` (A1). Le grant est signé sans interaction par la clé de session du navigateur : il protège contre la falsification inter-sites et le rejeu, pas contre un script exécuté dans la page.
9. **Prix non modifiable**, expliqué dans la fiche (« inscrit dans le reçu signé par l'enclave au scellement… détruis et republie »). Le PATCH refuse `price`, `priceUsdc` et `priceUsdcAtomic` avec ce message.
10. **Consentement** : seul le **retrait** existe (pose `trainingConsentRevokedAt`, garde date et version initiales, une seule fois, possible même après destruction). Donner un consentement depuis la fiche supposerait le texte versionné de l'upload (N2) : non fait.
11. **Statistiques.**
    - *Emprunt* = prêt dont le blocage USDC est confirmé : ESCROWED, TRAINING, SETTLING, SETTLED, ou CANCELLED **avec** `cancelTxHash` (remboursement confirmé, donc blocage réel). PENDING, SUBMITTING (le blocage peut encore échouer et revenir à PENDING) et CANCELLED sans transaction n'en sont pas.
    - *Revenus gagnés* = somme, sur les prêts SETTLED, de `datasetAmountUsdcAtomic` (prêts v7 : la part de calcul va à l'enclave) ou de `amountUsdcAtomic` (prêts antérieurs au devis, montant entier au fournisseur). Sommes en `bigint`, exactes au-delà de 2⁵³ ; un montant illisible est exclu et compté à part.
    - *Bloqué dans l'escrow* = même part sur les prêts en cours.
    - *Retirés / à retirer* : **non disponibles par dataset**. L'escrow crédite le wallet du fournisseur (`creditOf`), tous datasets confondus ; la fiche le dit et renvoie vers la page Wallet. Écart assumé avec 06.
    - *Entraînements livrés* = SETTLED ; *remboursés (échec ou délai dépassé)* = CANCELLED avec remboursement. Le libellé ne prétend pas distinguer échec et expiration.
    - *Par semaine* : 8 fenêtres glissantes de 7 jours se terminant à l'instant de la requête, UTC, bornes [début, fin) ; libellé « 7 days from <date> » pour ne pas suggérer des semaines calendaires.
    - *Dernier emprunt* : `createdAt` du prêt (réservation), pas l'heure du blocage.
    - Fiche : 5 000 prêts au plus lus (`truncated` affiché). Mosaïque : agrégat dans le navigateur à partir de `/api/loans` (route existante, tous les prêts du wallet, filtrés sur `provider`) avec la même fonction : mêmes chiffres, sans plafond.
12. **Mosaïque** : toutes les pages de `/api/datasets` sont suivies (au plus 20 × 24) pour que le tri porte sur tout ; au-delà, un message le dit. Les datasets détruits **et réconciliés** n'y apparaissent pas (filtre de la route de liste, N2) : la pastille *Détruit* ne se voit que pour une suppression à finaliser, et sur la fiche. Les états de la mosaïque sont calculés à l'instant du chargement (rendu pur).
13. **Propriété** : lecture par `findFirst({ id, provider })`. Absent, autre wallet et identifiant hors format (`^[A-Za-z0-9_-]{1,64}$`) donnent le même 404 « Dataset introuvable », sans lecture de la ligne d'autrui.
14. **Écritures conditionnelles** : chaque écriture rejoue en base les conditions vérifiées en lecture (`updateMany` avec propriétaire, statut exact, titre EVM, `listedAt`, expiration, date d'expiration lue à la milliseconde) ; `count !== 1` → 409 « Dataset modifié entre-temps : recharge la page ». Deux prolongations simultanées ne s'additionnent pas.
15. **Validation du nom et de la description** plus stricte qu'à la création : mêmes longueurs (120 / 2 000), normalisation NFC, refus des substituts isolés, des contrôles C0/C1, des marques et contrôles bidirectionnels, des caractères invisibles ou de format (liste en `manage.ts`) ; ZWNJ et ZWJ admis (persan, langues indiennes, emojis composés) ; U+00AD, U+180E et U+2800 refusés dans le nom seulement ; au moins une lettre ou un chiffre dans le nom. Description vide → `null`. La fiche n'envoie que les champs modifiés : un ancien nom que ces règles refuseraient n'empêche pas de corriger la description.
16. **Jeton et catégories** : fabrique de l'upload `settlementToken(réseau)` (`src/lib/datasets/token.ts`, N2) : MUSD sur mainnet, USDC de test sur testnet, décimales `USDC_DECIMALS` ; la fiche prend les décimales renvoyées par `/stats` (serveur). Catégories traduites par `DATASET_CATEGORY_LABEL_KEYS` de N2 ; une catégorie inconnue n'est pas affichée.
17. **Traductions** dans un fichier séparé `datasets-en.ts` (comme `shared-en.ts`) plutôt qu'en bout de `english.ts` et `errors-en.ts`, pour limiter les conflits avec les slices parallèles ; erreurs serveur comprises.
18. **Fonctions de l'ancienne liste conservées** : publication d'un brouillon (sur la carte et sur la fiche, même bouton), réconciliation LISTING, suppression d'un brouillon, finalisation d'une suppression, KYB, liens « Preuve publique » et explorateur, champs avancés (CID, Merkle, titre EVM) ; ils sont sur la fiche. Destruction proposée pour un dataset archivé seulement s'il a un titre EVM, comme avant.

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès, route par route**

- `GET /api/datasets/[id]/settings` : `requireAuth` (session signée, 401 sinon) → limite `subject:<adresse>` → `readOwnerView` : `findFirst({ id, provider: <adresse normalisée de la session> })` avec `omit` qui ré-inclut seulement les trois colonnes de consentement (`wrappedKey` reste omis globalement) → 404 sinon → compte des prêts en cours → vue construite champ par champ.
- `PATCH /api/datasets/[id]/settings` : `requireAuth` (Origin et `Sec-Fetch-Site` vérifiés, puis session) → limite → `readJson` 16 Kio → `validateDetailsPatch` (avant la base : un corps invalide ne révèle rien sur l'existence) → `loadOwnedDataset` (404) → `applyDetails` : statut parmi DRAFT, LISTING, LISTED, UNLISTED, PRIVATE, rejoué en base avec le propriétaire.
- `POST /api/datasets/[id]/settings/listing` : `requireAuth` → limite → `readJson` 16 Kio → `parseListingRequest` → `loadOwnedDataset` (404 avant tout grant) → règle (409 avant tout grant) → `requireMutationGrant` si `pause`, `resume`, ou prolongation d'une annonce LISTED expirée (sujet du grant = wallet de la session, opération, `datasetId`, intention `[id, cible]`, nonce unique) → écriture conditionnelle.
- `POST /api/datasets/[id]/settings/consent` : `requireAuth` → limite → `readJson` 1 Kio → `parseConsentRequest` → `loadOwnedDataset` → `updateMany` conditionné sur propriétaire, consentement donné et non retiré.
- `GET /api/datasets/[id]/stats` : `requireAuth` → limite → `loadOwnedDataset` (**avant** toute lecture de prêt) → `loan.findMany({ where: { datasetId }, select: { status, createdAt, amountUsdcAtomic, datasetAmountUsdcAtomic, cancelTxHash } })` : ni l'emprunteur ni les preuves ne sont lus.
- `PATCH /api/datasets/[id]` : `loadOwnedDataset` remplace `findUnique` + `assertOwner` ; `assertVisibilityChange` avant le grant ; le reste inchangé.
- La page `/datasets/[id]` ne fait aucun contrôle et n'en a pas besoin : elle n'affiche que ce que les routes renvoient. Aucun contrôle ne repose sur un bouton masqué (les règles de la fiche sont des copies d'affichage des règles serveur).

**Validation et bornes**

- Corps : `readJson` exige `application/json`, refuse `Transfer-Encoding`, un encodage non identity, un `Content-Length` au-delà de la borne (413 avant lecture) et tout JSON non objet. Clés inconnues refusées (`__proto__` et `constructor` issus de `JSON.parse` compris). `days` : nombre exactement 7, 30 ou 90. `authorization` : objet simple. `action` : liste fermée.
- Identifiant : `^[A-Za-z0-9_-]{1,64}$`, sinon 404 sans requête.
- Nom et description : voir §2.15.

**Fuites possibles**

- Les vues sont construites champ par champ : pas d'adresse du fournisseur, pas de `wrappedKey`, pas de `runnerReceipt`, pas de métriques brutes (seuls `rowCount` et `columnCount` validés par `publicDatasetMetrics`). Test : clés de la réponse énumérées, chaînes secrètes absentes.
- Le consentement ne sort que par les routes privées ; l'`omit` global de `src/lib/db.ts` n'est pas touché, et aucune route publique ne fait de `select` sur ces colonnes.
- Erreurs : `AppError` à message fixe ; les autres passent par `errorResponse` (500 opaque, classe seule journalisée). Aucun `console.log` ajouté.
- `/api/loans` (utilisé par la mosaïque) renvoie toujours au fournisseur des lignes complètes, adresses des emprunteurs comprises : antérieur à la slice.

**Argent, escrow, contrats, Phala** : aucune transaction, aucun appel RPC ni runner nouveau. La destruction réutilise `destroyDataset` existant (transaction de tombstone signée dans le wallet). Les changements de visibilité restent entre LISTED et UNLISTED (tous deux empruntables) sauf le passage en PRIVATE, gardé par la règle existante. Les revenus affichés sont une lecture de la base, pas des montants on-chain.

**Base de données** : aucune migration. Écritures `updateMany` conditionnelles uniquement (§2.14). La forme `listingExpiresAt: <date>` + `AND: [{ listingExpiresAt: { gt } }]` a été validée contre le client Prisma 7 réel par un relecteur (la requête atteint la connexion ; un `where` volontairement faux lève `PrismaClientValidationError`).

**Interface** : aucun `dangerouslySetInnerHTML` ; nom et description rendus par React (échappés), `whitespace-pre-line` pour la description ; liens internes construits avec `encodeURIComponent`, lien explorateur depuis une base fixe ; `DatasetCard` filtre lui-même `href` (`safeInternalHref`). Double confirmation de destruction : ouvrir le panneau, puis taper le nom exact, puis signer dans le wallet.

**Textes** : la fiche ne promet pas que l'expiration retire le dataset de la marketplace (voir §7.1) ; elle dit que la pause n'arrête pas l'emprunt par lien direct ; elle dit que les retraits ne sont pas ventilés par dataset ; le texte du consentement reprend celui de 07 (enclave seulement, usages futurs).

### 4. Cas limites à essayer à la main sur staging

Préparation : deux wallets A et B connectés dans deux navigateurs ; un dataset de A publié (LISTED). Les appels manuels se font depuis la console du site (`fetch` avec l'en-tête `content-type: application/json`).

1. **Mosaïque** : `/datasets` → la tuile « Publish a dataset » est la première et ouvre `/datasets/new` ; chaque carte montre nom, modèle, lignes, colonnes, taille, prix « Provider receives », pastille, emprunts, revenus. Trier par Revenue puis Borrows puis Date : l'ordre suit ; recharger : le tri est gardé. À 360 px : une colonne, pas de défilement horizontal.
2. **Fiche d'un autre wallet** : B ouvre `/datasets/<id de A>` → « Dataset not found ». `fetch("/api/datasets/<id de A>/stats")` → 404 ; même réponse pour `/api/datasets/inexistant/stats` et `/api/datasets/..%2Fx/stats`.
3. **Sans session** : navigation privée, `GET /api/datasets/<id>/settings` → 401.
4. **Prix** : `fetch("/api/datasets/<id>/settings",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({priceUsdcAtomic:"1"})})` → 400 « The price cannot be changed… ». La fiche affiche le prix et l'explication.
5. **Nom** : renommer en « Ventes 2025 » → enregistré, la mosaïque suit. Essayer un nom de 121 caractères (refusé côté formulaire et serveur), un nom contenant U+202E (inversion bidirectionnelle) (400 « invisible or control characters »), « --- » (400 « at least one letter or digit »), un nom persan avec ZWNJ (accepté).
6. **Pause** : « Pause » → signature silencieuse, pastille *Paused*, le dataset disparaît de la marketplace (filtre `LISTED` de la liste publique), mais `/marketplace` par lien direct ou `POST /api/loans` avec son identifiant reste possible (comportement voulu et affiché). « Put back online » → *Online*.
7. **Rendre privé** : sur un dataset sans emprunt → *Paused* + légende « Private » ; pendant un emprunt réservé ou en cours le bouton est masqué (ou 409 « Visibility change failed… » si l'état a changé entre-temps).
8. **Expiration** (nécessite une date posée à la main tant que l'upload ne la pose pas : `UPDATE "Dataset" SET "listingExpiresAt" = now() - interval '1 day' WHERE id = '<id>'`) : pastille *Expired* ; « Put back online » d'un UNLISTED expiré absent, `POST …/settings/listing {action:"resume"}` → 409 ; « Extend by 7 days » d'un LISTED expiré → signature, nouvelle fin à J+7 ; prolonger encore → la durée s'ajoute à la fin ; au-delà de 365 jours → 409.
9. **Annonce sans date** : la fiche affiche « Listing without an end date… », pas de formulaire de prolongation ; l'appel direct `extend` → 409.
10. **Concurrence** : ouvrir la fiche dans deux onglets, prolonger dans l'un puis dans l'autre → le second reçoit 409 « The dataset changed in the meantime: reload the page ».
11. **Consentement** (nécessite `trainingConsentAt` posé à la main tant que l'upload ne l'écrit pas) : « Withdraw my consent » → confirmation → « Consent withdrawn on <date> » ; un second appel → 409.
12. **Destruction** : « Destroy this dataset… » → champ de confirmation ; le bouton reste grisé tant que le nom n'est pas exact ; puis signature du tombstone ; la fiche passe à *Destroyed*. Un dataset archivé sans titre EVM ne propose pas la destruction.
13. **Démo Phala** (`SIRIUS_PHALA_DEMO=true`) : la fiche n'affiche ni « Put back online » ni la prolongation d'une annonce en ligne expirée, mais « Demo deployment: datasets stay off the marketplace. » ; les appels directs (`resume`, `extend` d'une annonce LISTED expirée, `PATCH /api/datasets/<id>` en `LISTED` ou PRIVATE → `UNLISTED`) répondent 409 sans consommer de grant. Hors démo, un ancien dataset PRIVATE titré dont `listedAt` est nul repasse en ligne.
14. **Limite de débit** : 21 `POST …/settings/listing` en moins d'une minute depuis le même wallet → le 21ᵉ reçoit 429.
15. **Statistiques** : sur un dataset avec un prêt réglé et un prêt remboursé, la fiche et la carte affichent le même nombre d'emprunts (2) et les mêmes revenus (part du dataset du prêt réglé) ; une réservation abandonnée (PENDING) n'est pas comptée.
16. **Brouillon** : un DRAFT sans CID affiche « Incomplete upload » grisé avec l'info-bulle « Upload interrompu… » ; sa destruction reste possible.
17. **Wallet connecté mais non authentifié** : la fiche affiche « Connect a wallet… » au lieu de charger indéfiniment.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

`src/lib/datasets/manage.test.ts` (35 tests, `node:test`, ajouté au script `test`) :
- états affichés (table complète, toujours un `StatusKind` connu), expiration (bornes, date illisible) ;
- transitions : pause, remise en ligne (UNLISTED, PRIVATE titré avec ou sans `listedAt`, démo, titre EVM, expiration), `assertVisibilityChange` (toutes les cibles, détour par UNLISTED, LISTED → LISTED), prolongation (durées, base, horizon exact 365, annonce sans date, statuts), `extensionRelists` ;
- corps : clés inconnues, `__proto__`, autorisation mal formée, actions inconnues ;
- nom et description : bornes exactes, contrôles, bidi, invisibles, substituts isolés, NFC, ZWNJ/ZWJ, langues variées, refus du prix ;
- statistiques : définition d'un emprunt, part du fournisseur v7 et ancienne, sommes au-delà de 2⁵³, bornes des 8 fenêtres (début inclus, fin exclue, plus ancienne), dates futures ou illisibles, plafond de 5 000 ;
- tri (bigint, inconnus en dernier, égalités) ; dates UTC ;
- base simulée : propriété dans la requête, 404 uniforme sans requête pour un identifiant hors format, `where` exacts des écritures (propriétaire, statut, titre EVM, `listedAt`, expiration, date lue), courses (pause deux fois, expiration ou destruction entre lecture et écriture, statut changé avant une prolongation, deux prolongations), consentement (une fois, trace initiale gardée), vue (clés énumérées, secrets absents, `omit`) ;
- routes chargées dans un contexte VM avec dépendances simulées (motif de `audit-regressions.test.ts`) : 401, 404 d'un autre wallet, prix refusé, 413, grant exigé et lié à la cible, transitions refusées sans consommer de grant, prolongation d'une annonce expirée (sans grant 400, grant refusé 401, accepté 200), démo Phala par variable d'environnement, limite de débit (21ᵉ appel 429, quota par wallet), consentement, statistiques, PATCH existant (expiration, privé jamais publié, détour, démo, 404 uniforme, LISTED → LISTED).

Mutations jouées par les relecteurs (§10) : 26 + 23 + 3, toutes tuées après les ajouts de tests sauf une équivalente (borne de fin `<` / `<=` absorbée par la garde du créneau) et une devenue équivalente (le précontrôle `extendedListingExpiry` avant le grant : une annonce LISTED expirée repart toujours d'aujourd'hui, donc une prolongation qui exige un grant n'est jamais hors horizon).

**Angles morts** :
- Interface : couverte par les e2e Playwright (§11) pour la mosaïque, la publication bloquée d'un brouillon sans profil, la double confirmation de suppression, l'archivé, l'erreur de finalisation, le changement de compte et la mise en page de 320 à 1440 px (`responsive.spec.ts`, inchangé). Ne sont pas couverts en e2e : pause, remise en ligne, prolongation, retrait du consentement et statistiques non nulles (routes simulées seulement en tests unitaires). `next build` n'a pas été lancé.
- Pas de test contre PostgreSQL réel : la base est simulée (le `where` simulé couvre `in`, `not`, `gt`, `OR`, `AND`, égalité de dates). La forme du `where` a été validée contre le client Prisma réel sans base.
- `requireMutationGrant` est simulé dans les tests de route : la vérification cryptographique du grant est celle, existante, de `src/lib/runner/authorization.ts`.
- La concordance mosaïque/fiche repose sur la même fonction ; aucun test ne compare les deux sources de prêts.
- Sous Windows, `english.test.ts` ne vérifie pas les messages `error:` des routes (test sur `"/api/"` dans un chemin à `\`) ; vérifié à part par script et par les relecteurs. Sur Linux (CI) la vérification s'applique.

### 6. Hypothèses

- Depuis N2 (fusionnée), `listingExpiresAt` est posé à la création du brouillon et recalé à la publication (`rebasedListingExpiry`), et `trainingConsentAt` / `trainingConsentVersion` sont écrits si la case est cochée : prolongation et retrait du consentement deviennent effectifs pour les nouveaux datasets. Les datasets antérieurs gardent une annonce sans date (prolongation refusée, voir §2.7). Le futur consommateur du consentement respectera `trainingConsentRevokedAt` (« le retrait vaut pour les usages futurs »).
- La marketplace (N3) appliquera la règle de 16 § 2 : `status = LISTED` **et** annonce non expirée.
- Un prêt v7 crédite au fournisseur exactement `datasetAmountUsdcAtomic` au règlement, un prêt antérieur le montant entier (vérifié en lecture des contrats et de `settle.ts` par un relecteur, pas par exécution).
- `cancelTxHash` n'est posé que pour un remboursement réellement confirmé on-chain (`cancel.ts`, `settle.ts`, `reaper.ts`).
- Les identifiants de dataset sont des cuid (`^[A-Za-z0-9_-]{1,64}$`).
- `SIRIUS_PHALA_DEMO` vaut exactement `true` en démo (validé par `src/lib/runner/config.ts`).
- Hors démo, aucun chemin ne crée de dataset PRIVATE titré sans l'avoir publié LISTED (`markDatasetListed` est le seul à poser le titre ; vérifié en lecture par un relecteur).
- La session ne contient qu'une adresse EVM valide (sinon 404).

### 7. Risques résiduels et limites connues

1. **L'expiration n'est appliquée que par le nouveau catalogue de la marketplace.** Depuis N3 (fusionnée), `/api/marketplace` (`src/lib/marketplace/listing.ts`) n'affiche que les annonces LISTED non expirées. En revanche l'ancienne liste publique `GET /api/datasets?status=LISTED` filtre seulement `status = LISTED`, et `src/lib/sirius/borrower.ts` (préparation et blocage) ne regarde pas `listingExpiresAt` : une annonce *Expirée* disparaît de la marketplace mais reste **empruntable par son identifiant**. **Actif depuis la fusion de N2** : chaque nouvelle annonce a une date de fin (7, 30 ou 90 jours). Correction restante (hors fichiers de la slice) : `OR: [{ listingExpiresAt: null }, { listingExpiresAt: { gt: now } }]` dans la disponibilité de `prepareLoan` et du blocage, et dans le `where` public de `GET /api/datasets?status=LISTED` si cette liste reste exposée. Le texte de la fiche a été reformulé pour ne pas promettre le retrait.
2. **La pause n'arrête pas l'emprunt par lien direct** (UNLISTED empruntable). Affiché ; « Rendre privé » ferme l'accès. Si la pause doit fermer l'emprunt, c'est au couloir des prêts.
3. **Création non alignée** : `POST /api/datasets` (N2) ne vérifie que la longueur du nom ; un nom avec un caractère bidi peut être créé et s'affiche sur la marketplace et `/proof/[id]`. Il faudrait partager `validateDetailsPatch` (ou une fonction dédiée de `manage.ts`).
4. **`setDatasetVisibility` ne rejoue pas `listedAt` ni l'expiration en base** : pour le PATCH existant, la vérification `assertVisibilityChange` est faite en lecture ; une fenêtre de course de quelques millisecondes subsiste (la route de la fiche, elle, rejoue tout).
5. **Limites de débit en mémoire, par instance** (motif existant du dépôt) : contournables en multipliant les instances, plafond global partagé par tous les wallets, au-delà de 1 024 clés un seau commun.
6. **Grant interchangeable** entre le PATCH existant et `/settings/listing` pour le même identifiant et la même cible (§2.8) ; l'intention ne lie pas l'état de départ. Sans effet exploitable trouvé (nonce unique, mêmes règles).
7. **Un grant peut être consommé sans écriture** (course → 409) : il se re-signe sans interaction.
8. **Nom et description modifiables pendant un emprunt**, sans historique ; `/proof/[id]` affiche le nom courant à côté de l'ancrage immuable.
9. **Mosaïque dépendante de `/api/loans`**, non paginée et lourde (attestations), qui échoue entièrement si un prêt a un devis incohérent : la mosaïque affiche alors « — » pour emprunts et revenus avec un message, jamais un faux zéro.
10. **États incomplets de `StatusPill`** (§2.2) : *Archivé* s'affiche « Failed », *Privé* « Paused » (avec légende).
11. **Traductions** : fusion par *spread* sans détection de collision ; une slice parallèle (marketplace) qui définirait la même clé française (par exemple « Trier par », « Prix », « Date ») avec un autre anglais écraserait l'une des deux sans bruit. Vérifié sans collision au moment de la PR contre `staging`.
12. **Dataset créé en démo puis démo désactivée** sur la même base : PRIVATE, titré, jamais public, il devient publiable par la fiche ou le PATCH. Seul le propriétaire peut le faire, avec son grant, et le KYB a été exigé au mint. À revoir si une même base passe de la démo à la production.
13. Dates en UTC (« 7 days from 2026-10-04 »), pas dans le fuseau du navigateur : choix de cohérence serveur/navigateur.

### 8. Reste à faire

- **P0 (couloir des prêts), désormais urgent** : appliquer l'expiration dans `borrower.ts` (et dans l'ancienne liste publique si elle reste exposée) (§7.1) ; la marketplace la respecte depuis N3, mais l'emprunt par identifiant non. N2 pose `listingExpiresAt` depuis sa fusion : la première échéance arrive 7 jours après la première publication.
- **P1 (N2)** : partager la validation du nom et de la description à la création (§7.3).
- **P1 (A2)** : états `archived`, `private`, `draft` dans `StatusPill` (§2.2).
- **P2** : rejouer `listedAt` et l'expiration dans `setDatasetVisibility` ou faire passer le PATCH existant par `applyVisibility` (§7.4) ; opération de grant dédiée aux réglages d'annonce ; limites de débit partagées ; route d'agrégat paginée pour la mosaïque au lieu de `/api/loans` ; retraits par dataset (05, V1.1) ; e2e de la pause, de la prolongation et du consentement ; donner (et non seulement retirer) le consentement depuis la fiche.

### 9. Résultats des vérifications

Environnement : Windows 11, Git Bash, Node v22.16.0, pnpm 11.18.0 lancé par `npx -y pnpm@11.18.0` (le pnpm global de la machine est cassé : « Failed to switch pnpm to v11.18.0 … ENOENT », sans rapport avec la slice). Mesures refaites après la fusion de N2 puis de N3 (`origin/staging` à `fd3cefc`) et les correctifs e2e de §11.

| Commande | Résultat exact |
|---|---|
| `pnpm install --frozen-lockfile` sans `DATABASE_URL` | **échec, exit 1** : `postinstall` → `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. Environnement, comme noté en A2. |
| `pnpm install --frozen-lockfile` avec `DATABASE_URL=postgresql://x:y@localhost:5432/z` | `Already up to date`, `Done … using pnpm v11.18.0`, exit 0 |
| `pnpm prisma generate` (même URL factice) | `✔ Generated Prisma Client (7.8.0) to .\src\generated\prisma`, exit 0 |
| `pnpm exec tsc --noEmit` | aucune sortie, exit 0 |
| `pnpm lint` | `$ eslint`, aucune autre sortie, exit 0 |
| `pnpm test` | **échec d'environnement, exit 1** : sous Windows, pnpm exécute le script avec `cmd.exe`, qui ne comprend pas la syntaxe `NODE_OPTIONS="…" node …` (« 'NODE_OPTIONS' n'est pas reconnu en tant que commande interne »). Aucun test lancé. Sur Linux (CI) le script fonctionne tel quel. |
| Même liste de fichiers que le script `test`, lancée directement (`node --import tsx --test …` avec `NODE_OPTIONS=--conditions=react-server`) | `tests 721`, `pass 649`, `fail 72`, exit 1. **Les 72 échecs sont exactement ceux de la base** `e829cfc` lancée de la même façon sur la même machine (`tests 530`, `pass 458`, `fail 72`, liste des titres en échec identique, comparée par `diff`) : chemins Windows (`src\app\…` au lieu de `src/app/…` dans `self-training-routes.test.ts` et `disclaimers.test.ts`), registres SQLite et processus enfants du runner (`budget.test.ts`, `replay.test.ts`, `runner-cli.test.ts`, `initialize-runner-volume.test.ts`…). Aucun ne touche un fichier de la slice. Les 35 tests de `manage.test.ts` et les 7 de `english.test.ts` passent. |
| `node --import tsx --test src/lib/datasets/manage.test.ts src/lib/i18n/english.test.ts` | `tests 42`, `pass 42`, `fail 0` |
| `pnpm audit:deps` | `2 vulnerabilities found`, `Severity: 1 low \| 1 high (1 ignored)`, exit 0 ; identique à `staging` (A2) |
| `pnpm exec playwright test` (suite complète, configuration du dépôt dupliquée localement sur le port libre 3157, `--workers=1` comme en CI) | `97 passed (2.4m)`, exit 0 (avant la fusion de N3 : `92 passed (1.6m)`) |
| `git diff --name-only origin/staging...HEAD` | 18 fichiers : ceux de §1, `e2e/datasets.spec.ts`, `e2e/account-switch.spec.ts` (autorisés par le coordinateur) et cette section de `docs/passage-mainnet/audit.md` |
| `git log origin/staging..HEAD --format=%B` | aucune signature d'assistant (recherche de `co-authored`, `claude`, `anthropic`, `generated with`, `session`, `skip ci` : aucune occurrence) ; auteur et committeur `alibenyezza` |

Non exécuté : `next build`, tests PostgreSQL (`test:postgres`), contrats.

Vérifications ponctuelles hors suite : script qui liste toutes les chaînes `t("…")`, `AppError`, `error:` et messages de la slice et vérifie leur présence dans `EN_MESSAGES` (aucune manquante) ; collisions de clés entre `datasets-en.ts` et `errors-en`, `phala-en`, `shared-en`, `profile-en`, `tour-en`, `english.ts` (une seule, « Wallet », de traduction identique : retirée de `datasets-en.ts`) ; aucun caractère invisible, bidi ou combinant littéral dans les sources de la slice (tous écrits en séquences `\u`).

### 10. Revue interne de la session

Méthode : six passes de relecture adversariale par des agents indépendants, en lecture seule sur le dépôt (scripts jetables hors dépôt, mutations temporaires restaurées, `git status` propre vérifié à chaque fin), chacun avec le diff, la spécification et la liste des limites déjà assumées. Passe 1 : deux relecteurs en parallèle (sécurité ; exactitude, tests et cas limites avec mutations). Passes 2 à 6 : un relecteur sur tous les axes, centré sur les correctifs précédents. Chaque correctif a été suivi de `tsc`, `lint` et des tests ciblés, puis commité séparément (`fix(datasets): … passe de revue`).

| Passe | Constats retenus et corrigés | Écartés ou documentés |
|---|---|---|
| 1 (sécurité) | prolongation d'une annonce LISTED expirée sans grant ; remise en ligne d'un PRIVATE en démo ; validation Unicode trop faible (RLM, ALM, ZWSP, U+2028, étiquettes, substituts isolés, nom invisible) ; lecture de la ligne avant contrôle du propriétaire | expiration non appliquée par le catalogue et `borrower.ts` (§7.1) ; validation absente à la création (§7.3) ; limites de débit en mémoire (§7.5) ; grant interchangeable entre routes (§7.6) ; consentement jamais écrit (§6) ; nom modifiable pendant un emprunt (§7.8) |
| 1 (exactitude) | texte « n'apparaît plus sur la marketplace » faux ; passage en PRIVATE perdu par rapport à l'ancienne page (« Rendre privé » ajouté) ; SUBMITTING compté comme emprunt ; libellé des semaines ; destruction proposée pour un archivé sans titre ; info-bulle de brouillon perdue ; rejet non géré de `/api/loans` après abandon ; fiche bloquée pour un wallet non authentifié ; formulaire réinitialisé par une pause ; libellés « en cours » jamais affichés ; plafond « 5 000 emprunts » inexact ; 5 mutations survivantes (propriétaire du retrait, titre EVM rejoué, borne de la plus ancienne semaine, prêts non en cours sur la pastille, `deletionPending`) | divergence de règle « pas de changement pendant un emprunt » entre routes (§2.4) ; `/api/loans` lourd (§7.9) |
| 2 | contournement des règles par le PATCH existant ; nom existant invalide bloquant la sauvegarde de la description ; ZWNJ, ZWJ, U+00AD, U+180E refusés à tort ; course sur la prolongation sans grant ; « Rendre privé » proposé pendant un emprunt ; besoin de grant calculé au chargement ; 4 mutations survivantes | grant consommé si l'écriture échoue (§7.7) ; allongement d'un nom par NFC (cas marginal, refusé par le serveur) |
| 3 | détour PRIVATE → UNLISTED → LISTED par le PATCH existant ; LISTED → LISTED refusé (comportement d'avant rétabli) ; horloge locale seule pour le besoin de grant ; texte « en cours » vs « réservé » ; U+034F, U+17B4-5, U+2800 admis | — |
| 4 | règle fondée sur `listedAt` bloquant les anciens datasets (remplacée par la règle du titre EVM hors démo) ; prolongation qui remet en ligne en démo | commentaires périmés corrigés |
| 5 | la fiche proposait en démo une remise en ligne vouée au refus après signature (`canRelist`) | dataset créé en démo puis démo désactivée (§7.12) |
| 6 | **aucun constat nouveau** | deux détails sans conséquence : en démo, une ancienne annonce LISTED expirée perd « Prolonger » sans message ; une expiration entre chargement et clic donne un 409 |

**Mutations** : passe 1, 26 mutations de `manage.ts` (20 tuées, 5 survivantes corrigées par des tests, 1 équivalente) ; passe 2, 23 mutations (19 tuées, 4 survivantes : 3 corrigées par des tests, 1 devenue équivalente, voir §5) ; passe 3, 3 mutations (tuées) ; passe 4, matrice exhaustive de `assertVisibilityChange` (7 statuts × 4 cibles × démo × `listedAt` × expiration × titre).

**Vérifications de relecteurs à retenir** : la forme `where` de `applyExtension` acceptée par le client Prisma 7 réel ; les 404 identiques pour un dataset absent, d'un autre wallet ou mal formé ; l'absence d'effet d'une pause sur un prêt en cours (`BORROWABLE_STATUSES`, `borrower.ts`, `settle.ts`) ; la concordance mosaïque/fiche ; les parts de revenu conformes aux contrats v6 et v7.

**Limite de la revue** : relecteurs IA, sans relecture humaine ; pas de `next build` ; pas de base PostgreSQL. Le rendu réel est désormais vérifié par les e2e (§11).

### 11. Correctifs après la première CI (e2e)

La CI de la PR #44 échouait à l'étape « Tests end-to-end » sur 11 tests (avec reprises) : `account-switch.spec.ts` (pagination), les trois tests de `datasets.spec.ts`, et `responsive.spec.ts` « titres et actions des datasets ne se chevauchent pas » sur les 7 écrans. Tous visaient l'ancienne liste.

**Comportements vérifiés et ce qui a changé**
- *La réponse datasets d'un compte précédent est ignorée* : comportement conservé (la page est remontée par identité de wallet et la requête en cours est abandonnée). La mosaïque suit désormais seule les curseurs (pas de bouton « Show more ») : le test attend la requête de **seconde page** du compte A (`cursor=page-2`, vérifié), change de compte, libère la réponse tardive, et vérifie toujours qu'aucun « Dataset A » n'apparaît, que « Dataset B » reste affiché et qu'aucun état de pagination de A ne survit (ni bouton « Show more », ni message de troncature).
- *La publication d'un brouillon sans profil valide est bloquée, sa suppression reste possible* : la page avait perdu le bouton de publication sur la liste (il n'existait que sur la fiche) ; **la page est corrigée** : le bouton revient sous la carte du brouillon (`PublishDraftButton`, partagé avec la fiche). Le test vérifie désormais : sur la carte, « Missing profile », la légende « Legacy dataset… », « Re-upload required » désactivé, « Publish title » actif pour le brouillon valide ; sur la fiche, « Re-upload required » désactivé, aucun « Publish title », puis « Destroy this dataset… » ouvre la double confirmation dont le bouton final reste désactivé tant que le nom n'est pas tapé exactement, et s'active ensuite. L'ancien bouton « Delete draft » est remplacé par cette double confirmation (exigence de 06).
- *Archivé supprimable sans remise en publication* : sur la fiche, « Destroy this dataset… » actif ; ni « Publish title », ni « Put back online », ni « Pause », ni « Make private ».
- *Erreur de finalisation qui laisse réessayer* : la confirmation n'est plus `window.confirm` mais le nom tapé ; l'erreur 503 du serveur s'affiche traduite et « Finalize deletion… » reste disponible.
- `responsive.spec.ts` (non modifié) attend sur `/datasets` un bouton « Incomplete upload » désactivé pour un brouillon sans fichier : satisfait par le retour du bouton sur la carte, mise en page contenue de 320 à 1440 px.
- Contrôle de non-affaiblissement : en retirant `!model` de la condition de désactivation du bouton, le test `datasets.spec.ts` échoue (`toBeDisabled`), puis repasse une fois la ligne restaurée.

**Intégration de N2** : jeton et catégories via `settlementToken` et `DATASET_CATEGORY_LABEL_KEYS` (§2.16) ; `SETTLEMENT_TOKEN_SYMBOL` supprimé ; §6, §7.1 et §8 mis à jour (l'expiration devient un risque actif). Une réponse non tableau de `/api/loans` est traitée comme « statistiques indisponibles » au lieu d'une exception.

**Fusion de N3** : la marketplace traduit « Publication » par « Published » ; le titre de la carte de publication d'un brouillon passe donc à la clé distincte « Publication du titre EVM » (« EVM title publication »), et la clé en double « Trier par » est retirée de `datasets-en.ts` (même traduction côté marketplace). Aucune collision restante entre `datasets-en.ts` et les autres fichiers de traduction.

**Résultats** : suite e2e complète en local, `97 passed`, exit 0 après la fusion de N3 (§9). Une première exécution avec 7 workers en parallèle sur `next dev` avait donné des dépassements de délai sur des pages hors slice (catalogue, prêts, preuves d'audit) et sur la première compilation de `/datasets/[id]` : la suite repasse entièrement avec un seul worker comme en CI, et l'attente du titre de la fiche est portée à 30 s pour la première compilation de la route dynamique.

---

## N2 — Upload en deux étapes

Branche `feat/upload-deux-etapes`, partie de `staging` (e829cfc), `origin/staging` (2f6ae81, PR #39) refusionné avant la PR. Cahier : [07-upload.md](07-upload.md), [01 §3-4](01-decisions-avant-samedi.md), [16 §2 et §4](16-socle-technique.md). La vague 1 avait livré les colonnes `category`, `listingExpiresAt`, `trainingConsentAt/Version/RevokedAt` (A1) et les composants `PriceBreakdown`, `DisclaimerNote`, `src/lib/copy/disclaimers.ts` (A2) ; cette slice est la première à **écrire** ces colonnes et à **monter** ces composants sur une page réelle.

### 1. Ce qui a changé

`git diff --name-only origin/staging...HEAD` : 32 fichiers (liste en fin de section). Aucune migration, aucun contrat, aucun fichier du runner (`src/runner/**`, `src/lib/runner/**`) ni de `src/components/**`.

**Page d'upload (`src/app/(app)/datasets/new/`)**
- `page.tsx` : devient un **composant serveur** (`export const dynamic = "force-dynamic"`, option encore documentée dans Next 16 sans `cacheComponents`) qui lit le tarif en vigueur (`publishedTariff()`) et le jeton du réseau (`settlementToken()`), puis rend le formulaire client. Il remplace l'ancien formulaire à une étape (prix + « délai de remboursement » 1–30 jours).
- `NewDatasetWizard.tsx` (client) : trois phases `data` → `securing` → `pricing` ; fichier lu en mémoire (`ArrayBuffer` + texte) ; contrôle du CSV recalculé quand le profil change ; empreinte SHA-256 locale pendant la transition (durée minimale 2,4 s, lignes affichées en séquence, états annoncés aux lecteurs d'écran, une erreur ramène à l'étape 1) ; publication avec progression par étape ; reprise de la seule inscription on-chain quand le dataset est déjà scellé ; focus clavier replacé sur le panneau à chaque changement d'étape.
- `DataStep.tsx` : dépôt (glisser-déposer + champ natif), raison exacte du refus (`role="alert"`), résumé du fichier accepté (lignes de données, colonnes, colonnes numériques, colonne cible = dernière colonne numérique, liste dépliable), jeu d'exemple, nom (120), description (2 000), catégorie obligatoire (liste fixe), profil d'entraînement. Encart `DisclaimerNote messages={["dataLimits"]}`.
- `PricingStep.tsx` : « What I want to earn per loan ({symbol}) », `PriceBreakdown perspective="provider"` en direct dès qu'une saisie est valide (part, frais de calcul du profil choisi, total emprunteur, minimum), durée 7 / 30 / 90 jours (30 par défaut, échéance indicative « à compter de l'inscription on-chain »), note sur le délai de sécurité de 3 jours fixé par Sirius, estimations (lignes, colonnes, taille chiffrée ≈ taille + 16 octets d'étiquette AES-GCM, modèle, cible), `DisclaimerNote variant="warning"` (texte commun `modelQuality` + `contactUs`), case de consentement décochée (texte de 07 au mot près, version affichée), progression (brouillon, chiffrement, scellement, titre on-chain avec sous-étapes), erreurs avec lien vers Mes datasets si le dataset est déjà scellé. **Sans tarif chargé, la publication est suspendue** avec explication.
- `wizard-types.ts` : types partagés et classes Tailwind communes (anneau de focus `focus-visible`, visible en contraste forcé).

**Logique de publication (`src/lib/datasets/`, nouveaux fichiers ; `manage.ts` non touché)**
- `publication.ts` (pur) : `MAX_NAME_LENGTH` / `MAX_DESCRIPTION_LENGTH` (partagées formulaire + route), `DATASET_CATEGORIES` (Finance, Health, Commerce, Industry, Mobility, Energy, Marketing, Other — identifiants stockés), `DATASET_CATEGORY_LABEL_KEYS`, `parseDatasetCategory`, `LISTING_DURATIONS_DAYS` [7, 30, 90], `DEFAULT_LISTING_DURATION_DAYS` 30, `parseListingDurationDays`, `listingExpiryFrom`, **`ESCROW_CHALLENGE_DAYS = 3`**, `TRAINING_CONSENT_TEXT_KEY` + `TRAINING_CONSENT_VERSION` (`2026-10-04`), `parseTrainingConsent` (booléen strict, absent = non), `rebasedListingExpiry`.
- `csv-check.ts` (pur, navigateur et Node) : `checkFileSize`, `inspectCsv(text, modelId)` qui reproduit dans le même ordre les contrôles de `validateTrainingDataset` (`src/lib/tee/train.ts`) avec le même parseur `parseCsv` et les constantes importées (`MAX_DATASET_BYTES`, `MAX_CSV_ROWS`, `MAX_CSV_COLUMNS`, `MIN_TRAINING_ROWS`, `MIN_ROWS_PER_PARAMETER`, `MAX_TRAINING_FEATURES`, `MAX_TRAINING_OPERATIONS`), `csvRejectionText` (raison traduite).
- `price-input.ts` (pur) : `parseProviderPrice(value, decimals)` (mêmes règles que `priceUsdcToAtomic`, précision passée par le serveur), `minimumProviderPriceAtomic(decimals)`.
- `tariff.ts` (pur) : `PublishedTariff`, `tariffFromPolicy(policy, scope)` (frais = max(profil, minimum), comme `prepareComputeQuote`), `legacyTariff` (frais nuls sans facturation v7), `providerPriceBreakdown`. `tariff-server.ts` (`server-only`) : `publishedTariff()` lit `billingPolicy()` (`RUNNER_BILLING_POLICY_FILE`), vérifie chaîne, jeton et décimales, mémoïse 5 s ; `null` en cas d'absence, de péremption ou d'incohérence.
- `token.ts` : `settlementToken(network)` → `{ symbol: "MUSD" | "MUSD", decimals: USDC_DECIMALS }`.
- `create-request.ts` (pur) : `parseCreateDatasetRequest(body)`, toute la validation serveur de `POST /api/datasets` ; `challengeDays` toujours `ESCROW_CHALLENGE_DAYS`.
- `draft.ts` (`server-only`) : `createDatasetDraft(request, provider)` = `beginDatasetIngestion` (pipeline inchangé, `challengeDays: 3`) puis lecture de `createdAt` et `updateMany` conditionné (`DRAFT`, même fournisseur, sans CID ni clé) posant `category`, `listingExpiresAt = createdAt + durée`, `trainingConsentAt`, `trainingConsentVersion` ; échec → brouillon supprimé et erreur propagée.
- `draft-response.ts` (pur) : `checkDraftResponse` relit la réponse du serveur avant chiffrement et signature (identifiant, clé d'ingestion, prix atomique, taille, profil, catégorie, durée, consentement, **`challengeDays === 3`**).
- `upload-client.ts` (client) : `uploadAndPublishDataset` = brouillon → chiffrement (`encryptDatasetForRunner`, inchangé) → grant `seal-dataset` (mêmes `intentParts`, même ordre que l'ancienne page) → `POST /api/datasets/{id}/upload` → `publishDataset` ; `UploadError` porte l'étape et l'identifiant scellé.
- `client.ts` : `publishDataset(datasetId, onStage?)` gagne un rappel de progression facultatif ; signature rétro-compatible (Mes datasets et la démo Phala l'appellent sans second argument).

**Routes**
- `src/app/api/datasets/route.ts` : `POST` réécrit autour de `parseCreateDatasetRequest` + `createDatasetDraft` ; `GET` inchangé. Corps accepté : `name`, `description?`, `sizeBytes`, `priceUsdc`, `category`, `listingDays`, `trainingConsent?`, `modelId`. Réponse 201 : champs de `beginDatasetIngestion` + `category`, `listingDays`, `listingExpiresAt`, `trainingConsentAt`, `trainingConsentVersion`, `challengeDays: 3`.
- `src/app/api/datasets/[id]/upload/route.ts` et `[id]/list/route.ts` : **non modifiés**.

**Mise en ligne (`src/lib/sirius/provider.ts`)** : `markDatasetListed` rebase `listingExpiresAt` sur la date de mise en ligne avec la durée choisie (`rebasedListingExpiry`) à la transition `DRAFT` → `LISTED` ; rien n'est touché si la valeur n'est pas reconnue ou en mode `SIRIUS_PHALA_DEMO`. `provider.test.ts` : une ligne (dépendance simulée `@/lib/datasets/publication`).

**Démo Phala (`src/lib/phala-demo/training-client.ts`)** : une ligne, le corps de `POST /api/datasets` envoie `category: "Other"`, `listingDays: 7`, `trainingConsent: false` et plus de `challengeDays` (sinon la démo, conservée sur staging, recevait 400).

**Traductions** : `src/lib/i18n/upload-en.ts` (nouveau, fusionné dans `EN_MESSAGES` par `english.ts`, +2 lignes). Texte du consentement et catégories au mot près.

**Tests** : `package.json`, 6 fichiers ajoutés à la fin du script `test` (après `access-log-wiring.test.ts` de staging). E2E : `e2e/upload.spec.ts` (nouveau, 3 tests), `e2e/responsive.spec.ts` (test de l'upload adapté).

Liste des fichiers : `e2e/responsive.spec.ts`, `e2e/upload.spec.ts`, `package.json`, `src/app/(app)/datasets/new/{DataStep,NewDatasetWizard,PricingStep}.tsx`, `src/app/(app)/datasets/new/{page.tsx,wizard-types.ts}`, `src/app/api/datasets/route.ts`, `src/lib/datasets/{client,create-request,csv-check,draft,draft-response,price-input,publication,tariff,tariff-server,token,upload-client}.ts`, `src/lib/datasets/{create-request,csv-check,draft-response,price-input,publication,tariff}.test.ts`, `src/lib/i18n/{english,upload-en}.ts`, `src/lib/phala-demo/training-client.ts`, `src/lib/sirius/{provider,provider.test}.ts`, `docs/passage-mainnet/audit.md`.

### 2. Décisions et écarts par rapport au cahier des charges

1. **L'« animation de chiffrement » ne chiffre pas.** La clé de chiffrement est dérivée de l'identifiant du brouillon et de la clé d'ingestion de l'enclave, obtenus par `POST /api/datasets`, qui exige le prix — connu seulement à l'étape 2. Créer le brouillon avant le prix aurait multiplié les brouillons abandonnés (quotas de `pipeline.ts` : 5 ouverts, 10 par heure). La transition fait donc **ce qu'elle dit** : fichier lu en mémoire, empreinte SHA-256 calculée sur l'appareil (affichée), et l'annonce que le chiffrement aura lieu ici, à la publication, pour la clé de l'enclave. Le chiffrement réel est l'étape « Encrypting on your device » de la progression. Une erreur (digest impossible) ramène à l'étape 1 avec son message.
2. **Colonne cible affichée, pas choisie.** L'enclave entraîne toujours sur la **dernière colonne numérique** (`validateTrainingDataset` appelle `trainingColumns` sans cible, `src/lib/tee/train.ts`) et `ModelSelection` ne transporte aucune cible ; le runner est hors périmètre. Le formulaire montre la cible que l'enclave utilisera et explique comment la changer (réordonner les colonnes). Laisser choisir une cible non honorée aurait été un mensonge.
3. **Tarif lu depuis la politique de facturation du runner, sur l'instance Next.** Aucune route (Next ni runner) n'expose le tarif et `src/runner/**` est interdit. `publishedTariff()` lit `RUNNER_BILLING_POLICY_FILE` avec `billingPolicy()` (même format, même validation que le runner), refuse une politique d'une autre chaîne, d'un autre jeton ou d'une autre précision, et mémoïse 5 s (page publique, lecture disque). Conséquence opérationnelle : **l'instance Next doit recevoir la même copie de la politique que le runner** (§8). Sans elle, la page le dit et **suspend la publication** : le cahier exige la décomposition avant « Publier », et un fournisseur ne doit pas publier sans connaître le total payé par l'emprunteur. Revue : première version autorisait la publication sans décomposition ; corrigé.
4. **Sans facturation v7 (`SIRIUS_BILLING_VERSION` ≠ 7), frais de calcul nuls.** L'escrow v6 bloque le seul prix du dataset (`lockUsdcTransaction`, contrat v6) ; `SiriusEscrowV7.sol` crédite `datasetAmount` au fournisseur et `computeAmount` au `computeRecipient` sans prélèvement. Le tarif `legacy-v6` affiche 0 avec un texte dédié. C'est la situation du testnet de staging et des e2e.
5. **Le minimum « imposé par le tarif » est `MIN_PRICE_USDC_ATOMIC` (0,001 jeton)**, seul plancher que la route applique à la part du fournisseur (`priceUsdcToAtomic`) et que `parseComputeQuote` exige sur le total. La politique de facturation n'a pas de minimum sur la part fournisseur. Il est connu localement (`minimumProviderPriceAtomic`) et affiché même sans tarif ; le champ refuse en dessous ; `PriceBreakdown` afficherait l'alerte si un tarif futur posait un minimum plus haut.
6. **Durée de publication ancrée sur `createdAt` puis rebasée à la mise en ligne.** `listingExpiresAt` est posé à la création du brouillon (seule place persistante sans nouvelle colonne, `prisma/` interdit) à `createdAt + durée` exactement, puis recalculé dans `markDatasetListed` : même durée, nouveau point de départ. Un brouillon scellé mais signé plusieurs jours après garde ses 7 / 30 / 90 jours pleins. La durée est reconnue par différence arrondie au jour (tolérance d'une minute, défensive) ; une valeur inconnue n'est pas touchée (datasets d'avant le champ, lignes modifiées par N1). Revue : première version prenait l'horloge serveur après l'appel runner (jusqu'à 60 s) ; corrigé.
7. **Deux écritures pour un brouillon.** `beginDatasetIngestion` (`pipeline.ts`, hors périmètre) ne connaît pas les champs de catalogue ; `createDatasetDraft` les pose juste après par `updateMany` conditionné et supprime le brouillon si cette écriture échoue. Entre les deux, le brouillon existe sans catégorie quelques millisecondes ; il n'est pas publiable (pas de CID) et le client ne connaît pas encore son identifiant.
8. **Le client relit la réponse du serveur** (`checkDraftResponse`) avant de chiffrer et de signer : prix, taille, profil, catégorie, durée, consentement et `challengeDays === 3`. Une réponse altérée arrête tout avant l'envoi du fichier (e2e dédié).
9. **Deux constantes privées de `train.ts` reproduites** dans `csv-check.ts` : `MAX_ABS_VALUE` (1e12) et `LOGISTIC_ITERATIONS` (200), non exportées et `src/lib/tee/**` interdit. Toutes les autres limites sont importées. `csv-check.test.ts` rejoue `validateTrainingDataset` sur les fichiers à la frontière (99/100 lignes, 319/320 à 31 variables, 3125/3126 logistique, 19 531/19 532 linéaire, 19 999/20 000, 1e12 / 1e12+1) : toute dérive casse le test.
10. **Catégories stockées en anglais** (`Finance`, `Health`, …), clés de traduction françaises pour l'affichage, comme le reste de l'interface. Comparaison exacte côté serveur, sans normalisation.
11. **Consentement : absent = non.** Le corps peut omettre `trainingConsent` ; toute valeur non booléenne est refusée. Date et version posées **uniquement** si `true`. Le retrait depuis la fiche (N1) est annoncé au futur (« You will be able to withdraw it… ») : il n'existe pas encore.
12. **Prix saisi en texte** (`inputMode="decimal"`), converti avec `token.decimals = USDC_DECIMALS` (même source que la route) ; `price-input.test.ts` vérifie l'accord avec `priceUsdcToAtomic`. Message d'erreur serveur neutre quant au jeton (« Invalid price (0.001 to 1,000,000 per loan) »).
13. **Reprise après échec.** Si l'inscription on-chain échoue après le scellement, le bouton devient « Resume the on-chain registration », les champs et le retour sont gelés, et seule `publishDataset` est relancée : pas de second brouillon. Si l'échec précède le scellement, le brouillon reste (nettoyé après 30 minutes par `pipeline.ts`, ou supprimé par le runner sur refus du fichier) et une nouvelle tentative crée un nouveau brouillon — comme l'ancienne page.
14. **Fichiers hors de la liste explicite, modifiés d'une ligne chacun** : `src/lib/sirius/provider.test.ts` (son bac à sable refuse toute dépendance non simulée) et `src/lib/phala-demo/training-client.ts` (la démo Phala, conservée sur staging selon 12-test-phala.md, créait des datasets sans catégorie ni durée et aurait reçu 400 ; trouvé en revue).
15. **E2E existants adaptés** (`responsive.spec.ts`) et spec dédié ajouté, la consigne demandant de vérifier et d'adapter les e2e de publication.
16. **Jeton affiché** : `settlementToken` donne MUSD sur mainnet, USDC sur le testnet ; A8 pourra la remplacer par sa fabrique.
17. **`origin/staging` refusionné** (2f6ae81, journal des accès) ; seul conflit : la ligne `test` de `package.json`, résolue en gardant les deux listes.
18. **Identité des commits** : auteur et committeur `alibenyezza <149864846+alibenyezza@users.noreply.github.com>`, aucune signature d'assistant. `CLAUDE.md` / `AGENTS.md` générés par `next dev` dans le worktree : non versionnés.

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès, route par route**
- `POST /api/datasets` : `requireAuth` avant toute lecture du corps ; le fournisseur est `session.address`, jamais le corps. `beginDatasetIngestion` applique `requireAcceptedKyb` et les quotas (inchangés). L'`updateMany` de `draft.ts` est conditionné à `provider` + `status: "DRAFT"` + `ipfsCid: null` + `wrappedKey: null`.
- `POST /api/datasets/[id]/upload`, `POST/PUT /api/datasets/[id]/list` : inchangés (grant runner authentifié, `assertOwner`).
- `page.tsx` : composant serveur sans authentification ; il ne lit que le tarif et le réseau, rien du wallet. `PublishedTariff` renvoyé au navigateur contient uniquement `tariffVersion`, les deux montants de calcul, le minimum et les décimales — ni `computeRecipient`, ni `costReference`, ni `validUntil`, ni le chemin du fichier.

**Validation et bornes** (`create-request.ts`, tests) : nom 1–120 après `trim`, description ≤ 2 000, `sizeBytes` entier sûr 1..`MAX_DATASET_BYTES`, `priceUsdc` chaîne 0,001..1 000 000 avec au plus `USDC_DECIMALS` décimales, `category` exacte dans la liste, `listingDays` nombre ∈ {7, 30, 90} (« 30 » refusé), `trainingConsent` booléen ou absent, `modelId` connu (`Object.hasOwn`). **`challengeDays` n'est pas lu** : `grep challengeDays src/lib/datasets/create-request.ts` ne montre que la constante. Ordre des contrôles fixe (test). Corps : `readJson` 16 Ko.

**Fuites** : les messages d'erreur ne reprennent jamais une valeur reçue ; `tariff-server.ts` et `draft.ts` ne journalisent que la classe de l'erreur ou l'identifiant ; la réponse du `POST` renvoie au fournisseur sa propre trace de consentement, ce qui est voulu — les lectures de catalogue restent protégées par l'`omit` de `db.ts`. Aucune donnée d'un autre wallet n'est lue.

**Argent, escrow, contrats, Phala** : aucun changement de contrat ni de moteur. Chaîne `challengeDays = 3` : constante → `createDatasetDraft` → ligne `Dataset` → `authorizeDatasetUpload` → `sealDatasetInRunner` (le runner borne 1..30 et compare l'intent, `src/runner/handler.ts`) → reçu de l'enclave → `prepareComputeQuote` (`challengeDays: input.dataset.challengeDays`) → `parseComputeQuote` (1..30) → `lock`. Le navigateur signe l'intent `seal-dataset` avec `String(draft.challengeDays)` après avoir vérifié `=== 3`. Frais de calcul affichés = `max(profile.computeAmount, minimumComputeAmount)`, identiques à `prepareComputeQuote` (test). Total = somme exacte en `bigint` (`PriceBreakdown`) ; fuzz de revue : 600 000 saisies, 0 divergence entre `parseProviderPrice` et `priceUsdcToAtomic` (6 et 18 décimales).

**Base de données** : aucune migration ; les colonnes écrites existent depuis A1. Cohérence : `category` ∈ liste fixe, `listingExpiresAt` = `createdAt` + durée puis mise en ligne + durée, `trainingConsentAt` et `trainingConsentVersion` nuls ou tous deux posés, `challengeDays` = 3 sur toute ligne créée par cette route. Les lignes antérieures gardent leur valeur (01 §3). Le défaut Prisma `challengeDays @default(7)` subsiste (aucun chemin ne l'utilise, voir §8).

**Interface** : aucun `dangerouslySetInnerHTML` ; noms de fichier, de colonnes, messages serveur rendus par React (échappés). Liens : `/datasets` en dur, `mailto:` via `DisclaimerNote`. Texte du consentement et catégories constants.

**Textes** : avertissement commun inchangé (`modelQuality` + `contactUs`, source unique 16 §4) ; « Encryption happens here, at publication, for the enclave key: your plain data never leaves your browser » est vrai (`encryptDatasetForRunner`, ECDH P-256 + HKDF + AES-GCM dans le navigateur) ; « No extra commission during the beta » : vrai au vu du contrat v7 et du v6 (frais de réseau à part, comme partout) ; « The enclave trains on the last numeric column » : `train.ts`, `targetIdx = numeric[numeric.length - 1]`.

**Signatures d'assistant** : `git log origin/staging..HEAD --format=%B` sans `Co-Authored-By`, `Claude`, `Generated`, lien `claude.ai`, `[skip ci]`.

### 4. Cas limites à essayer à la main sur staging

1. **Fichier refusé avant tout envoi.** Déposer un CSV de 3 lignes → « Not enough rows: 2, minimum 100 for this number of features. », bouton « Continue to pricing » désactivé, onglet Réseau vide. Fichier de 3 Mio + 1 octet → « File too large: 3.0 MB (3,145,729 bytes), maximum 3 MB. » sans lecture du contenu. Fichier vide → « The file is empty. ».
2. **Profil et cible.** Charger `credit-default-train.csv` en logistique → accepté, cible `defaulted`. Basculer sur linéaire → toujours accepté. Charger `housing-prices-train.csv` puis passer en logistique → « For logistic regression, the target column “price_eur” must contain only 0 and 1… » ; revenir en linéaire → accepté.
3. **En-têtes.** Deux colonnes du même nom ou une colonne sans nom → « Invalid header… ». Colonne texte au milieu → acceptée si au moins deux colonnes numériques, absente de « Show numeric columns ».
4. **Transition.** « Continue to pricing » : trois lignes s'allument l'une après l'autre, l'empreinte s'affiche, l'étape 2 arrive après 2 à 3 secondes ; « Step 2 of 2 » ; le focus est sur le panneau ; « ← Back to your data » revient avec le fichier et les champs intacts.
5. **Prix.** Champ vide → encart neutre « Enter your share to see what the borrower will pay. Minimum… », pas d'alerte. `0.0001` → « Invalid amount… », bouton désactivé. `12.5` → « You receive 12.50 MUSD / Compute fee (Phala enclave) x / Borrower pays 12.50 + x MUSD », « Minimum set by the tariff: 0.001 MUSD. ». `20,5` (virgule) → invalide. `1000000` → accepté ; `1000000.01` → invalide. Changer de profil à l'étape 1 puis revenir : les frais suivent le profil.
6. **Tarif absent.** Instance sans `RUNNER_BILLING_POLICY_FILE` (ou périmé) en v7 → encart jaune « The tariff in force could not be loaded… Publication is paused… », minimum affiché, bouton désactivé « Publication paused: tariff unavailable. ». Sur staging (v6) : « Compute fee 0.00 », texte « No compute fee with the current escrow… ».
7. **Durée.** 30 jours coché par défaut ; choisir 90 → « Listed for 90 days from the on-chain registration (around AAAA-MM-JJ) » ; après publication, `listingExpiresAt` en base = date de mise en ligne + 90 jours. Laisser un brouillon scellé 2 jours avant de signer le titre depuis Mes datasets → échéance = mise en ligne + 90 jours.
8. **Consentement.** Publier sans cocher → `trainingConsentAt` et `trainingConsentVersion` nuls. Cocher → date de la requête et `2026-10-04`. `GET /api/datasets?status=LISTED` ne renvoie pas ces champs.
9. **challengeDays forcé.** Rejouer `POST /api/datasets` avec `curl` et `"challengeDays": 30` (ou `"1"`, `null`) → 201 avec `"challengeDays": 3` ; ligne en base à 3 ; l'emprunt ultérieur montre un devis à 3 jours (`ComputeQuoteDialog`).
10. **Catégorie et durée hors liste par `curl`.** `"category": "finance"` → 400 « Category required » ; `"listingDays": "30"` → 400 « Invalid listing duration… » ; `"trainingConsent": "true"` → 400 « Invalid consent value ».
11. **Réponse altérée.** Avec un proxy, `challengeDays` de la réponse mis à 7 → « Inconsistent escrow safety delay », étape « Creating the draft » en échec, aucun `upload` envoyé (reproduit par l'e2e).
12. **Progression et échec.** Refuser la signature du titre dans le wallet → « Transaction rejected in your wallet. », étape « Registering the title on-chain » en échec, « The dataset is sealed by the enclave. Finish the on-chain registration from My data assets », champs gelés, bouton « Resume the on-chain registration » ; cliquer → nouvelle demande de signature, pas de second dataset dans Mes datasets.
13. **Annulation du sélecteur de fichier** pendant une lecture → le formulaire ne reste pas sur « Reading the file… ».
14. **Démo Phala** (`SIRIUS_PHALA_DEMO=true`, `/phala`) : le parcours crée toujours son dataset (catégorie Other, 7 jours).
15. **Écran 320 px et police 200 %** : aucun défilement horizontal (e2e `responsive` sur l'étape 1 à 7 tailles ; l'étape 2 n'y est vérifiée qu'à la main).
16. **Mes datasets** : après la publication, redirection vers `/datasets`, le dataset apparaît en ligne avec sa catégorie et son échéance (affichage à la charge de N1).

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

Ajoutés au script `test` (6 fichiers, 36 tests) :
- `publication.test.ts` : liste et libellés des catégories (traduits, identiques aux identifiants), correspondance exacte, durées strictes, échéance en millisecondes exactes, constante 3 dans 1..30, consentement strict, texte du consentement au mot près et version datée, rebase (trois durées, décalage toléré, valeurs inconnues ignorées).
- `csv-check.test.ts` : **parité avec `validateTrainingDataset`** sur 27 cas de bord (lignes, variables, budget de calcul, parseur, en-têtes, classes logistiques, `1e12`, hexadécimal, espaces, `Infinity`, CRLF, guillemets), raisons alignées sur les messages de l'enclave, résumé exact, dépendance au profil, bornes de taille, textes traduits sans paramètre pendant, **jeux d'exemple du formulaire acceptés** par les deux contrôles.
- `create-request.test.ts` : normalisation, `challengeDays` ignoré pour 13 valeurs, catégorie, durée, consentement, bornes de nom/description/taille/prix/profil, ordre des erreurs, corps non objet, traduction de chaque message.
- `tariff.test.ts` : frais = max(profil, minimum), refus d'une politique d'une autre chaîne / jeton / précision, tarif v6 nul, décomposition exacte et minimum, **`publishedTariff()` réel** avec un fichier temporaire (valide, mémoïsation, autre chaîne, périmé, illisible, absent, v6, version inconnue).
- `price-input.test.ts` : plancher local = `MIN_PRICE_USDC_ATOMIC`, accord avec `priceUsdcToAtomic` sur 40 saisies, précision paramétrée, entrées invalides.
- `draft-response.test.ts` : relecture conforme, `challengeDays` ≠ 3 refusé (7 variantes), termes différents refusés, réponses malformées (dont identifiant de 9 et 65 caractères).

E2E (`e2e/upload.spec.ts`, 3 tests, API simulée, wallet qui signe réellement, chiffrement réel pour une clé P-256 générée par le test) : refus à l'étape 1 sans appel réseau ; parcours complet (exemple chargé, nom, catégorie, transition ≥ 2 s avec empreinte, prix sous le plancher refusé, décomposition, minimum, délai de 3 jours, 30 jours par défaut, 90 choisi, avertissement, consentement coché, publication, redirection, corps du `POST` sans `challengeDays`, enveloppe chiffrée avec grant runner, `list` appelé) ; réponse à 7 jours refusée avant tout chiffrement. `e2e/responsive.spec.ts` : étape 1 à 7 tailles d'écran avec le message de refus.

**Angles morts :**
- `createDatasetDraft` (deux écritures, suppression compensatoire) et le `POST` de la route n'ont pas de test unitaire (Prisma + `beginDatasetIngestion`) ; vérifiés par relecture et par le cas 9 à la main.
- Le rebase dans `markDatasetListed` n'est testé qu'au niveau de la fonction pure ; `provider.test.ts` n'exerce pas la mise en ligne.
- `NewDatasetWizard` / `PricingStep` : pas de test de rendu unitaire ; les e2e ne couvrent ni la reprise après signature refusée, ni le retour à l'étape 1, ni un tarif v7 (frais > 0), ni le tarif absent, ni le glisser-déposer, ni le clavier, ni l'étape 2 aux petites largeurs.
- La parité `csv-check` ↔ enclave dépend de deux constantes recopiées (§2.9) ; détectée sur les frontières choisies, pas sur un changement d'algorithme du budget. BOM UTF-8 : le navigateur le retire (`TextDecoder`), l'enclave non (`Buffer.toString`) — même verdict sauf en-tête vide précédé d'un BOM (refusé par le navigateur, accepté par l'enclave : direction sûre).
- Le corps envoyé par la démo Phala n'est couvert par aucun test (`test:phala-demo` ne l'exerce pas).
- Les e2e ne lancent pas `next build` ; `next dev` compile le composant serveur sans erreur.
- Aucun test d'accessibilité automatisé.

### 6. Hypothèses

- L'instance Next de production reçoit `RUNNER_BILLING_POLICY_FILE` (même fichier que le runner). `deploy/vps/compose.yaml` ne le passe pas aujourd'hui, et `docs/BILLING-INTEGRATION.md` le décrit comme local au runner ; la politique ne contient que des montants publics.
- La fiche du dataset (N1) affichera et renouvellera `listingExpiresAt`, et permettra de révoquer le consentement ; la marketplace (N3) filtrera sur `listingExpiresAt` futur (16 §2). Aujourd'hui aucune route ne lit ce champ.
- Le texte anglais du consentement et des catégories est celui attendu par le propriétaire ; `2026-10-04` est la première version.
- Les décimales de `USDC_DECIMALS_BY_NETWORK` correspondent au contrat déployé (contrôle au déploiement, hors slice).
- `beginDatasetIngestion` reste la seule fabrique de brouillons ; aucun autre code n'écrit `challengeDays`.
- `encryptDatasetForRunner` et `issueRunnerGrant` n'ont pas changé de contrat ; l'ordre des `intentParts` est celui du runner (`src/runner/handler.ts`, `seal-dataset`).

### 7. Risques résiduels et limites connues

1. **Tarif non déployé sur Next** → en v7, publication suspendue tant que le fichier n'est pas fourni à l'instance (voulu, mais à régler avant le 6, §8).
2. **Deux constantes recopiées** (`1e12`, `200`) : une modification de `train.ts` hors des cas testés passerait inaperçue jusqu'au refus par l'enclave (jamais une acceptation à tort).
3. **Brouillon transitoirement sans catégorie** (quelques millisecondes) et brouillon orphelin si Next tombe entre les deux écritures ou si la connexion tombe après un scellement réussi mais avant sa réponse (plafond de 5 brouillons ouverts, TTL 30 min sans CID ; un brouillon scellé se termine depuis Mes datasets).
4. **Durée rebasée par heuristique** (différence arrondie au jour) : une autre slice qui écrirait une durée non proposée sur un brouillon ne serait pas rebasée.
5. **Mode `SIRIUS_PHALA_DEMO`** : passage par `PRIVATE` sans rebase ; `setDatasetVisibility("LISTED")` ne rebase pas non plus. Testnet uniquement.
6. **`dataLimits` optimiste** (A2 §7.1) toujours affiché tel quel à l'étape 1 ; le contrôle immédiat corrige l'attente (le vrai minimum de lignes est annoncé au refus).
7. **Pas de choix de cible** : un fournisseur dont la cible n'est pas la dernière colonne numérique doit réordonner son fichier.
8. **Frais de réseau** (gas du mint, de l'approve/lock) non mentionnés à l'étape 2 ; ils le sont au moment des transactions.
9. **`listingExpiresAt` sans effet** tant que N1/N3 ne le lisent pas : un dataset reste en ligne après son échéance.
10. **Re-parse complet** du CSV (jusqu'à 3 Mio) au changement de profil, sur le fil principal.
11. **`pnpm audit:deps`** : 2 vulnérabilités (1 faible, 1 haute ignorée), identiques à `staging`.

### 8. Reste à faire

- **P0 (exploitation)** : fournir `RUNNER_BILLING_POLICY_FILE` à l'instance Next (compose VPS, `release-check`) ou exposer le tarif par une route runner ; sans quoi la publication reste suspendue en v7.
- **P0 (N1)** : affichage et renouvellement de `listingExpiresAt`, révocation du consentement depuis la fiche ; **(N3)** filtre d'échéance sur la marketplace.
- **P1** : test unitaire de `createDatasetDraft` avec Prisma simulé ; fixture de mise en ligne dans `provider.test.ts` vérifiant le rebase ; test du corps envoyé par la démo Phala.
- **P1** : exporter `MAX_ABS_VALUE` et `LOGISTIC_ITERATIONS` depuis `train.ts` et faire renvoyer `createdAt` par `beginDatasetIngestion` (couloir runner/pipeline) ; aligner le défaut Prisma `challengeDays` sur 3.
- **P2** : fabrique centrale du jeton (A8) ; e2e de la reprise après signature refusée, d'un tarif v7 et du tarif absent ; étape 2 aux petites largeurs ; mention des frais de réseau ; retrait du BOM dans `parseCsv` ; mémoïser le parse du CSV indépendamment du profil.

### 9. Résultats des vérifications

Environnement : Windows 11, Node v22.16.0, pnpm 11.18.0 via `corepack pnpm@11.18.0` (le `pnpm` installé, 10.17.1, refuse de basculer vers la version déclarée dans `packageManager` : outil manquant dans `%LOCALAPPDATA%\pnpm\.tools`), `DATABASE_URL=postgresql://x:y@localhost:5432/z` (factice). Le script `test` écrit `NODE_OPTIONS="…" node …` (syntaxe POSIX) : sous Windows il faut `pnpm --config.shell-emulator=true test`, sinon `'NODE_OPTIONS' n'est pas reconnu` (échec d'environnement, pas de la slice). Toutes les commandes ont été relancées sur l'arbre final fusionné (cca5d80).

| Commande | Résultat exact |
|---|---|
| `pnpm install --frozen-lockfile` | `Already up to date`, `Done in 674ms`, exit 0 (première installation du worktree : `Done in 1m 48s`, `Generated Prisma Client (7.8.0)`) |
| `pnpm prisma generate` | `✔ Generated Prisma Client (7.8.0) to .\src\generated\prisma in 100ms`, exit 0 |
| `pnpm exec tsc --noEmit` | aucune sortie, exit 0 |
| `pnpm lint` | `eslint`, aucune sortie, exit 0 |
| `pnpm test` (shell-emulator) | `tests 567`, `pass 492`, `fail 75`, exit 1. **Les 75 échecs sont exactement ceux d'une copie vierge de `origin/staging` (e829cfc) dans le même environnement** : `tests 530`, `pass 455`, `fail 75`, même liste nom pour nom (diff vide). Causes : séparateurs de chemin Windows (`src\app\api\train\…` attendu `src/app/api/train/…`, `self-training-routes.test.ts`, `disclaimers.test.ts` « contract.ts absent du graphe »), permissions POSIX (« Répertoire privé requis pour le budget runner », `budget.test.ts`), fichiers temporaires absents (`check-reaper.test.mjs`), CLI runner. La slice ajoute 36 tests, tous verts ; +1 test de staging (`access-log-wiring`) vert. Les tests de la slice seuls : `node --import tsx --test src/lib/datasets/*.test.ts src/lib/i18n/english.test.ts src/lib/sirius/provider.test.ts` → `tests 68`, `pass 68`, `fail 0` |
| `pnpm test:phala-demo` | `tests 24`, `pass 12`, `fail 12` — même liste d'échecs que sur la copie vierge de `origin/staging` (environnement) ; le client modifié (`training-client.ts`) n'y est pas exercé |
| `pnpm exec playwright test` (suite complète, Chromium) | `82 passed (51.2s)`, exit 0 (avant la fusion de staging : `82 passed (1.2m)`) ; dont `e2e/upload.spec.ts` 3/3 et `e2e/responsive.spec.ts` « le sélecteur de profil, le fichier et son contrôle restent dans le formulaire » 7/7 tailles |
| `pnpm audit:deps` | `2 vulnerabilities found — Severity: 1 low | 1 high (1 ignored)`, exit 0 ; identique à `staging` |
| `git diff --name-only origin/staging...HEAD` | 32 fichiers, tous listés en §1 (deux hors liste explicite, une ligne chacun, justifiés §2.14) |
| `git log origin/staging..HEAD --format=%B` | aucune occurrence de `co-authored`, `claude`, `anthropic`, `generated`, `session`, `skip ci` ; auteur et committeur `alibenyezza` sur chaque commit |

Non exécuté : `next build` (les e2e tournent sur `next dev`), tests de contrats (`contracts/**` non touché).

Vérifications ponctuelles (hors suite, scripts jetables hors dépôt) : fuzz de 600 000 saisies de prix (`parseProviderPrice` ↔ `priceUsdcToAtomic`, 6 et 18 décimales, 0 divergence) ; 0 collision de clés entre `upload-en.ts` et les autres fichiers de traduction ; graphe d'imports des composants client sans `server-only` ni module Node ; `git merge-tree` avant fusion (seul conflit : `package.json`).

### 10. Revue interne de la session

Méthode : deux passes de revue adversariale par des agents indépendants, la première à trois angles (sécurité et validation serveur ; exactitude du prix, `challengeDays` et non-régression du scellement ; interface, accessibilité, traductions, tests et conformité à 07), la seconde par un relecteur unique chargé de vérifier chaque correction et de chercher ce qui restait. Scripts de revue (fuzz de 600 000 saisies de prix, collisions de clés de traduction, graphe d'imports du bundle client, vérification BOM) hors dépôt.

| Passe | Constats retenus | Écartés |
|---|---|---|
| 1 | 1 bloquant, 4 importants, 14 mineurs | ~25 (vérifiés conformes) |
| 2 | 0 bloquant, 0 important dans le code, 1 important de process (conflit `package.json` avec `origin/staging`), 6 mineurs | 8 |

**Retenus et corrigés (commits 09fe866, 01026bb, 04b4765, d048377, fusion cca5d80) :**
- Bloquant : la démo Phala (`training-client.ts`) appelait `POST /api/datasets` sans catégorie ni durée → 400 ; corps aligné, `challengeDays` retiré.
- Importants : l'échéance partait de l'horloge serveur après un appel runner pouvant durer 60 s, ce qui faisait abandonner le rebase (`rebasedListingExpiry` → `null`) et raccourcissait la durée → ancrage sur `createdAt` ; publication possible sans décomposition quand le tarif manquait → suspendue avec explication ; promesse « You can withdraw this consent from the dataset page » sans fonction correspondante → au futur ; anneau de focus `outline-none` invisible en contraste forcé → `outline-hidden` + `focus-visible` ; double `role="alert"` et alerte sur champ vide → `PriceBreakdown` monté seulement sur saisie valide ; date d'échéance présentée comme ferme et en UTC → « for N days from the on-chain registration (around …) », mémoïsée.
- Mineurs : deux résolutions des décimales (`settlementToken` ↔ `USDC_DECIMALS`) → une seule ; lecture disque à chaque requête sur une page publique → mémoïsée 5 s ; minimum « — » sans tarif → plancher local ; `readingFile` bloqué après annulation du sélecteur → remis à `false` ; `aria-busy` jamais levé → retiré ; focus perdu entre étapes → panneau focalisé (puis rendu stable en StrictMode) ; bornes nom/description recopiées → partagées dans `publication.ts` ; bannière d'erreur sans `wrap-anywhere` ; libellés d'étapes tronqués → retour à la ligne ; phrase coupée entre `t()` et JSX → deux clés ; états de la transition non annoncés aux lecteurs d'écran → `sr-only` ; « File too large: 3 MB, maximum 3 MB » → taille réelle en MB et en octets ; `ID_RE` borne basse non testée → cas de 9 caractères ; commentaires devenus inexacts → reformulés ; conflit `package.json` → `origin/staging` fusionné, les deux listes de tests conservées.

**Écartés avec la raison :**
- Reprise après un scellement réussi dont la réponse s'est perdue (brouillon orphelin) : comportement identique à l'ancienne page, pas de route sûre pour le détecter sans toucher N1 ; consigné §7.3.
- `listingExpiresAt` sans effet côté catalogue et absence de révocation : périmètre N1/N3 ; consigné §6, §7.9, §8.
- Défaut Prisma `challengeDays @default(7)` : `prisma/` hors périmètre, aucun chemin ne l'utilise ; §8.
- `createdAt` relu par une requête au lieu d'être renvoyé par `beginDatasetIngestion` : `pipeline.ts` hors périmètre ; §8.
- BOM UTF-8 : divergence dans la direction sûre, correctif dans `metrics.ts` hors périmètre ; §5, §8.
- Couplage par sous-chaînes aux messages de `parseCsv` : protégé par le test de parité ; `metrics.ts` hors périmètre.
- Re-parse au changement de profil, vouvoiement d'une clé (texte du cahier), DST sur des durées en millisecondes (cohérent avec un stockage d'instants) : acceptés, §7.
- Texte de l'avertissement : 07 renvoie au texte commun de 16, qui est affiché (A2 §7.2).

**Limite de la revue :** aucun relecteur humain ; les constats écartés l'ont été sur l'avis d'agents de revue et le mien. Les tests ont été exécutés sous Windows, où 75 tests de la suite échouent déjà sur `staging` pour des raisons d'environnement (séparateurs de chemin, permissions POSIX, fichiers temporaires) — vérifié sur une copie vierge de `origin/staging`, même liste d'échecs, voir §9.

---

## N3 — Marketplace

Branche `feat/marketplace`, partie de `staging` (`e829cfc`) puis rebasée sur `staging` (`b1b9c5a`, après les PR #39 journal des accès et #41 tutos ; seuls conflits : la liste du script `test` et les deux lignes d'import et d'étalement de `english.ts`, résolus en gardant les deux côtés). Cahier des charges : [08-marketplace.md](08-marketplace.md), avec [01](01-decisions-avant-samedi.md) §2 à §4, [02](02-general.md) §3 et [16](16-socle-technique.md). Commits : implémentation, puis trois commits de corrections (un par passage de revue, §10), puis cette section ; empreintes visibles avec `git log staging..HEAD` (réécrites par le rebase). Tout est vérifiable depuis `git diff staging...HEAD`.

### 1. Ce qui a changé

**Routes (nouvelles, publiques, lecture seule, sans session)**

| Route | Rôle |
|---|---|
| `GET /api/marketplace` (`src/app/api/marketplace/route.ts`) | Catalogue : datasets en ligne, recherche, filtres, tri et pagination calculés côté serveur. Réponse : `items` (cartes), `total`, `page`, `pageCount`, `pageSize`, `truncated`, `token`, `computeFees`, `kybAvailable`. |
| `GET /api/marketplace/[id]` (`src/app/api/marketplace/[id]/route.ts`) | Fiche d'un dataset en ligne. Réponse : `dataset` (fiche), `token`, `kybAvailable`, `billingMode`. 404 identique (« Dataset introuvable ») pour tout autre cas. |

Paramètres acceptés par le catalogue : `q`, `category`, `model`, `minPrice`, `maxPrice`, `minRows`, `maxRows`, `verified`, `sort` (`recent`, `borrowed`, `price`), `page`. Les autres sont ignorés.

**Pages**

| Fichier | Changement |
|---|---|
| `src/app/(app)/marketplace/page.tsx` | Réécrite : enveloppe `Suspense` de la grille (l'ancienne page, avec un bouton « Emprunter » par carte, est remplacée). |
| `src/app/(app)/marketplace/_components/MarketplaceCatalogue.tsx` (nouveau) | Grille de `DatasetCard` dans une liste `ul`/`li`, recherche (envoi après 350 ms de pause ou sur Entrée), filtres à gauche (catégorie, modèle, prix total, lignes, fournisseur vérifié KYB), tri, pagination, filtres conservés dans l'URL, encart `DisclaimerNote`, étoile des favoris au-dessus de chaque carte. |
| `src/app/(app)/marketplace/[id]/page.tsx` (nouveau) | Fiche publique : description, catégorie, lignes, colonnes, taille, modèle et ce qu'il produit, statistiques publiques, fournisseur (adresse raccourcie, KYB), lien `/proof/[id]`, `PriceBreakdown`, « ce que vous obtenez », « en cas d'échec », encart d'avertissement, bouton « Emprunter ». |
| `src/app/(app)/marketplace/[id]/BorrowPanel.tsx` (nouveau) | Bouton « Emprunter » : demande la connexion puis la signature au clic si besoin, puis appelle le flux existant `borrowDataset` + `useComputeQuoteConfirmation`, inchangés. Reprend de l'ancienne grille la confirmation en cas de prêt déjà en cours et le formulaire KYB de secours. |
| `src/app/(app)/borrow/**` | Inchangé (redirige toujours vers `/train`). |

**Modules (`src/lib/marketplace/`, nouveaux)**

| Fichier | Contenu |
|---|---|
| `categories.ts` | Liste fixe de l'upload (finance, health, commerce, industry, mobility, energy, marketing, other), `normalizeCategory` (identifiant ou libellé français ou anglais, sans casse ni accents), clés de traduction. Pur. |
| `query.ts` | `parseMarketplaceQuery` : lecture stricte et bornée des paramètres, messages d'erreur (`QUERY_ERRORS`). Pur. |
| `listing.ts` | `MARKETPLACE_DATASET_SELECT` (liste blanche de 16 colonnes), `onlineDatasetWhere` et `isOnlineDataset` (règle « en ligne »), projections `toPublicListing` / `toPublicDetail` construites champ par champ, filtrage, tri, pagination. Pur. |
| `catalogue.ts` | `server-only`. `readCatalogueSnapshot` (lecture des candidats, statistiques de prêts, frais, KYB), `createCatalogueSnapshotCache` (lecture partagée 10 s), `loadCatalogue`, `loadListingDetail`. Dépendances injectées (base, KYB, facturation, horloge). |
| `kyb.ts` | `server-only`. Lecteur du statut KYB on-chain (`isKybValid`) pour le badge : délai 2,5 s, lectures en cours partagées, cache 60 s (échec 10 s), dernière valeur connue servie 10 min au plus si la relecture échoue, 200 adresses au plus par requête. |
| `server.ts` | `server-only`. Branchement réel : adaptateur Prisma explicite (quatre lectures typées), lecteur KYB sur `getPublicClient`, `billingEnabled()` → `v6`/`v7`/`unknown`, jeton. |
| `token.ts` | Jeton affiché : `MUSD` à 18 décimales sur mainnet, `USDC` à 18 sur testnet (table `USDC_DECIMALS_BY_NETWORK`). |
| `test-fixtures.ts` | Jeux d'essai des tests (jamais importé par l'application). |

**Traductions** : `src/lib/i18n/marketplace-en.ts` (nouveau), fusionné dans `EN_MESSAGES` par `src/lib/i18n/english.ts` (+2 lignes : import et `...MARKETPLACE_MESSAGES_EN`). Aucune clé existante modifiée ni supprimée.

**Tests** : `query.test.ts`, `listing.test.ts`, `catalogue.test.ts`, `kyb.test.ts`, `client-graph.test.ts` sous `src/lib/marketplace/`, ajoutés à la fin du script `test` de `package.json` (aucune autre ligne touchée). E2E : `e2e/marketplace.spec.ts` (nouveau) ; `e2e/billing-v7.spec.ts`, `e2e/sirius.spec.ts`, `e2e/responsive.spec.ts` adaptés.

**Aucune** table, colonne, migration, modification de `src/lib/db.ts`, de contrat, d'escrow, du moteur Phala, de `src/runner/**`, des composants partagés `src/components/**`, du layout `(app)`, de la Sidebar, du dashboard, ni de `src/app/(app)/datasets/**` ou `src/app/api/datasets/**`.

### 2. Décisions et écarts par rapport au cahier des charges

1. **Consultation sans connexion.** Vérifié : le groupe `(app)` n'impose aucune connexion (`layout.tsx` ne fait que monter Sidebar, tuto et bandeau ; `src/proxy.ts` ne pose que la CSP). L'ancienne grille se lisait déjà sans wallet, via `GET /api/datasets?status=LISTED`. Rien n'a donc été « ouvert » côté accès : la marketplace a sa propre route publique, plus étroite que `/api/datasets` (liste blanche, voir §3), et la connexion n'est demandée qu'au clic sur « Emprunter » : `connectWallet()` puis `signInWithWallet()`, comme `SignInCta`. Après la signature, l'utilisateur clique une seconde fois : l'emprunt ne part jamais tout seul.
2. **Nouvelle route plutôt que `GET /api/datasets`.** `/api/datasets` est hors périmètre et renvoie la ligne entière (CID, Merkle, reçu runner, identifiants EVM, `updatedAt`…), sans filtre d'expiration. `/api/marketplace` lit une liste blanche de colonnes et construit la réponse champ par champ.
3. **« En ligne »** = `status = LISTED`, `keyDestroyedAt` nul, `listingExpiresAt` nul ou futur (strictement), plus `wrappedKey` et `evmDatasetId` non nuls (dataset réellement empruntable ; ces deux colonnes ne servent qu'au filtre, jamais sélectionnées). La règle de statut et d'expiration est revérifiée en mémoire sur chaque ligne et à chaque requête. La pause (`UNLISTED`, docs 16) est donc exclue de la grille **et** de la fiche : un dataset en pause a une fiche « indisponible », même s'il reste empruntable par lien direct via les routes existantes (décision P1 du couloir des prêts, non tranchée ici).
4. **Filtrage en mémoire côté serveur, pas en SQL.** Le serveur lit au plus 500 datasets en ligne (les plus récemment créés), puis filtre, trie et pagine en mémoire. Raisons : le prix est une chaîne en base (tri numérique impossible en Prisma sans SQL brut), le nombre de lignes est dans un JSON, le KYB vient de la chaîne, et `contains` de Prisma n'échappe pas les jokers `%`/`_`. Pendant la bêta sur invitation le catalogue est très en dessous de 500 ; au-delà, la réponse porte `truncated: true` et la grille l'annonce. Passer au SQL est noté en §8.
5. **Lecture partagée 10 s.** Après la première revue, la lecture (datasets, statistiques, frais, KYB) est mise en commun entre requêtes pendant 10 s par instance, lecture en cours partagée, échec jamais mis en cache. Conséquence : une pause ou un nouveau dataset apparaît dans la grille avec jusqu'à 10 s de retard ; l'expiration, elle, est revérifiée à chaque requête avec l'heure courante. La fiche n'utilise pas ce cache.
6. **Prix total et frais de calcul (point à relire en priorité).** En facturation v7, le tarif de calcul n'est connu que du runner (fichier `RUNNER_BILLING_POLICY_FILE` sur le volume Phala) ; l'application web n'a aucun moyen de le lire. Le prix total affiché reprend donc le `computeAmountUsdcAtomic` du **dernier prêt verrouillé** (`evmLockTxHash` non nul, et statut ESCROWED, TRAINING, SETTLING, SETTLED, ou CANCELLED avec transaction de remboursement : un lock annulé n'est jamais lu) pour le même profil et la même version, de moins de 30 jours. Ce montant ne dépend que du profil (`prepareComputeQuote` : `max(computeAmount, minimum)`), il figure dans les conditions du lock on-chain, et sa date n'est pas renvoyée. La grille et la fiche disent que c'est le dernier devis et que le montant exact est celui du devis présenté avant paiement. Sans prêt récent, ou configuration illisible : la carte affiche « Provider receives » (le gain du fournisseur), la fiche n'affiche pas de total et renvoie au devis. En v6 : frais nuls, total = prix du dataset, exact. Le filtre et le tri par prix portent sur le prix affiché (total si connu, sinon gain du fournisseur).
7. **Fournisseur sans KYB valide.** Le cahier demande un filtre « vérifié KYB » : les datasets d'un fournisseur non vérifié restent donc dans la grille, avec le badge « Provider not KYB-verified ». Mais `prepareLoan` refuse l'emprunt (`requireCounterpartyKyb`) : sur la fiche, le bouton est désactivé avec « Borrowing unavailable: the provider’s KYB attestation is missing or expired ». Statut illisible (`null`) : aucun badge, exclu du filtre « vérifiés », bouton actif (le serveur tranche).
8. **Colonnes et types : écart.** Le cahier demande « colonnes et leur type ». La base ne stocke que les volumes (`rowCount`, `columnCount`) : `publicDatasetMetrics` élimine volontairement les statistiques détaillées et les noms de colonnes ne sont jamais en clair. La fiche affiche le nombre de colonnes et dit que les noms et types restent dans le fichier chiffré. Publier un schéma demanderait un choix du fournisseur à l'upload (N2).
9. **Taux de réussite : libellé corrigé.** `successRate` = prêts réglés au fournisseur / (réglés + remboursés), sur les transactions confirmées. Un remboursement suit un échec **ou** un entraînement jamais lancé : la fiche l'intitule « Loans settled to the provider » et l'explique, plutôt que « taux de réussite des entraînements », qui aurait été trompeur. `borrowCount` = prêts dont les fonds ont été verrouillés (ESCROWED, TRAINING, SETTLING, SETTLED, ou CANCELLED avec transaction de remboursement) ; les réservations abandonnées ne comptent pas.
10. **« En cas d'échec » dépend de la facturation.** v7 : « Only the compute actually consumed is retained; the rest is refunded. » v6 : « No compute fee is charged: the locked amount is returned in full. » Version illisible : « The quote states what is retained if training fails, before any payment. » Dans tous les cas : « If the loan is not settled after {n} days, you can recover your funds from the Train page », avec `n` = `challengeDays` **du dataset** (valeur reprise dans le devis et la deadline du lock), pas « 3 » en dur : les datasets publiés avant la décision 3 gardent leur valeur (1 à 30).
11. **Catégories : liste tenue ici, en attendant N2.** Aucune liste n'existait dans le code de `staging`. `categories.ts` accepte l'identifiant (`health`) et les libellés français ou anglais (`Santé`, `Health`), sans casse ni accents ; toute autre valeur est traitée comme « sans catégorie » (non affichée, non filtrable). N2 doit écrire une de ces valeurs, idéalement l'identifiant, et peut importer `MARKETPLACE_CATEGORIES`.
12. **Jeton.** `MUSD` (18 décimales) sur mainnet, `USDC` (18) sur testnet, choisi par le serveur et renvoyé dans chaque réponse ; `marketplaceDeps()` refuse en 503 une configuration où la table et `USDC_DECIMALS` divergent. Le devis (`ComputeQuoteDialog`, hors périmètre) écrit toujours « USDC ».
13. **Favoris conservés, réputation retirée.** L'étoile reste sur chaque carte (au-dessus du lien étiré de `DatasetCard`) ; les favoris passent en tête seulement avec le tri par défaut et à l'intérieur de la page, pour ne jamais réordonner en douce un tri choisi. La ligne « Confiance EVM score/100 · N règlements » de l'ancienne carte n'est plus affichée : remplacée par le badge KYB, le nombre d'emprunts et la part réglée. Les clés de traduction de l'ancienne page sont laissées dans `english.ts` (non supprimées pour éviter les conflits avec les autres slices).
14. **Fiche rendue côté client.** La fiche appelle `/api/marketplace/[id]` depuis le navigateur, comme le reste du groupe `(app)` ; pas de rendu serveur ni de métadonnées par dataset (aperçu de lien générique).
15. **Identité des commits.** Auteur et committeur : l'identité git locale du propriétaire (`alibenyezza`). Aucune ligne de co-signature, d'identifiant de session ni de mention d'outil, dans les commits, la PR et les fichiers.

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès, route par route**

- `GET /api/marketplace` et `GET /api/marketplace/[id]` : publics par conception. Aucune lecture de cookie ni de session (ni `readSession`, ni `requireAuth`) : la réponse ne dépend que de l'URL, identique pour tous (test : même corps avec un cookie forgé). Aucune écriture.
- `BorrowPanel` n'appelle des routes authentifiées (`GET /api/loans`, `GET /api/account/status`, `POST /api/loans` via `borrowDataset`) qu'une fois le wallet signé ; leur contrôle d'accès est inchangé. Le bouton désactivé (KYB du fournisseur) n'est **pas** un contrôle : `prepareLoan` refuse de toute façon.
- Débit : 60 requêtes/min par client et 1 200 par instance (catalogue), 120 et 2 400 (fiche). Sans `SIRIUS_TRUST_PROXY_HEADERS=true`, seule la limite globale s'applique (voir §7).

**Validation et bornes**

- `parseMarketplaceQuery` : paramètre répété → 400 ; `q` ≤ 100 points de code après suppression des espaces (valeur brute ≤ 400), contrôles C0/DEL/C1 refusés, 8 mots au plus, repliés (minuscules, sans accents), comparés par sous-chaîne (aucune expression régulière construite à partir de l'entrée) ; `category` et `model` : identifiants exacts (`__proto__`, `constructor` refusés) ; prix : décimal, 8 chiffres entiers au plus, décimales ≤ celles du jeton, converti en `bigint` sans arrondi, `min ≤ max` ; lignes : entier 0 à 20 000 ; `verified` ∈ {0, 1} ; `sort` fermé ; `page` 1 à 21 (au-delà de la dernière page réelle : ramenée à la dernière).
- `[id]` : `^[A-Za-z0-9_-]{1,64}$`, sinon la même 404.
- Coût par requête : lecture de 501 lignes au plus, 3 `groupBy` sur 500 ids au plus, 2 `findFirst` (un par profil), lectures KYB (≤ 200 adresses, partagées, en cache) ; le tout mis en commun 10 s.

**Fuites possibles**

- Colonnes lues : `MARKETPLACE_DATASET_SELECT` (id, name, description, category, provider, modelId, modelVersion, metrics, sizeBytes, priceUsdcAtomic, challengeDays, status, listedAt, listingExpiresAt, keyDestroyedAt, createdAt). Jamais `wrappedKey`, consentement, CID, Merkle, reçu runner, identifiants EVM, `updatedAt`. `metrics` est réduit à `rowCount`/`columnCount` par `publicDatasetMetrics`. `status`, `listingExpiresAt`, `keyDestroyedAt` et `createdAt` sont lus mais ne sortent pas.
- Réponse : projection champ par champ ; une ligne qui contiendrait des champs privés (ré-inclusion future, jointure) ne peut pas fuir (tests avec une fausse base qui renvoie la ligne entière et des datasets hors ligne).
- Prêts : seulement des comptes agrégés par dataset et un montant de frais par profil ; jamais d'emprunteur, de date de devis, de montant individuel. L'activité est déjà publique on-chain.
- Existence : la fiche renvoie la même 404 pour inconnu, pause, expiré, privé, brouillon, détruit, id mal formé. **Mais** `GET /api/datasets/[id]` (hors slice) sert toujours un dataset `UNLISTED` à qui connaît son id, et `GET /api/datasets` en anonyme liste les LISTED expirés : la garantie « pause et expiration non révélées » ne vaut que pour les routes de la marketplace.
- Fournisseur : adresse publique (titulaire du titre on-chain), affichée raccourcie (`0x930f…318b`, complète au survol).
- Erreurs : `errorResponse` (message des seules `AppError`, sinon « Erreur interne » ; journal : classe de l'erreur seulement). Test : une panne de base contenant une chaîne de connexion ne laisse rien dans la réponse ni dans le journal. `cache-control: no-store` sur toutes les réponses, erreurs comprises.
- Bundle client : test du graphe d'imports : les pages n'atteignent ni `src/lib/db.ts`, ni `catalogue.ts`/`server.ts`/`kyb.ts`, ni `server-only`, `pg`, `@prisma/*` (types serveur importés en `import type`).

**Argent, escrow, contrats, Phala**

- Aucune transaction construite par la slice. L'emprunt passe par `borrowDataset({ datasetId, priceUsdcAtomic, confirmQuote })`, inchangé, avec `priceUsdcAtomic` = `Dataset.priceUsdcAtomic` (contrôlé `^(0|[1-9][0-9]*)$`, sinon bouton désactivé), la même valeur que l'ancienne grille ; le contrôle « Prix du dataset modifié » et le devis signé restent les garde-fous. Le prix total affiché n'engage rien : le devis signé, affiché avant paiement, fait foi. Aucun envoi de transaction runner, aucun contrat ni moteur touché.

**Base de données** : aucune migration, aucune contrainte. Lectures seulement, par un adaptateur typé de quatre opérations.

**Interface**

- Nom, description, catégorie : rendus par React (échappés), aucun `dangerouslySetInnerHTML` ; la description garde ses retours à la ligne (`whitespace-pre-line`). E2E : `<script>` dans la description affiché comme du texte.
- Liens internes seulement (`/marketplace/<id encodé>`, `/proof/<id encodé>`, `/train`) ; `DatasetCard` passe par `safeInternalHref`. Le seul lien externe est le `mailto:` constant de `DisclaimerNote`.
- Une catégorie inconnue en base n'est jamais affichée telle quelle.

**Textes**

- Aucun texte ne promet une qualité de modèle : encart commun `modelQuality` + `contactUs` sur la grille et la fiche ; « What it does » reprend la description du registre (« Predicts a continuous numeric value. », « Classifies a target strictly encoded as 0 or 1. »).
- « Ce que vous obtenez » = texte de 01 §2 ; « en cas d'échec » adapté à v6/v7 et à `challengeDays` (§2.10) ; « KYB-verified provider » atteste le fournisseur, pas la donnée.
- À vérifier : la mention « Prices include the compute fee from the latest quote » (§2.6) est vraie tant que le tarif n'a pas changé depuis le dernier prêt.

### 4. Cas limites à essayer à la main sur staging

1. **Sans wallet** (navigation privée) : `/marketplace` affiche la grille ; ouvrir une carte → fiche complète. Onglet réseau : seuls `/api/marketplace` et `/api/marketplace/<id>` partent (aucun `/api/loans`, `/api/account/status`, `/api/datasets`).
2. **Clic sur « Borrow » sans wallet installé** → « No wallet detected », rien d'autre ne part. **Avec un wallet non connecté** → fenêtre de connexion puis signature ; refuser la signature → message d'erreur affiché sous le bouton ; accepter → « Borrow » à recliquer, puis le devis s'ouvre.
3. **Emprunt complet** depuis la fiche (v7) : le devis affiche les mêmes montants que la fiche si le tarif n'a pas changé ; accepter → approbation puis lock ; message « Loan recorded… » avec lien vers Train ; le prêt apparaît dans `/train`. Recliquer → confirmation « You already have an active loan… ».
4. **Changement de compte** dans le wallet pendant le devis → le devis se ferme sans rien signer ; pendant la signature de connexion → le message d'erreur s'affiche (pas de panneau remis à zéro silencieusement).
5. **Pause** : mettre un dataset en pause dans Mes datasets → il disparaît de la grille en 10 s au plus ; sa fiche dit « Dataset unavailable » immédiatement. **Expiration** : `listingExpiresAt` dans 1 minute → visible, puis absent de la grille et de la fiche à l'échéance (sans attendre le cache). **Destruction** : idem.
6. **Fournisseur non vérifié** (attestation révoquée ou expirée) : badge « Provider not KYB-verified », bouton désactivé avec le message ; le filtre « KYB-verified providers only » le masque. RPC KYB en panne : aucun badge, mention « The KYB status of some providers could not be read », le filtre « vérifiés » ne montre rien de non vérifié.
7. **Filtres** : chaque catégorie et chaque modèle ; recherche avec accents (« energie » trouve « Énergie »), avec `%`, `_`, `.*` (texte littéral) ; prix `1.5` à `20` ; prix avec trop de décimales (`0.0000001` sur mainnet) → « Invalid price » ; min > max → « Invalid price range » ; lignes `0` à `20000` ; tri par prix et par emprunts ; « Reset filters » ; retour arrière du navigateur (les filtres et le champ de recherche suivent l'URL).
8. **Frappe pendant l'envoi** : taper « crédit », attendre, puis taper « pme » lentement → le champ ne se vide jamais et aucune lettre n'est perdue.
9. **URL forgées** : `?page=999` → 400 ; `?page=3` sur un catalogue d'une page → dernière page affichée ; `?category=Santé` → 400 ; `?q=` de 101 caractères → 400 ; `?sort=price&sort=recent` → 400 ; `/marketplace/../datasets`, `/api/marketplace/%00` → 404.
10. **Facturation v6** (staging VPS par défaut) : la carte affiche le prix du dataset comme total, la fiche « Compute fee 0.00 » et le texte d'échec v6. **v7 sans aucun prêt récent** : carte « Provider receives », fiche sans total, « Shown in the quote ».
11. **Datasets anciens** : un dataset avec `challengeDays = 7` → « after 7 days » ; catégorie absente → pas de badge ; profil d'entraînement inconnu → « Missing profile » et bouton désactivé.
12. **Mobile 320–390 px et texte agrandi** : bouton « Show filters », cartes et fiche sans débordement (e2e `responsive`).
13. **Hostile** : nom ou description contenant `<img src=x onerror=alert(1)>` → affiché comme texte.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

Unitaires (ajoutés au script `test`) :
- `query.test.ts` : valeurs par défaut, champs vides et paramètres inconnus ignorés, doublons, longueur en points de code (émojis), contrôles et `%00`/CRLF encodés, substituts isolés (devenus U+FFFD), caractères SQL et regex traités comme texte, repli des accents, 8 mots, catégories et modèles exacts, prix (décimales, `bigint`, bornes, formes refusées), lignes, `verified`, `sort`, `page`, traduction de chaque message d'erreur.
- `listing.test.ts` : règle « en ligne » (LISTED, expiration future/présente/passée/illisible, chaque statut, clé détruite), filtre Prisma, liste blanche de colonnes, projection avec une ligne pleine de champs privés (clés exactes, aucune valeur « SECRET »), prix affiché (v6, inconnu, au-delà de 2⁵³, prix illisible), valeurs stockées douteuses, catégories et leurs traductions, chaque filtre, chaque tri, pagination (dont page au-delà de la fin).
- `catalogue.test.ts` : avec une fausse base qui ignore `where`/`select` et renvoie des lignes privées et hors ligne : arguments exacts passés à Prisma, rien d'hors ligne ni de privé ne sort, statistiques, requête des frais (prêts verrouillés, profil et version), v6/v7/inconnu/montants invalides, KYB vrai/faux/illisible/en panne, plafond `truncated`, cache (une lecture pour 25 requêtes simultanées, expiration revérifiée sans relire la base, échec non mis en cache), fiche et `billingMode`, **routes réelles** chargées avec leurs dépendances (statut, `no-store`, même réponse avec cookie, 400 sur paramètres, 404 uniforme, panne de base opaque dans la réponse et le journal).
- `kyb.test.ts` : valeurs non booléennes, délai, exceptions synchrones, adresses invalides, plafond de lectures, cache et TTL d'échec, lectures simultanées partagées, valeur périmée servie puis abandonnée ; jeton par réseau.
- `client-graph.test.ts` : graphe d'imports des modules partagés et des deux pages.

Mutations jouées, toutes détectées : projection remplacée par un étalement de la ligne (6 tests rouges) ; vérification « en ligne » en mémoire neutralisée (6 rouges) ; import à l'exécution de `catalogue.ts` depuis la fiche (graphe rouge).

E2E (`playwright`, chromium) : `marketplace.spec.ts` (sans wallet : grille, fiche, prix, contact, aucun appel privé, clic « Borrow » sans wallet ; filtres et URL dont frappe pendant l'envoi et réinitialisation qui vide le champ sans renvoyer la recherche ; 400 affiché et fiche indisponible ; fournisseur non vérifié + v6 ; frais inconnus) ; `billing-v7.spec.ts` (tous les scénarios d'emprunt, désormais depuis la fiche) ; `sirius.spec.ts` (favoris) ; `responsive.spec.ts` (grille puis fiche, 7 largeurs).

**Angles morts** : aucun test contre une vraie base PostgreSQL (les requêtes Prisma sont vérifiées par les types générés et les arguments exacts, pas exécutées) ; aucun test contre un vrai RPC (KYB) ni un vrai wallet (les e2e simulent l'API et le wallet) ; le parcours connexion → signature déclenché par « Borrow » n'est couvert qu'à l'état « aucun wallet » ; pas de test d'accessibilité automatisé ; `next build` non exécuté (voir §9).

### 6. Hypothèses

- Le montant de calcul d'un devis ne dépend que du profil (vrai dans `prepareComputeQuote` aujourd'hui) ; si le tarif devenait fonction du dataset ou de la taille, la mention « dernier devis » deviendrait fausse.
- `challengeDays` du dataset est la valeur reprise dans le devis et la deadline (vrai en v6 et v7 aujourd'hui).
- La slice upload (N2) écrira une catégorie reconnue par `normalizeCategory`.
- L'emprunt d'un dataset dont le fournisseur n'a pas `isKybValid` est refusé par le serveur sur tous les réseaux (`requireCounterpartyKyb`).
- `wrappedKey` non nul et `evmDatasetId` non nul sont nécessaires à l'emprunt (vrai dans `prepareLoan` aujourd'hui).
- MUSD à 18 décimales sur mainnet (« annoncé », à confirmer on-chain selon 01) ; testnet à 18.
- Le catalogue reste sous 500 datasets en ligne pendant la bêta.
- L'adresse `sirius.data.contact@gmail.com` (texte commun A2) est active.

### 7. Risques résiduels et limites connues

1. **Prix total indicatif en v7** (§2.6) : faux jusqu'au prochain prêt verrouillé après un changement de tarif ; inconnu tant qu'aucun prêt n'a été verrouillé depuis 30 jours (notamment juste après le lancement mainnet). Le devis signé reste correct.
2. **Limiteur de débit global** : sans adresse client transmise par l'ingress, un seul client peut épuiser le quota de l'instance et renvoyer des 429 à tous les visiteurs pendant une minute. Le cache de 10 s limite le coût, pas ce blocage.
3. **Badge KYB jusqu'à 10 min périmé** si le RPC tombe juste après une révocation ; l'emprunt, lui, revérifie on-chain. Au-delà du délai de 2,5 s, l'appel RPC n'est pas annulé (il finit en arrière-plan, une fois par adresse grâce au partage).
4. **Grille en retard de 10 s** sur une pause ou une nouvelle publication (§2.5).
5. **Routes hors slice** : `/api/datasets/[id]` sert un dataset en pause, `/api/datasets` liste les expirés, et le parcours d'emprunt n'applique pas `listingExpiresAt` : un dataset expiré reste empruntable par appel direct de l'API. À corriger dans les couloirs datasets et prêts.
6. **Jeton** : la fiche affiche MUSD sur mainnet, le devis et `/train` écrivent USDC.
7. **Filtrage en mémoire plafonné à 500** (§2.4).
8. **Mix total / gain du fournisseur** dans le tri par prix quand un profil a des frais connus et l'autre non.
9. **Relecture du KYB de secours** au bout de 31 s : pendant ce délai, le formulaire de secours n'apparaît pas pour un compte vraiment sans attestation (l'emprunt échouerait alors avec le message serveur). Une seule relecture, y compris après un 503/429.
10. **Retrait visible jusqu'à ~13 s dans la grille** : un passage en PRIVATE/UNLISTED ou une clé détruite n'est revérifié qu'à la lecture suivante (10 s après la fin d'une lecture qui peut durer 2,5 s à cause du KYB), par instance. Seuls le nom, la description et les volumes restent affichés ; la fiche renvoie 404 aussitôt.
11. **Frappe perdue, cas rare** : si un filtre est cliqué pendant qu'un envoi de recherche est en vol **et** que Next rend les deux navigations successivement, le brouillon tapé entre-temps peut être remplacé par la valeur de l'URL. Le cas courant (seule la dernière navigation est rendue) conserve et renvoie le brouillon (e2e).
12. **Erreur d'un compte réaffichée** si le même compte se reconnecte (message rangé par compte) ; cosmétique.
13. **Provenance du runner non filtrée** : `prepareLoan` exige `runnerReceipt` et la provenance du runner courant ; un dataset d'un ancien runner peut apparaître empruntable et répondre 409 (comportement déjà présent avec l'ancienne grille).

### 8. Reste à faire

- **P0** : couloir des prêts : appliquer `listingExpiresAt` (et décider pour `UNLISTED`) dans `prepareLoan` ; couloir datasets : restreindre `GET /api/datasets` anonyme aux datasets en ligne et à une liste blanche.
- **P0** : N2 : écrire la catégorie avec un identifiant de `MARKETPLACE_CATEGORIES`.
- **P1** : exposer le tarif de calcul en vigueur à l'application web (route du runner ou variable publiée avec la politique tarifaire), pour remplacer le « dernier devis ».
- **P1** : libellé du jeton dans `ComputeQuoteDialog` et `/train` (MUSD sur mainnet).
- **P1** : exiger l'adresse client de l'ingress (`SIRIUS_TRUST_PROXY_HEADERS`) en production pour que le débit soit par client.
- **P2** : filtrage et tri en SQL si le catalogue dépasse quelques centaines de datasets ; schéma de colonnes publiable au choix du fournisseur ; rendu serveur et métadonnées de la fiche ; nettoyage des clés de traduction de l'ancienne grille ; test e2e du parcours connexion + signature avec un faux wallet.

### 9. Résultats des vérifications

Environnement : Windows 11, Git Bash, Node v22.16.0, pnpm 11.18.0 (lancé par `npx pnpm@11.18.0` : l'installation locale de pnpm 11 de la machine est cassée), `DATABASE_URL=postgresql://x:y@localhost:5432/z` (factice), aucune base ni RPC. Le script `test` utilise la syntaxe POSIX `NODE_OPTIONS=… node …` : lancé avec `--config.script-shell` pointant sur `bash.exe`. Toutes les commandes sur la tête de la branche.

| Commande | Résultat exact |
|---|---|
| `pnpm install --frozen-lockfile` | `Already up to date`, `Done in 545ms using pnpm v11.18.0`, code 0 (premier passage : `Done in 1m 50.8s`, postinstall `✔ Generated Prisma Client (7.8.0)`) |
| `pnpm prisma generate` | `✔ Generated Prisma Client (7.8.0) to .\src\generated\prisma in 113ms`, code 0 |
| `pnpm exec tsc --noEmit` | aucune sortie, code 0 |
| `pnpm lint` | `eslint`, aucune remarque, code 0 |
| `pnpm test` (après rebase) | `# tests 624`, `# pass 552`, `# fail 72`, code 1 (avant rebase : 567 / 495 / 72). **Échec d'environnement, pas de la slice** : `staging` sur la même machine, avant la branche, donne `# tests 530`, `# pass 458`, `# fail 72` ; les 72 échecs de la branche sont tous des tests préexistants hors slice (aucun test marketplace ni `english.test.ts`), et la liste est identique d'un passage à l'autre de la branche. Ils dépendent de POSIX (droits de fichiers, `SIGKILL`, chemins `/`, registres anti-rejeu, volumes runner, budget) et passent en CI Linux. Après le rebase, la liste des 72 échecs est identique à celle d'avant le rebase. Les 37 tests ajoutés passent tous, ainsi que `english.test.ts` (7/7). |
| Tests de la slice seuls (`node --import tsx --test src/lib/marketplace/*.test.ts src/lib/i18n/english.test.ts`) | `# tests 44`, `# pass 44`, `# fail 0` |
| `pnpm audit:deps` | `2 vulnerabilities found`, `Severity: 1 low \| 1 high (1 ignored)`, code 0 ; aucune dépendance ajoutée, état identique à `staging` |
| E2E (`playwright test e2e/marketplace.spec.ts e2e/billing-v7.spec.ts e2e/sirius.spec.ts e2e/responsive.spec.ts`, chromium, `next dev` Turbopack, port 3197 via une configuration locale hors dépôt car le 3100 était occupé par une autre session) | après rebase, cache `.next` vidé : `52 passed` ; `marketplace.spec.ts` répété deux fois : `10 passed`. Un premier passage après rebase a eu un échec de délai (navigation vers la fiche pendant sa première compilation en développement) : délai de cette attente porté à 30 s |
| Mutations (§5) | projection étalée : 6 tests rouges ; règle « en ligne » neutralisée : 6 rouges ; import serveur depuis la fiche : graphe rouge |
| `git diff --name-only staging...HEAD` | 26 fichiers + cette section : `e2e/billing-v7.spec.ts`, `e2e/marketplace.spec.ts`, `e2e/responsive.spec.ts`, `e2e/sirius.spec.ts`, `package.json`, `src/app/(app)/marketplace/[id]/BorrowPanel.tsx`, `src/app/(app)/marketplace/[id]/page.tsx`, `src/app/(app)/marketplace/_components/MarketplaceCatalogue.tsx`, `src/app/(app)/marketplace/page.tsx`, `src/app/api/marketplace/[id]/route.ts`, `src/app/api/marketplace/route.ts`, `src/lib/i18n/english.ts`, `src/lib/i18n/marketplace-en.ts`, `src/lib/marketplace/{catalogue,categories,kyb,listing,query,server,token,test-fixtures}.ts`, `src/lib/marketplace/{catalogue,client-graph,kyb,listing,query}.test.ts`. Aucun fichier interdit. |
| `git log staging..HEAD --format=%B` passé au crible (co-signature, nom de l'assistant, lien de session, mention de génération, `[skip ci]`) | aucune occurrence ; auteur et committeur de chaque commit : `alibenyezza` |

Non exécuté : `pnpm build` (pas demandé ; la compilation Turbopack des pages a été exercée par `next dev` pendant les e2e), `test:postgres`, contrats, e2e hors des quatre fichiers marketplace.

### 10. Revue interne de la session

Méthode : trois passages de relecture adversariale par des agents indépendants, avec accès au dépôt et droit d'écrire des scripts d'essai hors du dépôt, sans droit de modifier le code. Passage 1 : deux relecteurs en parallèle (fuite de données sans connexion, injection et bornes des filtres ; non-régression du flux d'emprunt et exactitude des textes). Passage 2 : un relecteur sur le code corrigé, avec la liste des défauts déjà traités, chargé de vérifier les corrections et de chercher du neuf. Passage 3 : un relecteur sur les seules corrections du passage 2. Arrêt quand le passage ne remonte plus que des points faibles acceptés ou corrigés.

**Passage 1, défauts remontés et suite**

| Défaut | Gravité | Suite |
|---|---|---|
| Fiche remontée à chaque révision du wallet (`key={revision}`) : la connexion lancée par « Borrow » perdait son état et ses erreurs | moyenne | corrigé (`8fc6e5c`) : plus de remontage, lectures rangées par compte |
| Champ de recherche vidé à l'envoi, frappes perdues | moyenne | corrigé, e2e de frappe pendant l'envoi |
| Dataset d'un fournisseur sans KYB présenté empruntable (le serveur refuse) | moyenne | corrigé : bouton désactivé avec explication |
| Lectures KYB démultipliées par requêtes simultanées, appel RPC partagé avec l'escrow | moyenne | corrigé : lectures en cours partagées, dernière valeur connue ; annulation RPC impossible, documentée (§7.3) |
| Coût par requête élevé, limiteur global | moyenne/basse | coût corrigé (lecture partagée 10 s) ; limiteur global documenté (§7.2, §8) |
| Page hors bornes affichant un catalogue vide | basse | corrigé : ramenée à la dernière page |
| « Taux de réussite » comptant les emprunts jamais entraînés | basse | corrigé : libellé « Loans settled to the provider » + explication |
| Texte d'échec v7 affiché en v6 | basse | corrigé : `billingMode` dans la fiche |
| Secours KYB affiché juste après la signature (attestation en cours) | basse | corrigé : une relecture après le cache de 30 s |
| Frais lus sur des devis abandonnés (révélait une activité) | basse | corrigé : prêts verrouillés, même profil et version |
| « Clé active » vérifiée à moitié | basse | corrigé : `wrappedKey` et `evmDatasetId` non nuls dans le filtre |
| Routes `/api/datasets*` hors slice exposant pause et expiration | basse | hors périmètre, documenté (§3, §7.5, §8) |
| Réputation retirée, favoris limités au tri par défaut, jeton USDC dans le devis | basse | assumés, documentés (§2.12, §2.13) |

Tenté sans défaut au passage 1 : champs privés (select, omit, projection), session non lue, 404 uniforme sans écart de temps exploitable, paramètres (doublons y compris clé encodée, contrôles, unicode, pleine largeur, chiffres arabes, `__proto__`), recherche sans regex, `bigint`, journaux opaques, XSS, prix envoyé à l'emprunt identique à l'ancienne grille, changement de wallet pendant le devis, double emprunt, `challengeDays`, frais = `max(computeAmount, minimum)`.

**Passage 2** : corrections du passage 1 vérifiées justes (dont le filtre sur une colonne omise, accepté par Prisma 7.8 et déjà utilisé par `borrower.ts`). Nouveaux défauts, tous faibles : lock annulé (CANCELLED sans remboursement) encore lu pour les frais ; recherche bloquée si un autre filtre supplante l'envoi, et délai relancé à chaque rendu ; erreur et succès d'un compte affichés après changement de wallet ; relecture KYB absente après un 503/429 ; texte v7 quand la facturation est illisible. **Tous corrigés** (`7506559`). Documenté sans correction : retrait visible ~13 s dans la grille (§7.10) ; provenance du runner non filtrée, préexistant (§7.13).

**Passage 3** : aucun défaut moyen ou bloquant. Un point faible en partie dû au passage 2 (la réinitialisation pouvait renvoyer la recherche effacée) : **corrigé** (`d0f3ebd`, e2e). Un point faible préexistant (frappe perdue si deux navigations sont rendues successivement) : une correction par `window.location.search` a été essayée puis retirée, l'URL n'étant mise à jour qu'à la fin de la navigation ; documenté (§7.11). Un point cosmétique (erreur réaffichée si le même compte se reconnecte) : accepté (§7.12). Après le rebase sur `staging` (tutos A3), vérifié que le tuto `marketplace` ne vise aucun élément de l'ancienne page (contenu textuel seulement, `src/lib/tour/content.ts`) et que `/marketplace/[id]` n'hérite pas du tuto de la liste (`tourKeyForPath`).

Écarté : aucun défaut remonté n'a été jugé faux ; ceux non corrigés sont hors périmètre ou acceptés, et listés en §7.

---

## N4 — Train

Branche `feat/train`, PR vers `staging`. Tout ce qui suit est vérifiable depuis `git diff staging...HEAD`. Aucune route, table, colonne, migration ni contrat n'est touché : la slice ne change que l'interface de la page Train, deux modules de logique d'affichage, les traductions et les tests.

### 1. Ce qui a changé

**Fichiers**

| Fichier | Rôle |
|---|---|
| `src/app/(app)/train/page.tsx` | Catalogue et `CatalogueCard` supprimés. Self training (section « Mes données », liste des jobs, pagination des datasets) affiché seulement si `GET /api/admin/me` répond exactement `{ "admin": true }`. Encart de contact pour les autres comptes. État lisible par emprunt, bouton « Refund » réservé aux échecs sans modèle, panneau « Retrain » sur les emprunts terminés. |
| `src/lib/train/loan-display.ts` | Logique pure d'affichage, sans effet de bord : `loanDisplayState`, `canRetrain`, `canRefund`, `isFailedWithoutModel`, `hasOtherActiveLoan`, `parseAdminResponse`, libellés et variantes des états. |
| `src/lib/train/loan-display.test.ts` | 14 tests unitaires de cette logique (ajoutés au script `test`). |
| `src/components/train/RetrainPanel.tsx` | Panneau de ré-entraînement : avertissement de déterminisme, prix de la fiche, bouton qui appelle `borrowDataset`. |
| `src/lib/i18n/train-en.ts` + 2 lignes dans `src/lib/i18n/english.ts` | Traductions anglaises des nouveaux textes (import et propagation dans `EN_MESSAGES`). |
| `package.json` | `src/lib/train/loan-display.test.ts` ajouté à la liste du script `test`. |
| `e2e/train.spec.ts` (nouveau), `e2e/billing-v7.spec.ts`, `e2e/responsive.spec.ts`, `e2e/audit-regressions.spec.ts` | Suite e2e adaptée (voir section 5). |

**Routes appelées par la page, avant et après**

| Appel | Avant | Après |
|---|---|---|
| `GET /api/loans` | toujours | toujours (la liste des prêts de l'emprunteur et du fournisseur) |
| `GET /api/admin/me` | jamais | toujours, pour décider d'afficher le self training |
| `GET /api/datasets` (ses propres datasets) et `GET /api/train` (jobs) | toujours | seulement si `admin === true` |
| `GET /api/datasets?status=LISTED` (catalogue) | toujours | jamais |
| `GET /api/marketplace/[id]` | jamais | à l'ouverture du panneau Retrain, pour le prix de la fiche (route publique existante, inchangée) |
| `POST /api/loans`, `/authorize`, `/submit` | via `CatalogueCard` | via `borrowDataset`, appelé par `RetrainPanel` (même fonction, mêmes routes) |
| `POST /api/loans/[id]/cancel` | bouton « Récupérer l'escrow » | bouton « Refund » (même `cancelExpiredLoan`, mêmes routes) |

Aucun fichier sous `src/app/api/**`, `contracts/**`, `src/runner/**`, `src/lib/runner/**`, ni la marketplace, les datasets, le layout, la Sidebar ou les composants partagés n'est modifié. La page `/phala` et ses composants ne sont pas touchés.

**États affichés d'un emprunt** (`loanDisplayState`, pastille sur chaque carte)

| État affiché | Condition (statut du prêt) |
|---|---|
| Paiement en attente de finalité (« Payment awaiting finality ») | `SUBMITTING` ; `PENDING` avec un hash de lock ; `SETTLING` (release envoyé, en cours de confirmation) |
| En cours (« In progress ») | `PENDING` sans hash de lock (prêt créé avant le devis, rien payé) ; `ESCROWED`, `TRAINING` dans leur délai |
| Terminé (« Completed ») | `SETTLED` |
| Échoué (« Failed ») | `CANCELLED` sans `cancelTxHash` ; ou `ESCROWED`/`TRAINING`/`SETTLING` échu sans modèle (voir règle de remboursement) |
| Remboursé (« Refunded ») | `CANCELLED` avec `cancelTxHash` |
| État inconnu | tout autre statut reçu de l'API |

### 2. Décisions et écarts par rapport au cahier des charges

1. **Pas d'état « échoué » côté serveur.** Le modèle `Loan` n'a pas de statut d'échec : `LoanStatus` vaut `PENDING | SUBMITTING | ESCROWED | TRAINING | SETTLING | SETTLED | CANCELLED`. L'état « échoué » est donc dérivé dans l'interface. Un entraînement est dit « échoué sans modèle livré » quand le serveur déclare le prêt remboursable (`refundable`, c'est-à-dire échéance dépassée sur un prêt actif) ET que `modelCid`, `settleTxHash` et `cancelTxHash` sont vides ET qu'une clé de prêt on-chain existe. Avant l'échéance, un job qui échoue reste « En cours » avec « Réessayer le job » : le contrat n'autorise le remboursement qu'après l'échéance, la slice ne le contourne pas.
2. **Remboursement : écart avec l'ancien bouton, corrigé pour le cas bloquant.** L'ancien bouton « Récupérer l'escrow » s'affichait pour tout prêt `refundable`, y compris au fournisseur. Le nouveau bouton « Refund » est réservé à l'emprunteur et à deux cas : (a) échec sans modèle (`modelCid`, `settleTxHash`, `cancelTxHash` vides) ; (b) **remboursement de secours** : prêt échu avec `modelCid` posé mais sans `runnerReceipt`, `settleTxHash` et `cancelTxHash` vides. Dans le cas (b) « Finaliser le règlement » est impossible (il exige le reçu) et le réaper (`reaper-policy.ts`) ne fait que resynchroniser la base avec la chaîne (`reconcile-chain`), jamais de règlement ni de remboursement on-chain : sans secours, les fonds resteraient bloqués. L'état affiché est « Failed », avec une explication distincte (« The deadline has passed and the settlement can no longer be completed »). Un prêt échu avec `modelCid` ET `runnerReceipt` garde « Finaliser le règlement » et n'a pas de Refund. (Correction demandée par la coordination avant fusion de la PR.)
3. **Self training : la page ne décide rien.** `GET /api/admin/me` est indicatif ; la protection reste celle des routes (slice N5). Un échec de cette route (réseau, 401, 500) laisse `admin = null` : ni self training ni encart de contact, plutôt que d'afficher l'encart à un administrateur sur une panne passagère. Seule la valeur exacte `admin === true` ouvre le self training.
4. **Un non-admin n'émet plus aucun appel à `/api/datasets` ni `/api/train`.** Sur une instance de démonstration Phala, `/api/train` reste ouvert aux visiteurs côté serveur, mais la page Train ne l'appelle plus pour eux ; le parcours de démonstration vit dans `/phala` et n'est pas modifié.
5. **Retrain = nouvel emprunt complet, flux existant.** Décision [01](01-decisions-avant-samedi.md) section 2 : la donnée est payée à nouveau plus le calcul. Le panneau affiche le prix de la fiche (`PriceBreakdown`, donnée + calcul = total, ou « indiqués dans le devis » si les frais de calcul sont inconnus), puis le bouton appelle `borrowDataset`, dont le devis signé (`ComputeQuoteDialog`) affiche le total exact avant toute approbation ou signature. Le prix de la fiche sert aussi de contrôle : `borrowDataset` refuse un devis dont le `datasetAmount` diffère. Aucune nouvelle transaction n'est créée.
6. **Retrain proposé seulement à l'emprunteur d'un prêt `SETTLED`.** `GET /api/loans` renvoie aussi les prêts où l'on est fournisseur ; un fournisseur ne voit pas le bouton sur le prêt d'un tiers.
7. **Avertissement de déterminisme complété.** Le texte commun `retrainDeterministic` (`DisclaimerNote`) ne contient que la première phrase du cahier ; la seconde (« Retrain only if the dataset has changed. ») est ajoutée à côté, sans modifier `src/lib/copy/disclaimers.ts`.
8. **Encart de contact.** Texte exigé : « Want to train on your own data? Contact us at sirius.data.contact@gmail.com. » Il utilise `DisclaimerNote` (sans messages communs, pour ne pas afficher `contactUs`, dont le texte est différent) et le lien `mailto:` de `contactMailtoHref()`.
9. **Avertissement qualité non ajouté.** Le cahier de la slice le laisse à une autre PR (encart en haut de page) pour limiter les conflits.
10. **Libellé « Refund »** remplace « Récupérer l'escrow » (cahier : bouton « Remboursement »). L'ancienne clé de traduction reste dans `english.ts`, inutilisée.
11. **Liens et texte de page non retouchés ailleurs.** Le tutoriel de la page (`src/lib/tour/content.ts`, hors périmètre) parle encore d'emprunter « un dataset du catalogue » : la marketplace est ce catalogue, le texte reste vrai mais mériterait une retouche (section 8).

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès côté serveur, route par route.** Aucune route n'est ajoutée ni modifiée. Les contrôles dont dépend la page :
- `GET /api/admin/me` : authentifiée (`requireAuth`), `{ admin }` via `adminAllowed`, `cache-control: no-store` (N5, inchangée). La page n'en tire que l'affichage.
- `GET /api/datasets`, `GET /api/train`, `POST /api/train`, `POST /api/train/[id]/key` : gardées côté serveur par `assertSelfTrainingAccess` (N5). Vérifier qu'un wallet non admin qui appelle ces routes à la main reçoit toujours 403 (hors démonstration Phala) : la page ne le garantit pas, elle ne fait que ne plus les appeler.
- `GET /api/loans` : filtre `borrower` OU `provider` = session ; renvoie `refundable` calculé côté serveur (statut actif et échéance dépassée). Inchangée.
- `POST /api/loans/[id]/cancel` : `cancelExpiredLoan` revérifie l'emprunteur, le statut actif, l'échéance on-chain, la portée de l'escrow, et ne renvoie qu'une transaction à signer par le wallet. C'est la seule garde réelle du remboursement ; la règle d'interface n'est qu'un second verrou.
- `POST /api/loans`, `/authorize`, `/submit` : inchangées, appelées par `borrowDataset` (KYB, plafonds, devis signé côté serveur).
- `GET /api/marketplace/[id]` : publique, 404 uniforme hors annonce en ligne.

**Où tombe la règle « le remboursement n'est jamais proposé à tort ».** `canRefund` dans `src/lib/train/loan-display.ts` : statut `ESCROWED`, `TRAINING` ou `SETTLING`, ET `refundable === true` strictement (un `"true"` ou un `1` ne passent pas), ET `settleTxHash`, `cancelTxHash` vides, ET (`modelCid` vide, OU `modelCid` posé sans `runnerReceipt` : secours), ET `evmLoanKey` présent, ET `borrower` égal à l'adresse connectée (comparaison par `addressesEqual`, insensible à la casse, fausse si l'une des adresses est invalide). `refundLoan` dans la page relit `canRefund` au clic, refuse un double clic (verrou par `useRef`) et refuse pendant qu'un job de ce prêt tourne dans l'onglet. À relire en priorité : la table de vérité de `loan-display.test.ts` (test « Rembourser et état échoué restent cohérents », qui énumère 2 × 2 × 2 × 2 × 8 combinaisons).

**Validation et bornes des entrées.** Aucune saisie utilisateur nouvelle. Les valeurs venues de l'API sont traitées comme non fiables : statut inconnu donne « État inconnu » et aucun bouton ; `admin` autre que `true` donne non-admin ; `borrower` absent ou invalide donne ni Retrain ni Refund ; montants affichés par `PriceBreakdown`, qui refuse les montants mal formés (« — » plutôt qu'un montant approché).

**Fuites possibles.** `GET /api/loans` renvoie la ligne `Loan` complète (champs d'attestation compris) au fournisseur et à l'emprunteur : comportement préexistant, la page n'affiche pas de champ de plus. Les messages d'erreur passent par `messageOf` et `t()` comme avant. Aucun journal ajouté. Pour un non-admin, la liste des jobs de self training n'est plus demandée du tout.

**Argent, escrow, contrats, moteur Phala.** Aucune transaction nouvelle, aucun changement de contrat, de montant ni de moteur. Le Retrain réutilise `borrowDataset` à l'identique (devis signé, total confirmé, approbation du total exact puis lock) ; le remboursement réutilise `cancelExpiredLoan` (`refund(loanKey)` signé par l'emprunteur, puis confirmation serveur). À vérifier : que le prix affiché dans le panneau Retrain (fiche publique, dernier devis connu) n'est jamais celui qui est payé ; seul le devis signé fait foi. Un écart de prix entre la fiche et le devis arrête le parcours avant toute signature (« Prix du dataset modifié » dans `borrowDataset`).

**Base de données.** Aucune migration, aucun schéma, aucune requête nouvelle.

**Interface : injection, liens.** Tout est rendu par React (échappé). Seul lien externe : `mailto:` construit à partir de la constante `CONTACT_EMAIL` par `contactMailtoHref()` (sans objet, sans contenu utilisateur). Les noms de datasets viennent de la base et sont affichés comme texte dans des titres, comme avant. Lien interne ajouté : `/marketplace`.

**Textes : promesses sur les modèles ou la sécurité.**
- « Linear and logistic regression are deterministic: retraining on the same data gives the same model. Retrain only if the dataset has changed. » : vrai pour les deux modèles du registre aujourd'hui ; à revoir quand un modèle non déterministe arrive.
- Explication du remboursement : « The refund returns everything you paid except, where applicable, the compute actually consumed, as measured by the enclave. » Formulation prudente (« le cas échéant ») car un escrow historique sans devis ne retient rien. Le texte du devis v7 (déjà en place) dit la même chose.
- « Un réentraînement est un nouvel emprunt complet : la donnée et le calcul sont payés à nouveau. » : conforme à la décision [01](01-decisions-avant-samedi.md).

### 4. Cas limites à essayer à la main sur staging

Prérequis : deux wallets, A (non admin, emprunteur) et B (dans `SIRIUS_ADMIN_ADDRESSES`) ; un dataset en ligne.

1. **Non-admin.** Se connecter avec A, ouvrir `/train`. Attendu : aucun catalogue, aucune section « My data », encart « Want to train on your own data? Contact us at sirius.data.contact@gmail.com. » (le lien ouvre un message vers cette adresse). Dans l'onglet réseau du navigateur : aucun appel à `/api/datasets` ni `/api/train`, un appel à `/api/admin/me`.
2. **Admin.** Se connecter avec B. Attendu : section « My data » (self training) visible, pas d'encart de contact.
3. **Panne de `/api/admin/me`.** Bloquer cette route dans les outils du navigateur et recharger avec B. Attendu : ni self training ni encart. Débloquer et recharger : le self training réapparaît.
4. **États.** Avec A : lancer un emprunt, constater « Payment awaiting finality » après l'envoi du lock, « In progress » une fois l'escrow confirmé et pendant l'entraînement, « Payment awaiting finality » pendant le règlement (SETTLING), « Completed » ensuite.
5. **Retrain.** Sur l'emprunt « Completed » : l'avertissement de déterminisme est visible avant tout clic. Cliquer « Retrain » : le prix de la fiche (donnée, calcul, total) s'affiche. « View the quote and retrain » ouvre le devis signé avec le total. Annuler : aucune transaction wallet, un prêt `PENDING` reste (il est annulé par le réaper après 10 minutes) et s'affiche « In progress », sans confirmation « emprunt déjà en cours » au Retrain suivant. Accepter : nouvel emprunt complet, nouvelle carte.
6. **Retrain sur un dataset retiré.** Mettre le dataset en pause ou privé, ouvrir « Retrain ». Attendu : « This dataset is no longer available to borrow: retraining is not possible. », bouton désactivé.
7. **Fournisseur.** Avec le wallet fournisseur du dataset, sur `/train` : le prêt de A apparaît (comportement préexistant), sans « Retrain » ni « Refund ».
8. **Remboursement, cas positif.** Prêt `ESCROWED` dont l'échéance est dépassée sans job réussi (réduire le délai sur staging ou attendre). Attendu : état « Failed », bouton « Refund » et explication (« Training failed: no model was delivered. … »). Cliquer : le wallet demande `refund(loanKey)`, puis l'état devient « Refunded ». Un double clic rapide ne doit envoyer qu'une transaction.
9. **Remboursement, cas négatifs.** Aucun bouton « Refund » : sur un prêt dans son délai (même si le job vient d'échouer) ; sur un prêt « Completed » ; sur un prêt « Refunded » ; sur un prêt échu avec `modelCid` posé (capsule prête) ; chez le fournisseur.
10. **Prêt échu avec capsule prête.** Un prêt `TRAINING` avec `modelCid` et `runnerReceipt`, échu : « Finaliser le règlement » est proposé, pas « Refund ». Le même prêt échu avec `modelCid` mais sans `runnerReceipt` : état « Failed », bouton « Refund » de secours et explication « settlement can no longer be completed ».
11. **Changement de wallet en cours de Retrain.** Ouvrir le panneau, changer de compte dans le wallet. Attendu : la page se remonte, le panneau disparaît, aucune transaction.
12. **Démo Phala.** Ouvrir `/phala` (instance de démonstration) : parcours inchangé ; le lien « Standard training » mène à `/train`.
13. **Langue.** Tous les nouveaux textes sont en anglais ; aucun libellé français visible (les états, l'encart, Retrain, Refund).

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

**Unitaires** (`src/lib/train/loan-display.test.ts`, dans le script `test`, 15 tests) : un état par statut ; statut inconnu, vide ou en minuscules ; libellés et variantes de chaque état ; Refund proposé dans les cas valides (casse d'adresse différente, `TRAINING`, `SETTLING`) ; Refund refusé à un tiers, au fournisseur, sans wallet, sans `borrower`, avec une adresse invalide ; Refund refusé si `refundable` n'est pas strictement `true` (`undefined`, `"true"`, `1`) ; Refund refusé avec `modelCid`, `settleTxHash` ou `cancelTxHash`, pour un prêt `SETTLED`, `CANCELLED`, `PENDING`, `SUBMITTING`, de statut inconnu, ou sans `evmLoanKey` ; test de cohérence qui énumère toutes les combinaisons (statut, `refundable`, `modelCid`, `settleTxHash`, `cancelTxHash`) et vérifie que `canRefund` vrai implique « échoué » et aucune trace de modèle ; Retrain proposé sur `SETTLED` réglé de l'emprunteur seulement ; détection d'un autre emprunt actif (PENDING sans lock ignoré) ; `parseAdminResponse` ; traduction anglaise de chaque libellé d'état. `src/lib/i18n/english.test.ts` passe (clés statiques, paramètres).

**e2e** (Playwright, port 3217 en local) :
- `e2e/train.spec.ts` (nouveau, 6 tests) : non-admin sans catalogue ni self training, encart exact, aucun appel `/api/datasets` ni `/api/train` ; réponse `/api/admin/me` en erreur ; admin garde le self training ; états lisibles ; Retrain seulement sur l'emprunt terminé de l'emprunteur, avec l'avertissement à côté ; Refund seulement sur l'échec sans modèle, avec l'explication, et absent dans six cas négatifs.
- `e2e/billing-v7.spec.ts` : I5 et I8 adaptés (champ `borrower`, bouton « Refund », envoi de `refund(loanKey)`), nouveau test « N4 : Retrain » (prix de la fiche, `POST /api/loans` avec le seul `datasetId`, devis avec le total 8.75 USDC, annulation sans aucune transaction).
- `e2e/responsive.spec.ts` : fixtures avec `borrower` et hash, `/api/admin/me` simulé admin, catalogue absent, Refund et Retrain dans le contrôle de mise en page à sept largeurs.
- `e2e/audit-regressions.spec.ts` : mocks admin ; la pagination ne concerne plus que les datasets de l'équipe.

**Ce que les tests ne couvrent pas.** Aucun test d'intégration contre un vrai serveur ni une vraie chaîne : le remboursement signé on-chain n'est vérifié que par simulation (billing-v7 I8, déjà là). Pas de test du comportement sur une instance de démonstration Phala réelle (`/phala` n'est pas modifié). Pas de test de focus clavier ni de lecteur d'écran. Les sélecteurs e2e de carte reposent sur la profondeur DOM de `Card` (`locator("../../../..")`), fragile à un changement de structure.
### 6. Hypothèses

- `refundable` (serveur) signifie « statut actif et `evmDeadline` dépassé » ; la slice n'a pas relu l'échéance on-chain côté interface.
- Un prêt `SETTLING` a toujours un `modelCid` (posé quand le prêt passe à `TRAINING`) : il n'est donc jamais « échoué sans modèle » et le remboursement n'y est jamais proposé.
- Le réaper serveur ne règle ni ne rembourse on-chain un prêt échu (il resynchronise seulement la base avec la chaîne, vérifié dans `reaper-policy.ts`) : c'est pourquoi le remboursement de secours existe.
- `GET /api/marketplace/[id]` renvoie `providerPriceAtomic` identique au prix qui sera dans le devis ; sinon `borrowDataset` arrête le parcours (c'est voulu).
- `adminAllowed` et les routes de self training se comportent comme décrit dans [10](10-self-training.md) (N5) : non vérifié ici, la slice ne les modifie pas.
- Le statut `CANCELLED` sans `cancelTxHash` est un prêt abandonné ou en cours de réconciliation, jamais un remboursement réussi.
- Sur la production, `/api/marketplace/[id]` est joignable depuis la page Train (même origine).

### 7. Risques résiduels et limites connues

1. **Prêt échu avec capsule prête : corrigé.** Un prêt échu avec `modelCid` et sans `runnerReceipt` avait perdu tout bouton (fonds bloquables). Il a maintenant le « Refund » de secours (`isOverdueWithoutReceipt`, `canRescueRefund`). Avec `runnerReceipt`, « Finaliser le règlement » reste la seule action ; si ce règlement tardif était refusé en boucle (clé non livrable après l'échéance), l'emprunteur n'aurait pas de remboursement dans l'interface : cas résiduel, à confirmer avec le contrat (un `refund` serait accepté par `/cancel`).
2. **État « Paiement en attente de finalité » pour `SETTLING`.** Le cahier ne dit pas si cet état désigne le verrouillage ou le règlement ; la slice couvre les deux. Le message d'attente de finalité réseau (15 à 30 minutes) reste affiché par l'erreur d'`resumeLoanSettlement`.
3. **Prix de la fiche différent du devis.** Pendant un Retrain, si le prix change après l'ouverture du panneau, `borrowDataset` lève « Dataset price changed. Reload the catalog. » : le catalogue n'est plus sur cette page, le message est imprécis ; fermer et rouvrir le panneau suffit.
4. **Erreurs du Retrain** s'affichent dans la bannière en haut de page (désormais `role="alert"`), pas dans le panneau, qui peut être loin en bas.
5. **Un prêt `PENDING` créé par un Retrain annulé** reste visible jusqu'à son annulation par le réaper (10 minutes) : « In progress » sans paiement envoyé. Comportement hérité du parcours d'emprunt (le prêt est créé avant le devis).
6. **Boutons de job pour un fournisseur.** Un fournisseur qui voit le prêt d'un tiers peut encore voir les boutons « Lancer le job », « Réconcilier » existants (ils échouent côté serveur, `assertOwner`) : comportement préexistant non corrigé, hors périmètre.
7. **Tests unitaires sous Windows.** Voir section 9 : 72 échecs de tests existants en environnement Windows, sans lien avec les fichiers de la slice ; à confirmer sur la CI Linux.

### 8. Reste à faire

| Priorité | Quoi |
|---|---|
| ~~P1~~ fait | Prêt échu avec capsule prête : remboursement de secours sans `runnerReceipt` (test unitaire et e2e ajoutés). Reste P2 : proposer aussi un secours quand le règlement tardif avec reçu échoue en boucle. |
| P1 | Page Certificat, bouton « Certificat » par entraînement terminé, statistiques d'entraînement : autre slice ([09](09-train-et-certificat.md)). |
| P2 | Retoucher le tutoriel de la page Train (`src/lib/tour/content.ts`) : il parle encore d'emprunter « un dataset du catalogue ». |
| P2 | Masquer les boutons d'action de job (« Lancer le job », « Réconcilier », « Finaliser ») au fournisseur qui ne les peut pas utiliser. |
| P2 | Remplacer les sélecteurs e2e `locator("../../../..")` par un `data-testid` sur la carte de prêt. |
| P2 | Message d'écart de prix adapté à la page Train (au lieu de « Reload the catalog »). |
| P3 | Page dédiée `/admin/self-training` ([10](10-self-training.md), après le 6). |

### 9. Résultats des vérifications

Environnement : Windows 11, Node 22.16.0, pnpm 11.18.0 (`npx -y pnpm@11.18.0 --config.script-shell=bash`), `DATABASE_URL=postgresql://x:y@localhost:5432/z`, branche `feat/train` après fusion de `origin/staging` (deux fusions, à chaque fois en conflit sur la liste du script `test` de `package.json` ; la seconde aussi sur `english.ts` : les imports et propagations de `settings-en` et de `train-en` sont conservés ensemble).

| Commande | Résultat |
|---|---|
| `pnpm install --frozen-lockfile` | `Done in 1m 32s using pnpm v11.18.0` au premier passage ; `Already up to date` après la fusion ; `postinstall: ✔ Generated Prisma Client (7.8.0)` |
| `pnpm exec prisma generate` | `✔ Generated Prisma Client (7.8.0) to .\src\generated\prisma`, code 0 |
| `pnpm exec tsc --noEmit` | code 0, aucune erreur |
| `pnpm lint` | code 0, aucune remarque |
| `node --import tsx --test src/lib/train/loan-display.test.ts` | `# tests 15`, `# pass 15`, `# fail 0` |
| `node --import tsx --test src/lib/i18n/english.test.ts` | `# tests 7`, `# pass 7`, `# fail 0` |
| `pnpm test` (après `pnpm datasets:generate`) | `# tests 743`, `# pass 671`, `# fail 72`. Les 72 échecs sont tous de l'environnement Windows et aucun ne touche la slice : tests qui comparent des chemins en `/` à des chemins en `\` (`self-training-routes.test.ts`, `disclaimers.test.ts`, graphe d'imports), tests du registre anti-rejeu et des volumes du runner, budget Phala. `loan-display.test.ts` et `english.test.ts` passent. Le nombre d'échecs est le même (72) avant et après chacune des deux fusions avec `staging`. Non rejoué sur Linux : la CI est le juge. `pnpm datasets:generate` réécrit les CSV d'exemple (fins de ligne Windows) : ils ont été remis à l'état du dépôt avant le commit. |
| `pnpm audit:deps` | `2 vulnerabilities found`, `Severity: 1 low \| 1 high (1 ignored)`, même état que `staging`, aucune dépendance ajoutée |
| `pnpm test:e2e` (Playwright, port 3217 au lieu de 3100, config temporaire supprimée ensuite) | `111 passed (57.3s)` après la seconde fusion (le total suit les tests de `staging`), dont les 6 de `e2e/train.spec.ts`, le nouveau test Retrain de `billing-v7.spec.ts`, et les suites `responsive`, `audit-regressions`, `marketplace`, `documentation` ; premier passage avant fusion : `103 passed (55.9s)` |
| `git diff --name-only staging...HEAD` | `docs/passage-mainnet/audit.md`, `e2e/audit-regressions.spec.ts`, `e2e/billing-v7.spec.ts`, `e2e/responsive.spec.ts`, `e2e/train.spec.ts`, `package.json`, `src/app/(app)/train/page.tsx`, `src/components/train/RetrainPanel.tsx`, `src/lib/i18n/english.ts`, `src/lib/i18n/train-en.ts`, `src/lib/train/loan-display.test.ts`, `src/lib/train/loan-display.ts`. Aucun fichier interdit. |
| `git log staging..HEAD --format=%B` passé au crible des motifs de signature d'assistant (nom de l'assistant, ligne de co-auteur, mention de génération automatique, lien de session) et de `[skip ci]` | aucune occurrence ; aucun fichier ni dossier de configuration d'assistant versionné (`next dev` en recrée en local pendant les e2e : ils sont ignorés globalement et absents de `git status`) |

Non lancés : `pnpm build`, `pnpm test:phala-demo`, `pnpm test:operations`, `pnpm test:postgres`, `pnpm contracts:test`, `pnpm test:billing` (hors périmètre de la slice, aucun fichier concerné modifié ; la CI les exécute).

### 10. Revue interne de la session

Deux passes de revue adversariale par des agents de revue indépendants (lecture seule), plus une relecture personnelle. Fichiers relus : `page.tsx`, `loan-display.ts`, `RetrainPanel.tsx`, `train-en.ts`, e2e.

**Passe 1.** Rien trouvé sur un remboursement ou un Retrain proposé à tort. Corrigé :
- Un prêt `PENDING` sans hash de lock (devis refusé) était présenté comme « paiement en attente de finalité » et déclenchait la confirmation « emprunt déjà en cours » : il est désormais « En cours » et ignoré par `hasOtherActiveLoan`. Tests ajoutés.
- Une erreur d'actualisation après un Retrain réussi s'affichait comme un échec de l'emprunt : `onBorrowed` est sorti du `try`, son erreur est ignorée.
- Une erreur de `/api/admin/me` faisait afficher l'encart de contact à un admin : l'état reste `null` (ni self training ni encart).
- Le texte de remboursement promettait une retenue de calcul dans tous les cas : adouci (« where applicable »), test e2e adapté.
- Le bouton « Refund » restait actif pendant un job TEE du même prêt, et son double clic reposait sur un état React asynchrone : désactivation pendant le job, verrou `useRef`, `canRefund` relu au clic.

**Passe 2.** Rien de nouveau sur le remboursement indu, les erreurs avalées ou les textes. Corrigé : `role="alert"` sur la bannière d'erreur de la page (les erreurs du Retrain n'étaient pas annoncées), `autoFocus` sur le bouton de confirmation à l'ouverture du panneau.

**Écarté ou reporté.**
- Perte du retour de focus au bouton « Retrain » après « Cancel » : mineur, non traité.
- Sélecteurs e2e à profondeur DOM fixe : reporté (section 8). Le cas e2e « échu avec `modelCid` sans `runnerReceipt` » est désormais couvert.
- Perte du bouton de remboursement pour un prêt échu avec capsule prête, signalée par les deux passes puis par la coordination (le réaper ne rembourse pas) : corrigé par le remboursement de secours sans `runnerReceipt` (section 2, point 2).
- Message « Reload the catalog » imprécis sur cette page : reporté (P2).

Troisième relecture après les derniers correctifs : aucun nouveau problème.

---

## N5 — Self training réservé à l'équipe

Branche `feat/self-training-admin`, PR vers `staging`. Périmètre : contrôle **côté serveur** uniquement. Le masquage dans l'interface (`src/app/(app)/**`, `src/components/**`) est fait par une autre session et n'est pas couvert ici.

### 1. Ce qui a changé

Aucune table, aucune colonne, aucune migration, aucun composant d'interface.

**Nouveaux fichiers**

- `src/lib/auth/admin.ts` : `adminAddresses(configured)` et `adminAllowed(address, configured)`. Lit `SIRIUS_ADMIN_ADDRESSES` par défaut (paramètre `configured` injectable pour les tests). Normalise avec `tryNormalizeAddress` de `src/lib/evm/address.ts` (la brique du projet : trim, `isAddress` non strict, minuscules), refuse l'adresse nulle, dédoublonne, plafonne à `MAX_ADMIN_ADDRESSES = 10`. Avertissement `console.warn` une seule fois par valeur mal formée, sans la valeur.
- `src/lib/sirius/self-training-access.ts` : `SELF_TRAINING_UNAVAILABLE = "Bientôt disponible"`, `phalaDemoInstance(env)`, `isDemoTrainingGrant(grant)`, `selfTrainingUnavailable()` (AppError 403) et la garde `assertSelfTrainingAccess(session, demoAccess = false)`.
- `src/app/api/admin/me/route.ts` : `GET`, `requireAuth` puis `{ admin: adminAllowed(session.address) }`, en-tête `cache-control: no-store`. Aucune base, aucun corps.
- `src/lib/auth/admin.test.ts` : tests unitaires de la liste.
- `src/lib/auth/self-training-routes.test.ts` : tests par inspection de source et par exécution des routes dans un bac à sable VM (même technique que `src/lib/audit-regressions.test.ts`).

**Fichiers modifiés**

- `src/app/api/train/route.ts` : `GET` appelle `assertSelfTrainingAccess(session, true)` juste après `requireAuth`, avant `prisma`. `POST` appelle `assertSelfTrainingAccess(session, true)` juste après `requireAuth` et avant `readJson`, puis `assertSelfTrainingAccess(session, isDemoTrainingGrant(authorization))` juste après `readJson` et avant la validation du corps, `assertAuthenticGrant` et `runSelfTrain`.
- `src/app/api/train/[id]/key/route.ts` : `POST` appelle `assertSelfTrainingAccess(session)` (admin seulement, pas d'exception démo) juste après `requireAuth`, avant le rate limiter, `params`, `readJson`, la base et le runner.
- `src/lib/i18n/errors-en.ts` : inchangé au final. Le message « Bientôt disponible » existait déjà dans `src/lib/i18n/english.ts` (« Coming soon ») ; le doublon ajouté dans un premier temps a été retiré après revue, et un test vérifie que `EN_MESSAGES` garde la clé.
- `docs/BACKUP-RECOVERY.md` : une phrase sur `SIRIUS_ADMIN_ADDRESSES` pour le script de reprise `ops:verify-model-delivery` (voir 2.13).
- `package.json` : `admin.test.ts` et `self-training-routes.test.ts` ajoutés au script `test`.
- `playwright.config.ts` : `SIRIUS_ADMIN_ADDRESSES` = adresse du wallet e2e (dérivée de la clé `0x11…11` de `e2e/helpers/wallet.ts`), dans `webServer.env` uniquement.
- `.env.example` : bloc `SIRIUS_ADMIN_ADDRESSES`.
- `docs/passage-mainnet/10-self-training.md` : en-tête « Fichiers » complété, section « Contrôle côté serveur (N5) ».
- `docs/passage-mainnet/audit.md` : cette section.

**Routes concernées et comportement pour un wallet authentifié hors équipe**

| Route | Hors démo (production, mainnet) | Instance de démo Phala (testnet) |
|---|---|---|
| `GET /api/train` | 403 `{ "error": "Bientôt disponible" }`, aucune lecture en base | 200, liste de ses propres jobs (inchangé) |
| `POST /api/train` | 403, **corps non lu** (un corps mal formé donne 403, pas 400/415) | corps lu ; 403 sauf si `authorization.payload.demoSessionRevision` est un entier strictement positif ; alors flux inchangé (grant authentifié, runner vérifie la session de démo) |
| `POST /api/train/[id]/key` | 403, corps non lu, rate limiter non touché | 403, idem (la démo livre ses clés par `/api/phala-demo/results/[id]`) |
| `GET /api/admin/me` | `{ "admin": false }` | `{ "admin": false }` |

Non authentifié : 401 « Authentification requise » par `requireAuth`, comme avant, sur toutes ces routes. « Instance de démo Phala » = exactement les conditions de `demoEnabled` (`SIRIUS_PHALA_DEMO=true`, `EVM_NETWORK=testnet`, `TEE_MODE=phala`, `DSTACK_SIMULATOR_ENDPOINT` vide), évaluées sans lever par `phalaDemoInstance`.

### 2. Décisions et écarts par rapport au cahier des charges

1. **Exception pour la démo Phala (écart le plus important, à relire en priorité).** Le cahier des charges demande 403 pour tout wallet non admin. Or la démo publique « Test Phala » ([12](12-test-phala.md) : « On la garde ») est elle-même un self training sur ses propres données et passe par `GET /api/train` (liste des jobs dans `src/components/phala-demo/PhalaDemo.tsx`) et `POST /api/train` (`src/lib/phala-demo/training-client.ts`). Une garde sans exception aurait fermé la démo à tous les visiteurs, et aucun test e2e ne l'aurait vu (ils simulent toute l'API). L'exception est volontairement étroite : (a) l'instance doit réunir les conditions de `demoEnabled` (`SIRIUS_PHALA_DEMO=true`, `EVM_NETWORK=testnet`, `TEE_MODE=phala`, pas de simulateur dstack), ce qui est impossible en production mainnet (`requiresPhalaRunner` dans `src/lib/runner/config.ts` refuse déjà la démo hors testnet au démarrage, et `phalaDemoInstance` l'exige une seconde fois) ; (b) seules la liste des jobs et un `POST` porté par un grant de démo (`payload.demoSessionRevision` entier strictement positif : la première ouverture de session porte la révision 1) sont ouverts ; (c) la livraison de clé reste réservée à l'équipe partout. Conséquence à connaître : **sur staging, qui est l'instance de démo (`SIRIUS_PHALA_DEMO=true` d'après `docs/PHALA-DEMO-IMPLEMENTATION.md`), un wallet non admin peut toujours lancer un entraînement sur ses propres données en forgeant un grant avec `demoSessionRevision`**, exactement comme la démo le fait aujourd'hui ; le runner le refuse si la session de démo est fermée (`checkDemoOperation`, `withDemoAdmission` dans `src/lib/phala-demo/runner-session.ts`). Si l'équipe préfère fermer complètement le self training sur staging, il suffit de retirer `SIRIUS_PHALA_DEMO` de staging ou de supprimer les deux `demoAccess=true` ; la démo cesse alors de fonctionner.
2. **`GET /api/train` est gardé** bien que le cahier des charges cite surtout les routes d'action : la liste des jobs révèle l'existence de la fonction et des données d'entraînement. La page `/train` tolère déjà un `GET` en échec (`jobsRes.ok ? … : []` dans `src/app/(app)/train/page.tsx`, non modifié) : aucun message d'erreur visible pour un non-admin.
3. **Liste fermée par défaut** : une seule entrée invalide refuse toute la liste, comme `operatorAllowed`. Alternative écartée : ignorer l'entrée invalide et garder les autres, parce qu'une liste partiellement lue est plus difficile à auditer qu'un refus franc et visible dans les journaux.
4. **Plafond de dix adresses**, repris d'`operatorAllowed`. Au-delà, la liste est refusée.
5. **Casse** : toute casse acceptée dans la variable et dans la session, préfixe `0X` compris (mis en minuscules avant `tryNormalizeAddress`, qui n'accepte que `0x`), comparaison en minuscules, conformément à la règle du projet dans `src/lib/evm/address.ts`. La somme de contrôle EIP-55 n'est pas vérifiée (comme partout ailleurs dans le projet) : une adresse en casse mixte avec une somme fausse est acceptée si ses 40 hexadécimaux sont les bons.
6. **Message** : « Bientôt disponible » (anglais « Coming soon »), sans le mot « self training », « admin » ni « réservé ». Même message pour toutes les routes et pour une liste vide ou mal formée.
7. **Premier refus avant la lecture du corps** sur `POST /api/train` et `POST /api/train/[id]/key` : un non-admin hors démo ne reçoit jamais les messages 400/415 qui décriraient le format attendu. Sur l'instance de démo, le corps doit être lu pour reconnaître un grant de démo : un non-admin y voit donc les 400/415 habituels (comportement d'aujourd'hui).
8. **Pas de journalisation des refus** (qui, quand). Le cahier [15](15-dashboard-admin.md) demande la journalisation des actions d'admin pour V1.2, pas des refus ; non fait ici pour éviter un journal inondé par des appels directs.
9. **`/api/admin/me` répond 401 sans session**, pas `{ admin: false }` : conforme à « protégée par requireAuth ». L'interface devra traiter 401 comme « pas admin ».
10. **Emplacement** : `adminAllowed` dans `src/lib/auth/` (demandé) ; la garde spécifique au self training dans `src/lib/sirius/`, à côté de `self-train.ts`, pour que l'inspection de source puisse exiger qu'elle ne serve qu'aux routes de self training.
11. **`runSelfTrain` (la fonction de `src/lib/sirius/self-train.ts`) n'est pas gardée elle-même**, seulement ses routes. `scripts/test/postgres-worker.ts` l'appelle directement pour les tests d'intégration Postgres ; une garde dans la fonction aurait exigé la variable dans cet environnement. Le test par inspection vérifie qu'aucun autre fichier de `src/` n'importe ce module.
12. **Wallet e2e admin** via `playwright.config.ts` (`webServer.env`), pas via un fichier `.env` : la valeur ne concerne que le serveur de test local. Les e2e actuels simulent toute l'API (`page.route("**/api/**")` dans `e2e/helpers/wallet.ts`) et n'atteignent pas les routes réelles ; la déclaration sert si un e2e futur les atteint.
13. **Script de reprise `scripts/operations/verify-model-delivery.ts`** (runbook `docs/BACKUP-RECOVERY.md`) : trouvé par la revue adversariale. Il se connecte en HTTP avec l'adresse dérivée de `MEZO_DEPLOYER_KEY` et appelle `GET /api/train` puis `POST /api/train/[id]/key`. Avec la garde, si cette adresse n'est pas dans `SIRIUS_ADMIN_ADDRESSES` de l'instance interrogée, la requête reçoit 403 et le script s'arrête : l'erreur interne « Requête refusée » est avalée par son `catch` final, la seule sortie est un diagnostic JSON sur stderr (`phase`, `verified: false`) et `failurePhase` + `httpStatus: 403` dans `report.json`. Seuls les modèles d'entraînement de l'inventaire passent par les routes gardées ; les prêts passent par `/api/loans`. Choix : ne pas modifier le script (hors périmètre, couvert par ses propres tests) ; documenter la dépendance dans `.env.example`, `10-self-training.md` et `BACKUP-RECOVERY.md`. L'ancienne instance historique visée par le runbook ne porte pas ce code tant qu'elle n'est pas redéployée.
14. **`phalaDemoInstance` ne réutilise pas `demoEnabled`** (`src/lib/phala-demo/runner-session.ts`), qui lève des 503 explicites sur une configuration incomplète : ici une configuration incomplète ferme simplement l'exception, sans message qui révélerait l'instance. Les conditions sont les mêmes ; un test les fixe.
15. **Pas de traduction nouvelle** : « Bientôt disponible » existait dans `english.ts`. Le cahier des charges demandait une traduction dans `errors-en.ts` pour toute chaîne nouvelle ; la chaîne n'étant pas nouvelle, le doublon a été retiré.

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès côté serveur, route par route**

- `src/app/api/train/route.ts` `GET` : `requireAuth` → `assertSelfTrainingAccess(session, true)` → `prisma`. Rien entre les deux.
- `src/app/api/train/route.ts` `POST` : `requireAuth` → `assertSelfTrainingAccess(session, true)` → `readJson` → `assertSelfTrainingAccess(session, isDemoTrainingGrant(authorization))` → validation du corps → `assertAuthenticGrant` → `runSelfTrain`. Vérifier qu'un `demoSessionRevision` dans le grant n'ouvre rien d'autre que cette garde : le grant est ensuite authentifié (`assertAuthenticGrant` : sujet = wallet connecté, signatures) et le runner contrôle la session de démo. Un grant forgé est refusé par `assertAuthenticGrant` avant tout appel runner, comme avant la slice.
- `src/app/api/train/[id]/key/route.ts` `POST` : `requireAuth` → `assertSelfTrainingAccess(session)` → rate limiter → … Aucune exception démo.
- `src/app/api/admin/me/route.ts` : `requireAuth` → `adminAllowed(session.address)`. Vérifier que la réponse n'est pas mise en cache (`no-store`) et qu'elle ne révèle pas la liste.
- `src/lib/sirius/self-training-access.ts` : `adminAllowed(session.address)` d'abord ; l'exemption ne s'applique que si `demoAccess && phalaDemoInstance()`. `phalaDemoInstance` lit `process.env` à chaque appel (pas de cache) et exige exactement `"true"` et `"testnet"`.
- Aucun autre fichier de `src/` n'importe le module `self-train` (import statique, réexport, `import()` ou `require`, alias ou chemin relatif) ; `selfTrainModelKeyInRunner` n'apparaît que dans `src/lib/tee/runner-client.ts` (définition) et `src/app/api/train/[id]/key/route.ts` (appel) ; `runSelfTrainingInRunner` que dans `src/lib/tee/runner-client.ts` et `src/lib/sirius/self-train.ts` ; `assertSelfTrainingAccess` n'est appelée que par les routes : vérifié par le test d'inspection sur l'arbre syntaxique, à revérifier à la main avec `grep -rn "sirius/self-train" src`, `grep -rn selfTrainModelKeyInRunner src` et `grep -rn runSelfTrainingInRunner src`.
- Aucun contournement par appel direct : les trois routes sont les seuls points d'entrée HTTP vers le self training. `scripts/test/postgres-worker.ts` appelle `runSelfTrain` en code, dans les tests Postgres seulement. `scripts/operations/verify-model-delivery.ts` passe lui par HTTP (`GET /api/train`, `POST /api/train/[id]/key`) avec l'adresse de `MEZO_DEPLOYER_KEY` : il est soumis à la garde comme n'importe quel client, et doit donc être exécuté avec une adresse admin (2.13).
- Le runner (`src/runner/**`, non touché) n'a pas de notion d'admin : il n'est joignable que par Next (`RUNNER_TRANSPORT_SECRET`) et par le contrôleur. La garde ne protège donc que l'entrée HTTP de Next ; c'est le périmètre demandé.

**Variable `SIRIUS_ADMIN_ADDRESSES`**

- Vide, absente, espaces seuls → `[]` → personne.
- `a,b` valides → les deux ; casse indifférente ; doublons fusionnés ; espaces autour des virgules tolérés.
- Une entrée invalide, l'adresse nulle, `a,` (virgule finale), `,a`, `a,,b`, séparateur `;` ou espace, plus de dix entrées → `[]` → personne, avertissement console `[admin] SIRIUS_ADMIN_ADDRESSES mal formée : aucune adresse n'est administratrice` une fois par valeur.
- Préfixe `0X` accepté dans la variable comme dans l'adresse comparée (mis en minuscules avant validation).
- La variable n'est lue qu'au moment de l'appel (pas de cache de la liste) : un changement d'environnement prend effet au redéploiement, comme toute variable Vercel.

**Fuites**

- Message 403 identique pour : non admin, liste vide, liste mal formée, instance de démo sans grant de démo. Aucun indice sur la raison.
- Les codes 400/415 du corps ne sont jamais atteints par un non-admin hors démo (corps non lu).
- Journaux : seul l'avertissement de variable mal formée, sans valeur ni adresse. Les refus ne sont pas journalisés.
- `/api/admin/me` : un booléen, rien d'autre.

**Argent, escrow, contrats, moteur Phala**

- Aucune transaction, aucun appel contrat. Le refus intervient avant `assertAuthenticGrant` et avant tout appel runner : aucun budget runner consommé, aucun échec compté dans le coupe-circuit du runner.
- Le self training n'a jamais eu d'escrow (propriétaire = emprunteur) : pas d'impact financier.

**Base de données** : aucune lecture avant le refus (vérifié dans le bac à sable : `findMany`/`findUnique` jamais appelés pour un non-admin). Aucune migration.

**Interface** : hors périmètre ; voir la slice de masquage. Point de coordination : l'interface pourra appeler `GET /api/admin/me` (401 = pas admin) ; `GET /api/train` renvoie 403 aux non-admins, ce que `src/app/(app)/train/page.tsx` et `PhalaDemo.tsx` tolèrent déjà sans erreur affichée.

**Textes** : « Bientôt disponible » ne promet rien ; la doc 10 décrit exactement le code.

### 4. Cas limites à essayer à la main sur staging

Préparer deux wallets : A (dans `SIRIUS_ADMIN_ADDRESSES` de staging) et B (absent). Se connecter et signer avec chacun. Rappel : staging est l'instance de démo Phala (`SIRIUS_PHALA_DEMO=true`, testnet), donc les lignes « démo » s'y appliquent ; pour tester le comportement « production », utiliser un déploiement de prévisualisation sans `SIRIUS_PHALA_DEMO`.

1. **B, non authentifié**, `curl -i https://STAGING/api/train` → 401 `{"error":"Authentification requise"}`.
2. **B, authentifié** (cookie de session du navigateur), `GET /api/train` → sur l'instance de démo : 200 `[]` (ou ses jobs de démo) ; hors démo : 403 `{"error":"Bientôt disponible"}`.
3. **B**, `POST /api/train` avec `Content-Type: text/plain` et corps `x`, en-tête `Origin` de staging → hors démo : 403 « Bientôt disponible » (pas 415) ; instance de démo : 415 « Content-Type application/json requis » (le corps est lu pour chercher un grant de démo).
4. **B**, `POST /api/train` JSON `{"datasetId":"x","jobId":"y","datasetReceipt":"z","authorization":{"payload":{"subject":"<B>"}}}` → 403 « Bientôt disponible » partout.
5. **B** sur la démo, même corps avec `"authorization":{"payload":{"subject":"<B>","demoSessionRevision":1}}` → passe la garde, puis 401 « Autorisation runner invalide » (délégation absente) ; avec un `subject` différent de B, 403 « Le grant runner ne correspond pas au wallet connecté ». Dans les deux cas aucun appel runner (vérifier le rapport de budget du runner : aucune opération, aucun échec compté).
6. **B**, `POST /api/train/<id>/key` avec n'importe quel corps → 403 « Bientôt disponible » partout, y compris sur la démo ; vérifier que le rate limiter n'a pas compté : 25 appels de suite dans la minute restent en 403, jamais 429 (le limiteur de la route autorise 20 appels par minute et par wallet : un admin qui en enchaîne 21 reçoit 429 au 21e).
7. **B**, `GET /api/admin/me` → 200 `{"admin":false}`, en-tête `cache-control: no-store`.
8. **A**, `GET /api/admin/me` → `{"admin":true}`. `GET /api/train` → 200 avec ses jobs. `POST /api/train` avec un corps incomplet → 400 « Requête d’entraînement incomplète » (preuve que la garde est passée).
9. **A écrit en casse mixte** dans la variable (forme EIP-55), session en minuscules → toujours admin.
10. **Variable mal formée** sur un déploiement de prévisualisation (`<A>,` avec virgule finale, ou `<A>;<B>`) → A reçoit 403 ; journaux du serveur : une ligne `[admin] SIRIUS_ADMIN_ADDRESSES mal formée`. Puis variable vide → A reçoit 403, pas d'avertissement.
11. **Démo Phala ouverte**, wallet B, parcours complet sur `/phala` (exemple, entraîner, télécharger) → fonctionne comme avant la slice.
12. **Démo Phala fermée**, wallet B, `POST /api/train` avec grant de démo signé par le parcours → refus du runner « Démonstration Phala fermée » (comportement d'avant la slice, inchangé).
13. **Page `/train`**, wallet B → aucune erreur visible liée à `GET /api/train` (la page traite le 403 comme une liste vide) ; l'encart de self training est masqué par l'autre slice.
14. **Script de reprise** `pnpm ops:verify-model-delivery` contre une instance portant ce code, avec un fichier d'environnement dont `MEZO_DEPLOYER_KEY` dérive une adresse hors `SIRIUS_ADMIN_ADDRESSES` → exit 1, rien sur stdout, un JSON sur stderr avec `verified: false` et `phase` « historique-proprietaire » (hors démo : arrêt dès `GET /api/train`) ou « livraison-cle » (instance de démo Phala : la liste passe, arrêt sur `POST /api/train/[id]/key`) ; `report.json` porte `failurePhase` et `httpStatus: 403` (le `httpStatus` du JSON stderr peut valoir 200, écrasé par la déconnexion finale). La chaîne « Requête refusée » n'apparaît nulle part : c'est une erreur interne du script. Avec l'adresse ajoutée à la variable → parcours complet comme avant.
15. **Instance de démo mal configurée** (prévisualisation avec `SIRIUS_PHALA_DEMO=true` et `TEE_MODE=stub`) → l'instance refuse de démarrer (`runnerEndpoint`, appelé au démarrage par `assertApplicationRunnerConfiguration` : dès que la démo est active, `RUNNER_URL` est obligatoire et `TEE_MODE=phala` sans simulateur exigé) ; si elle démarrait, `phalaDemoInstance` renverrait faux et B recevrait 403 partout.

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

`src/lib/auth/admin.test.ts` (8 tests) : liste valide, casse (variable et adresse, préfixe `0X` compris), espaces et doublons, liste vide/absente, douze formes invalides (chacune refuse toute la liste, un avertissement par valeur, sans la valeur dans le message), plafond de dix, adresses comparées invalides, lecture par défaut de `process.env`.

`src/lib/auth/self-training-routes.test.ts` (14 tests) :
- inspection de l'arbre syntaxique TypeScript (un commentaire ou une chaîne ne satisfait pas le contrôle) : la liste des routes sous `src/app/api/train` est exactement les deux attendues ; chaque handler exporté, qu'il soit déclaré `export async function`, `export function` ou `export const X = …` (une réexportation fait échouer le test), appelle la garde après `requireAuth`, sans expression `await` entre les deux, et avant tout appel à `prisma.*`, `readJson`, `assertAuthenticGrant`, `runSelfTrain`, `selfTrainModelKeyInRunner`, `enforceRateLimit`, `assertCurrentRunner`, `assertOwner` et toute lecture de `params` ; `GET`/`POST` passent `true` puis `isDemoTrainingGrant(authorization)` entre le corps et le grant, la route de clé passe `session` seul ; aucun autre fichier de `src/` n'importe le module `self-train` (statique, réexport, `import()`, `require`, alias ou relatif), n'utilise `selfTrainModelKeyInRunner` (liste exacte : `runner-client.ts`, route de clé) ni `runSelfTrainingInRunner` (liste exacte : `runner-client.ts`, `self-train.ts`), ni n'appelle `assertSelfTrainingAccess` hors des routes (importer le message `SELF_TRAINING_UNAVAILABLE` ailleurs reste permis, pour une future page « bientôt ») ; `src/runner/handler` (chemin runner en processus) n'est importé que par `src/lib/tee/runner-client.ts` ; la résolution des spécificateurs (alias `@/`, relatif, frère `./self-train`, extension) est elle-même testée sur une source synthétique ; les fichiers `route.(ts|tsx|js|mjs|cjs)` sont tous énumérés ; les handlers exportés par chaque module transpilé sont exactement ceux que l'inspection a vus ; `/api/admin/me` sans base ni corps ; message traduit et sans mot révélateur ; `phalaDemoInstance` et `isDemoTrainingGrant` sur leurs cas limites ;
- bac à sable VM (routes réelles transpilées, dépendances coûteuses remplacées par des enregistreurs, garde et liste réelles) : non admin hors démo refusé sur chaque route avec `[]` appels et `request.bodyUsed === false` ; admin accepté (variable et session en toute casse, `0X` compris) avec l'ordre `assertAuthenticGrant` puis `runSelfTrain` ; liste vide ou mal formée refuse même l'adresse attendue ; instance de démo : `GET` ouvert, `POST` ouvert seulement avec `demoSessionRevision` entier strictement positif (0, négatif, décimal, chaîne refusés, corps lu), clé fermée ; aucune exemption hors testnet, hors `TEE_MODE=phala`, avec simulateur ou avec un drapeau approximatif.

**Angles morts**

- Aucun test n'exécute les vraies routes Next avec une vraie session, un vrai `readSession` ni la vraie base : le bac à sable remplace `requireAuth`. La chaîne cookie → session → adresse n'est pas re-testée ici (couverte ailleurs).
- Les e2e Playwright n'atteignent pas les routes réelles ; la déclaration du wallet e2e dans `playwright.config.ts` n'est donc exercée par aucun test aujourd'hui.
- Le runner n'est pas exécuté : la vérification de `demoSessionRevision` contre la session ouverte reste couverte par `src/lib/phala-demo/runner-session.test.ts`, inchangé.
- La page `/train` et `PhalaDemo.tsx` ne sont pas testées face à un 403 (interface hors périmètre).
- Les tests par inspection reposent sur les noms `requireAuth`, `assertSelfTrainingAccess`, `readJson`, etc. : une réécriture qui renomme la garde ou lit le corps autrement doit mettre ces tests à jour. Un handler défini dans un autre fichier puis réexporté, ou exporté par déstructuration, fait échouer le test au lieu d'être inspecté.
- L'inspection syntaxique prouve la présence et l'ordre des appels, pas leur exécution : une garde placée dans une fermeture jamais appelée, ou une lecture du corps par `req.clone()` avant la garde, lui échapperaient. C'est le bac à sable qui porte la preuve d'exécution, et il n'exerce que les handlers existants : tout nouveau handler doit y être ajouté (le test « handlers inspectés = handlers exportés » signale au moins son apparition).
- `runSelfTrain` est aussi le nom de la fonction navigateur de `src/lib/train/client.ts` : le test épingle la liste exacte des fichiers qui l'utilisent, à mettre à jour sciemment.
- `scripts/operations/verify-model-delivery.ts` n'est pas exécuté contre les routes gardées (il cible une instance distante) ; seul son comportement attendu est documenté (4.14).

### 6. Hypothèses

- Staging déclare `SIRIUS_PHALA_DEMO=true`, `EVM_NETWORK=testnet`, `TEE_MODE=phala` sans simulateur (sinon `runnerEndpoint` refuse de démarrer l'instance) (d'après `docs/PHALA-DEMO-IMPLEMENTATION.md` et `PHALA-DEMO-RESTE-A-FAIRE.md`) ; non vérifié dans Vercel depuis cette session.
- La production mainnet ne déclare pas `SIRIUS_PHALA_DEMO=true` ; si elle le faisait, `requiresPhalaRunner` refuserait de démarrer (« La démonstration Phala exige le testnet ») et `phalaDemoInstance` renverrait de toute façon faux hors testnet.
- `session.address` est une adresse normalisée en minuscules à la connexion (`verifyLoginSignature` → `normalizeAddress`, puis `setSession`) et relue telle quelle par `readSession` ; la garde tolère de toute façon toute casse.
- Le grant de démo porte bien `payload.demoSessionRevision` (lu dans `src/lib/runner/authorization-contract.ts` et `training-client.ts` : `...await demoScope()` ajoute `demoSessionRevision` aux paramètres du grant) ; vérifié par lecture, pas par exécution du parcours.
- Les deux adresses de l'équipe seront renseignées dans Vercel (staging et production) avant la fusion : sans elles, personne n'accède au self training, ce qui est le comportement voulu par défaut.
- Les tests Postgres (`pnpm test:postgres`) et billing n'ont pas été lancés ici (pas de base ni de compilation Hardhat dans l'environnement) ; ils n'importent pas les routes modifiées.

### 7. Risques résiduels et limites connues

- **Sur staging, le self training reste techniquement accessible aux non-admins par un `POST` direct portant un grant de démo** (voir 2.1). Risque borné au testnet, à la session de démo ouverte, aux quotas de la démo ; identique à l'état antérieur.
- Une faute de frappe dans `SIRIUS_ADMIN_ADDRESSES` ferme l'accès à toute l'équipe (volontaire) ; le seul signal est un avertissement dans les journaux du serveur et `GET /api/admin/me` à `false`.
- Pas d'horodatage ni de journal des accès admin (prévu en V1.2 par [15](15-dashboard-admin.md)).
- Le masquage côté interface relève d'une autre slice ; tant qu'elle n'est pas fusionnée, un non-admin voit l'encart de self training et reçoit « Bientôt disponible » / « Coming soon » en cliquant.
- Le script de reprise `ops:verify-model-delivery` exige désormais une adresse admin sur l'instance interrogée ; un opérateur qui l'ignore ne voit qu'un diagnostic JSON générique (`verified: false`, `phase`) sans indication de cause ; seul `report.json` porte `httpStatus: 403`.
- L'exception démo repose sur quatre variables d'environnement ; une instance testnet qui activerait la démo par erreur ouvrirait la liste des jobs et le `POST` avec grant de démo aux visiteurs (mais le runner refuserait sans session de démo ouverte et budget sponsorisé).

### 8. Reste à faire

1. (P1, avant fusion) Renseigner `SIRIUS_ADMIN_ADDRESSES` dans Vercel pour staging et production, avec les deux adresses de l'équipe, en minuscules, séparées par une virgule, sans virgule finale.
2. (P1) Slice de masquage : utiliser `GET /api/admin/me` (401 et `{ admin:false }` = masquer) et tolérer 403 sur `GET /api/train`.
3. (P2) Décider si staging doit fermer le self training hors démo : retirer les `demoAccess=true` ou séparer la démo sur sa propre route.
4. (P2) Journaliser les accès admin (qui, quoi, quand) quand le dashboard admin arrivera ([15](15-dashboard-admin.md)).
5. (P3) Un e2e qui atteint la vraie route `/api/train` avec le wallet de test, pour exercer la déclaration de `playwright.config.ts`.
6. (P3) Faire dire explicitement à `verify-model-delivery.ts` qu'un 403 vient de `SIRIUS_ADMIN_ADDRESSES`, au lieu du diagnostic JSON générique actuel (et ne plus laisser la déconnexion finale écraser le `httpStatus` affiché).

### 9. Résultats des vérifications

Environnement : conteneur Linux, Node v22.22.0, pnpm 11.18.0, `DATABASE_URL="postgresql://x:y@localhost:5432/z"` (factice : `prisma generate` du postinstall exige la variable, aucune base n'est jointe). Série finale lancée sur l'état du code de `61087ca` (dernier commit de la branche), après chaque passe de revue les mêmes commandes avaient été relancées.

| Commande | Résultat exact |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 ; « Already up to date », `prisma generate` OK. Au tout premier appel sans `DATABASE_URL`, le postinstall échouait (« PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL ») : contrainte d'environnement, pas de la slice. |
| `pnpm exec tsc --noEmit` | exit 0, aucune sortie. |
| `pnpm lint` | exit 0 (`eslint`, aucune sortie). |
| `pnpm test` | exit 0 ; 451 tests, 451 réussis, 0 échec (449 avant la slice + les deux nouveaux fichiers ; le compte net varie avec les sous-tests ajoutés) ; durée environ 18 s. |
| `pnpm audit:deps` | exit 0 ; « 2 vulnerabilities found, Severity: 1 low, 1 high (1 ignored) » : identique à `staging` avant la slice (lockfile inchangé). |
| `pnpm test:e2e` | exit 0 ; 71 tests, 71 réussis (1,8 min). Nécessite dans ce conteneur `PLAYWRIGHT_BROWSERS_PATH` pointant vers une copie du Chromium headless 1194 préinstallé renommée `chromium_headless_shell-1228` (Playwright 1.61 attend cette version et le téléchargement est bloqué par le proxy) ; sans cela les 71 tests échouent au lancement du navigateur (« Executable doesn't exist »), ce qui n'a rien à voir avec la slice. Le serveur `next dev` des e2e a démarré avec `SIRIUS_ADMIN_ADDRESSES` et l'import `viem/accounts` de `playwright.config.ts`. |
| Tests ciblés `admin.test.ts` + `self-training-routes.test.ts` | 22 tests (8 + 14), 22 réussis, à chaque relance. |
| `git diff --name-only staging...HEAD` | 13 fichiers, tous autorisés (liste en 1) ; aucun fichier sous `src/app/(app)/`, `src/components/`, `src/runner/`, `src/lib/runner/`. |
| `git log staging..HEAD --format=%B` | 6 commits en français ; aucune signature d'assistant, aucun `[skip ci]` (vérifié par grep `co-authored\|claude\|anthropic\|generated\|skip ci` : aucune occurrence). |
| `git diff staging...HEAD -- docs/passage-mainnet/audit.md` | un seul bloc modifié, la section N5. |

Non lancés ici : `pnpm test:postgres` (pas de base), `pnpm test:billing` et `pnpm contracts:test` (compilation Hardhat), `pnpm build` (lancé une fois par un agent de revue de la passe 1 : exit 0, routes `/api/admin/me`, `/api/train`, `/api/train/[id]/key` compilées). Effet de bord d'environnement : `next dev` recrée `CLAUDE.md` et `AGENTS.md` à la racine ; ils ont été supprimés avant chaque commit et ne sont pas versionnés.

### 10. Revue interne de la session

Trois passes de revue adversariale par agents indépendants, en lecture seule sur le dépôt. Chaque passe : des relecteurs sous des angles distincts (contournement du contrôle d'accès, exactitude et non-régression, tests et cas limites, conformité au cahier des charges et aux conventions), puis trois réfutateurs par constat (reproduction, spécification, sévérité) ; un constat n'est retenu que si au moins deux réfutateurs ne parviennent pas à le réfuter.

**Passe 1** (sur le premier commit, 4 relecteurs, 22 constats bruts ; 13 d'entre eux n'ont pas pu être vérifiés par les réfutateurs, les crédits d'usage étant épuisés en cours de passe : ils ont été jugés à la main, chaque décision est notée ici).

Corrigé :
- Le script de reprise `scripts/operations/verify-model-delivery.ts` appelle `GET /api/train` et `POST /api/train/[id]/key` en HTTP avec l'adresse de `MEZO_DEPLOYER_KEY` : soumis à la garde, non documenté, et la première version de cette section affirmait à tort qu'il ne passait pas par HTTP → documentation dans `.env.example`, `10-self-training.md`, `BACKUP-RECOVERY.md`, et correction de la section 3.
- Tests d'inspection par recherche de texte : ne reconnaissaient que `export async function`, la chaîne exacte `from "@/lib/sirius/self-train"`, et ignoraient `runSelfTrainingInRunner` ; un commentaire ou une chaîne pouvait satisfaire le contrôle ; « corps non lu » n'était pas prouvé → réécriture sur l'arbre syntaxique TypeScript (toutes les formes d'export, réexport refusé, imports statiques/dynamiques/`require`), symboles runner ajoutés, `request.bodyUsed` vérifié dans le bac à sable.
- Documentation plus stricte que le code : « corps non lu » sans condition alors que l'instance de démo lit le corps ; `/api/admin/me` présentée comme « réservée » ; plafond « dix entrées » sans dire que les doublons comptent → textes corrigés.
- `.env.example` et `10-self-training.md` disaient que `SIRIUS_DEMO_OPERATORS` « ne concerne que le contrôleur » alors qu'elle est aussi lue côté Next (`requireDemoOperator`) → corrigé.
- Préfixe `0X` : fermait toute la liste alors que la doc promettait « toute casse » → mis en minuscules avant validation, testé.
- `isDemoTrainingGrant` acceptait 0 et les entiers négatifs → entier strictement positif exigé (la première ouverture de session porte la révision 1).
- `phalaDemoInstance` plus permissive que `demoEnabled` (ne regardait ni `TEE_MODE` ni le simulateur) → alignée sur les mêmes conditions, sans lever.
- Traduction en double : « Bientôt disponible » existait déjà dans `english.ts` → doublon retiré de `errors-en.ts`.
- En-tête « Fichiers » de `10-self-training.md` sans les nouveaux modules → complété.
- Test « la garde n'est importée que par les routes » trop large (une future page « bientôt » importerait le message) → seuls les appels à `assertSelfTrainingAccess` sont restreints.

Écarté, avec la raison :
- « Exemption démo décidée sur un champ forgeable » et « le second refus repose sur une valeur non authentifiée » : exact, mais c'est le comportement de la démo publique elle-même, borné à l'instance de démo testnet ; le grant est ensuite authentifié et le runner vérifie la session. Assumé en 2.1 et 7.
- « Le critère Terminé quand de la doc 10 reste contredit sur staging » : même point ; staging est l'instance de démo. Décision à prendre par l'équipe (8.3).
- « Pré-requis de déploiement non porté par le pipeline » : exact, mais le pipeline n'injecte aucune variable métier ; noté en 8.1.
- « `warnedFor` et `console.warn` non isolés » : chaque fichier de test tourne dans son propre processus ; l'avertissement a tout de même été neutralisé dans les tests qui le déclenchent.
- « Aucun e2e n'exerce la garde » : exact, angle mort noté en 5 et 8.5.
- « Les 403 de la route de clé ne sont plus comptés par le rate limiter » : choix ; la garde est sans entrée-sortie, comme le 401 de `requireAuth` qui la précède déjà.
- « `phalaDemoInstance` devrait réutiliser `demoEnabled` » : `demoEnabled` lève des 503 explicites qui révéleraient l'instance ; mêmes conditions reprises à l'identique, décision 2.14.
- « Placement des tests sous `src/lib/auth` » : conforme aux voisins (`lifetimes.test.ts`).

**Passe 2** (après corrections, 4 relecteurs, 15 constats bruts, 11 retenus, tous de sévérité basse ou moyenne, aucun défaut de contrôle d'accès).

Corrigé :
- `.env.example` annonçait un 403 inconditionnel, sans l'exception démo (relevé trois fois, par trois angles) → une phrase ajoutée avec renvoi vers la doc 10.
- Résolution des imports par suffixe : `./self-train` depuis `src/lib/sirius/`, ou `@/lib/sirius/self-train.ts` avec extension, échappaient au test ; `runSelfTrain` non épinglé → résolution réelle des spécificateurs (alias, relatif, frère, extension), testée sur une source synthétique ; liste exacte des fichiers utilisant `runSelfTrain` (dont la fonction navigateur homonyme).
- `export const { PUT } = …` ignoré en silence → refusé explicitement ; test « handlers exportés par le module transpilé = handlers inspectés ».
- Énumération limitée à `route.ts` et aux sources `.ts/.tsx` → `route.(ts|tsx|js|mjs|cjs)` et sources `.js/.mjs/.cjs` incluses ; `src/runner/handler` (chemin runner en processus) épinglé à `src/lib/tee/runner-client.ts`.
- Plafond « doublons compris » non épinglé par un test → ajouté.
- Cas limite 4.5 : statut attendu faux (c'est un 401 « Autorisation runner invalide » quand la délégation manque, le 403 n'apparaît que si le sujet diffère) → corrigé.
- Cas limite 4.6 : « 20 appels » ne discriminait rien (le limiteur en autorise 20) → 25 appels, et 429 au 21e pour un admin.
- Cas limite 4.14 et `BACKUP-RECOVERY.md` : sur l'instance de démo, le script passe la liste et s'arrête sur la clé → les deux cas décrits.
- Cas limite 4.15 : le refus de démarrage vient de `runnerEndpoint`, pas de `requiresPhalaRunner` → corrigé.

Écarté, avec la raison :
- `/api/phala-demo/results/[id]` et `/api/models/[cid]` sans garde admin : antérieurs à la slice, hors du périmètre (ils ne mènent pas à `self-train.ts`) ; livraison de la démo au propriétaire du job. Réfuté 3/3.
- « L'arbre syntaxique ne prouve pas l'exécution » (garde dans une fermeture morte) et « `req.clone().json()` avant la garde invisible » : exacts comme limites de méthode, mais aucun code de ce genre n'existe et le bac à sable couvre les handlers existants ; notés en 5 comme angles morts.
- Avertissement `[admin] … mal formée` dans la sortie d'un test vert : neutralisé malgré tout (correctif trivial).

**Passe 3** (après la passe 2, 2 relecteurs : code et tests, exactitude de la documentation ; 6 constats bruts, 1 retenu ; 5 réfutations n'ont pas pu être rendues, la limite de session étant atteinte : jugés à la main, décision notée). Aucun défaut de code ni de contrôle d'accès ; les corrections de la passe 2 ont été confirmées une à une par les deux relecteurs.

Corrigé :
- « Requête refusée » présenté dans quatre documents comme le message vu par l'opérateur du script de reprise : c'est une erreur interne avalée par le `catch` final ; la sortie réelle est un diagnostic JSON sur stderr (`phase`, `verified: false`) et `failurePhase` + `httpStatus: 403` dans `report.json` ; seuls les modèles d'entraînement passent par les routes gardées → `BACKUP-RECOVERY.md`, `10-self-training.md`, sections 2.13, 4.14, 7 et 8.6 réécrites.
- Épinglage des symboles runner limité à « hors `src/lib/tee/` » : un réexport sous alias dans ce dossier aurait échappé au test → listes exactes de fichiers, `runner-client.ts` compris ; sections 3 et 5 reformulées (la route de clé appelle bien `selfTrainModelKeyInRunner`).
- Tableau de `10-self-training.md` : la ligne `GET` n'avait pas la réserve « hors instance de démo » de la ligne `POST` → ajoutée.
- Section 5 affirmait que le bac à sable refusait une révision négative alors que seul le test unitaire l'essayait → `-1` ajouté au bac à sable.
- Section 6 attribuait la mise en minuscules de `session.address` à `readSession` → corrigé (`verifyLoginSignature` → `normalizeAddress` → `setSession`).

Écarté : rien ; les six constats, tous documentaires ou de robustesse des tests, ont été appliqués. La passe n'ayant trouvé aucun défaut de code et seulement des imprécisions de texte, la revue s'arrête ici.

---

## N6 — Certificat d'exécution

Branche `feat/certificat`, partie de `staging` (`fd3cefc`, après la PR #45 marketplace). Cahier des charges : [09-train-et-certificat.md](09-train-et-certificat.md), partie « Certificat d'exécution », avec [12-test-phala.md](12-test-phala.md) et le [plan global](00-PLAN-GLOBAL.md). Commits : implémentation (`92be486`), une correction par passage de revue (`2afe697`, `76802e9`, `740439f`, §10), fusion de `origin/staging` (`538af6c`), correction d'un minuteur (`bc25afe`), puis cette section ; empreintes visibles avec `git log staging..HEAD`. Tout est vérifiable depuis `git diff staging...HEAD`.

### 1. Ce qui a changé

**Routes (nouvelles, publiques, lecture seule, sans session)**

| Route | Rôle |
|---|---|
| Page `/certificate/[loanId]` (`src/app/certificate/[loanId]/page.tsx`) | Certificat d'exécution d'un emprunt, rendu côté serveur, hors du groupe `(app)` comme `/proof/[id]`. Quatre états : 404 (`notFound()`), « Certificate not available yet », « Too many requests », certificat. Métadonnées `robots: noindex, nofollow`. |
| `GET /api/certificate/[loanId]/attestation` (`src/app/api/certificate/[loanId]/attestation/route.ts`) | Attestation brute en JSON, `content-disposition: attachment; filename="sirius-certificate-<loanId>.json"`, `cache-control: no-store`. 404 `{"error":"Certificate not found"}` identique pour tout ce qui n'est pas un certificat prêt ; 429 au-delà du débit ; 500 générique sinon. |

**Contenu de la page (certificat prêt)** : nom du dataset avec lien vers `/proof/[datasetId]`, profil de modèle (`modelDisplayName`), empreinte du modèle livré (`modelCid`), date d'enregistrement du règlement (`settledAt`, UTC, libellé « Settlement recorded »), transaction de règlement avec lien explorateur (`transactionExplorerUrl`, sans lien si aucun explorateur n'est configuré), réseau, hash SHA-256 du résultat attesté (`attestationHash`), verdict (titre + résumé), quatre contrôles (« Bound to this run », « Intel TDX hardware », « Code identity », « Event log ») avec état Passed / Failed / Not checked, trois mesures (MRTD, RTMR3, compose hash) avec leur correspondance aux valeurs épinglées `SIRIUS_EXPECTED_MRTD`, `SIRIUS_EXPECTED_RTMR3`, `SIRIUS_EXPECTED_COMPOSE_HASH` (« Matches the pinned value » / « Differs from the pinned value » / « No pinned value configured »), mention que la page ne juge pas la qualité du modèle et ne contient ni ligne du dataset ni clé, bouton « Download raw attestation (JSON) » (`<a download>`, sans JavaScript).

**Modules (`src/lib/certificate/`, nouveaux)**

| Fichier | Contenu |
|---|---|
| `resolve.ts` | `server-only`. `isCertificateLoanId` (`^[A-Za-z0-9_-]{1,64}$`), `resolveCertificate` (règles d'accès et contrôles de cohérence, §3), `networkForChain`, `certificateExport` (contenu du JSON). Types `CertificateLoanRow`, `CertificateRecord`, `CertificateResolution`. |
| `load.ts` | `server-only`. Lecture Prisma `findUnique` avec projection explicite (`CERTIFICATE_SELECT`, 20 colonnes du prêt + 7 du dataset), `loadCertificate`. Identifiant hors format : aucune requête. |
| `verification.ts` | `server-only`. `BoundedQuoteVerifier` (cache, plafonds, échéances, §3), `verificationCacheKey`, `verifyCertificate` (singleton `globalThis` branché sur `verifyTdxQuote`). |
| `presentation.ts` | Pur (aucun accès serveur). `presentVerification` : du résultat de vérification au verdict, aux contrôles et aux mesures affichés ; `formatCertificateDate`. |
| `display.ts` | Pur. `certificateViewProps` : projection du certificat vers les seules propriétés de la vue (frontière de confidentialité), `certificateDownloadPath`. |
| `download.ts` | `server-only`. `certificateDownloadResponse` (logique de la route, injectable pour les tests), `certificateDownloadLimiter`. |
| `page-guard.ts` | `server-only`. `certificatePageLimiter`, `certificateClientKey`, `allowCertificatePage` : débit de la page. |
| `certificate-view.render.tsx` | Script de rendu HTML statique pour les tests (processus sans `react-server`, comme `shared-components.render.tsx`). Jamais importé par l'application. |
| `*.test.ts` | Six fichiers de tests (§5). |

**Composants** : `src/app/certificate/[loanId]/certificate-view.tsx` (nouveau, sans état ni accès serveur) : `CertificateView`, `CertificateUnavailable`, `CertificateBusy`. Textes en anglais écrits directement, comme `/proof/[id]` (composant serveur sans contexte de locale) : aucune clé de traduction ajoutée.

**Autres fichiers** : `package.json` (six fichiers de tests ajoutés au script `test`), `e2e/certificate.spec.ts` (nouveau, §5), cette section.

**Aucune** modification de : base de données (aucune migration, aucune colonne), contrats, escrow, moteur Phala et runner (`src/runner/**`, `src/lib/runner/**`), `src/lib/tee/**` (réutilisé sans modification : `verifyTdxQuote`, `parseLoanAttestationPayload`, `hashLoanAttestationPayload`), `src/app/api/loans/**` (la route `GET /api/loans/[id]/attestation` reste réservée aux parties), page Train, layout, composants partagés, `next.config.ts`, `src/proxy.ts`. Aucune dépendance ajoutée (`@phala/dcap-qvl` déjà présent).

### 2. Décisions et écarts par rapport au cahier des charges

1. **Pas de bouton « Certificat » sur la page Train.** Le cahier des charges le demande, la consigne de la slice l'interdit (une autre session modifie la page Train et ajoutera le lien). Tant qu'il n'existe pas, la page n'est atteignable que par son URL. Lien à ajouter : `/certificate/${loan.id}` pour un prêt `SETTLED`.
2. **Accès : même règle de visibilité que `/proof/[id]`.** Certificat servi seulement si le dataset est `LISTED`, `UNLISTED` ou `SUSPENDED` avec titre on-chain (`evmDatasetId`). Un dataset passé en `PRIVATE`, `DELETED` ou `DRAFT` après l'emprunt ferme le certificat (404). Choix conservateur : le certificat nomme le dataset et renvoie vers sa preuve ; il ne doit pas rouvrir un nom que le fournisseur a retiré. Conséquence : un emprunteur perd son certificat public si le fournisseur supprime le dataset (l'attestation reste disponible pour lui via `GET /api/loans/[id]/attestation`).
3. **Trois réponses distinctes, et seulement trois.** 404 indistinct pour « identifiant hors format », « prêt inexistant » et « dataset fermé » ; « Certificate not available yet » (HTTP 200, aucun détail) pour tout prêt existant non `SETTLED` (PENDING, SUBMITTING, ESCROWED, TRAINING, SETTLING, CANCELLED), sans attestation, sans `modelCid`, sans `settleTxHash` bien formé, avec une attestation qui ne se recoupe pas avec la ligne, sur un déploiement d'escrow non approuvé ou sur une chaîne inconnue de l'application. Un prêt annulé ou remboursé n'a jamais de certificat ; le texte le dit sans dire lequel des cas s'applique. Le JSON rend 404 pour les deux premiers groupes (il n'a pas d'état « pas encore »).
4. **Contrôles de cohérence recopiés de la route attestation.** `resolveCertificate` refait exactement les contrôles de `GET /api/loans/[id]/attestation` (hash du payload, chaîne, escrow, prêt, clé de prêt, dataset, CID, parties, montant, hash de devis, `challengeDays`, racine Merkle, profil et version de modèle, `modelCid`). La route existante n'est pas modifiable dans cette slice : la logique est dupliquée, pas partagée (§8).
5. **Vérification de quote : en cache et bornée, pas à la demande.** Le cahier des charges laisse le choix. La page vérifie au rendu, avec cache par contenu, une seule vérification en vol par certificat, au plus 10 vérifications matérielles neuves par minute et 5 simultanées par instance, attente maximale de 8 s pendant le rendu, échéance dure de 30 s, et repli sur les contrôles locaux (sans réseau) au-delà. Une vérification plus lente que le rendu est confiée à `after()` (Next 16) pour finir et remplir le cache. Le téléchargement JSON, lui, ne vérifie rien.
6. **Rédaction du verdict : le titre « Executed inside an Intel TDX enclave on Phala Cloud » n'apparaît que si tout est vérifié** : quote liée au prêt (`reportDataMatches`), matériel et TCB acceptés par Intel (`hardwareVerified === true`, TCB `UpToDate`), identité du code complète (`codeIdentityMatches === true`, donc les trois valeurs épinglées configurées et égales, et l'event-log rejoué). Sinon :
   - « Enclave execution not confirmed » (verdict `failed`) seulement pour un échec franc : quote non liée au prêt, ou event-log incohérent avec RTMR3 ;
   - « Enclave execution not fully confirmed » (verdict `incomplete`) pour tout le reste : vérification en attente, simulateur, collatérale injoignable ou signature refusée (indiscernables dans `verifyTdxQuote`), TCB déclassé aujourd'hui, mesures différentes des valeurs épinglées aujourd'hui (le résumé évoque une mise à jour de l'enclave), valeur épinglée absente, erreur de vérification ;
   - « No hardware attestation recorded » (verdict `unattested`) si aucune quote n'est enregistrée (mode non Phala).
   Raison de ne pas classer en échec un écart d'épinglage ou de TCB : les valeurs épinglées et l'état du TCB sont ceux d'aujourd'hui ; une mise à jour de l'enclave ou une révision du TCB par Intel les produirait sur tous les certificats antérieurs, authentiques au moment du calcul. La ligne de contrôle concernée reste « Failed » et la note sous les mesures le dit.
7. **Quote et mesures : affichées depuis la quote, pas depuis la base.** MRTD et RTMR3 sont lus dans la quote par `verifyTdxQuote` ; le compose hash vient de l'évidence enregistrée, lié à RTMR3 par le rejeu de l'event-log. Une mesure non hexadécimale n'est pas affichée.
8. **Ce que la page n'affiche pas** : adresses du fournisseur et de l'emprunteur, montant, clé de prêt, escrow, payload attesté, hash d'enveloppe, devis, reçus (runner, audit HMAC), quote brute et event-log (seulement dans le JSON). « Pas d'adresse complète inutile » : aucune adresse n'est utile au lecteur pour juger l'exécution.
9. **Ce que le JSON contient, et pourquoi les adresses y sont.** `format`, `loanId`, `chainId`, `settlementTxHash`, `modelCid`, `attestation.{payload, payloadSha256, tdxQuote, eventLog, composeHash}`, `howToVerify` (six étapes en anglais). Le payload est la chaîne exacte dont le SHA-256 est dans `report_data` de la quote : impossible de le tronquer sans rendre la vérification impossible. Il contient les adresses complètes du fournisseur et de l'emprunteur, le montant atomique, la clé de prêt, l'escrow, la racine Merkle, le CID chiffré du dataset, `releaseEnvelopeHash` et `billingQuoteHash`. Tous sont publics on-chain (événements de lock et de règlement de l'escrow, titre du dataset) ou sur `/proof/[id]`, ou sont des hashes. Le préimage d'escrow n'y figure pas (le payload ne contient que le hash de l'enveloppe), et le certificat n'existe qu'après `SETTLED`, donc après publication on-chain du préimage. Le reçu d'audit HMAC (`auditReceipt`), servi par la route des parties, n'est pas exporté : il n'est vérifiable qu'avec la clé de l'enclave.
10. **`modelCid` rendu public.** Le cahier des charges demande « l'empreinte du modèle livré ». Jusqu'ici le CID n'était servi qu'à l'emprunteur. Le blob IPFS est chiffré, la clé passe par l'enveloppe de l'emprunteur : le CID révèle l'existence et la taille du chiffré, pas le modèle.
11. **Débit de la page.** Ajouté après la première revue : 60 affichages par minute par client, 1 200 au total par instance, consommés une seule fois par requête (React `cache` partagé entre `generateMetadata` et la page), avant toute lecture en base ; un identifiant hors format ne consomme rien. Au-delà, état « Too many requests » en HTTP 200 (une page serveur Next ne peut pas fixer son statut sans passer par le proxy, hors périmètre ; `noindex` limite l'effet sur les aperçus). Téléchargement JSON : 20 par minute par client, 240 au total.
12. **`noindex`.** Un certificat se partage par lien ; rien ne justifie qu'il soit indexé. `/proof/[id]` ne le fait pas.
13. **Date affichée.** `settledAt` est écrit au moment où le serveur constate le règlement (y compris par le reaper ou une reprise), pas l'horodatage du bloc : libellé « Settlement recorded », pas « Settled on ». La date on-chain est dans la transaction liée.
14. **Démo Phala (self training, [12](12-test-phala.md)).** Hors périmètre : pas de modèle `Loan`, pas de règlement. La présentation (`presentation.ts`, `certificate-view.tsx`) est réutilisable.
15. **Statistiques d'entraînement** (durée, métriques, horodatage de la quote) : V1.1, non faites.

### 3. Ce que l'audit doit vérifier

**Contrôle d'accès, route par route**

- `/certificate/[loanId]` : aucune session lue, aucun cookie. `src/proxy.ts` ne fait que la CSP. Ordre dans `certificateFor` (`page.tsx`) : format (`isCertificateLoanId`) → débit (`allowCertificatePage(await headers())`) → `loadCertificate`. Dans `resolveCertificate` (`resolve.ts`) : prêt absent ou `id` hors format → `not-found` ; statut du dataset hors `LISTED`/`UNLISTED`/`SUSPENDED`, ou `SUSPENDED` sans `evmDatasetId` → `not-found` ; statut du prêt ≠ `SETTLED`, `attestationHash`/`attestationPayload`/`modelCid`/`settleTxHash` absent, `settleTxHash` hors `^0x[0-9a-fA-F]{64}$`, `attestationHash` hors SHA-256, profil de modèle inconnu, payload illisible, `loanEscrowBinding` qui lève (escrow non approuvé, `SIRIUS_ESCROW_ADDRESS` manquante), chaîne inconnue, ou l'un des 16 recoupements faux → `unavailable`.
- `GET /api/certificate/[loanId]/attestation` : mêmes règles (même `loadCertificate`), débit avant tout, puis format, puis lecture ; tout état autre que `ready` → 404 au corps constant.
- Vérifier qu'aucune règle d'accès ne repose sur l'interface : le lien Train n'existe pas encore, et la page ne doit rien montrer de plus à qui devine une URL.

**Validation et bornes de chaque entrée**

- `loanId` : seule entrée de l'appelant. `^[A-Za-z0-9_-]{1,64}$` avant toute requête, avant le débit et avant l'en-tête `content-disposition` (aucun guillemet, CR ou LF possible).
- En-tête `x-real-ip` : lu seulement si `SIRIUS_TRUST_PROXY_HEADERS=true` ; une valeur hors `^[A-Fa-f0-9:.]{3,64}$` est regroupée sous une clé commune (la page ne lève pas, à la différence de `requestClientKey` qui renvoie 400 sur les routes API).
- Données en base relues comme non fiables : payload borné à 4 096 caractères et canonique (`parseLoanAttestationPayload`), quote hexadécimale de longueur paire et ≤ 64 Kio de texte avant tout appel (`isWellFormed`), event-log ≤ 2 Mio et compose hash SHA-256 sinon ignorés (pas de rejeu), mesures affichées seulement si hexadécimales, nom du dataset échappé par React (vide → « Untitled dataset »).

**Fuites possibles**

- Projection Prisma explicite (`load.ts`) : ni `billingQuote`, ni `runnerReceipt`, ni `auditReceipt`, ni `evmHashlock`, ni `wrappedKey`, ni `KeyGrant`. Vérifier que `CertificateLoanRow` n'est jamais passé à la vue : `display.ts` est la seule projection vers `CertificateViewProps`, et le payload n'en fait pas partie (test « propriétés de la vue »).
- Les métadonnées (`<title>`) ne contiennent le nom du dataset que pour un certificat prêt ; « not available » et « busy » ont un titre générique.
- Messages d'erreur : JSON 404 constant, 500 via `errorResponse` (« Erreur interne — réessaye. », journal sans message). `resolveCertificate` et le vérificateur avalent leurs exceptions sans journaliser : rien sur la quote, le payload ou la ligne n'arrive dans les journaux.
- Temps de réponse : inexistant et dataset fermé font la même lecture par clé primaire ; la différence avec un prêt présent mais non réglé est assumée (état distinct demandé).
- JSON : contenu listé en §2.9 ; à valider par l'auditeur comme « déjà public ».

**Exactitude de la vérification affichée**

- `presentation.ts` contre `verifyTdxQuote` (`src/lib/tee/quote.ts`) : `hardwareVerified` vaut `null` au simulateur (y compris via `isSimulator()` quand `skipHardware` n'est pas passé), `false` avec `tcbStatus` si Intel répond un TCB non accepté, `false` sans `tcbStatus` pour toute exception de `getCollateralAndVerify` (signature, révocation, debug, réseau) ; `codeIdentityMatches` vaut `null` si une valeur épinglée ou l'évidence manque. Le titre vérifié n'est atteignable que par la conjonction §2.6 (tests « aucun autre état… »).
- **Limite héritée importante** : `verifyTdxQuote` ne compare que MRTD, RTMR3 et le compose hash. RTMR0 à RTMR2 (noyau, ligne de commande, initrd de l'image dstack) et `mrConfigId` ne sont ni épinglés ni vérifiés. Un hôte TDX authentique qui démarrerait une image OS modifiée avec le même firmware pourrait étendre RTMR3 avec les digests d'un event-log authentique et obtenir le verdict vérifié. Le résumé ne dit donc plus « produced by the enclave code Sirius publishes » mais « carries the enclave measurements Sirius pins ». Correctif dans `quote.ts`, hors périmètre (§8, P0).
- Les valeurs épinglées sont celles du serveur au moment de l'affichage ; voir §2.6 pour la conséquence d'une mise à jour d'enclave.

**Déni de service et coût**

- Appels sortants : seulement `getCollateralAndVerify` (jusqu'à environ six `fetch` vers la collatérale Intel / PCCS, sans délai ni `AbortSignal` dans `@phala/dcap-qvl`). Bornes par instance : cache par contenu (1 h si concluant, 5 min si non concluant ou abandonné, 1 min sur erreur), 500 entrées par cache (éviction de la plus ancienne), une vérification en vol par clé, 10 neuves par minute, 5 simultanées, 30 s d'échéance dure, et au plus 10 appels réellement non terminés (abandonnés compris) avant de refuser toute vérification neuve.
- CPU : contrôles locaux (parse de quote, rejeu d'event-log jusqu'à 2 Mio, deux passes dans `identity.ts`) et SHA-256 de la clé de cache (event-log compris) à chaque affichage d'un certificat prêt ; les contrôles locaux sont en cache, le SHA-256 non. Le tout derrière le débit de la page.
- Base : une lecture par clé primaire par affichage, derrière le débit ; la ligne lue comprend la quote et l'event-log.
- Mémoire : caches bornés, minuteurs annulés, promesses en vol bornées par les plafonds ; une promesse abandonnée à l'échéance garde sa fermeture (quote, event-log) jusqu'à la fin réelle de son `fetch`.

**Impact sur l'argent, l'escrow, les contrats, le moteur Phala** : aucun. Lecture seule ; aucune transaction, aucun appel au runner, aucun accès au registre de budget. `loanEscrowBinding` ne fait que lire la configuration.

**Base de données** : aucune migration, aucune écriture.

**Interface** : tout passe par l'échappement React (pas de `dangerouslySetInnerHTML`) ; liens internes `/proof/<encodeURIComponent(id)>` et `/api/certificate/<encodeURIComponent(id)>/attestation` ; lien externe construit sur la base fixe de l'explorateur avec un hash validé, `target="_blank" rel="noreferrer noopener"`. CSP du proxy appliquée à la page ; `nosniff` et `X-Frame-Options: DENY` globaux.

**Textes** : relire `presentation.ts` et `certificate-view.tsx`. Aucune promesse sur la qualité du modèle (« This certificate covers how the model was produced, not its quality »). « on Phala Cloud » repose sur le compose hash épinglé de l'application Phala, pas sur une preuve cryptographique du fournisseur d'hébergement.

### 4. Cas limites à essayer à la main sur staging

Prérequis : un prêt `SETTLED` en mode Phala (quote, event-log, compose hash enregistrés) sur un dataset `LISTED`, son identifiant (`/explorer` ou base), et les trois `SIRIUS_EXPECTED_*` configurés.

1. Ouvrir `/certificate/<id>` en navigation privée, sans wallet → page rendue sans JavaScript nécessaire, nom du dataset, lien « on-chain proof » qui ouvre `/proof/<datasetId>`, CID du modèle, transaction de règlement cliquable vers l'explorateur testnet, trois mesures. Si tout est vérifié : titre « Executed inside an Intel TDX enclave on Phala Cloud », quatre contrôles « Passed », trois « Matches the pinned value ».
2. Recharger immédiatement → même verdict, rendu rapide (cache) ; aucun nouvel appel sortant vers la collatérale dans les journaux réseau du serveur.
3. Cliquer « Download raw attestation (JSON) » → fichier `sirius-certificate-<id>.json`. Vérifier `sha256(attestation.payload) == attestation.payloadSha256` (par exemple `node -e` ou `sha256sum` sur la chaîne exacte), et que `report_data` de la quote commence par ce hash (`dcap-qvl` ou outil Phala).
4. Inspecter le HTML de la page : aucune adresse `0x` à 40 caractères, aucun montant.
5. `/certificate/<id d'un prêt TRAINING ou ESCROWED>` → « Certificate not available yet », aucun nom de dataset, titre d'onglet générique. Même chose pour un prêt `CANCELLED` (remboursé).
6. `/certificate/cnexistepas00000000000000` et `/certificate/abc!` → 404. `GET /api/certificate/abc!/attestation` et `GET /api/certificate/<id non réglé>/attestation` → 404 au même corps `{"error":"Certificate not found"}`.
7. Passer le dataset du prêt en `PRIVATE` (ou le supprimer) → la page et le JSON rendent 404 ; repasser en `LISTED` → le certificat revient.
8. Retirer `SIRIUS_EXPECTED_COMPOSE_HASH` puis redémarrer → « Enclave execution not fully confirmed », mesure « No pinned value configured », contrôle « Code identity » « Not checked ».
9. Mettre une valeur épinglée fausse (64 hex différents) puis redémarrer → « not fully confirmed », résumé « may have been upgraded since », mesure « Differs from the pinned value ».
10. Mettre une valeur épinglée mal formée (`abc`) → la page s'affiche quand même, contrôles locaux en échec de lecture : état « The TDX quote could not be read or checked » (pas de 500).
11. Couper l'accès sortant à la collatérale (pare-feu, ou PCCS injoignable) → le premier affichage attend au plus 8 s puis montre les mesures avec « Intel TDX hardware : Not checked » et « Reload this page in a few minutes » ; pas de « Failed ».
12. Ouvrir 70 fois la page en une minute depuis la même IP (derrière l'ingress avec `SIRIUS_TRUST_PROXY_HEADERS=true`) → à partir de la 61ᵉ, « Too many requests ». Même essai sur le JSON : 429 à partir de la 21ᵉ.
13. Prêt `SETTLED` sans quote (instance hors Phala) → « No hardware attestation recorded », aucun contrôle ni mesure, bouton de téléchargement présent (`tdxQuote: null`).

### 5. Tests ajoutés et ce qu'ils ne couvrent pas

Ajoutés au script `test` : `resolve.test.ts` (11 tests), `verification.test.ts` (14), `presentation.test.ts` (9), `download.test.ts` (5), `page-guard.test.ts` (2), `certificate-view.test.ts` (6, via le rendu en processus séparé) : 47 tests. E2E : `e2e/certificate.spec.ts` (2).

- **Accès et états** : identifiant borné ; 404 pour inexistant, hors format, `DRAFT`/`LISTING`/`PRIVATE`/`DELETED`, `SUSPENDED` sans titre ; certificat pour `LISTED`/`UNLISTED`/`SUSPENDED` avec titre ; « pas encore disponible » pour les six autres statuts et pour neuf pièces manquantes ou mal formées ; quatorze recoupements faussés un par un, hash faux, escrow non approuvé, chaîne inconnue.
- **Absence de champs privés** : record affichable sans adresse, montant, clé ni escrow ; propriétés de la vue sans adresse, montant, payload ni hash d'enveloppe ; export JSON à clés exactes, sans reçu, devis, hashlock ni clé ; HTML de chaque état sans adresse complète ni nom de champ interne ; états « pas encore disponible » et « busy » sans nom de dataset, CID, `0x` ni lien.
- **404** : route JSON hors format sans lecture en base ; corps identique pour inexistant et non disponible ; 429 sans lecture ; 500 sans détail.
- **Verdicts** : seul le cas tout-vérifié porte le titre ; neuf autres combinaisons ne le portent pas ; échecs francs, TCB déclassé, collatérale injoignable, épinglage différent, simulateur, en attente, sans quote, mesure non hexadécimale ; date UTC.
- **Vérificateur** : cache et expiration, déduplication en vol, plafond par fenêtre, repli local mis en cache, délai de rendu avec remise à `after()`, échéance dure (place rendue, appel compté), plafond des appels non terminés, plafond simultané, vérificateur qui lève de façon synchrone, erreur → contrôles locaux et nouvel essai après une minute, TTL non concluant de cinq minutes, quotes mal formées ou démesurées sans appel, éviction, clé de cache sensible à chaque pièce et valeur épinglée.
- **Échappement** : nom et CID hostiles rendus en texte.
- **E2E** (sans base, comme toute la suite) : `/certificate/<hors format>` → 404, aucun appel API du navigateur, ni titre vérifié ni bouton ; `GET /api/certificate/bad%21id/attestation` → 404 JSON `no-store`.

Non couvert :
- aucun test avec une vraie quote TDX : le dépôt n'a pas de quote d'exemple, et `verifyTdxQuote` n'est pas exercé de bout en bout par ces tests (il l'est par ses propres tests, hors slice) ; le câblage `verifyCertificate` → `verifyTdxQuote` (`skipHardware`) n'est vérifié que par lecture ;
- la page elle-même (`page.tsx`) n'est pas rendue par un test : le partage d'un seul jeton de débit entre métadonnées et page par `cache`, l'appel réel de `after()` et la lecture de `headers()` ne sont vérifiés que par lecture et par la doc locale de Next 16.3.7 ;
- les états « prêt » et « pas encore disponible » ne sont pas couverts en e2e (il faudrait une base) ;
- aucun test de charge ni de comportement multi-instances ;
- la cohérence de `resolveCertificate` avec la route `GET /api/loans/[id]/attestation` est vérifiée par lecture, pas par un test commun.

### 6. Hypothèses

- `cuid()` reste le générateur d'identifiants de `Loan` (25 caractères `[a-z0-9]`) : la borne `^[A-Za-z0-9_-]{1,64}$` les accepte.
- `SETTLED` n'est posé qu'après confirmation on-chain du règlement (vrai dans `settle.ts`, le reaper et la reprise aujourd'hui) : le préimage est donc public quand le certificat apparaît.
- Les adresses du fournisseur et de l'emprunteur, le montant et la clé de prêt sont lisibles on-chain dans les événements de l'escrow (v6 et v7) : leur présence dans le payload exporté n'expose rien de neuf.
- Le blob IPFS désigné par `modelCid` est chiffré pour l'emprunteur seul.
- `SIRIUS_EXPECTED_MRTD`, `SIRIUS_EXPECTED_RTMR3` et `SIRIUS_EXPECTED_COMPOSE_HASH` sont configurés sur l'application web (et pas seulement sur le runner) en staging et en production ; sinon aucun certificat n'atteint le verdict vérifié.
- L'application web peut joindre la collatérale Intel / PCCS depuis Vercel et le VPS (même besoin que la route attestation existante).
- `SIRIUS_TRUST_PROXY_HEADERS=true` en production derrière un ingress qui écrase `X-Real-IP` (sinon seul le plafond global s'applique).
- `after()` maintient bien l'instance pendant la fin de la vérification sur Vercel (comportement documenté de Next 16, non observé ici).
- Les quotes TDX enregistrées tiennent sous 64 Kio de texte hexadécimal et les event-logs sous 2 Mio.

### 7. Risques résiduels et limites connues

1. **Identité de l'OS non vérifiée** (§3) : RTMR0-2 et `mrConfigId` ignorés par `verifyTdxQuote`. Le verdict vérifié repose sur MRTD + RTMR3 + compose hash, comme toute la vérification existante du projet. C'est le risque principal de la page : elle rend public un verdict que seule la route des parties exposait.
2. **Plafonds par instance** : sur Vercel, chaque instance a son cache, son débit et ses plafonds. Un attaquant qui force la montée en instances multiplie les vérifications neuves (10 par minute et par instance). Correctif durable : persister le résultat de vérification (§8).
3. **Appels réseau non annulables** : `dcap-qvl` n'a ni délai ni `AbortSignal`. Une vérification abandonnée à 30 s continue jusqu'aux délais par défaut d'undici (plusieurs minutes) ; au plus 10 tels appels par instance avant refus de toute vérification neuve.
4. **Valeurs épinglées et TCB d'aujourd'hui** : après une mise à jour d'enclave ou une révision du TCB, les certificats antérieurs passent en « not fully confirmed », avec une explication mais sans preuve qu'ils étaient valides à l'époque.
5. **Collatérale injoignable ≡ signature refusée** : `verifyTdxQuote` ne les distingue pas ; la page affiche « Not checked » dans les deux cas, donc une quote à la signature réellement invalide n'apparaît pas en « Failed » (jamais en vérifié non plus), et elle est revérifiée toutes les cinq minutes dans la limite des plafonds.
6. **Seul `UpToDate` est accepté** : des quotes Phala authentiques en `SWHardeningNeeded` ou `ConfigurationNeeded` s'afficheront « not fully confirmed ».
7. **Limiteurs globaux sans ingress de confiance** : sans `SIRIUS_TRUST_PROXY_HEADERS=true`, un seul client peut épuiser le quota de la page (1 200/min) ou du JSON (240/min) d'une instance et bloquer les autres visiteurs une minute.
8. **« Too many requests » en HTTP 200** : un aperçu de lien pris à ce moment-là affiche ce texte.
9. **Certificat fermé avec le dataset** (§2.2).
10. **CPU par affichage** : SHA-256 de l'event-log (jusqu'à 2 Mio) pour la clé de cache à chaque affichage d'un certificat prêt, borné par le débit.
11. **Logique de cohérence dupliquée** avec `GET /api/loans/[id]/attestation` : une évolution du payload (version 3) doit toucher les deux.
12. **JSON volumineux** : jusqu'à environ 2 Mio par réponse (event-log), 240 réponses par minute et par instance au plus.

### 8. Reste à faire

- **P0** : bouton « Certificate » sur chaque entraînement `SETTLED` de la page Train, vers `/certificate/${loan.id}` (session Train).
- **P0** : configurer `SIRIUS_EXPECTED_MRTD`, `SIRIUS_EXPECTED_RTMR3`, `SIRIUS_EXPECTED_COMPOSE_HASH` et `SIRIUS_TRUST_PROXY_HEADERS=true` sur les projets Vercel staging et production ; vérifier un certificat réel sur staging (§4).
- **P0** (couloir TEE) : épingler et vérifier RTMR0-2 (ou l'empreinte d'image OS dstack) et `mrConfigId` dans `verifyTdxQuote` ; exiger leur correspondance dans `codeIdentityMatches`.
- **P1** : persister le résultat de vérification au règlement (colonnes `quoteVerifiedAt`, `tcbStatus`, verdict, valeurs épinglées utilisées) et faire de la page un simple lecteur : supprime l'amplification multi-instances et fige le verdict « au moment du calcul ».
- **P1** : historique des mesures approuvées (liste des compose hash et RTMR3 successifs) pour qu'une mise à jour d'enclave ne déclasse pas les certificats antérieurs.
- **P1** : distinguer dans `verifyTdxQuote` l'échec de collatérale (réseau) du refus de vérification (signature, révocation).
- **P1** : passer à `dcap-qvl` un `fetch` avec délai et taille maximale (dispatcher undici ou fork).
- **P2** : extraire les contrôles de cohérence du payload dans un module partagé par la route attestation et le certificat.
- **P2** : publier les valeurs de mesure attendues (page de documentation ou JSON signé) pour qu'un tiers compare sans faire confiance au serveur ; commande de revérification hors ligne (V1.2 de [09](09-train-et-certificat.md)).
- **P2** : statistiques d'entraînement (durée, métriques, horodatage et état du TCB de la quote) ; certificat de la démo Phala ([12](12-test-phala.md)).
- **P2** : test e2e des états « prêt » et « pas encore disponible » avec une base de test ; quote TDX d'exemple dans les fixtures.

### 9. Résultats des vérifications

Environnement : Windows 11, Git Bash, Node v22, pnpm 11.18.0 lancé par `npx -y pnpm@11.18.0` (l'installation locale de pnpm est cassée), `DATABASE_URL=postgresql://x:y@localhost:5432/z` (factice), aucune base, aucun RPC, aucune collatérale Intel. Le script `test` utilise la syntaxe POSIX `NODE_OPTIONS=… node …` : lancé avec `--config.script-shell=bash`. Toutes les commandes ci-dessous sur la tête de la branche après fusion de `origin/staging` (`ec0b768`, PR #44 et #46 ; seul conflit : la liste du script `test`, résolue en gardant les deux côtés).

| Commande | Résultat exact |
|---|---|
| `pnpm install --frozen-lockfile` | `Already up to date`, `Done in 518ms using pnpm v11.18.0`, code 0 (premier passage : `Done in 1m 16.8s`, postinstall `✔ Generated Prisma Client (7.8.0)`) |
| `pnpm exec prisma generate` | `✔ Generated Prisma Client (7.8.0) to .\src\generated\prisma in 118ms`, code 0 |
| `pnpm exec tsc --noEmit` | aucune sortie, code 0 |
| `pnpm lint` | `eslint`, aucune remarque, code 0 |
| `pnpm --config.script-shell=bash test` | `# tests 776`, `# pass 704`, `# fail 72`, `# cancelled 0`, code 1. **Échec d'environnement, pas de la slice** : les 72 échecs sont tous dans des fichiers hors slice qui dépendent de POSIX (`src/lib/runner/budget.test.ts` 54, `replay.test.ts` 7, `scripts/initialize-runner-volume.test.ts` 4, `src/lib/auth/self-training-routes.test.ts` 3 — chemins `\\` au lieu de `/`, `src/runner/server.test.ts`, `src/lib/runner/monitoring.test.ts`, `src/lib/copy/disclaimers.test.ts` — graphe d'imports avec chemins Windows, `scripts/runner-cli.test.ts`, 1 chacun) ; même liste de fichiers et même nombre avant la fusion (`# tests 722`, `# pass 650`, `# fail 72`) et que le relevé de `staging` sur cette machine consigné par N3. Les 47 tests de la slice passent tous. |
| Tests de la slice seuls (`node --import tsx --test src/lib/certificate/*.test.ts`, `NODE_OPTIONS=--conditions=react-server`) | `# tests 47`, `# pass 47`, `# fail 0`, `# cancelled 0` ; répété 8 fois après la dernière correction, 8 fois vert |
| `pnpm audit:deps` | `2 vulnerabilities found`, `Severity: 1 low \| 1 high (1 ignored)`, code 0 ; aucune dépendance ajoutée, état identique à `staging` |
| E2E, suite complète (`playwright test`, chromium, `next dev`, port 3137 via une configuration locale hors dépôt qui étend `playwright.config.ts`, car 3100 est réservé à une autre session) | après fusion : `107 passed (1.0m)`, code 0 ; avant fusion : `99 passed (52.0s)` ; `e2e/certificate.spec.ts` seul : `2 passed` |
| `git diff --name-only staging...HEAD` (contre `origin/staging`) | 19 fichiers + cette section : `e2e/certificate.spec.ts`, `package.json`, `src/app/api/certificate/[loanId]/attestation/route.ts`, `src/app/certificate/[loanId]/{certificate-view,page}.tsx`, `src/lib/certificate/{display,download,load,page-guard,presentation,resolve,verification}.ts`, `src/lib/certificate/certificate-view.render.tsx`, `src/lib/certificate/{certificate-view,download,page-guard,presentation,resolve,verification}.test.ts`. Aucun fichier interdit (ni page Train, ni `src/app/api/loans/**`, ni `src/lib/tee/**`, ni runner, ni contrats, ni layout, ni composant partagé). |
| `git log staging..HEAD --format=%B` passé au crible (co-signature, nom de l'assistant, lien de session, mention de génération, `[skip ci]`) | aucune occurrence ; auteur et committeur de chaque commit : `alibenyezza` |

Non exécuté : `pnpm build` (non demandé ; la compilation Turbopack de la page et de la route a été exercée par `next dev` pendant les e2e), `test:postgres`, contrats, `test:phala-demo`. Aucun certificat réel n'a été affiché : pas de base ni de prêt Phala réglé sur la machine (§4 à faire sur staging).

### 10. Revue interne de la session

Méthode : trois passages de relecture adversariale par des agents indépendants, en lecture seule, avec accès au dépôt et à `node_modules`. Passage 1 : deux relecteurs en parallèle (fuite de données, contrôle d'accès, injection et exactitude du verdict ; déni de service, cache et robustesse de la vérification). Passage 2 : un relecteur sur le code corrigé, avec la liste de ce qui était déjà traité, chargé de vérifier les corrections et de chercher du neuf. Passage 3 : un relecteur sur les seules corrections du passage 2. Arrêt quand un passage ne remonte plus rien de nouveau à corriger.

**Passage 1, défauts remontés et suite** (corrections dans `2afe697`)

| Défaut | Gravité | Suite |
|---|---|---|
| Verdict vérifié atteignable avec un OS non mesuré (RTMR0-2, `mrConfigId` ignorés par `quote.ts`) | haute | hors périmètre (`src/lib/tee/**` interdit) : résumé reformulé pour ne dire que ce qui est vérifié ; documenté §3, §7.1, §8 P0 |
| Page publique sans limite de débit (lecture en base, parse, rendu à chaque requête) | haute | corrigé : `page-guard.ts`, débit avant toute lecture, un jeton par requête |
| Plafond « global » par instance en serverless | haute | documenté §7.2, §8 P1 (persistance du verdict) |
| `dcap-qvl` sans délai réseau : vérifications bloquées accumulées | moyenne | corrigé : échéance dure 30 s, plafond de 5 simultanées ; non-annulation documentée §7.3 |
| Collatérale injoignable affichée « Failed » | moyenne | corrigé : « Not checked », verdict `incomplete` |
| Écart avec les valeurs épinglées après mise à jour d'enclave affiché comme échec | moyenne | corrigé : verdict `incomplete` avec explication |
| Vérification lente : le remplissage du cache après la réponse n'est pas garanti en serverless | moyenne | corrigé : promesse confiée à `after()` |
| Contrôles locaux recalculés, double rejeu de l'event-log | moyenne | en cache ; double passe dans `identity.ts` hors périmètre ; borné par le débit (§7.10) |
| Pannes déterministes et simulateur consomment le budget de vérification | basse | accepté (budget d'une vérification par minute et par clé au plus) |
| Clé de cache sans la quote, l'event-log ni les valeurs épinglées | basse | corrigé : `verificationCacheKey` (SHA-256 de toutes les pièces) |
| JSON servi en 200 alors que la page dit « pas disponible » pour une chaîne inconnue ; explorateur absent → 500 | basse | corrigé : chaîne résolue dans `resolveCertificate`, lien explorateur facultatif |
| Event-log inutilisable annoncé « No event log was recorded » | basse | corrigé : « No usable event log » |
| Libellé « rate-limited » pour un dépassement de délai | basse | corrigé |
| `settledAt` = heure d'enregistrement | basse | corrigé : libellé « Settlement recorded » |
| Débit global du JSON monopolisable, sortie volumineuse | basse | plafonds abaissés (20/240) ; prérequis d'ingress documenté §7.7, §8 |
| Entrée « en vol » orpheline si le vérificateur levait de façon synchrone (trouvé en relisant pendant le passage) | basse | corrigé : `Promise.resolve().then`, test dédié |

Tenté sans défaut au passage 1 : projection Prisma, champs de la vue et du JSON, préimage (absent du payload, certificat après `SETTLED` seulement), datasets privés ou supprimés (404 identique, même lecture), escrow non approuvé, `content-disposition` (identifiant borné), XSS (échappement React, hrefs encodés ou sur base fixe), liens externes, cache de page entre visiteurs (layout `force-dynamic`, JSON `no-store`), TD en mode debug (refusée par `dcap-qvl`), simulateur et valeurs épinglées absentes (jamais « vérifié »), rejets non gérés, minuteurs, cohérence avec la route attestation (16 recoupements identiques, `auditReceipt` non exporté).

**Passage 2** (corrections dans `76802e9`) : corrections du passage 1 vérifiées justes (`after()` et `headers()` conformes à la doc locale de Next 16.3.7, `cache` partagé entre métadonnées et page, clé de cache sans collision, aucune exception non rattrapée pendant le rendu). Nouveaux défauts :

| Défaut | Gravité | Suite |
|---|---|---|
| Une vérification abandonnée ou en erreur affichait « quote illisible » pendant 5 min, sans mesures, et pouvait masquer un échec franc (`reportDataMatches=false`) visible juste avant | moyenne | corrigé : entrée sans résultat → contrôles locaux (`pending` avec mesures) ; `error` réservé à l'échec des contrôles locaux |
| L'échéance dure rendait la place sans arrêter l'appel : la concurrence réelle n'était plus bornée | basse | corrigé : compteur des appels non terminés, refus au-delà de 2 × `maxInFlight`, test dédié |
| TCB déclassé depuis affiché comme échec franc (même raisonnement que l'épinglage) | basse | corrigé : verdict `incomplete`, résumé avec le statut TCB |
| « The Intel TDX quote below » alors qu'aucune quote n'est affichée | basse | corrigé |
| « Too many requests » servi en HTTP 200 | basse | accepté et documenté (§2.11, §7.8) |
| Test sans échéance dure laissant deux minuteurs de 30 s (fichier de test à 31 s) | basse | corrigé (le fichier passe en moins de 2 s) |
| Branchement de la page (`after()`, jeton unique, `headers()`) non testé | basse | documenté §5 |

**Passage 3** (sur `76802e9` seul) : corrections du passage 2 vérifiées justes (compteur des appels non terminés jamais négatif, aucun rejet non géré, aucun appel réseau ni boucle via les contrôles locaux, verdict vérifié non atteignable à tort, statut TCB `Revoked` toujours en « Not checked » car `dcap-qvl` lève). Un défaut réel : le test du plafond simultané était devenu instable (3 échecs sur 11 en suite complète) à cause de l'échéance dure de 20 ms et de la granularité des minuteurs Windows ; un commentaire de type périmé. **Corrigés** (`740439f`) : l'échéance dure revient à sa valeur par défaut dans ce test et son minuteur ne retient plus le processus.

**Vérification de cette dernière correction** : le passage de la suite complète a montré que détacher aussi l'attente du rendu (et pas seulement l'échéance dure) laissait la boucle d'événements se vider pendant un test qui l'attendait (11 tests « cancelled »). **Corrigé** (`bc25afe`) : seul le minuteur de l'échéance dure est détaché. Suite complète ensuite : `# cancelled 0`, tests de la slice 8 fois verts d'affilée. Pas de passage de revue supplémentaire : la correction tient en une condition sur un minuteur, couverte par la suite.

Écarté : aucun défaut remonté n'a été jugé faux. Ceux non corrigés sont hors périmètre (`src/lib/tee/**`, proxy) ou acceptés, et listés en §7 et §8.

## F1 — Ajout de fonds, serveur

Branche `feat/onramp-serveur`, depuis `origin/staging`. Côté serveur seulement ; l'interface est la slice F2, codée en parallèle sur le même contrat d'API.

### 1. Périmètre

- `src/lib/onramp/onramp.ts` (nouveau) : décision des options, validation du corps, construction des liens MoonPay et Relay.
- `src/app/api/onramp/options/route.ts` (nouveau) : `GET /api/onramp/options`, public.
- `src/app/api/onramp/route.ts` : ajout du `POST` ; `GET` historique inchangé, commentaire faux corrigé.
- `src/lib/i18n/errors-en.ts` : traduction des sept nouveaux messages d'erreur.
- `src/lib/onramp/onramp.test.ts` (nouveau), ajouté au script `test` de `package.json`.

Non touchés : `src/components/**`, `src/app/(app)/**` (F2), `src/lib/moonpay/url.ts` (réutilisé tel quel), `src/lib/wallet/onramp.ts`.

### 2. Contrat d'API livré

- `GET /api/onramp/options` → 200 `{ network, faucet, card, transfer, bridge, minCardUsd: 5 }`. Testnet : `faucet` seul. Mainnet : `transfer` et `bridge` vrais, `card` vrai seulement si `NEXT_PUBLIC_MOONPAY_PUBLISHABLE_KEY` commence par `pk_live_` et que `MOONPAY_SECRET_KEY` est non vide. `Cache-Control: no-store`.
- `POST /api/onramp` : `requireAuth` (origine vérifiée puis session, 403 ou 401), corps JSON de 1 Kio au plus, `{ method, asset, amount }` → 200 `{ url }`.
  - `card` : URL MoonPay signée, `currencyCode` `musd_mezo` ou `btc_mezo`, `baseCurrencyAmount` = montant en USD, entre 5 et 10 000.
  - `bridge` : `https://relay.link/bridge/mezo?fromChainId=8453&fromCurrency=<USDC Base>&toCurrency=<MUSD ou 0x0…0>&amount=<montant>&tradeType=EXACT_INPUT&toAddress=<session>`, montant entre 1 et 100 000.
  - Erreurs : 400 (méthode, jeton, montant non numérique ou hors bornes), 503 `Achat par carte indisponible` (carte sans clé live, ou testnet), 503 `Pont indisponible sur ce réseau` (pont sur testnet).
- `GET /api/onramp` : comportement identique (Across sur mainnet, MoonPay `usdc` ailleurs), couvert par un test de non-régression.

### 3. Décisions

1. **Adresse imposée par la session.** `parseOnrampRequest` ne lit que `method`, `asset` et `amount` ; `onrampUrl` reçoit `session.address` en argument séparé. Un `walletAddress` ou `toAddress` dans le corps est ignoré (testé sur les deux méthodes).
2. **Carte seulement avec une clé live sur mainnet.** MoonPay n'a pas de mode test pour `musd_mezo` ni `btc_mezo` : une clé sandbox ouvrirait un widget qui ne livre rien. La décision `cardAvailable` sert à la fois aux options et au `POST`, pour que l'écran ne propose jamais un chemin que le serveur refuse.
3. **Montant strictement numérique.** `"10"` est refusé (400) : pas de conversion implicite. Bornes incluses (5 et 10 000, 1 et 100 000). Aucune limite sur le nombre de décimales : MoonPay et Relay arrondissent eux-mêmes.
4. **Adresse MUSD du lien Relay dérivée de `stablecoin.ts`** (`getAddress(MAINNET_STABLECOIN_ADDRESS)`), pas recopiée : une seule source.
5. **Ordre des contrôles** : origine et session d'abord (403/401), puis corps (400), puis réseau et clés (503). Un visiteur non connecté n'apprend rien de la configuration par le `POST` ; les options publiques ne révèlent que des booléens.
6. **Commentaire corrigé** dans `route.ts` : MoonPay vend bien `musd_mezo` et `btc_mezo` sur 31612 (vérifié le 4 octobre). Le `GET` historique garde quand même le pont Across sur mainnet : il demande `currencyCode=usdc` par défaut, qui, lui, ne serait pas livré sur Mezo.

### 4. Risques

- **URL signée.** La signature HMAC-SHA256 couvre toute la query (`apiKey`, `currencyCode`, `walletAddress`, `baseCurrencyAmount`) : modifier l'adresse dans l'URL renvoyée invalide la signature côté MoonPay. Le secret ne quitte jamais le serveur (`server-only`) et n'apparaît dans aucune réponse ni aucun message d'erreur. L'URL elle-même n'est pas secrète (elle contient la clé publique et l'adresse de l'utilisateur) ; réponse en `no-store`.
- **Adresse imposée par la session.** Seule protection contre un lien d'achat qui enverrait les fonds ailleurs : couverte par deux tests. Le lien Relay, lui, n'est pas signé : l'utilisateur peut changer `toAddress` dans son navigateur avant de payer. Ce n'est pas une faille (il dépense son propre argent depuis son propre wallet Base), mais Sirius ne peut pas garantir l'arrivée sur l'adresse du compte par ce chemin.
- **Clés MoonPay.** Une clé publique live avec un secret sandbox (ou l'inverse) donne `card: true` mais des URL rejetées par MoonPay : la cohérence des deux clés n'est pas vérifiable sans appel réseau. À contrôler à la configuration de la prod. Une clé `pk_live_` sur testnet ne rend pas la carte disponible.
- **Pas de limitation de débit** sur le `POST` : il ne fait qu'un HMAC local, sans appel réseau ni écriture, et exige une session.
- **CSP** : l'ouverture des liens se fait par navigation (`window.open`), hors `connect-src`. Si F2 appelait Relay ou MoonPay en `fetch`, il faudrait élargir la politique de `src/proxy.ts`.

### 5. Tests

`src/lib/onramp/onramp.test.ts`, 17 tests : options par réseau et par clés (live, sandbox, secret absent ou vide, testnet) ; route des options ; bornes des montants (incluses, dépassées, `NaN`, `Infinity`, chaîne, `null`) ; méthode et jeton inconnus ; traduction anglaise des messages ; lien Relay (MUSD et BTC natif) ; URL MoonPay (actif, montant, adresse, signature recalculée) ; 503 carte et testnet ; `POST` sans session (401), d'une origine étrangère ou sans origine (403), adresse du corps ignorée, montants hors bornes, 503 avec le message exact ; `GET` historique inchangé et 401 sans session.

Non couvert : l'acceptation réelle des liens par MoonPay et Relay (pas de mode test MoonPay pour ces actifs).

### 6. Points à relire

- Le message 503 du pont sur testnet (`Pont indisponible sur ce réseau`) n'est pas fixé par le contrat : F2 doit se fier au statut, pas au texte.
- `minCardUsd` vaut 5 en dur (minimum MoonPay du 4 octobre) : si MoonPay le relève, changer `CARD_MIN_USD`.
- Le lien Relay part toujours de l'USDC de Base : un utilisateur qui a ses fonds ailleurs change la chaîne de départ dans Relay.
- Le `GET` historique pourra être retiré quand F2 ne l'appellera plus (`src/lib/wallet/onramp.ts`).

### 7. Résultats des vérifications (Windows)

- `npx pnpm@11.18.0 install --frozen-lockfile` : OK (avec un `DATABASE_URL` synthétique pour le `postinstall`).
- `npx pnpm@11.18.0 prisma generate` : OK.
- `npx pnpm@11.18.0 exec tsc --noEmit` : OK.
- `npx pnpm@11.18.0 lint` : OK.
- `NODE_OPTIONS=--conditions=react-server npx tsx --test src/lib/onramp/onramp.test.ts` : 17/17. Avec `english.test.ts`, `tour.test.ts`, `demo-host.test.ts`, `wallet/onramp.test.ts` et `stablecoin.test.ts` : 84/84.

## F2 — Ajout de fonds, interface

Branche `feat/onramp-interface`, PR vers `staging`. Interface seulement : les routes `GET /api/onramp/options` et `POST /api/onramp` sont celles de la slice F1 (#58, `src/app/api/onramp/**`, `src/lib/onramp/**`, `src/lib/moonpay/**`, non touchés ici), fusionnée dans `staging` pendant cette slice ; l'interface a été alignée sur son code au moment de la fusion de `origin/staging`. Tout ce qui suit est vérifiable depuis `git diff staging...HEAD`.

### 1. Périmètre

| Fichier | Rôle |
|---|---|
| `src/lib/wallet/onramp-client.ts` (nouveau) | Client du contrat d'API : lecture des options avec repli, demande d'URL, validation des montants, filtre d'URL, ouverture en nouvel onglet. `fetch` injectable |
| `src/components/wallet/AddFundsDialog.tsx` (nouveau) | Fenêtre « Add funds » : trois choix, formulaires carte et pont, panneau de transfert |
| `src/components/wallet/ReceiveFunds.tsx` | Prop `embedded` : rendu sans carte ni titre, sans le renvoi au bouton de pont. Rendu autonome inchangé |
| `src/app/(app)/wallet/page.tsx` | Mainnet : le bouton « Add funds » ouvre la fenêtre (il ouvrait le pont, libellé « Use the bridge »). La carte de réception en ligne est retirée de la page : elle est dans la fenêtre. Testnet : inchangé |
| `src/app/(app)/dashboard/page.tsx` | Mainnet : le bouton ouvre la fenêtre. Testnet : faucet inchangé |
| `src/lib/i18n/funding-en.ts` (nouveau), `english.ts` | Traductions anglaises, fusionnées dans `EN_MESSAGES` |
| `src/lib/wallet/onramp-client.test.ts` (nouveau), `receive-funds.*` | Tests, ajoutés au script `test` |

Non touchés : `src/lib/wallet/onramp.ts` (`addFunds()` sert toujours le faucet testnet ; sa branche mainnet n'est plus appelée par l'interface), `add-funds.ts`, `src/components/ui/**`, la lecture du solde.

### 2. Décisions

- **Le réseau du build décide de la fenêtre, le serveur décide des choix.** `resolveClientNetwork() === "mainnet"` ouvre la fenêtre ; testnet garde `addFunds()` et le faucet, à l'identique. Dans la fenêtre, seuls les choix à `true` de `/api/onramp/options` sont affichés, dans l'ordre carte, autre wallet, autre chaîne ; `faucet` n'est jamais un choix de la fenêtre.
- **Repli sans la route.** Panne réseau, statut non 2xx (404 tant que F1 n'est pas fusionnée, 401), JSON illisible, forme inattendue ou `network` différent de celui du build : `addFundsOptions(network)` avec `card: false`. Sur mainnet, cela donne « autre wallet » et « autre chaîne ». Seuls les champs du contrat sont recopiés.
- **Aucune adresse envoyée.** Le corps de `POST /api/onramp` est reconstruit champ par champ (`method`, `asset`, `amount`) : même un objet plus large passé par erreur ne fait rien partir d'autre. Le serveur prend l'adresse dans la session.
- **`amount` est un nombre JSON, et c'est toujours ce que l'utilisateur paie** : des dollars pour la carte, de l'USDC de Base pour le pont (lien Relay en `EXACT_INPUT`), y compris quand il reçoit du BTC. Deux décimales. Saisie en texte (`inputMode="decimal"`), virgule acceptée, ni exposant ni hexadécimal, plafond de saisie à 1 000 000. Minimum de la carte : `minCardUsd` du serveur (5 USD), vérifié aussi côté client pour un message immédiat. Les bornes du serveur (carte 5 à 10 000 USD, pont 1 à 100 000 USDC) ne sont pas recopiées : le serveur reste juge et son message est traduit.
- **URL renvoyée filtrée** : https absolue seulement, sans identifiants (`javascript:`, `data:`, `http:`, relatif refusés), puis `window.open(url, "_blank", "noopener,noreferrer")`.
- **Erreurs** : `error` du serveur affiché après `t()` (traduit s'il est connu, sinon affiché tel quel), sinon « Ajout de fonds indisponible ».
- **Le solde ne bouge pas** : la fenêtre n'écrit dans aucun état de la page. Le solde affiché reste celui lu sur la chaîne.
- **Accessibilité**, sur le modèle de `TourDialog` : `role="dialog"`, `aria-modal`, titre et description reliés, focus sur le titre à l'ouverture et à chaque changement de vue, Tab et Maj+Tab piégés, Échap ferme (écoute en capture sur `window`), clic sur le fond ferme (aucune opération en cours n'est perdue), focus rendu au bouton d'origine, défilement de la page bloqué. Erreurs en `role="alert"`, champ `aria-invalid`. `Modal.tsx` (partagé) n'a pas été modifié : il n'a ni piège de focus ni retour du focus, et `ComputeQuoteDialog` en dépend.
- **360 px** : fenêtre `w-full max-w-lg` dans une marge de 16 px, hauteur bornée à `100dvh - 2rem` avec défilement interne ; QR de 176 px centré. Vérifié sans défilement horizontal.

### 3. Risques

| Risque | Parade | Reste |
|---|---|---|
| **Mauvais réseau** (MUSD ou ETH envoyé sur Ethereum, Base, etc. vers l'adresse) | Avertissement visible en tête du panneau « autre wallet » (encart jaune) : seulement MUSD ou ETH, seulement sur Mezo, sinon perdus ; sources confirmées citées (app Mezo, Kraken, réseau « Mezo ») ; conseil d'un petit premier envoi | L'adresse est la même sur toutes les chaînes EVM : un envoi sur une autre chaîne n'est pas détruit (récupérable avec la même clé, si l'utilisateur la contrôle), mais Sirius ne le verra jamais. Le texte dit « perdus » pour rester simple |
| **Mauvais jeton** (USDC d'une autre chaîne, jeton non pris en charge) | Même avertissement ; le pont annonce explicitement « USDC sur Base → MUSD » | Un jeton ERC-20 quelconque envoyé sur Mezo arrive bien, mais n'est ni affiché ni utilisable |
| **Popup bloquée** : `window.open` est appelé après l'appel réseau, hors du geste utilisateur (Safari surtout) | Avec `noopener`, `window.open` renvoie toujours `null`, le blocage n'est pas détectable : un lien de secours « Nothing opened? Open the page here. » (`target="_blank" rel="noopener noreferrer"`) est toujours affiché après l'obtention de l'URL | Un second onglet si l'utilisateur clique le lien alors que le premier s'était ouvert : sans conséquence |
| URL malveillante renvoyée par le serveur | Filtre https | La confiance dans le domaine (MoonPay, pont) reste côté serveur (F1) |
| Fonds payés livrés à une autre adresse | Le client n'envoie aucune adresse | Dépend de F1 : l'adresse doit venir de la session |
| Montant dû à une faute de frappe | Validation, minimum, plafond | Le montant final est confirmé chez MoonPay ou sur le pont |

### 4. Tests

- **Unitaires** (`src/lib/wallet/onramp-client.test.ts`, 18 tests, `fetch` simulé) : contrat vérifié contre le code de F1 (les options de `onrampOptions` passent telles quelles, le corps envoyé passe `parseOnrampRequest` pour carte et pont, MUSD et ETH) ; options reprises telles quelles, champs en trop ignorés ; repli sur 404, 401, 500, panne réseau, HTML, booléen en texte, minimum négatif, réseau inconnu, `null`, réseau différent du build ; repli égal à `addFundsOptions` avec `card: false` ; choix affichés selon les options et le réseau (testnet : aucun, le faucet garde son bouton) ; corps exact sans adresse même si l'appelant en passe une ; erreur du serveur rendue telle quelle ; message générique ; URL non https refusée ; `noopener,noreferrer` ; montants.
- **Rendu** (`receive-funds.test.ts`) : nouveau cas `embedded` (QR, adresse, copie, ni titre ni renvoi au pont). Les cas existants passent sans modification.
- **i18n** : `english.test.ts` vérifie que toutes les clés `t()` statiques ont une traduction (vert).
- **e2e existants (testnet)** : `profile.spec.ts` (dont « sur testnet, la page Wallet garde le faucet »), `wallet.spec.ts`, `sirius.spec.ts`, `audit-regressions.spec.ts`, `upload.spec.ts` : 37/37, sans modification.
- **e2e mainnet, local et non versionné** (build `NEXT_PUBLIC_EVM_NETWORK=mainnet`, routes simulées) : 5/5 — Wallet et dashboard à 360 px (fenêtre ouverte, trois choix, pas de défilement horizontal, Tab piégé, Échap ferme et rend le focus au bouton) ; carte (MUSD par défaut, minimum refusé, corps `{ method: "card", asset: "MUSD", amount: 50 }`, ouverture `_blank` + `noopener,noreferrer`, erreur serveur traduite) ; autre wallet (avertissement, sources, QR, adresse) ; pont vers du BTC (montant en USDC, `25` → `{ method: "bridge", asset: "BTC", amount: 25 }`) ; sans la route options, pas de carte ; clic sur le fond ferme. Non versionné parce que la configuration Playwright du dépôt ne construit qu'un réseau (testnet).

### 5. Points à relire

1. **Contrat avec F1** : aligné et testé contre `src/lib/onramp/onramp.ts`. Le pont part toujours de l'USDC de Base : « BTC pour le gas » sur le pont veut dire « payer en USDC, recevoir du BTC ». À confirmer que c'est bien l'intention produit.
2. **Carte de réception retirée de la page Wallet mainnet** : l'adresse et le QR ne sont plus visibles qu'en ouvrant la fenêtre. L'adresse reste dans l'en-tête de la page et dans le bouton profil.
3. **La branche mainnet de `addFunds()` n'est plus appelée par l'interface** : à retirer ou à réécrire avec F1, qui change `GET /api/onramp`.
4. **Messages d'erreur du serveur** : affichés après `t()`. Ceux de F1 sont déjà dans `errors-en.ts` ; tout nouveau message serveur devra y être ajouté, sinon il s'affiche en français.
5. **Fenêtre tierce du wallet embarqué** : la fenêtre ne rend pas le reste de la page `inert` (contrairement à `TourDialog`) et intercepte Échap même si le focus est dans une fenêtre tierce. Sans conséquence aujourd'hui : aucune signature n'est demandée depuis la fenêtre.
