# Migration du VPS Sirius — 25 septembre 2026

**Reprise au 26 septembre :** ce document conserve les preuves du transfert des reapers. Pour la suite, suivre la [checklist Phala](PHALA-DEMO-RESTE-A-FAIRE.md) : bascule globale v7 et nettoyage Neon différés, watchdog temporisé désactivé, contrôleur manuel à installer. Les procédures historiques ci-dessous ne réactivent pas ces opérations.

Plan transmis par Ali, adapté au workflow et au lot B en cours. Nouvelle cible OVHcloud : **162.19.66.80**. **Ali a terminé les tranches 0 à 2**, confirmé par Ali. Les connexions par clé à `ubuntu` et `sirius-deploy` sont vérifiées, avec l’empreinte d’hôte `SHA256:o710R0oGhbHCvh6p/AhwLEjWrDbQfvK23jjRGIn+mz8`. Le relais est passé à Ali / intégration.

## État vérifié après le relais d’Ali

- Docker Engine `29.8.1` et Compose `v5.5.1` sont disponibles. `sirius-deploy` appartient au groupe Docker et n’a pas de sudo ; `ubuntu` dispose du sudo nécessaire à l’installation systemd.
- `/opt/sirius` et `/opt/sirius-staging` sont en `0750`, leurs `.env.vps` en `0600`, tous appartenant à `sirius-deploy`. `sirius-ops` et `/var/lib/sirius-ops` en `0700` sont présents.
- Les clés dédiées à GitHub Actions staging et production ont été ajoutées au compte `sirius-deploy` ; leurs connexions sont vérifiées. La clé opérateur est conservée.
- Les deux `.env.vps` copiés contiennent les configurations **historiques v6**, avec deux hôtes Neon distincts. La connexion staging peut être utilisée sur le VPS, sans demander de nouveau son mot de passe à Ali ni rapatrier le fichier historique sur son Mac.
- Au premier contrôle, aucun conteneur ni fichier Compose n’était présent. Les deux reapers ont ensuite démarré ; les preuves de déploiement figurent ci-dessous.

**Décision finale de Ali : effectuer le transfert sans attendre l’adresse de l’ancien VPS et sans arrêter ses reapers.** Les nouveaux reapers conservent les images et configurations historiques. L’état des anciens processus n’a pas été contrôlé ; s’ils tournent encore, les lectures Neon/RPC et les tentatives de traitement sont doublées. Leur retrait reste différé. La remise à zéro de Neon et la bascule applicative Phala/v7 restent une deuxième opération, sur staging, après neutralisation de tous les anciens accès en écriture.

L’ancien serveur héberge aussi partnersud : aucune extinction de la machine, suppression globale de Docker ou modification des dossiers partnersud ne fait partie de cette migration Sirius.

## Résultat du transfert — 25 septembre, 21:18 UTC

