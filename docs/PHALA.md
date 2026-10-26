# Phala : runner unique de production

**Point de reprise au 26 septembre :** la [checklist de l’espace Phala](PHALA-DEMO-RESTE-A-FAIRE.md) et son [runbook manuel](PHALA-DEMO-RUNBOOK.md) font référence. La bascule globale de staging et le nettoyage Neon sont différés ; les mesures et étapes ci-dessous restent historiques. La nouvelle démonstration nécessite sa propre configuration et une nouvelle validation matérielle. Le calcul VPS reste un chantier distinct, sans garantie TEE.

Le runner Phala détient les clés, déchiffre les datasets, entraîne et règle les prêts. Next ne reçoit ni donnée brute, ni DEK, ni master key, ni préimage avant règlement. Le VPS héberge les reapers et les outils de supervision extérieure ; le calcul confidentiel reste dans la CVM.

`main` impose `SIRIUS_REQUIRE_PHALA=true`, même sur testnet. Staging et le développement peuvent conserver `TEE_MODE=stub` sans `RUNNER_URL` pour les données synthétiques ou non sensibles. Il n’y a ni sélecteur utilisateur, ni repli automatique vers ce mode en cas de panne Phala. La présence d’un runner distant en production impose HTTPS et l’attestation, même en mode démonstration.

## Reprendre ici — 25 septembre 2026

**Lot B : staging d’abord.** La PR #8 intègre A2/B2 dans `staging`, les nouveaux contrats v7 sont vérifiés au bloc finalisé et le runner actif est validé par RA-TLS/Intel `UpToDate`. Identité, mesures et budget sont stables après redémarrage. Vercel staging contient les nouvelles adresses et mesures. Le nouveau VPS est accessible, les reapers historiques staging et production y sont déployés par GitHub et les unités de supervision y sont installées, timers désactivés. Les anciens reapers ne sont pas arrêtés ; la remise à zéro Neon, la configuration v7 du reaper et le redéploiement applicatif restent à faire. La CVM est arrêtée. Utiliser [PHALA-V7-STAGING.md](PHALA-V7-STAGING.md) et [VPS-MIGRATION.md](VPS-MIGRATION.md) pour l’état exact et la répartition Ali/Ali. Ne pas réinitialiser ses volumes ni réutiliser les mesures d’amorçage ci-dessous.

### Historique de préparation — 23 septembre 2026

Les procédures et configurations de production ci-dessous restent historiques et ne doivent pas être copiées vers staging.

**Mise à jour après correctifs et préparation opérationnelle :** le [suivi de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) couvre la reprise des transactions confirmées, la livraison v7 après confirmation, le règlement des résultats persistés et le devis obligatoire. La [deuxième passe](RECOVERY-OPERATIONS.md) ajoute récupération du résultat perdu par Next, rediffusion identique et validation réelle PostgreSQL/processus. La [préparation opérationnelle](OPERATIONS-PREPARATION.md) ajoute des contrôles distants en lecture seule et une restauration locale de la base réelle. Restent à borner la coupure avant checkpoint runner, les transactions toujours introuvables, la finalité du réseau cible et les anciennes sauvegardes de clés. Aucun changement de secret, migration distante ou redémarrage Phala n'a été effectué pendant ces passes. Les observations ci-dessous conservent leur date et leur périmètre.

