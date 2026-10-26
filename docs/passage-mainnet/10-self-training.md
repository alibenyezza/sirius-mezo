# Self training

Fichiers : `src/app/(app)/train/page.tsx`, `src/lib/sirius/self-train.ts`, `src/app/api/train/**`, `src/lib/auth/admin.ts`, `src/lib/sirius/self-training-access.ts`, `src/app/api/admin/me/route.ts`, `src/lib/phala-demo/operator.ts`.

## Ce qu'on a dit

- Une page cachée, seulement pour nous et pour les tests au début. On la révèle plus tard selon les retours.
- Liée au dashboard admin.

## Avant le 6 — P1

- Le self training disparaît de l'interface publique ([09](09-train-et-certificat.md)).
- **Accès réservé** aux adresses opérateurs : vos deux wallets. Le contrôle existe déjà pour la démo Phala (`SIRIUS_DEMO_OPERATORS`, `operatorAllowed`). On le réutilise avec une variable dédiée `SIRIUS_ADMIN_ADDRESSES`, pour ne pas mélanger les rôles.
- La protection se fait **côté serveur**, sur les routes de self training. Masquer un lien dans l'interface ne suffit pas.
- Un non-opérateur qui tape l'URL reçoit une page « bientôt disponible », sans fuite d'information.

## Contrôle côté serveur (N5)

Variable `SIRIUS_ADMIN_ADDRESSES`, documentée dans `.env.example` : adresses EVM de l'équipe, séparées par des virgules, toute casse acceptée, préfixe `0X` compris (tout est comparé en minuscules). Lue par `adminAllowed` dans `src/lib/auth/admin.ts`.

- Vide ou absente : personne n'est administrateur.
- Une seule entrée invalide (pas une adresse, adresse nulle, virgule finale), ou plus de dix entrées doublons compris : la liste entière est refusée, personne n'est administrateur. Une faute de frappe ferme donc l'accès au lieu de l'ouvrir ; un avertissement est écrit dans les journaux du serveur, sans la valeur.
- Variable distincte de `SIRIUS_DEMO_OPERATORS`, réservée aux opérateurs de la démo Phala (route `/api/phala-demo/operator` côté Next et contrôleur).

Routes gardées par `assertSelfTrainingAccess` (`src/lib/sirius/self-training-access.ts`), juste après l'authentification et avant toute requête en base, toute vérification de grant et tout appel runner :

| Route | Wallet authentifié hors équipe |
|---|---|
| `GET /api/train` | 403 « Bientôt disponible » (hors instance de démo, voir ci-dessous) |
| `POST /api/train` | 403 « Bientôt disponible », corps non lu (hors instance de démo, voir ci-dessous) |
| `POST /api/train/[id]/key` | 403 « Bientôt disponible », corps non lu |
| `GET /api/admin/me` | `{ "admin": false }` ; indique à l'interface si le wallet connecté est admin, pour afficher ou masquer |

Exception, uniquement sur une instance de démonstration Phala, aux mêmes conditions que `demoEnabled` (`SIRIUS_PHALA_DEMO=true`, `EVM_NETWORK=testnet`, `TEE_MODE=phala`, pas de simulateur dstack ; donc jamais sur mainnet) : la démo publique ([12](12-test-phala.md)) est elle-même un self training sur ses propres données et passe par `/api/train`. Un visiteur authentifié y garde la liste de ses jobs et le lancement d'un entraînement porté par un grant de démo (`payload.demoSessionRevision` entier strictement positif, vérifié ensuite par le runner contre la session ouverte). Sur une telle instance, `POST /api/train` lit donc le corps pour reconnaître le grant avant de refuser : un non-admin y reçoit les 400/415 habituels sur un corps mal formé. Le reste, dont la livraison de clé, reste réservé à l'équipe.

Le script de reprise `pnpm ops:verify-model-delivery` ([BACKUP-RECOVERY](../BACKUP-RECOVERY.md)) se connecte avec l'adresse dérivée de `MEZO_DEPLOYER_KEY` et appelle `GET /api/train` puis `POST /api/train/[id]/key` : cette adresse doit figurer dans `SIRIUS_ADMIN_ADDRESSES` de l'instance interrogée, sinon il s'arrête sans message lisible : exit 1, un diagnostic JSON sur stderr (`phase` « historique-proprietaire » ou « livraison-cle », `verified: false` ; le `httpStatus` de ce JSON peut refléter la déconnexion finale), et `failurePhase` + `httpStatus: 403` dans `report.json`. Seuls les modèles d'entraînement de l'inventaire sont concernés, pas les prêts.

## Après le 6 — V1.2

- Page dédiée `/admin/self-training`, accessible depuis le dashboard admin ([15](15-dashboard-admin.md)).
- Usage : tester de nouveaux modèles sur nos propres données, préparer leur sortie publique.
- Révélation publique décidée selon les retours de la bêta. Quand elle arrive, la page sort de l'admin avec son tuto ([02](02-general.md)).

## Terminé quand

- Avant le 6 : aucun utilisateur ne voit ni n'atteint le self training. Vos deux adresses y accèdent, et les routes refusent les autres côté serveur.