| Cible | Nouveau conteneur | Job GitHub relancé seul | Résultat |
|---|---|---|---|
| Staging | `sirius-staging-reaper-1` | [Run 36042451260, tentative 2](https://github.com/alibenyezza/sirius-mezo/actions/runs/36042451260/attempts/2), commit `c30cff8` | Réussi à 21:11:50 UTC |
| Production | `sirius-reaper-1` | [Run 35789836029, tentative 2](https://github.com/alibenyezza/sirius-mezo/actions/runs/35789836029/attempts/2), commit `95ed404` | Réussi à 21:18:18 UTC |

Les quatre secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` et `VPS_KNOWN_HOSTS` pointent vers le nouvel hôte dans chacun des deux environnements GitHub, avec une clé distincte par environnement. Les deux conteneurs tournent sans port publié ni redémarrage au contrôle. L’accès PostgreSQL a été vérifié en lecture seule sur les bases distinctes : 13 prêts staging et 12 production au moment du contrôle. Cela ne constitue pas un test complet de règlement/reprise.

Images worker conservées :

- Staging : `ghcr.io/alibenyezza/sirius-worker@sha256:1832fbaf33a492852b61695df672216de3dfb1039e7cc06ba8207b1b684a59b0`.
- Production : `ghcr.io/alibenyezza/sirius-worker@sha256:4678767c47d8ad552dbcd356804637f9eb811b36b336af9c8dc1b9fd383985f5`.

Seul le job **« Reaper sur le VPS »** a été exécuté de nouveau. Les autres jobs gardent leurs dates historiques du 24 septembre pour staging et du 22 septembre pour production : aucun nouveau build Vercel ni migration PostgreSQL pendant ce transfert. Le frontend staging reste donc historique, malgré les variables v7 déjà préparées dans Vercel.

Watchdog et collecteur de budget sont installés sous `sirius-ops` dans `/opt/sirius-ops`, avec Node `22.23.2`, pnpm `11.18.0` et Phala CLI `1.1.22`. Les unités systemd et le chargement du collecteur sont vérifiés. Le profil Phala authentifié a confirmé la CVM **arrêtée**, sans opération en cours. **Les deux timers restent désactivés et inactifs ; aucun `session.json` n’est créé.** La collecte attestée et l’arrêt automatique pendant une session active restent à tester depuis cet hôte.

Les anciens reapers n’ont pas été arrêtés. La semaine d’observation avant retrait de leurs dossiers n’a donc pas commencé. La base staging n’a pas été vidée et les reapers restent en configuration v6 ; la suite est suivie dans [le lot B](PHALA-V7-STAGING.md).

| Tranche | Preuve attendue |
|---|---|
| 0 — SSH et système | Connexion par clé testée, empreinte d’hôte transmise |
| 1 — Docker et comptes | Docker fonctionne pour `sirius-deploy`, `sirius-ops` sans droits Docker |
| 2 — Configurations | Secrets historiques transférés directement ; configuration v7 à appliquer séparément |
| 3 — Staging | Nouveau reaper vérifié avec la configuration historique |
| 4 — Pipeline staging | Secrets staging basculés, job VPS réussi ; autres jobs historiques conservés |
| 5 — Production | Configuration et image de production conservées, validation propre |
| 6 — Supervision et observation | Unités installées, puis sept jours d’observation avant retrait des seuls dossiers Sirius |

L’état du runner, les contrats et les mesures actives sont dans [PHALA-V7-STAGING.md](PHALA-V7-STAGING.md). Phala a été arrêtée après sa validation. Cette migration ne doit pas réinitialiser ses volumes ni la redémarrer sans créneau d’essai planifié.

## 0 — Première connexion

Changer le mot de passe initial via la console ou une session authentifiée. Installer les clés publiques des opérateurs ; tester une seconde connexion par clé avant de désactiver les accès par mot de passe et root. Contrôler la configuration SSH effective, y compris les fichiers inclus et l’authentification interactive, puis valider sa syntaxe avant rechargement. Conserver la console OVH accessible pendant ce contrôle.

Autoriser SSH sur le port 22 avant d’activer le pare-feu ; configurer fail2ban et les mises à jour automatiques. Le reaper ne publie aucun port.

La clé opérateur de Ali est `~/.ssh/sirius_vps.pub` sur son Mac. Les clés dédiées aux pipelines sont `~/.ssh/sirius_staging_actions_20260925.pub` et `~/.ssh/sirius_production_actions_20260925.pub` ; leurs parties privées sont enregistrées dans les secrets GitHub des environnements correspondants. La clé opérateur est autorisée pour `ubuntu` et `sirius-deploy`, les clés pipeline pour `sirius-deploy`.

Depuis la console du nouveau serveur, relever :

```bash
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
```

L’empreinte `SHA256:…` sert à vérifier l’identité. Le secret **`VPS_KNOWN_HOSTS` contient la ligne complète**, au format `162.19.66.80 ssh-ed25519 AAAA…`. Comparer sa clé à l’empreinte relevée via la console avant de la retenir ; `ssh-keyscan` seul ne prouve pas l’identité du serveur. [Documentation OpenSSH](https://man.openbsd.org/ssh-keyscan).

## 1 — Docker, utilisateurs et répertoires

Installer Docker Engine et le plugin Compose depuis le dépôt officiel Docker. Ajouter `sirius-deploy` au groupe Docker, avec sa clé pipeline. Ce groupe donne des privilèges équivalents à root ; `sirius-ops` doit en rester exclu. [Documentation Docker](https://docs.docker.com/engine/install/linux-postinstall/).

- `/opt/sirius` et `/opt/sirius-staging` : propriétaire `sirius-deploy`, mode `0750`.
- `sirius-ops` : compte système sans droits Docker, répertoire personnel et état dans `/var/lib/sirius-ops`, mode `0700`.
- `/opt/sirius-ops` : code et dépendances du superviseur, installés par l’administrateur, lisibles mais non modifiables par `sirius-ops` ; séparés des configurations du reaper.

Vérifier Docker sous `sirius-deploy` avec un conteneur de test supprimé à sa sortie (`--rm`). Vérifier ensuite qu’aucun conteneur de test ni port publié ne subsiste.

## 2 — Configurations et remise à zéro staging

L’opérateur qui connaît l’ancien VPS transfère les fichiers `.env.vps` directement entre serveurs, dans une connexion SSH dont les hôtes sont vérifiés. Aucun transit des fichiers historiques par un chat, un mail ou le poste local. Vérifier empreintes de fichiers et permissions, pas seulement leurs tailles : propriétaire `sirius-deploy`, mode `0600`. Conserver les anciennes configurations à leur emplacement pour la reprise de l’infrastructure.

Le fichier **staging transféré conserve d’abord la configuration historique pour le transfert d’hébergement**. Lors de la deuxième opération, il doit recevoir v7, les nouveaux contrats, le RPC archive, le nouveau secret de transport, l’origine staging, `SIRIUS_REQUIRE_PHALA=true`, l’URL Phala et les mesures actives. Utiliser alors les valeurs préparées du lot B et vérifier leur cohérence avec Vercel. Le fichier production reste séparé et n’est jamais remplacé par celui de staging.

Pour la remise à zéro Neon autorisée par Ali : confirmer l’identité de la base staging, suspendre les écritures de l’ancienne application et des reapers avant la transaction de nettoyage. Sans accès à l’ancien hôte, une révocation de ses accès propres à staging peut remplacer son arrêt, à condition de traiter aussi les connexions déjà ouvertes et de vérifier qu’il ne peut plus écrire. Cette modification d’accès n’a pas été effectuée : Ali avait choisi de conserver les identifiants existants. Conserver le schéma et les migrations. Appliquer et vérifier les migrations attendues avant le démarrage du worker v7.

Ne pas importer la master key ni une clé privée de runner/déploiement dans le nouveau VPS. L’accès staging est disponible dans le `.env.vps` transféré, à utiliser sur le serveur sans rapatrier ce fichier historique ; Pinata ne fournit pas l’accès PostgreSQL.

## 3 — Démarrer staging sur le nouveau VPS

Pour le premier transfert, conserver l’image worker immuable du fichier copié et la configuration historique. Pour la bascule v7 suivante, utiliser une image worker issue du code v7 validé par la CI. Le digest du **runner Phala** ne désigne pas l’image **worker**.

Copier `deploy/vps/compose.yaml` dans `/opt/sirius-staging`, configurer son digest dans `SIRIUS_WORKER_IMAGE` et authentifier `sirius-deploy` auprès de GHCR avec un accès en lecture. Ne pas afficher le fichier `.env.vps` ni une configuration Compose avec secrets interpolés.

Le nom de projet est obligatoire : le Compose versionné porte `name: sirius` par défaut. Exécuter sur le nouveau VPS seulement, après les contrôles précédents :

```bash
cd /opt/sirius-staging
docker compose -p sirius-staging --env-file .env.vps up --detach --pull always
```

Exécuter `deploy/vps/check-reaper.sh /opt/sirius-staging sirius-staging`. Ce script prouve que le conteneur tourne et qu’une passe a abouti (`[reaper] passe ok`) dans les deux dernières minutes ; une passe qui lève ou dont tous les prêts restent en erreur écrit `passe échouée` et le fait échouer. Il ne prouve pas que chaque prêt a été réconcilié. Vérifier aussi le démarrage applicatif, l’accès Neon, le RPC et la cohérence runner/contrats, puis une réconciliation réelle lors du parcours de test.

Le code comporte des mises à jour conditionnelles contre les courses, mais le verrou `running` du reaper est propre à chaque processus. La coexistence retenue par Ali conserve **la même image et la même configuration historique** ; elle ne prouve pas l’absence de courses entre processus. Elle ne valide pas une coexistence avec v7 : lors de la remise à zéro et de la bascule v7, tous les anciens accès en écriture doivent être neutralisés.

## 4 — Basculer le pipeline staging

Avant de remplacer les secrets, consigner dans un emplacement privé les anciennes valeurs nécessaires au retour de l’infrastructure. GitHub ne permet pas de relire la valeur d’un secret existant. Sans cette copie ou un autre accès opérateur conservé à l’ancien serveur, le retour arrière n’est pas prêt.

Modifier uniquement l’environnement GitHub **`staging`** :

| Secret | Nouvelle valeur |
|---|---|
| `VPS_HOST` | `162.19.66.80` |
| `VPS_USER` | `sirius-deploy` |
| `VPS_SSH_KEY` | Clé privée dédiée au pipeline staging, fournie par fichier ou stdin |
| `VPS_KNOWN_HOSTS` | Ligne complète de clé d’hôte vérifiée |

Pour le transfert d’hébergement, relancer uniquement **« Reaper sur le VPS »** du dernier workflow staging réussi (`36042451260`, commit `c30cff8`) afin de conserver l’image et la configuration historique. Cette relance a réussi. L’arrêt de l’ancien reaper staging est différé par Ali ; l’adresse de l’ancien VPS n’est pas requise pour achever ce transfert.

La relance complète du workflow v7 annulé (`36152313928`, commit `0423f4a`) attend la cohérence de la base, de Vercel et du reaper. Elle exécute vérifications, migrations, publication d’images, déploiement Vercel et déploiement VPS. Ne pas la confondre avec le transfert d’hébergement.

## 5 — Production

Préparer une migration de reaper à configuration et image de production conservées, après validation de staging. Vérifier le commit exact du workflow choisi et l’état des migrations de production : **le job `prisma migrate deploy` s’exécute même si `main` n’a pas changé** et peut appliquer une migration en attente. Une relance complète reconstruit aussi Vercel et ses variables publiques.

Ali autorise cette migration d’hébergement après staging. Conserver la configuration et l’image de production et relancer seulement le job VPS du dernier workflow production réussi (`35789836029`, commit `95ed404`). Cette relance a réussi. Les secrets et le projet Compose `sirius` restent distincts de staging ; l’arrêt de l’ancien reaper production est différé par Ali. Cette opération ne passe pas la production à Phala/v7 ni à mainnet.

## 6 — Supervision et observation de l’ancien serveur

Installer les unités versionnées du watchdog Phala et du collecteur de budget sous `sirius-ops`, **timers désactivés tant qu’aucune session n’est planifiée**. Leur installation peut précéder les tranches 3/4 et doit précéder tout prochain créneau Phala.

Le workflow dépose seulement le Compose et l’image worker ; il n’installe pas les scripts ni Node/pnpm sur l’hôte. Prévoir Node 22, pnpm, le code vérifié et ses dépendances dans `/opt/sirius-ops`, le profil CLI Phala sous le compte `sirius-ops`, et les fichiers privés sous `/etc/sirius/operations`. Les scripts exigent notamment `session.json` en `0600`, lisible par ce compte ; les rapports sont écrits en `0600` dans `/var/lib/sirius-ops`.

Les unités fournies ciblent encore `/opt/sirius`. À l’installation, remplacer via des surcharges systemd leurs `WorkingDirectory` et `ExecStart` par `/opt/sirius-ops` (réinitialiser `ExecStart` avant sa nouvelle valeur). Conserver les restrictions existantes, vérifier les chemins réels de Node/pnpm, les droits de lecture et la disponibilité du cache/profil CLI. Ne pas ajouter `sirius-ops` au groupe de déploiement pour contourner les droits.

Contrôler la syntaxe des unités et leurs timers désactivés. Lors du prochain créneau autorisé : créer une session bornée, vérifier le profil Phala et l’identité CVM en lecture seule, activer le watchdog avant démarrage, vérifier le rapport attesté frais après activation et confirmer l’arrêt en fin de session. La présence de fichiers systemd ne prouve pas que la supervision fonctionne.

Lorsque leur retrait sera repris, arrêter les anciens reapers puis commencer la semaine d’observation globale une fois **les deux reapers Sirius** arrêtés sur l’ancien VPS. Après sept jours sans besoin de retour, vérifier l’inventaire puis retirer seulement `/opt/sirius` et `/opt/sirius-staging` de l’ancien serveur. Les services partnersud restent en place ; aucune commande d’extinction ou suppression globale n’est prévue.

## Limite du retour arrière

Revenir sur l’ancien hôte exige la configuration compatible, une image conservée et l’arrêt du nouveau reaper avant de réactiver l’ancien. Restaurer les anciens secrets GitHub ne restaure ni la base ni l’état des contrats.

La suppression autorisée des données staging intervient **avant la tranche 6** et n’a pas de restauration prévue, puisque Ali abandonne ces données. Après ce nettoyage, un retour d’hébergement doit garder la configuration v7 et la base neuve ; ne pas relancer l’ancien workflow v6 sur cette base. Les anciens contrats restent consultables sur la chaîne.