**CVM arrêtée à la demande de Ali le 23 septembre à 01:27 (Europe/Paris).** L’API confirme `status: stopped`, `in_progress: false`, avec le même app ID. Le disque et la CVM sont conservés ; aucun redéploiement de contrats ou de CVM n’a été réalisé dans cette passe. Les frais de calcul sont coupés ; le disque reste facturé `0.002780` USD/h, soit environ 0,067 USD/jour ou 2 USD pour 30 jours. Le tarif de la machine allumée est `0.060780` USD/h (`0.058000` calcul + `0.002780` disque). Voir la [tarification Phala](https://cloud.phala.com/about/pricing).

**Dernier contrôle : 23 septembre à 14:48:02 UTC, soit 16:48:02 à Paris.** La lecture API confirme `status: stopped`, `in_progress: false` et le même app ID. Aucun entraînement ni appel métier n'a été envoyé à la CVM pendant la préparation. Le superviseur et son timer sont préparés localement, non installés.

**Essais chiffrés, sans activation :** [10 sessions de deux heures et 30 jours de disque](OPERATIONS-PREPARATION.md#scénario-dessais-phala-préparé), avec réserve de délai d'arrêt : 3,209940 USD, ou 4,02 USD avec coussin de 25 %. L'enveloppe proposée de 5 USD reste non approuvée. Les autres abonnements sont hors périmètre de cette préparation, selon la demande de Ali.

Le [business plan global](BUSINESS-PLAN.md) ajoute les autres postes sous hypothèses et un budget jusqu'au mainnet. Il ne change pas le scénario d'essais Phala ni l'autorisation requise avant un démarrage.

**Consigne de Ali sur les crédits :** prévenir avant toute prochaine opération utilisant Phala, en indiquant quand elle aura lieu et son coût estimé. Ne pas redémarrer automatiquement la CVM pour un contrôle ou une reprise ; préparer les opérations locales pendant son arrêt. Ne pas supprimer ni recréer la CVM pour éviter les frais du disque sans demande explicite.

**Consigne de Ali sur le faucet testnet :** vérifier les soldes des comptes concernés avant les opérations on-chain et le prévenir lorsqu’un complément est nécessaire, avec l’adresse à alimenter et le token requis. Le compte déployeur/trésorerie et le compte Phala sont distincts ; vérifier chacun selon l’opération. Aucun suivi permanent hors session n’est configuré. Un apport faucet finance les transactions testnet ; il ne remplace ni les crédits Phala ni le budget d’exploitation.

**Prochaine action demandée par Ali : terminer la [facturation du compute au borrower](COMPUTE-BILLING.md), avant tout nouveau déploiement de contrats pour Phala.** Le [premier livrable v7](ESCROW-V7.md) est implémenté séparément en local : contrat, tests et ABI. Les [budgets durables du runner](RUNNER-BUDGETS.md) sont également implémentés localement. L’[application, le devis et le parcours runner v7](BILLING-INTEGRATION.md) sont maintenant raccordés localement, avec budget de clôture réservé ; aucun registre réel, tarif ni déploiement public v7 n’est actif. Ali a retenu le compte de `.env` pour le déploiement et la trésorerie compute testnet ; la bascule reste à effectuer après les validations restantes. Phala reste arrêté pendant la préparation locale.

Les deux accès sont renseignés et validés dans `.env.phala-production-secrets`, en permissions `0600`, couvert par les exclusions Git et Docker. `DATABASE_URL` a été vérifiée le 23 septembre par connexion TLS et transaction en lecture seule ; les deux identifiants de datasets publics et leurs titres EVM correspondent à `sirius-data.tech`, sans correspondance avec le catalogue staging. Pinata a été validé le même jour et son JWT reporté dans `.env.phala`, avec la gateway de production. Ne pas redemander les secrets dans le chat.

État observé en base de production le 23 septembre, à revérifier en maintenance avant toute bascule :

- Prêts : 5 `SETTLED`, 5 `CANCELLED`, aucun prêt actif.
- Entraînements personnels : 8 `DONE`, aucun entraînement actif.
- Datasets : 2 `LISTED`, 2 `DRAFT`, 5 `SUSPENDED`, 21 `DELETED`.
- Modèles historiques : 5 prêts et 8 entraînements portent un `modelCid`. Les 13 blobs ont ensuite été téléchargés, sauvegardés sous chiffrement supplémentaire et relus avec empreintes identiques ; deux modèles du wallet local ont ensuite été livrés, déchiffrés et restaurés hors ligne. Les onze autres sont liés à d'anciens wallets de test inaccessibles, confirmé par Ali. Voir [la récupération historique](BACKUP-RECOVERY.md).
- Déploiements des prêts : réseau `31611`, 8 prêts sur `0xede81141d007593d4bfce2de4778f753d167700e` et 2 sur `0x805a2c2deaa3a8926e85fed6b341dacb54cacba0`. Conserver ces deux escrows dans l’historique et vérifier les autres adresses déjà autorisées.
- Dernière migration appliquée lors de cette observation : `20260906000000_reconcile_dataset_deletion`. Les migrations de provenance `20260919000000_track_runner_provenance` et de facturation `20260923000000_add_compute_billing` restent à appliquer lors de la future maintenance.

Contrôles Pinata et infrastructure du 23 septembre :

- Authentification Pinata HTTP 200 ; les 15 CID distincts attendus sont présents dans le compte : 2 datasets publiés, 5 modèles de prêts, 8 modèles d’entraînements.
- La gateway de production répond HTTP 200 aux lectures HEAD d’un dataset et d’un modèle historiques. Cela ne vérifie pas leur déchiffrement ni leur re-livraison de clé.
- Test avec un petit fichier synthétique chiffré AES-256-GCM : upload, téléchargement avec empreinte SHA-256 identique, suppression et absence du fichier de test dans le compte vérifiés. Aucun fichier métier supprimé.
- Avant son arrêt demandé par Ali, la CVM existante était `running`, toujours en amorçage. La capture RA-TLS a vérifié à nouveau la quote matérielle ; les cinq mesures, l’empreinte d’ingestion et le compte de règlement étaient identiques à ceux du 19 septembre. Solde de règlement : 0 ETH testnet.
- Le KYB actuel est ouvert : `0x8fce2282ea1b70255881588920f1fc999915fe58`, `OPEN_EXPIRY = 4102444800`, bytecode identique à `SiriusOpenKybRegistry` local. Conserver ce mode pour la démonstration testnet, sauf décision explicite de le changer.
- Le précédent déployeur de l’escrow de production est `0x9016cbe5a101a2c753923fdd766fd67e2077b67f` (création `0xe3b0e1e73e7ece8e3b40c2feeb3417ad00dd36069ed3b71c24870e4c419125ee`). La clé `MEZO_DEPLOYER_KEY` présente dans `.env` correspond à un autre compte, `0xb6acf8a998bb8efa34a954cd6334ccc15da7f919`, doté d’environ 0,00791466 ETH testnet lors du contrôle ci-dessous. **Choix confirmé ensuite par Ali : ce compte sert au déploiement et à la trésorerie compute sur testnet.** Sa clé signe les déploiements et les retraits de ses crédits ; seule son adresse publique devient `computeRecipient`. Les signatures de devis et de règlement restent celles du runner Phala `0x3b31923ee7cb2a15fc85abbeeae1fc32afc08c8d`, dont la clé reste dans l’enclave.
- À la demande de Ali, les soldes et les clés locales ont été contrôlés au bloc `122948152` : le compte local détient `0.007914660088247486` ETH et `101960` USDC testnet, le précédent déployeur `0.00377673347` ETH et 0 USDC, Phala 0 ETH et 0 USDC. Parmi les 7 fichiers `.env*` locaux et l’environnement du processus inspectés, seule la clé du compte local a été retrouvée. Les clés faucet/KYB de l’export Vercel restent masquées ; elles ne permettent pas de confirmer la disponibilité de la clé du précédent déployeur. La clé du runner reste dans l’enclave.
- USDC confirmé à 18 décimales ; empreinte du bytecode `0x4f86dc6f206ef3e02a21709f2e8330bf1439c450abe88b6a6cb1af071e6f9965`. Compilation Solidity et 46 tests Hardhat réussis.

**Identifiants PostgreSQL :** une ancienne note évoquait un partage dans une conversation, sans message d’origine vérifié. Aucune compromission n’a été établie. Ali demande explicitement de conserver les identifiants actuels ; aucune rotation ni synchronisation de nouveaux secrets n’est prévue dans cette préparation.

La [préparation de l’exploitation](OPERATIONS-PREPARATION.md) ajoute une sauvegarde chiffrée de la base réelle, sa restauration locale PostgreSQL 18 avec les deux migrations, la copie vérifiée des 13 blobs de modèles, le chiffrage, les images et les outils de contrôle. Phala reste arrêté. La récupération des deux modèles accessibles est vérifiée ; les validations d'activation restent à effectuer.

- `DATABASE_URL` sert aux contrôles de migration et à l’application ; **ne pas l’envoyer à Phala**.
- `PINATA_JWT` permet au runner de stocker les fichiers chiffrés. Sa copie validée est dans `.env.phala` pour le futur envoi chiffré à la CVM ; aucune mise à jour distante de la CVM n’a encore été faite.
- Ce fichier de collecte contient seulement deux variables : ce n’est pas une configuration complète de déploiement.

La connexion CLI Phala (profil `sirius`, workspace `sirius_data`) et l’accès GitHub/GHCR privé ont déjà été configurés. Ne pas recommencer ces autorisations sauf si un contrôle constate leur expiration. L’image a été publiée le **19 septembre** ; la CLI Phala et la CVM en amorçage ont été revérifiées le 23 septembre, puis la CVM a été arrêtée à la demande de Ali. Le solde de crédits du compte Phala n’a pas été contrôlé lors de cette passe. Le tarif initialement observé figure ci-dessous.

**Restent non effectués :** validation du budget d'essais, calibration des tarifs et des plafonds fournisseurs, intégration de la trésorerie choisie dans la politique tarifaire validée, publication des images préparées, nouveaux contrats publics liés à Phala, financement du compte de règlement, activation métier de la CVM, migrations Prisma distantes, configuration/déploiement Next et reaper, parcours navigateur complet. Les migrations sont vérifiées sur la copie PostgreSQL 18 locale. Ali garde les sauvegardes en local pour l'instant ; les onze modèles des wallets de test inaccessibles restent conservés sans livraison vérifiée. Aucun commit, push ou autre commande Git n’a été exécuté pour cette intégration ; une demande explicite de Ali reste nécessaire pour toute commande Git.

### Fichiers locaux à conserver

| Fichier | Rôle et limites |
|---|---|
| `.env.phala-production-secrets` | Deux accès de production renseignés et validés le 23 septembre. Permissions `0600`. |
| `.env.phala` | Configuration privée de la CVM existante : secret de transport et accès GHCR conservés ; JWT Pinata validé et gateway de production ajoutés le 23 septembre. Nouvelles adresses de contrats à compléter. Ne pas écraser ce fichier ni régénérer ses secrets à la reprise. Aucune master key injectée. |
| `.env.phala-production-current` | Export Vercel de production du 19 septembre, incomplet : six valeurs masquées par `[SENSITIVE]` (`DATABASE_URL`, `PINATA_JWT`, `SIRIUS_FAUCET_KEY`, `SIRIUS_KYB_VERIFIER_KEY`, `SIRIUS_MASTER_KEY`, `SIRIUS_SESSION_SECRET`). Ne pas l’utiliser tel quel pour un déploiement. |
| `.env.production.local` et `.env` | Configurations anciennes ou de développement ; leur nom ne prouve pas leur cible. Seule la clé `MEZO_DEPLOYER_KEY` de `.env` a été retenue explicitement par Ali pour le déploiement et la trésorerie testnet ; ce choix ne valide pas les autres valeurs comme configuration de production. |
| `.env.phala-next` | Fichier prévu par le runbook pour la future configuration applicative complète ; sa préparation reste à faire. |

### Ordre de reprise

1. Résoudre les limites restantes du [suivi de l'audit local](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) : coupure avant checkpoint runner, incertitude après rediffusions bornées, finalité/RPC et anciennes copies de clés. La [reprise Next et les validations entre processus](RECOVERY-OPERATIONS.md) sont désormais couvertes localement. Valider ces scénarios et l'[intégration v7](BILLING-INTEGRATION.md), puis finaliser tarifs, comptabilité, plafonds fournisseurs et procédure de reprise. Les identifiants PostgreSQL sont conservés à la demande de Ali. Ne pas déployer un nouvel escrow v6 intermédiaire dépourvu de facturation.
2. Préparer les benchmarks et annoncer à Ali leur créneau et leur coût avant toute utilisation de Phala. Calibrer les tarifs et vérifier la stabilité de l’identité lors de la reprise de la même CVM.
3. Préserver l’accès historique aux modèles et aux crédits, sauvegarder puis relire l’état de la base avant toute mutation : le contrôle du 23 septembre est une observation ponctuelle. Vérifier prêts ouverts, entraînements en cours, datasets publiés, modèles historiques et escrows référencés.
4. Utiliser le compte confirmé `0xb6acf8a998bb8efa34a954cd6334ccc15da7f919` pour le déploiement et comme `computeRecipient` de la future politique tarifaire. Garder le wallet opérationnel Phala distinct. Le mode KYB ouvert actuel est confirmé ; ne pas changer implicitement de politique KYB. La cible reste **Mezo testnet `31611`**, pas mainnet.
5. Après validation de la facturation, préparer la maintenance, déployer la version retenue avec l’adresse publique attestée de Phala et financer cette adresse en ETH testnet. Ne jamais récupérer ni importer sa clé privée.
6. Après information de Ali sur l’utilisation et le coût Phala, compléter `.env.phala`, les politiques de facturation/budget validées et leur volume persistant, puis activer explicitement v7 et passer le booléen d’amorçage à `"false"` dans le Compose. Mettre à jour **la même CVM** avec l’image contenant les changements validés. Recapturer les mesures actives, vérifier le Compose brut et la stabilité de l’identité avant de configurer Next. Le registre SQLite ne doit pas être réinitialisé à chaque redémarrage.
7. Préparer l’environnement applicatif complet, migrer la base en maintenance, suspendre/réimporter les anciens datasets et conserver les escrows legacy. Synchroniser Next et le reaper, reconstruire le frontend, exécuter les préflights adaptés à la nouvelle version puis le parcours réel à deux wallets avant réouverture.

Les commandes détaillées et les conditions de chaque étape suivent dans ce document. Ne pas utiliser les mesures d’amorçage pour ouvrir la production.

## Amorçage vérifié le 19 septembre 2026

La CVM `sirius-phala-production` est démarrée en **amorçage uniquement** dans le workspace `sirius_data`. La production Vercel et ses contrats n’ont pas basculé.

- CVM : `e8a8b8cb-1552-4b9a-b801-54e3ae0f6e1e` ; app ID : `8e14a57b42bfeff1e3cb806a5a042c313874c79c`.
- URL RA-TLS : `https://8e14a57b42bfeff1e3cb806a5a042c313874c79c-4100s.dstack-pha-prod9.phala.network`.
- Compte de règlement attesté : `0x3b31923ee7cb2a15fc85abbeeae1fc32afc08c8d` ; solde constaté : 0 ETH testnet.
- Identité runner : `phala:c02c6054e2a8021cfcb066e5de092fc199ceabfd49e7a569ed01f0eb36fde3bc`.
- Ressources : `tdx.small`, 1 vCPU, 2 Go RAM, disque 20 Go, `US-WEST-1`, dstack `0.5.9` sans accès SSH. Tarif observé : 0,060780 USD/h, stockage inclus.
- Logs et informations système publics désactivés. L’image privée est épinglée directement dans le Compose.
- Image déployée : `ghcr.io/alibenyezza/sirius-runner@sha256:fbc137a97f16213f331ce54916a5053f17c97a06d3f614c8b127365b526c5e19` (`phala-ratls-20260919`, `linux/amd64`).

Cible applicative confirmée : projet Vercel `prj_gmEKctb6EJcsErIQqamKiZNaK5vZ`, scope `byezzaali-gmailcoms-projects`, domaine `https://sirius-data.tech`, reaper VPS `/opt/sirius`. Utiliser cette cible explicite, pas le lien `.vercel` local ni une branche supposée.

La vérification Intel accepte la quote (`UpToDate`), le lien au certificat TLS et le rejeu RTMR3. Le document Compose brut fourni avec l’attestation a été rehaché et comparé à la quote ; son contenu Docker correspond exactement à `deploy/phala/compose.yaml`. La clé d’ingestion, la chaîne KMS et l’adresse de règlement restent identiques après mise à jour et redémarrage de la même CVM. Les appels via le transport RA-TLS épinglé confirment `/health` en mode `bootstrap` et le refus des POST avec 503.

Mesures de cet amorçage — à recapturer après activation, avant configuration de Next :

```dotenv
SIRIUS_EXPECTED_MRTD=f06dfda6dce1cf904d4e2bab1dc370634cf95cefa2ceb2de2eee127c9382698090d7a4a13e14c536ec6c9c3c8fa87077
SIRIUS_EXPECTED_RTMR3=347cd18da5cbac549320f53c0c82a61cbdbae8b088583308cdc89d98f532cb1322ff87f089c1016da8d02f5671b158e1
SIRIUS_EXPECTED_COMPOSE_HASH=73b99cb4f02620e2cbdf87f7762e5bbaaabb93a825ac7d02d8209b105ac1fbe8
SIRIUS_EXPECTED_MASTER_KEY_CHAIN_SHA256=199159501916dfc4f26c379cda97faff4e5b646b5b37789c324642cd579ba98e
NEXT_PUBLIC_SIRIUS_INGRESS_KEY_SHA256=c02c6054e2a8021cfcb066e5de092fc199ceabfd49e7a569ed01f0eb36fde3bc
```

Deux corrections révélées par la CVM réelle sont couvertes par les tests : décodage du certificat DER qui embarque des certificats PEM Intel, et recalcul des digests runtime omis par dstack 0.5.9. Le payload des événements est lié au digest recalculé, et ne peut pas être remplacé en conservant la mesure signée. Validation locale : 245 tests applicatifs, 46 tests contrats, lint, typage et build réussis.

L’export Vercel de production a confirmé l’escrow courant `0x805a2c2deaa3a8926e85fed6b341dacb54cacba0`. La lecture on-chain confirme v6 et l’ancien autorisateur `0x86d8220bca82633bc4c8b4d88b1c44b72015826d` ; aucun USDC n’est verrouillé, mais `20000000000000000000` unités restent dues en crédits pull. Cet escrow doit rester déclaré en legacy pour les retraits. Cela ne remplace pas le contrôle des prêts et entraînements en base.

Les valeurs sensibles de production ne sont pas exportables : notamment `DATABASE_URL` pour le préflight et `PINATA_JWT` pour l’activation. `.env.phala-production-current` est un relevé privé incomplet contenant des marqueurs `[SENSITIVE]`, pas un environnement prêt au déploiement. Ne pas réutiliser les anciennes valeurs locales sans confirmation de leur cible.

## Préparation locale

La CLI vérifiée pour ce runbook est `phala@1.1.22`. Elle peut être utilisée sans installation globale :

```bash
pnpm dlx phala@1.1.22 login --profile sirius
pnpm dlx phala@1.1.22 deploy --help
```

La connexion utilise une validation navigateur ; ne pas passer de clé API en argument ni la publier dans le chat. Le profil Phala ne remplace pas le choix de l’environnement Sirius.

1. Préparer la cible de production `sirius-phala-production`. Staging et le développement restent en processus ; une deuxième CVM n’est pas nécessaire. `main` ne signifie pas mainnet : la première bascule reste sur Mezo testnet.
2. Construire et publier `Dockerfile.runner` pour `linux/amd64`. La pipeline produit déjà cette image ; récupérer le digest d’un build réussi contenant ce code. Ne pas utiliser une ancienne image qui ignore le mode d’amorçage.
3. Inscrire le digest `ghcr.io/…/sirius-runner@sha256:…` directement dans `deploy/phala/compose.yaml`. Une interpolation de l’image depuis les variables chiffrées ne lie pas ce digest au Compose mesuré. Préparer ensuite le fichier privé `.env.phala` à partir de `deploy/phala/.env.example`, sans écraser un fichier existant, avec un nouveau secret de transport de 32 octets en base64 et l’origine canonique de production.
4. Garder `RUNNER_BOOTSTRAP_ONLY: "true"` directement dans le Compose. Le passage en mode actif modifiera ainsi la mesure attestée. Les adresses de contrats et `SIRIUS_LOCK_AUTHORIZER` restent vides jusqu’à la récupération de l’identité. Ne jamais injecter `SIRIUS_MASTER_KEY`, une clé de déploiement ou la clé du vérificateur KYB dans la CVM.
5. Pour une image GHCR privée, ajouter `DSTACK_DOCKER_REGISTRY=ghcr.io`, `DSTACK_DOCKER_USERNAME` et `DSTACK_DOCKER_PASSWORD` au fichier privé, protégé en `0600`. Le compte doit pouvoir lire le package et le jeton doit autoriser `read:packages`. Phala chiffre ces variables avant envoi ; les identifiants du registre ne sont pas exposés dans l’environnement du conteneur runner. La publication locale nécessite également `write:packages` ; ne jamais afficher le jeton dans les logs ou le chat.

Origines : staging → `https://sirius-mezo-staging.vercel.app` ; production → `https://sirius-data.tech`. Les alias HTTP configurés dans Next ne changent pas le domaine signé par le runner.

## Amorcer la CVM avant les contrats

Avec Escrow v6, `lockAuthorizer` est immuable. Le compte dérivé dans Phala doit donc être connu avant le déploiement du contrat. Le mode d’amorçage initialise dstack et TLS sans exiger de contrats :

- `GET /health` retourne `status: bootstrap` ;
- `GET /ra-tls` expose la preuve matérielle, les empreintes et l’adresse publique de règlement ;
- toutes les opérations POST, y compris celles autorisées, renvoient 503 ; aucun dépôt, entraînement, permis de lock ou règlement n’est possible.

La CVM de production existe déjà : **ne pas relancer sa création pour reprendre cette intégration**. La commande suivante décrit uniquement la création initiale ; pour l’activation, utiliser la mise à jour avec `--cvm-id` plus bas.

Amorçage initial de la CVM de production, après validation du tarif et de la région dans Phala :

```bash
pnpm dlx phala@1.1.22 deploy --profile sirius \
  -n sirius-phala-production -t tdx.small --disk-size 20G --kms phala \
  --no-dev-os --no-public-logs --no-public-sysinfo \
  -c deploy/phala/compose.yaml -e .env.phala --wait
```

Conserver l’app ID et l’identifiant de la CVM. `DSTACK_APP_ID` et `DSTACK_GATEWAY_DOMAIN` sont injectés par Phala dans le Compose. Le runner utilise le socket `/var/run/dstack.sock` et le port 4100.

L’URL doit utiliser le passthrough TLS : `https://<app-id>-4100s.<gateway-domain>`. Le suffixe `s` conserve TLS jusqu’au runner ; la terminaison HTTPS générique de la gateway ne convient pas à la vérification RA-TLS de Sirius.

Capturer l’identité sans envoyer de secret métier :

```bash
DOTENV_CONFIG_PATH=.env.phala RUNNER_URL=https://<app-id>-4100s.<gateway-domain> pnpm runner:capture-ra-tls
```

La commande vérifie le certificat, son lien à la quote TDX, l’état matériel et l’event-log. Comparer aussi le compose et le digest observés au déploiement attendu : une quote valide ne suffit pas à approuver n’importe quel code.

Si le service PCCS échoue avec `ECONNRESET` uniquement sur le chemin IPv6 local, utiliser `DOTENV_CONFIG_PATH=.env.phala node --dns-result-order=ipv4first --conditions=react-server --import tsx src/runner/capture-ra-tls.ts`. Les contrôles TLS et Intel restent inchangés.

Conserver les valeurs publiques retournées : adresse `SIRIUS_LOCK_AUTHORIZER`, empreinte d’ingestion et `RUNNER_DEPLOYMENT_ID`. Ne pas encore utiliser les mesures de l’amorçage pour ouvrir l’application.

Les clés `getKey` sont dérivées sous l’app ID dstack et le chemin stable `sirius/master/v1`. Mettre à jour la même CVM, sans recréer une application ni changer ce chemin. L’activation vérifie le signataire attendu ; un changement de clé bloque le démarrage au lieu de rendre silencieusement les données inaccessibles.

## Déployer puis activer

**Prérequis ajouté le 23 septembre :** la procédure ci-dessous décrit la bascule d’identité préparée pour v6. Elle doit être adaptée à la version avec [facturation compute](COMPUTE-BILLING.md) avant exécution. Les contrats v6 actuels ne répartissent pas un prix compute ; ne pas suivre directement cette section pour un redéploiement intermédiaire.

**Registre anti-rejeu :** avant le passage en mode actif, vérifier le registre SQLite dans le volume persistant avec la [procédure A1](RUNNER-RECOVERY-A1.md#mise-à-jour-de-lanti-rejeu). L'initialisation est explicite et réservée à la première installation ou à la migration des anciens fichiers ; après perte du registre, restaurer l'historique. Le runner actif refuse de démarrer si le registre manque et ne le recrée jamais automatiquement.

1. Avant de remplacer un déploiement existant, maintenir une fenêtre de maintenance : arrêter les nouvelles préparations, attendre les transactions wallet en vol, terminer ou rembourser les anciens prêts et terminer les entraînements personnels. Sauvegarder la base et l’environnement historique séparément.
2. Avec l’adresse publique capturée dans `SIRIUS_LOCK_AUTHORIZER`, suivre [ESCROW-V6.md](ESCROW-V6.md) pour déployer un nouvel escrow et son nouveau registre dataset. Le script crée également le registre KYB ; renouveler les attestations/consentements nécessaires. Ne pas utiliser le signataire du déployeur comme substitut de celui de Phala.
3. Financer le compte public de Phala en ETH testnet pour ses appels `release`. Sa clé privée reste dans l’enclave.
4. Compléter `.env.phala` : `EVM_NETWORK`, `EVM_RPC_URL`, les quatre adresses `SIRIUS_*_ADDRESS`, `SIRIUS_LOCK_AUTHORIZER`, `PINATA_GATEWAY`, `PINATA_JWT`. Conserver le secret de transport et l’origine de cette cible. Passer `RUNNER_BOOTSTRAP_ONLY: "false"` dans le Compose.
5. Mettre à jour la CVM identifiée, avec le même fichier Compose et l’ensemble des variables de cette cible :

```bash
pnpm dlx phala@1.1.22 deploy --profile sirius --cvm-id <identifiant-cvm> \
  -c deploy/phala/compose.yaml -e .env.phala --wait
```

En mode actif, le démarrage vérifie le réseau RPC, les versions et liaisons escrow/registre, les adresses KYB et USDC et la correspondance du `lockAuthorizer` on-chain avec le compte dérivé et l’adresse attendue. Une panne RPC ou une divergence bloque le démarrage.

6. Recapturer RA-TLS, vérifier `mode actif` et la stabilité de l’adresse de règlement et de l’empreinte d’ingestion. Répéter après un redémarrage de la même CVM. Toute modification de code, compose ou configuration mesurée requiert une nouvelle validation des mesures. Pour vérifier le hash du Compose, utiliser le document brut de `phala cvms attestation` : l’objet normalisé retourné par `/cvms/:id` peut contenir des valeurs par défaut absentes du document mesuré.

## Configurer Next et migrer les données

Dans un fichier privé distinct, par exemple `.env.phala-next`, préparer les variables de l’application pour la cible choisie :

- `SIRIUS_REQUIRE_PHALA=true`, `TEE_MODE=phala`, `RUNNER_URL`, le même `RUNNER_TRANSPORT_SECRET` et `SIRIUS_LOCK_AUTHORIZER` public ;
- les cinq mesures retournées par la capture active : `SIRIUS_EXPECTED_MRTD`, `SIRIUS_EXPECTED_RTMR3`, `SIRIUS_EXPECTED_COMPOSE_HASH`, `SIRIUS_EXPECTED_MASTER_KEY_CHAIN_SHA256`, `NEXT_PUBLIC_SIRIUS_INGRESS_KEY_SHA256` ;
- les nouvelles adresses serveur et `NEXT_PUBLIC_*`, le réseau testnet et les origines cohérentes ;
- les anciens escrows dans `SIRIUS_LEGACY_ESCROW_ADDRESSES` pour les crédits, preuves et préimages historiques ;
- la base et les autres paramètres applicatifs existants de cette cible.

Retirer `SIRIUS_MASTER_KEY` et tout endpoint de simulateur de Next. Les mesures attendues de Next ne vont pas dans le Compose Phala : cela modifierait la mesure à épingler.

Appliquer la migration Prisma `20260919000000_track_runner_provenance` dans la fenêtre de maintenance. Elle ajoute `runnerKind` et `runnerDeploymentId` sur Dataset, TrainingJob et Loan, sans réécrire les données historiques. Les lignes existantes restent `UNKNOWN` avec une identité nulle. Une nouvelle exécution enregistre `PHALA` ou `DEVELOPMENT` et une identité dérivée de l’empreinte publique d’ingestion ; cette identité suit la clé, pas l’URL ou le certificat TLS renouvelable.

Suspendre les anciennes fiches publiées sans supprimer les blobs et reçus historiques. Réimporter les datasets depuis le navigateur du provider vers Phala et publier de nouveaux titres. Une nouvelle clé ne peut pas ouvrir les anciennes enveloppes et ne rend pas rétroactivement confidentiels les traitements Vercel.

Préserver avant la bascule le téléchargement des anciens modèles et l’environnement permettant leur re-livraison. Le nouveau runner refuse les ressources d’une autre identité ou de provenance inconnue. Les préimages déjà publics et retraits des anciens escrows restent accessibles, mais `SIRIUS_LEGACY_ESCROW_ADDRESSES` ne donne pas à Phala les anciennes clés. Un accès historique doit rester séparé de la production Phala ; aucun routage automatique vers le runner de démonstration n’est ajouté.

Avec le fichier de contrôle de la bonne cible et les migrations appliquées :

```bash
DOTENV_CONFIG_PATH=.env.phala-next pnpm runner:smoke
DOTENV_CONFIG_PATH=.env.phala-next pnpm runner:check-migration
```

Le smoke vérifie RA-TLS, le mode actif, les contrats, l’adresse de règlement financée et la clé d’ingestion liée à l’origine. Le préflight est en lecture seule : il reprend les contrôles Escrow v6, refuse les datasets publiés ou exécutions actives appartenant à un autre runner, puis compte les modèles historiques dont il faut préserver l’accès. Il ne télécharge pas ces modèles et ne migre aucune clé.

Synchroniser Next, le runner et le reaper, puis reconstruire le frontend : les variables `NEXT_PUBLIC_*` sont figées au build. La pipeline fixe `SIRIUS_REQUIRE_PHALA=true` sur main ; un déploiement main sans configuration Phala complète sera refusé. Elle ne déploie pas la CVM et ne redéploie pas les contrats.

## Validation avant réouverture

- Dépôt chiffré depuis le navigateur et entraînement personnel avec provenance persistée.
- Prêt complet avec deux wallets : approve, autorisation v6, lock, entraînement, capsule, release et retrait provider.
- Remboursement après échéance et retrait borrower ; lecture des crédits historiques.
- Refus d’un ancien dataset, d’une attestation incorrecte et d’un changement de runner ; aucune bascule in-process.
- Récupération du modèle après reconnexion, redémarrage CVM et renouvellement du certificat.
- Budget et durée d’entraînement compatibles avec les limites synchrones du runner et de Vercel.

Le RPC de règlement voit le préimage avant confirmation lors de la simulation/envoi : utiliser un RPC de confiance. La validation locale ne remplace pas ce parcours sur une CVM réelle.

Le support futur de plusieurs destinations est conservé dans [RUNNER-MULTI-BACKEND.md](RUNNER-MULTI-BACKEND.md), sans implémentation VPS dans le produit actuel.

Références Phala : [clé déterministe par app ID](https://docs.phala.com/phala-cloud/key-management/get-a-key), [variables chiffrées](https://docs.phala.com/phala-cloud/cvm/set-secure-environment-variables), [TLS passthrough](https://docs.phala.com/phala-cloud/networking/tls-passthrough), [format et recalcul des événements dstack 0.5.9](https://github.com/Dstack-TEE/dstack/blob/v0.5.9/cc-eventlog/src/tdx.rs).
