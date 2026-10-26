# Branches, déploiements et authentification

Guide actualisé le 23 septembre 2026. Les règles d'origines introduites le 12 septembre restent applicables ; la dernière revue concerne le code local. Une modification locale ne met pas à jour une instance déjà déployée et ne prouve pas l'état de sa configuration distante.

**Priorité au 26 septembre :** suivre la [checklist Phala](PHALA-DEMO-RESTE-A-FAIRE.md) et le [runbook manuel](PHALA-DEMO-RUNBOOK.md). La bascule globale staging v7, le nettoyage Neon et les sessions temporisées décrits dans les notes historiques ci-dessous sont différés. Réconcilier les anciennes variables avant tout prochain déploiement staging ; préparer une cible Phala dédiée, sans fermeture programmée.

**Transfert VPS vérifié le 25 septembre à 21:18 UTC :** les reapers staging et production tournent sur OVHcloud `162.19.66.80`, sous `sirius-deploy`, avec leurs images et configurations historiques v6. Les quatre secrets VPS de chaque environnement GitHub sont basculés ; les jobs VPS [staging](https://github.com/alibenyezza/sirius-mezo/actions/runs/36042451260/attempts/2) et [production](https://github.com/alibenyezza/sirius-mezo/actions/runs/35789836029/attempts/2) ont réussi. Seuls ces jobs ont été relancés : aucun nouveau build Vercel ni migration PostgreSQL. Watchdog et collecteur sont installés sous `sirius-ops`, timers désactivés, Phala arrêtée. Ali a choisi de laisser les anciens reapers en place ; la remise à zéro et la bascule Phala/v7 attendent la neutralisation des anciens accès en écriture staging. Preuves et suite dans [VPS-MIGRATION.md](VPS-MIGRATION.md). Partnersud reste hors périmètre.

Les corrections F1–F4 du 13 septembre sont documentées dans [ESCROW-V6.md](ESCROW-V6.md), désormais référence historique pour la migration. La prochaine évolution économique suit [v7](BILLING-INTEGRATION.md), après résolution des bloqueurs. Le choix automatique des origines ne déploie pas les contrats.

**Activation bloquée :** valider les limites encore ouvertes du [suivi de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026), puis les tarifs, la comptabilité et les plafonds fournisseurs de la [facturation compute](COMPUTE-BILLING.md). Le [parcours v7 signé jusqu’au remboursement](BILLING-INTEGRATION.md) est intégré localement, avec budget de clôture réservé et migration Prisma additive `20260923000000_add_compute_billing` préparée. Aucun tarif réel ni migration distante n’est actif. Appliquer les migrations avant de publier le nouveau client Prisma, même en v6 ; lire les prérequis de bascule Phala. Ne pas redéployer v6 pour le seul changement de runner entre-temps.

La future configuration v7 doit aligner `SIRIUS_BILLING_VERSION=7`, contrats, finalité, `RUNNER_BILLING_POLICY_FILE` et registre persistant `RUNNER_BUDGET_FILE`. Le Compose d'amorçage actuel ne réalise pas cette activation. Préserver le registre et ses intentions lors des redémarrages ; ne pas supprimer une intention incertaine pour débloquer un wallet. Une transaction confirmée est réconciliée avant le prochain envoi. Le journal chiffré autorise au plus trois envois identiques, sans nouveau nonce ni hausse des frais ; une intention toujours introuvable après ces reprises ou sans journal reste bloquée pour examen opérateur.

Validations du 23 septembre : 304 tests applicatifs, 13 tests des outils d'exploitation, lint et typage applicatif lors de la dernière passe ; build validé précédemment ; 79 tests contrats, 62 tests Playwright, le parcours EVM de facturation et le typage v7 lors des passes précédentes. La CI lance aussi `test:billing`, `test:postgres`, `test:operations` et le typage dédié v7. Ces tests ne remplacent pas un parcours v7 à deux vrais wallets et sur Phala actif.

**Point de reprise Phala au 23 septembre :** l'arrêt demandé par Ali est confirmé à 13:13 UTC ; le disque est conservé et reste facturé. Prévenir Ali avant toute nouvelle utilisation de Phala, avec son moment et son coût estimé. Aucune bascule Next, base, contrats ou reaper n’a été effectuée dans cette intégration. Les accès de production sont validés dans `.env.phala-production-secrets` ; Pinata est aussi configuré dans le fichier local `.env.phala`. Aucun prêt ni entraînement actif observé ; les 13 blobs de modèles historiques sont sauvegardés, leur re-livraison de clé reste à prouver. Le KYB actuel est ouvert sur testnet ; le compte local de déploiement/trésorerie est confirmé par Ali. L’export `.env.phala-production-current` contient toujours des valeurs `[SENSITIVE]` inutilisables. Lire [le point de reprise et l’ordre des opérations](PHALA.md#reprendre-ici--23-septembre-2026) avant tout déploiement main.

## Préparation v7 disponible localement

La [préparation opérationnelle](OPERATIONS-PREPARATION.md) documente la sauvegarde réelle chiffrée, sa restauration/migration sur PostgreSQL 18 local et les images `linux/amd64` construites sans publication. Les identifiants PostgreSQL sont conservés à la demande de Ali. Refaire un snapshot pendant la maintenance et conserver séparément sa clé et une copie hors machine.

Le Compose VPS transmet les paramètres de facturation, contrats, finalité et attestation au reaper. En v7, celui-ci refuse de démarrer sans runner distant et configuration d'attestation complète. Le délai d'arrêt de 90 secondes couvre un appel runner de 60 secondes. `pnpm ops:check-release <next.env> <reaper.env> <runner.env>` compare les trois fichiers explicites sans afficher leurs secrets ; ce contrôle ne certifie pas une attestation active ni des contrats publics.

Les images doivent être publiées puis figées par digest, et leurs mesures validées avant bascule. Au 25 septembre, le superviseur d'arrêt est installé sur le nouveau VPS, avec ses timers désactivés : préparer une session bornée et vérifier son fonctionnement avant tout futur essai Phala. La politique de crédits internes et ses limites sont suivies dans [PHALA-TRIAL-CREDITS.md](PHALA-TRIAL-CREDITS.md) ; les tarifs commerciaux et les autres plafonds fournisseurs restent distincts.

## Retrait automatique des crédits d’escrow (worker VPS)

Préparé localement le 26 septembre ; **désactivé par défaut**, ni publié ni activé. Le bouton de retrait manuel reste le repli.

**Fonctionnement.** Toutes les cinq minutes, le worker :
- relit `creditOf` pour les providers et borrowers des prêts clos depuis 30 jours (réglés, ou annulés avec remboursement) ;
- se limite aux escrows approuvés, `SIRIUS_ESCROW_ADDRESS` et `SIRIUS_LEGACY_ESCROW_ADDRESSES` ;
- appelle `withdrawFor(titulaire)` au-dessus du seuil : les fonds partent au seul titulaire, et Sirius paie le gas.

Les plus gros crédits passent d’abord. Chaque envoi est précédé d’une relecture et d’une estimation : un refus du contrat ne coûte donc aucun gas. Un refus ou une transaction rejetée ne sont jamais retentés. Le crédit de la trésorerie compute n’est pas concerné.

**Activation, sur le VPS, pour un environnement :**
1. Publier le code : le Compose déployé par le pipeline transmet les nouvelles variables.
2. Générer une clé neuve, écrite directement dans `.env.vps` sans jamais s’afficher ; seule l’adresse à financer apparaît :
   ```bash
   cd /opt/sirius-staging   # /opt/sirius pour la production
   IMAGE=$(sed -n 's/^SIRIUS_WORKER_IMAGE="\(.*\)"$/\1/p' .env.vps)
   { echo; docker run --rm --entrypoint node "$IMAGE" --input-type=module -e 'import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"; const key = generatePrivateKey(); console.error(`Adresse à financer : ${privateKeyToAccount(key).address}`); console.log(`SIRIUS_WITHDRAW_RELAYER_KEY=${key}`);'; } >> .env.vps
   ```
3. Envoyer à cette adresse un peu d’ETH du réseau visé, rien d’autre.
4. Ajouter dans `.env.vps` `SIRIUS_WITHDRAW_RELAYER_ENABLED=true`, `SIRIUS_WITHDRAW_RELAYER_MIN_USDC` et `SIRIUS_WITHDRAW_RELAYER_DAILY_GAS_ETH`. Seuil et plafond n’ont aucune valeur par défaut : ce sont des dépenses à décider explicitement.
5. Relancer : `docker compose -p sirius-staging --env-file .env.vps up --detach`. Le journal doit afficher `[withdraw-relayer] actif avec 0x… : seuil …, plafond …`. Une configuration invalide arrête le worker avec un message explicite, visible par `check-reaper.sh`.

**Règles de clé.** Une clé par worker : staging et production sur le même testnet se disputeraient sinon les nonces. Elle reste distincte du faucet, du vérificateur KYB, de l’enclave et de la trésorerie. Elle ne passe jamais par le chat, Git ou Vercel. Surveiller `[withdraw-relayer] réserve insuffisante` pour la recharger.

**Limites.**
- Plafond du jour et échecs connus sont tenus en mémoire : un redémarrage les remet à zéro.
- Les crédits de prêts clos depuis plus de 30 jours, ou sans déploiement enregistré, se retirent à la main.
- Le coût réel d’un retrait est à mesurer sur Mezo puis à reporter dans le [business plan](BUSINESS-PLAN.md).

## Assistant Sirio (chat Claude dans la bulle du guide)

Le guide animé de première visite (`src/components/guide/`) se range dans une bulle en bas à droite qui ouvre un chat. Les réponses viennent de Claude (`claude-opus-5-5`, effort « low », réponses courtes) avec un prompt système figé compilé depuis le dépôt (`src/lib/assistant/knowledge.ts`) et mis en cache par l'API. **Désactivé par défaut** : sans le drapeau, la route `POST /api/assistant/chat` répond 404 et la bulle n'affiche que les quatre réponses fixes et le contact.

**Activation, sur Vercel (projet staging puis production) :**
1. Créer une clé API Anthropic dédiée à l'instance (une par environnement, révocable séparément) et la poser dans `ANTHROPIC_API_KEY`, marquée « Sensitive ». Jamais de préfixe `NEXT_PUBLIC_`.
2. Générer un secret de signature (`openssl rand -hex 32`) dans `SIRIUS_ASSISTANT_SECRET` (32 caractères au moins, Sensitive). Il signe chaque réponse renvoyée au navigateur ; au tour suivant, les tours d'assistant sans signature valide sont écartés de l'historique (personne ne peut fabriquer de fausses réponses pour orienter le modèle). Le changer invalide seulement le contexte des conversations ouvertes.
3. Poser `SIRIUS_ASSISTANT_ENABLED=true` ; facultativement `SIRIUS_ASSISTANT_DAILY_CAP` (défaut 500 requêtes par jour UTC, au plus 2000), `SIRIUS_ASSISTANT_DAILY_BUDGET_USD` (défaut 5 $ de dépense estimée par jour) et `SIRIUS_ASSISTANT_DAILY_PER_IP` (défaut 40 questions par jour et par client).
4. Appliquer les migrations `20261007000000_add_assistant_usage` et `20261007010000_add_assistant_budget` (`AssistantUsage` : une ligne par jour, requêtes, jetons et micro-dollars ; `AssistantClientUsage` : une ligne par jour et par empreinte de client, nettoyée au fil de l'eau ; aucun contenu, aucune adresse en clair).
5. Redéployer. Au démarrage, `[sirius] SIRIUS_ASSISTANT_ENABLED=true : assistant Sirio ouvert, N requêtes par jour au plus, X $ de budget estimé par jour, M par client et par jour.` ; `true` sans clé ou sans secret refuse de démarrer, et `pnpm ops:check-release` signale clé ou secret posés sur le reaper ou le runner, ou sans le drapeau. Couper : drapeau à `false` puis redéploiement.

**Garde-fous.** Origine contrôlée comme toute mutation ; 10 questions par minute par adresse IP (`SIRIUS_TRUST_PROXY_HEADERS=true`) ou par wallet signé et 300 par minute par instance (mémoire) ; en base, partagés entre instances : 40 questions par jour et par client (IP si l'ingress la transmet, sinon wallet signé ; un visiteur sans l'un ni l'autre ne compte que dans les plafonds d'instance), plafond de requêtes et budget estimé par jour. 1000 caractères par message, 10 messages et 6000 caractères d'historique (tenu par le navigateur, revalidé et filtré par signature côté serveur), 800 jetons de réponse au plus. L'identifiant de conversation du navigateur ne sert qu'aux signatures, jamais aux plafonds. Aucune donnée de compte (adresse, soldes, prêts) n'est envoyée au modèle : seulement le texte des messages et le chemin de la page. Un navigateur qui part annule l'appel en amont. Le journal ne contient que des compteurs (tours, jetons, coût estimé, latence, motif d'arrêt), jamais le contenu. Un refus du classifieur est rejoué côté API sur le modèle de repli recommandé, et sinon affiché comme tel.

**Coût** (tarif Claude Opus 5.5 : 4 $ / 20 $ par million de jetons en entrée / sortie, écriture de cache 5 $, lecture 0,20 $ ; `estimateAssistantCostMicroUsd` applique ce barème aux jetons renvoyés par l'API et l'inscrit au budget du jour). Le prompt système fait ~3 000 jetons : écrit en cache à la première question d'une fenêtre de cinq minutes (~0,015 $), puis lu pour ~0,0006 $.
- Question typique (200 jetons de question, 500 produits réflexion comprise, cache lu) : ~0,011 $ ; conversation de trois questions : ~0,05 $.
- Pire cas par question : 6 000 caractères d'historique (~1 700 jetons) + 800 jetons produits + écriture de cache à chaque question si le trafic est espacé (> 5 min) : ~0,04 $.
- Pire cas par jour avec les réglages par défaut : le budget de 5 $ s'arrête avant le plafond de 500 requêtes (500 × 0,04 $ = 20 $) ; relever `SIRIUS_ASSISTANT_DAILY_BUDGET_USD` relève la dépense maximale d'autant. Le quota de 40 par client borne un poste à ~1,60 $ par jour.

## Serveur MCP (lecture seule)

`POST /api/mcp` expose aux agents les données publiques du site : catalogue, fiche, profils d'entraînement, état du protocole et vérification de certificat. **Désactivé par défaut** : sans `SIRIUS_MCP_ENABLED=true`, la route répond 404. Aucun secret, aucune migration. Détail, garde-fous et connexion des clients : [MCP.md](MCP.md).

## Une cible par branche

[`scripts/deployment-target.mjs`](../scripts/deployment-target.mjs) est la source de vérité utilisée par [la pipeline](../.github/workflows/pipeline.yml).

| Branche | Environnement GitHub | Projet Vercel | Origine canonique | Compose / dossier VPS |
|---|---|---|---|---|
| `staging` | `staging` | `sirius-mezo-staging` | `https://sirius-mezo-staging.vercel.app` | `sirius-staging` / `/opt/sirius-staging` |
| `main` | `production` | `sirius-mezo` | `https://sirius-data.tech` | `sirius` / `/opt/sirius` |

Alias explicitement autorisés pour **main** :

- `https://sirius-mezo.vercel.app` ;
- `https://sirius-mezo-byezzaali-gmailcoms-projects.vercel.app`.

Alias explicitement autorisé pour **staging** : `https://sirius-mezo-staging-byezzaali-gmailcoms-projects.vercel.app`.

`sirius-mezo.vercel.app` appartient à main, même si le dossier local est sur staging. Le navigateur ne connaît pas la branche ouverte dans l'éditeur. Les URL Vercel éphémères de chaque build ne sont pas implicitement autorisées. Aucun joker `*.vercel.app` n'est utilisé.

Les deux projets Vercel utilisent chacun leur environnement **Production**. Cela ne veut pas dire qu'ils partagent leurs variables. La branche choisit le projet ; elle ne choisit pas `Preview` à la place de `Production`.

**Branche `main`, environnement Vercel Production et réseau EVM mainnet sont trois notions distinctes.** Le réseau et les contrats restent ceux de chaque environnement. Fusionner sur main ne déploie pas de contrats, ne change pas le token et n'active pas mainnet.

## Ce qui se passe après une fusion

La cible fixe aussi `SIRIUS_REQUIRE_PHALA` : `true` sur main ; sur staging, la variable du dépôt `SIRIUS_STAGING_REQUIRE_PHALA` commande cette exigence. Elle est réglée à `true` depuis la validation matérielle du 25 septembre, pour la prochaine bascule décrite dans [PHALA-V7-STAGING.md](PHALA-V7-STAGING.md). La production applicative exige Phala même si le réseau reste testnet. Avant une fusion sur main, terminer le runbook [PHALA.md](PHALA.md) et configurer les mesures et le runner actif ; les secrets de démonstration ne sont pas convertis automatiquement. Aucun sélecteur de runner n’est exposé.

1. Le push sur `staging` ou `main` déclenche les tests, le typage, le lint, le build et les tests navigateur. Une PR seule ne déploie rien.
2. La référence exacte résout le projet Vercel, l'environnement GitHub, le dossier VPS et les origines. Une branche inconnue, un tag ou une référence de PR est refusé ; aucun fallback vers staging.
3. Le préflight et les migrations utilisent la base et les paramètres de l'environnement GitHub ciblé.
4. Le job Vercel réécrit le lien `.vercel/project.json` pour cette cible, puis synchronise trois variables publiques dans son environnement Production :
   - `SIRIUS_APP_ORIGIN` : domaine canonique signé ;
   - `SIRIUS_APP_ORIGIN_ALIASES` : liste exacte des alias de cette cible ;
   - `NEXT_PUBLIC_SIRIUS_APP_ORIGIN` : même domaine canonique, intégré au JavaScript navigateur.
5. La pipeline exécute `vercel pull`, `vercel build --prod`, puis `vercel deploy --prebuilt --prod`. Les origines sont définies **avant** le build et à l'exécution. Une erreur de synchronisation arrête le job.
6. Un smoke vérifie un vrai challenge sur le domaine canonique et chaque alias, son domaine signé, son adresse et sa clé de session. Il vérifie aussi que l'origine de l'autre branche est refusée. Il crée seulement des nonces d'authentification temporaires ; il ne signe pas de connexion, ne crée pas de prêt et n'envoie aucune transaction.

Les trois origines ne sont pas des secrets : elles sont enregistrées comme configuration lisible. Les secrets de session, de base, de transport et de chiffrement restent propres à chaque environnement. Ils ne sont jamais copiés d'une branche vers l'autre par cette synchronisation.

Les images worker/runner sont construites par la pipeline. Le worker est déployé sur le VPS de la cible ; la CVM Phala reste une opération distincte, avec vérification de ses mesures. Ne pas promouvoir un build staging déjà produit vers main : les variables `NEXT_PUBLIC_*` sont figées pendant la compilation.

## Pourquoi « Sign-in challenge rejected » apparaissait

Le 12 septembre, l'appel à `/api/auth/challenge` depuis `https://sirius-mezo.vercel.app` renvoyait **403 « Origine de requête non autorisée »**, avant toute signature du wallet. L'origine configurée du déploiement main était `https://sirius-data.tech`. Le front remplaçait toutes les erreurs de cette étape par le même message générique.

Le serveur accepte maintenant les alias déclarés, uniquement si l'origine du navigateur correspond aussi à celle de l'URL appelée. Les requêtes cross-site restent refusées. Le challenge conserve le domaine canonique attendu par le runner, pour ne pas casser ses délégations. Le front affiche l'erreur renvoyée par l'API ; une signature annulée peut être réessayée avec une nouvelle clé de session.

La clé d'ingestion porte elle aussi un domaine. Accepter un alias pour le login tout en comparant cette clé uniquement à `location.origin` déplace le bug au dépôt du CSV. Le navigateur compare désormais la clé au domaine canonique de **son build**, en conservant le contrôle de son empreinte. Une clé de staging est refusée par un build main.

Le runner distant doit garder le même `SIRIUS_APP_ORIGIN` que Next. La pipeline ne reconfigure pas automatiquement la CVM. Une modification de son compose peut changer son identité mesurée : suivre [PHALA.md](PHALA.md).

## Rechargement et navigation

La reconnexion du provider EIP-1193 ne constitue pas une demande de navigation. L'accueil `/` reste sur le blob après restauration du wallet et de la session, y compris après plusieurs rechargements. L'accès au dashboard reste un clic explicite. Recharger une route déjà ouverte comme `/dashboard` conserve cette route.

L'ancien `LandingRedirect` et son drapeau `sirius.return-to-landing` ont été retirés. Ce drapeau ne survivait qu'à un retour vers l'accueil et provoquait ensuite des redirections surprenantes.

## Subtilités d'un changement de branche local

Changer de branche remplace les fichiers suivis ; cela ne remplace pas les fichiers ignorés ni l'état du navigateur.

| Élément persistant | Risque | Pratique attendue |
|---|---|---|
| `.vercel/project.json` | Déployer manuellement le code de staging vers le projet main, ou l'inverse | La pipeline recrée ce lien depuis la branche. Un lien local existant n'est pas une preuve de cible. |
| `.env`, `.env.local`, `.env.production.local`, `.vercel/.env.production.local` | Garder une base, une origine ou des adresses d'une autre cible | Vérifier les noms des variables et leur cible ; ne jamais afficher les secrets pour comparer. Un changement de branche ne télécharge pas les bonnes valeurs. |
| Variables exportées dans le terminal | Écraser silencieusement celles des fichiers `.env` | Elles ont priorité ; repartir d'un terminal configuré pour l'environnement voulu. |
| `.next`, `.vercel/output` | Réutiliser du JavaScript contenant les anciennes variables `NEXT_PUBLIC_*` | Reconstruire pour la cible ; un changement de variable à l'exécution ne corrige pas le bundle. |
| `node_modules`, Prisma généré, ABI | Garder des dépendances ou un client d'une autre révision | Réinstaller avec le lockfile, régénérer Prisma et les ABI seulement si leurs sources ont changé. |
| Cookie, IndexedDB et localStorage sur `localhost` | Conserver le compte, la délégation, les favoris et les préférences d'une autre branche | Se déconnecter puis se reconnecter après changement d'environnement. Le port sépare IndexedDB/localStorage, mais pas les cookies d'un même hôte. |
| PostgreSQL et volume de clés local | Confondre les données ou perdre la capacité de relivrer les modèles | Utiliser des bases et volumes séparés. Ne jamais remplacer une master key pour réparer le login. |
| CSV d'exemple locaux | Faire échouer les tests sur des fixtures absentes ou mal rangées | `pnpm datasets:generate` recrée les synthétiques au bon emplacement ; la pipeline le fait avant les tests. |

Pour Next, la priorité est : environnement du processus, `.env.$NODE_ENV.local`, `.env.local` (hors tests), `.env.$NODE_ENV`, `.env`. Prisma et les scripts qui utilisent seulement `dotenv/config` ne chargent pas automatiquement toute cette hiérarchie. Le runner de développement charge explicitement `.env.local`, puis `.env`.

Une valeur vide ou `[SENSITIVE]` issue d'un export Vercel ne constitue pas un secret utilisable. Le SQLite historique `file:...` ne convient plus à l'adaptateur PostgreSQL. Garder `SIRIUS_APP_ORIGIN=http://localhost:3000` et `NEXT_PUBLIC_SIRIUS_APP_ORIGIN` vide pour un développement sur cette origine ; ne pas placer les origines publiques de main dans un `.env.local` partagé avec staging.

## Vérifier sans déployer

### Échec du job Migrations

`check-evm-migration.ts` s'exécute **avant** `prisma migrate deploy`. S'il échoue, le déploiement Vercel est ignoré ; ce n'est pas une erreur du build front. La base vient du secret GitHub `DATABASE_URL` de l'environnement ciblé (`staging` pour la branche staging), pas du lien Vercel local.

Le préflight décrit l'hébergeur déduit du domaine, l'indice de pooler, le port et le mode TLS, sans afficher l'hôte ni les identifiants. Un hébergeur inconnu ou un pooler non détecté reste indéterminé. Il annonce ensuite chaque étape PostgreSQL puis RPC : la dernière étape affichée situe l'échec.

Le diagnostic conserve les codes SQLSTATE valides, même absents du dictionnaire de traduction. Le motif natif PostgreSQL est limité à une ligne, après masquage des URL et des composants de `DATABASE_URL` (y compris les identifiants encodés). L'objet d'erreur Prisma/RPC complet n'est jamais journalisé. Par exemple, `28P01` indique un refus d'authentification, `42P01` une table absente et `57P03` un serveur qui ne peut pas encore accepter de connexion. Voir les [codes PostgreSQL](https://www.postgresql.org/docs/current/errcodes-appendix.html). Ne pas appliquer les migrations ni contourner le préflight avant d'avoir identifié la cause.

L'avertissement de `pg-connection-string` sur `sslmode=require` annonce un futur changement de comportement ; il ne prouve pas un échec TLS. `sslmode=verify-full` rend explicite le comportement actuellement utilisé, mais ne répare ni les identifiants, ni le réseau, ni le schéma SQL. Ne pas désactiver la vérification des certificats pour faire passer ce contrôle.

Les premiers logs staging du 13 septembre ont affiché le message générique, puis seulement `P2010` à la détection de `Loan`. La première liste de diagnostics masquait certains SQLSTATE : ce défaut a été reproduit avec le vrai client Prisma et son adaptateur, puis corrigé.

Le troisième log confirme la cause : **Neon, connexion via pooler, SQLSTATE `53000`, quota de temps de calcul dépassé**. Le serveur refuse la connexion avant toute lecture applicative ou vérification EVM. Modifier la requête SQL, les certificats ou relancer les jobs ne rétablit pas le quota.

Pour remettre staging en service :

1. Ouvrir le projet concerné dans la console Neon et vérifier sa consommation et sa période de facturation.
2. Rétablir sa capacité de calcul. Sur l'offre gratuite, la suspension prend fin au renouvellement mensuel du quota ou au passage à une offre payante ; voir la [documentation officielle Neon](https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md). La suspension pour quota ne supprime pas les données.
3. Une fois la connexion disponible, relancer les jobs échoués de la pipeline staging. Le préflight pourra alors poursuivre les contrôles SQL et EVM habituels.

La consommation est aussi à examiner côté worker : `src/worker/reaper.ts` interroge la base toutes les 30 secondes par défaut, même sans prêt à traiter. S'il fonctionne en continu sur cette base, il peut empêcher la mise en veille Neon après cinq minutes d'inactivité ; c'est une piste fondée sur le code, pas une mesure de consommation du compte. Voir [la gestion des computes Neon](https://neon.com/docs/manage/endpoints/). Ne pas arrêter un worker chargé de prêts actifs sans prévoir leur suivi. Aucun worker, quota, abonnement ou secret distant n'a été modifié pendant ce diagnostic.

### Échec du contrôle du reaper sur le VPS

Après rétablissement de Neon, le run staging du 13 septembre valide les migrations, Vercel et les smokes, mais échoue sur « Vérifier que le reaper tourne ». L'ancienne commande terminait par `grep -q 'reaper running'` : un conteneur arrêté ou en redémarrage donnait seulement un code 1, sans état ni logs. La première ligne `HOST=...` affichée par GitHub n'identifie pas la commande fautive.

Une incompatibilité de démarrage a été reproduite avec la configuration **distante** de Vercel staging, puis vérifiée sur le testnet : Escrow `0xede81141d007593d4bfce2de4778f753d167700e` est v5 et DatasetRegistry `0x18a6594a7a5b227b87808c733c40067d20357618` est v4 ; leurs liaisons réciproques sont correctes. Le worker appelait le contrôle v6 des nouveaux prêts et refusait donc ces contrats pourtant lisibles par son moteur de réconciliation.

Le worker utilise désormais un contrôle de lecture dédié qui accepte l'escrow v5 ou v6 avec le registre v4 correctement lié. Ce contrôle n'alimente pas le cache d'autorisation des nouveaux prêts : ceux-ci exigent toujours v6. Les erreurs métier de démarrage sont affichées sans exposer les erreurs RPC brutes.

`deploy/vps/check-reaper.sh` affiche l'état, le code de sortie, l'éventuel dépassement mémoire et le nombre de redémarrages du conteneur. En cas d'échec, il affiche les derniers logs du seul service `reaper` du projet ciblé. Il ne lit ni n'affiche la configuration des secrets. Ce contrôle exige aussi une ligne `[reaper] passe ok` récente : il vérifie que le processus tourne et qu'une passe vient d'aboutir, pas la réussite de toutes les réconciliations futures.

Le fichier `/opt/sirius-staging/.env.vps` doit rester cohérent avec la configuration de l'application ; il n'a pas été consulté ni modifié pendant cette correction. Le correctif doit être publié pour reconstruire l'image worker et déployer son nouveau digest. Relancer uniquement l'ancien job VPS réutiliserait l'ancienne image.

### Contrôles locaux

```bash
node scripts/deployment-target.mjs staging
node scripts/deployment-target.mjs main
node --test scripts/deployment-target.test.mjs
pnpm datasets:generate
pnpm test
pnpm lint
pnpm build
pnpm test:e2e
```

Les deux premières commandes affichent uniquement la cible versionnée, sans lire de secret, changer de branche ou appeler Git. Le smoke distant `node scripts/smoke-auth.mjs staging` vise exclusivement le déploiement staging ; son résultat dépend du code et de la configuration déjà publiés, pas des modifications locales.

Les tests locaux ne prouvent pas que DNS, Vercel, la base et Phala sont correctement configurés à distance. Un domaine absent ou inaccessible fait échouer le smoke même si son alias Vercel répond. Les constats historiques et l'état observé de staging sont dans [l'audit du 12 septembre](AUDIT-STAGING-2026-09-12.md) ; les limites actuelles figurent dans le [suivi du 23 septembre](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026).

## Correctifs du 13 septembre

Next et `eslint-config-next` sont alignés sur `16.3.5`. Après changement de branche, réinstaller avec `pnpm install --frozen-lockfile` avant de lancer Next ; ne pas partager un ancien `node_modules` ou bundle entre ces versions. Le bloc généré par Next dans `AGENTS.md` ne change pas la règle du projet : ce fichier reste exclu du suivi.

La vérification CI exécute `pnpm audit:deps`. Les alertes modérées, hautes et critiques bloquent ; les alertes faibles restent visibles. Au 13 septembre, une alerte faible `elliptic` n’a pas de correction publiée. Voir [le suivi des correctifs](AUDIT-CORRECTIFS-2026-09-13.md).

Changer de compte, de provider ou de réseau invalide désormais une connexion en cours et recrée les états privés. Cela ne remplace pas la déconnexion/reconnexion nécessaire quand les secrets, la base ou le domaine d’un même localhost changent avec la branche.

Le registre KYB strict passe à v3 (domaine EIP-712 `2`, époque signée). La migration reste indépendante du déploiement Next. Garder les anciens escrows dans `SIRIUS_LEGACY_ESCROW_ADDRESSES` pour les crédits et les preuves, et tester le retrait dans Wallet après release/refund.

### Échec des tests de solde en CI

Les premiers tests A1/A5 passaient localement grâce à l’adresse USDC de `.env.local`, absente du job GitHub de vérification. `fetchUsdcBalance` résout cette adresse avant d’appeler `eth_call` : sans elle, le mock ne reçoit jamais la lecture. Les tests Wallet/Dashboard attendent donc une réponse retardée qui n’existe pas ; celui du retrait confirme le crédit à zéro mais ne peut pas afficher le nouveau solde.

`playwright.config.ts` définit désormais une adresse USDC factice identique dans `SIRIUS_USDC_ADDRESS` et `NEXT_PUBLIC_SIRIUS_USDC_ADDRESS` pour son serveur de test. Ces valeurs remplacent celles du terminal ou des `.env` locaux et ne configurent aucun déploiement. Il ne faut pas ajouter de secrets de staging à ce job ni augmenter les timeouts pour résoudre ce cas.

Après une modification des tests E2E, vérifier aussi depuis une copie sans `.env*`, avec un environnement de processus nettoyé et un seul worker. Une suite verte dans le dossier de développement ne suffit pas à valider la configuration CI.
