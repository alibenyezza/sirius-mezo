# Lot B — Phala/v7 sur staging

> **Plan global différé le 26 septembre 2026.** Ali choisit un espace Phala self-train distinct et garde les essais courants sur testnet. Ne pas vider Neon ni relancer la bascule globale décrite ci-dessous. Les éléments suivants sont historiques. Reprendre par [le plan actuel](PLAN-VPS-PHALA.md), [le journal](PHALA-DEMO-IMPLEMENTATION.md) et [le runbook dédié](PHALA-DEMO-RUNBOOK.md).

Cible choisie par Ali le **24 septembre 2026** : `https://sirius-mezo-staging.vercel.app`, Mezo **testnet 31611**, KYB ouvert. La production `sirius-data.tech` conserve sa configuration. Ali pilote contrats, image, CVM et mutations distantes ; Ali prépare les politiques comptables, la restauration, les migrations et les scénarios navigateur.

## État vérifié et conditions manquantes

### Reprise du 25 septembre — staging neuf

Ali autorise la fin du lot B, avec **la même base Neon staging vidée**, trois contrats indépendants et réimport manuel des datasets. Les historiques des anciens contrats restent sur la chaîne ; ils ne sont pas repris dans ce staging neuf. Cela ne supprime ni ne migre la production. Les prescriptions de conservation ci-dessous décrivent la préparation précédente et ne s’appliquent plus aux données staging abandonnées.

- A2 (`141802f`) et B2 (`608fb91`) sont intégrés dans `staging` par la [PR #8](https://github.com/alibenyezza/sirius-mezo/pull/8), fusionnée en `0423f4a`. Les commandes `ops:*` manquantes sont ajoutées. La [CI du code livré](https://github.com/alibenyezza/sirius-mezo/actions/runs/36150925390) est verte. Le déploiement déclenché par la fusion (`36152313928`) a été annulé avant les mutations distantes : la base et le reaper doivent être prêts avant sa relance.
- Le RPC archive et Pinata staging sont configurés dans les fichiers privés ; les lectures historiques fonctionnent. Le compte Phala dispose de **0,01 ETH testnet** au contrôle précédant le déploiement.
- Les trois contrats ci-dessous sont déployés et la liaison du registre à l’escrow a réussi. Coût des quatre transactions : **0,00004194274 ETH testnet**. Le préflight au bloc **finalisé** a réussi à 14:59:43 UTC : versions, liaisons, signataire, USDC et KYB ouvert vérifiés.
- Les crédits d’essai, la liste des deux wallets de Ali et le canal de supervision sont préparés : voir [PHALA-TRIAL-CREDITS.md](PHALA-TRIAL-CREDITS.md). Aucun financement n’est déclaré comme marge acquise.
- Les nouvelles adresses privées/publiques, v7, KYB ouvert, finalité et RPC archive sont enregistrés dans **le projet Vercel staging** (cible `production` de ce projet distinct). Les anciens escrows et la clé de vérificateur KYB inutilisée en mode ouvert y sont retirés. L’environnement GitHub `staging` reçoit le réseau et le secret RPC archive. Cela ne reconstruit pas le déploiement actif.
- L’image immuable `ghcr.io/alibenyezza/sirius-runner@sha256:df52f30f769478474eab7d40fe6c7126fdc8fd7f5fa6eccf07c15d49eb02204f` est publiée et installée dans la CVM existante. Le runner **actif** a passé la vérification Intel `UpToDate`, le lien au certificat, le rejeu RTMR3 et la comparaison du Compose brut avec l’image attendue. Les logs et informations système restent privés.
- Les mesures actives, le domaine staging, l’adresse de règlement, la clé d’ingestion et la chaîne KMS sont stables après redémarrage. Le budget SQLite est lisible par le collecteur RA-TLS et inchangé après ce redémarrage : crédits d’essai Phala, devis autorisés, aucune opération ni transaction engagée. Un appel de supervision sans secret est refusé avec 401. Ce contrôle ne remplace pas un essai de reprise avec prêt en cours ni une restauration du volume.
- Vercel staging contient maintenant aussi les mesures actives, l’empreinte publique d’ingestion, `RUNNER_URL`, le nouveau secret de transport, `TEE_MODE=phala` et `SIRIUS_REQUIRE_PHALA=true`. La variable du dépôt `SIRIUS_STAGING_REQUIRE_PHALA=true` empêche la prochaine pipeline complète de réimposer le mode démo. Les configurations v7 locales sont alignées ; **le reaper hébergé conserve encore la configuration historique v6 et l’application n’est pas reconstruite pour v7**.
- Ali a transféré les deux `.env.vps` sur le nouveau VPS. Leurs endpoints Neon sont distincts ; la lecture staging a réussi et compte encore **13 prêts** au contrôle. `.env.staging-db` reste vide, mais il n’est plus nécessaire de demander cette connexion à Ali : les opérations peuvent être conduites depuis le serveur. Aucune donnée distante n’a été vidée.
- Le reaper staging est transféré sur `162.19.66.80`, à image/configuration historiques conservées. Les quatre secrets SSH GitHub staging sont basculés ; la [relance du seul job VPS](https://github.com/alibenyezza/sirius-mezo/actions/runs/36042451260/attempts/2) a réussi le 25 septembre à **21:11:50 UTC**. Les dates des jobs Vercel/migrations restent celles du 24 : ils n’ont pas été réexécutés. Le transfert de production a également réussi à **21:18:18 UTC**, avec sa configuration historique conservée et ses secrets GitHub basculés. Voir [VPS-MIGRATION.md](VPS-MIGRATION.md) pour les preuves et les anciens reapers.
- Watchdog et collecteur sont installés sur le nouveau VPS sous `sirius-ops`, dans `/opt/sirius-ops`, avec leurs configurations privées et **timers désactivés/inactifs**. Node 22.23.2, pnpm 11.18.0, CLI Phala 1.1.22 et chargement du collecteur sont vérifiés. Le profil Phala a été authentifié depuis ce compte ; l’API confirme encore la CVM **arrêtée**, sans opération en cours. Aucun nouveau créneau Phala n’a été lancé ; la collecte active depuis le VPS reste à vérifier au prochain créneau.
- Validation locale Node 22 : **361 tests applicatifs, 72 tests d’exploitation, 79 tests de contrats, 71 scénarios navigateur**, parcours EVM v7, concurrence PostgreSQL, typages, lint et build réussis. Ces scénarios navigateur utilisent des mocks ; ils ne remplacent pas le parcours réel dans Phala.

| Contrat staging neuf | Adresse | Transaction |
|---|---|---|
| KYB ouvert | `0xc6ef861119c097d135c85ff0988014d52cc78c64` | `0x9837cd8591fd625db1e174a5d8fdc4ba655193277877e06e0ef39c3e5da45d35` |
| Dataset Registry | `0x99ea98be5c439809a918115764bcabf089ef4be5` | `0x3279dff2c4e2d3ea886b505942abaeeec581d6ec9766c84834feabf72a1ea0d3` |
| Escrow v7 | `0x5f9d8d8035b32657f9fd5d03149d86c06ead5f6c` | `0x2a063ce595a38c2cc1fc700d42603b9e7318166987595b0a2819c0c14cc393e8` |
| Liaison registre → escrow | même registre | `0x1f750ed42936ef0f129cdd0ae703f6e0bbf96b2558d070aa19a52532204c1d04` |

Pour vider la base autorisée : confirmer son identité distincte de la production, arrêter les écrivains staging, vider uniquement les tables applicatives Sirius dans une transaction, conserver le schéma et `_prisma_migrations`, puis vérifier les comptes nuls. Aucune copie des données abandonnées n’est demandée. Les listes d’escrows historiques staging restent vides ; `check-upgrade` sur les anciens contrats de production n’est pas une porte de cette remise à zéro.

### Ce qu’il reste à fournir et à exécuter

**Ali :** les accès au nouveau VPS et à Neon sont disponibles ; aucune nouvelle transmission de secret n’est demandée. Prévoir ETH et USDC **testnet** sur le wallet borrower `0x75773bf175273eb37cd89016324176e257d114ce`, trouvé vide au dernier contrôle, puis signer les opérations navigateur. Le provider prévu est `0xe07abf7ef148d0ecf04906239deb2b1b54e9aa55`.

**Ancien VPS :** Ali choisit de poursuivre le transfert d’hébergement sans son adresse et sans arrêt immédiat des anciens reapers. Leur arrêt n’est donc pas validé ; des lectures Neon/RPC peuvent continuer en double. Cela n’autorise pas une remise à zéro concurrente : avant le nettoyage et la bascule v7, neutraliser les anciens accès en écriture staging, puis suspendre aussi ceux du nouveau VPS et de l’application. L’arrêt des anciens processus peut être remplacé par une révocation de leurs accès staging avec fermeture des connexions existantes ; cette modification d’accès reste à convenir puisque Ali conserve actuellement les identifiants.

**Intégration restante :** vider les données staging autorisées depuis le serveur, vérifier/appliquer les migrations, aligner le reaper sur les nouveaux contrats v7 et les mesures Phala, contrôler la cohérence Next/reaper/runner, puis relancer la pipeline v7 complète. Planifier ensuite un créneau Phala borné avec le watchdog et vérifier la collecte attestée depuis le VPS. **Ne pas relancer la pipeline v7 complète avant cette préparation.** Aucun nouveau déploiement de contrats n’est nécessaire. Le transfert d’hébergement de production reste indépendant ; sa base ne doit pas être vidée.

**Ali :** A2/B2 sont intégrés ; pas de reprise de ces développements. Préparer les datasets synthétiques et les résultats attendus du [kit de test](TESTNET-RUN-KIT.md), puis relever les coûts, durées, montants nets, remboursements et écarts comptables pendant les essais réels. La migration des anciens historiques staging et leur sauvegarde hors machine ont été écartées pour ces essais.

**Ensemble :** exécuter le parcours à deux wallets, vérifier le modèle ouvert et les retraits, puis les scénarios d’expiration, remboursement, interruption/reprise, suppression refusée pendant un prêt et restauration du volume. Les cases de fin du lot B restent ouvertes jusqu’aux preuves réelles.

### Relevé historique du 24 septembre

- Les PR #4, #5 et #6 sont intégrées. La [pipeline staging de `332afae`](https://github.com/alibenyezza/sirius-mezo/actions/runs/36035263971) a réussi : vérifications, migrations, Vercel, images, reaper et smokes. Ces migrations sont celles de staging ; cela ne prouve aucune migration de production.
- L'API Phala confirme le 24 septembre à 18:09:56 UTC : CVM arrêtée, aucune opération en cours, app ID `8e14a57b42bfeff1e3cb806a5a042c313874c79c`. La machine existante est `tdx.small`, disque 20 Go. Son nom `sirius-phala-production` n'est pas une autorisation d'utiliser la base ou les secrets de production.
- Le dernier runner publié par cette pipeline est `ghcr.io/alibenyezza/sirius-runner@sha256:f1c9cda9975fdb5051c95df54c37eef59ff984ef553423ffbd27234b4e398f33`. Il contient A1, **pas le nouvel outil d'initialisation du présent lot B**. Publier une image contenant ce lot avant d'utiliser le mode `init` ; relever son nouveau digest dans sa pipeline.
- Le compte déployeur/trésorerie `0xb6acf8a998bb8efa34a954cd6334ccc15da7f919` disposait de `7914660088247486` wei, soit `0,007914660088247486 ETH` testnet. Le compte Phala `0x3b31923ee7cb2a15fc85abbeeae1fc32afc08c8d` disposait de **0 wei**. Recontrôler avant signature ; financer le gas Phala avant ses règlements.
- Le code USDC testnet `0x1d6c58bb2f60b5a18ee4a72096f7743f01db0213` a l'empreinte attendue `0x4f86dc6f206ef3e02a21709f2e8330bf1439c450abe88b6a6cb1af071e6f9965` et expose 18 décimales lors de la lecture à `latest`.
- Le RPC public fournit un bloc `finalized` canonique, mais refuse des `eth_call` sur son état avec `historical state … is not available`. Le premier relevé avait 8 873 blocs d'écart avec `latest`. **Un tag finalisé disponible ne suffit pas : l'état historique doit aussi être lisible.** Un RPC archive est nécessaire au double contrôle `matchesScope` dans `assertLoanScope`, avant le calcul v7. La [documentation Mezo](https://docs.mezo.com/chain/connecting/) recommande un endpoint archive pour ces lectures ; [Alchemy](https://www.alchemy.com/rpc/mezo-testnet) annonce cet accès avec un compte gratuit. Aucun nouveau compte ni abonnement RPC n'a été créé.
- Aucun budget ou tarif réel n'est configuré dans le fichier Phala existant. Les crédits d'essai et apports ne doivent pas être renseignés comme marge acquise pour contourner le mode strict. Ali doit fournir les politiques et leurs justificatifs ; les valeurs des tests restent synthétiques.

Le lot B n'est terminé qu'après les preuves de la dernière section. Cette préparation ne vaut ni activation de la CVM, ni attestation active, ni validation navigateur.

## Préflight de chaîne sans signature

La commande `pnpm phala:check-v7` n'importe aucune clé, ne charge aucun `.env` implicitement et n'envoie aucune transaction. Injecter uniquement la configuration explicite :

```dotenv
EVM_NETWORK=testnet
SIRIUS_BILLING_VERSION=7
SIRIUS_KYB_MODE=open
SIRIUS_EVM_FINALITY=finalized
SIRIUS_EVM_CONFIRMATIONS=1
EVM_RPC_URL=<endpoint-archive-testnet>
SIRIUS_USDC_ADDRESS=0x1d6c58bb2f60b5a18ee4a72096f7743f01db0213
SIRIUS_USDC_CODE_HASH=0x4f86dc6f206ef3e02a21709f2e8330bf1439c450abe88b6a6cb1af071e6f9965
SIRIUS_DEPLOYER_ADDRESS=0xb6acf8a998bb8efa34a954cd6334ccc15da7f919
SIRIUS_COMPUTE_RECIPIENT=0xb6acf8a998bb8efa34a954cd6334ccc15da7f919
SIRIUS_LOCK_AUTHORIZER=0x3b31923ee7cb2a15fc85abbeeae1fc32afc08c8d
```

La profondeur `1` est celle du diagnostic initial, avec `finalized` obligatoire ; elle n'est pas une validation du délai de règlement réel. Harmoniser ensuite la politique validée entre Next, reaper, runner et budget.

```bash
node --env-file=.ops/phala-v7-preparation/preflight.env \
  --conditions=react-server --import tsx scripts/check-phala-v7.ts
```

Après déploiement, ajouter les **trois nouvelles** adresses `SIRIUS_ESCROW_ADDRESS`, `SIRIUS_DATASET_ADDRESS`, `SIRIUS_KYB_ADDRESS`. Avant cela, le rapport signale `contracts.not_configured` et retourne un code d'échec. Une configuration partielle est refusée. Après cela, il vérifie les versions v7/v4, les liaisons réciproques, le signataire Phala, le token et le KYB ouvert au même bloc finalisé. Un solde natif positif n'est pas une estimation suffisante du gas. Même lorsque les contrôles de chaîne passent, `activationReady` reste `false` : les autres preuves ne sont pas déduites de ce script.

## Préparation des configurations de staging

Préparer des fichiers privés distincts pour le runner, Next et le reaper staging. La configuration `.env.phala` existante contient l'origine et des accès de production : **ne pas la charger telle quelle pour cette bascule**. Reprendre uniquement les accès d'infrastructure nécessaires à la même CVM et au registre d'images ; les accès applicatifs, base et stockage sont ceux de staging. Ne pas exporter la clé de l'enclave.

Le fichier local `.env.phala-staging`, en `0600` et hors Git, contient le nouveau secret de transport staging, le RPC archive, Pinata staging et les nouvelles adresses. Il a été appliqué à la même CVM. Seuls les identifiants d’infrastructure nécessaires au registre d’images ont été repris de l’ancienne configuration ; ni base ni clé applicative de production ne sont injectées.

- Runner : origine staging, RPC archive testnet, nouvelles adresses et signataire attendu, transport partagé avec les deux services staging, accès Pinata staging, `SIRIUS_BILLING_VERSION=7`, politique de finalité commune. Aucune `DATABASE_URL`, master key injectée, clé de déploiement ou clé d'émetteur KYB.
- Next et reaper : mêmes contrats et RPC archive, `TEE_MODE=phala`, `SIRIUS_REQUIRE_PHALA=true`, URL RA-TLS de la CVM existante, mesures **actives** recapturées et secret de transport staging. Base staging commune à Next/reaper ; aucune clé de runner ou de déploiement.
- Frontend : réseau testnet, nouvelles adresses publiques, origine staging et empreinte de clé d'ingestion. Reconstruire après modification : ces variables publiques sont figées au build.
- Pipeline : la variable **du dépôt GitHub** `SIRIUS_STAGING_REQUIRE_PHALA=true` est configurée après validation de l’attestation active. La pipeline transmet `SIRIUS_REQUIRE_PHALA=true` à Vercel ; main exige toujours Phala. Le reaper doit conserver la même exigence dans sa configuration staging.
- Historique : le staging neuf repart avec une liste historique vide après suppression autorisée de ses données applicatives. Les anciens prêts de production conservent leurs propres déploiements.

Ali et Ali valident ensuite `pnpm ops:check-release <next.env> <reaper.env> <runner.env>`. Le résultat ne remplace pas la quote matérielle, les politiques économiques ni les tests réels.

## Image mesurée et volumes

Publier le code du lot B, obtenir une CI verte et relever le digest immuable du runner. Le rendu ci-dessous fixe ce digest dans le Compose, conserve les `${VARIABLES}` pour leur transmission chiffrée par Phala, fixe l'origine staging et supprime les noms de projet/volumes calculés sur le poste local. Docker Compose est requis, mais aucun conteneur n'est démarré par cette commande.

```bash
pnpm phala:compose-v7 bootstrap <image@sha256:digest-validé> .ops/phala-v7-preparation/bootstrap.compose.json
pnpm phala:compose-v7 init <image@sha256:digest-validé> .ops/phala-v7-preparation/init.compose.json
pnpm phala:compose-v7 active <image@sha256:digest-validé> .ops/phala-v7-preparation/active.compose.json
```

Les trois fichiers sont des documents Compose JSON, acceptés comme YAML. Chaque sortie est créée exclusivement en `0600` ; un fichier existant n'est pas écrasé. **Ne pas déployer un rendu `docker compose config` avec secrets interpolés** : le Compose entre dans la mesure attestée. Ne pas déployer directement `compose.v7.yaml` avec l'image laissée en variable.

| Mode | Service runner | Initialisation |
|---|---|---|
| `bootstrap` | Nouvelle image, amorçage uniquement, volumes `runner_replay` et `runner_budget` montés | Aucune |
| `init` | Amorçage uniquement | Conteneur ponctuel `initialize-v7`, sans réseau ni socket dstack, `restart: no` |
| `active` | v7, politiques et registres existants obligatoires | Aucun service ni paramètre d'initialisation |

Pour la **première installation uniquement**, après validation par Ali des deux politiques :

1. Préparer `RUNNER_INITIAL_BUDGET_POLICY` et `RUNNER_INITIAL_BILLING_POLICY` dans le fichier d'environnement privé dédié à l'initialisation. Ce sont les JSON complets validés, pas des montants de fixtures.
2. Contrôler qu'il n'existe pas d'ancien registre SQLite à restaurer. Les fichiers historiques `grant`/`capability` peuvent être conservés lors de leur migration volontaire. Vérifier la sauvegarde et les noms réels des volumes de la même CVM.
3. Pendant le créneau Phala autorisé, déployer le Compose `init` sur **la CVM existante**. L'outil vérifie les politiques avant création ; refuse un volume budget non vide, un registre replay existant, une incohérence de réseau/compte/financement ; crée en `0600` `budget-policy.json`, `billing-policy.json`, `ledger.sqlite` et `replay.sqlite`.
4. Contrôler la fin réussie du conteneur d'initialisation. Avec les logs privés inaccessibles à la CLI, le 25 septembre, le contrôle a utilisé le démarrage actif qui exige les registres existants, suivi d’un rapport de budget RA-TLS vérifié. Aucun fichier n’a été supprimé ou réinitialisé. Un échec ou un état partiel demande une analyse opérateur, **jamais une suppression pour réessayer**. Un registre perdu impose une restauration cohérente.
5. Retirer le Compose `init` et les deux variables `RUNNER_INITIAL_*` avant d'activer le runner. Contrôler puis sauvegarder les registres selon les procédures A1/A2. Une restauration doit inclure les journaux SQLite cohérents ; ne pas copier seulement un fichier DB pendant une écriture.

La CVM existante n'a pas d'accès SSH configuré : cette étape d'initialisation explicite évite d'en inventer un. Le service n'est jamais inclus dans le Compose actif ; l'image n'initialise rien dans son démarrage normal. Il n'est pas un outil de restauration et ne garantit pas l'authenticité des justificatifs comptables fournis par l'opérateur.

## Exécution après levée des prérequis

1. **Ali/Ali :** politiques et dépenses d'essai validées, endpoint archive vérifié, snapshot staging récent et restauration répétée, prêts/entraînements en cours traités, scénarios et deux wallets distincts de la trésorerie prêts. Vérifier les accès et le superviseur avant toute dépense.
2. **Ali :** contrôler le bytecode compilé, le réseau et le compte de déploiement ; estimer et borner le gas avant signature. Déployer avec `SIRIUS_DEPLOY_NETWORK=testnet`, `SIRIUS_BILLING_VERSION=7`, `SIRIUS_KYB_MODE=open` et le signataire Phala ci-dessus. Le script existant crée KYB, DatasetRegistry et EscrowV7, puis lie le registre. Aucun v6 intermédiaire. La clé de déploiement n'entre ni dans le runner ni dans Next/reaper.
3. **Ali :** contrôler les reçus et les liaisons ; attendre leur disponibilité dans l'état finalisé ; compléter puis relancer `phala:check-v7`. Conserver les hashes de toutes les transactions, y compris en cas de timeout. Ne pas relancer aveuglément un déploiement dont la réponse manque.
4. **Ali/Ali :** alimenter le compte Phala en ETH testnet dans la limite retenue, vérifier les soldes, installer et tester le superviseur d'arrêt de la session ; aucune remise à zéro du budget à chaque session.
5. **Ali :** après accord sur le créneau/coût, reprendre la même CVM `e8a8b8cb-1552-4b9a-b801-54e3ae0f6e1e`, app ID inchangé. Utiliser les rendus `bootstrap`/`init` nécessaires puis `active`, avec l'environnement **staging** explicite. Une mise à jour Phala peut démarrer la machine : ce n'est pas un simple enregistrement de configuration.
6. **Ali :** recapturer RA-TLS, quote Intel `UpToDate`, événement RTMR3, hash du Compose brut, chaîne de clé et empreinte d'ingestion ; vérifier l'image attendue, l'adresse de règlement et l'origine staging. Répéter après redémarrage. Ne jamais épingler les mesures `bootstrap` ou `init` comme mesures actives.
7. **Ali/Ali :** vérifier les migrations staging déjà appliquées et les lignes historiques, préparer le réimport des datasets pour ce runner, synchroniser Next/reaper, contrôler `ops:check-release`, reconstruire puis déployer staging. Exécuter `runner:check-migration` avec cette cible explicite.
8. **Ensemble :** exécuter et documenter les scénarios ci-dessous ; conserver hashes, blocs de finalité, temps d'attente, exports et preuves de restauration dans l'espace privé, avec synthèse publiable sans secrets.

Les commandes Phala doivent viser la même CVM avec `--profile sirius --cvm-id e8a8b8cb-1552-4b9a-b801-54e3ae0f6e1e`, un fichier `-c` rendu et un fichier `-e` de staging. Elles ne sont pas lancées par les scripts de préparation.

## Preuves de fin du lot B

- [ ] Dataset synthétique publié depuis le wallet provider, reçu lié au runner actif et nouveau titre v7 compatible.
- [ ] Devis détaillé accepté par un autre wallet ; approbation exacte du total et prêt verrouillé sur le nouvel escrow.
- [ ] Calcul réel en enclave ; règlement canonique/finalisé, modèle ouvert et crédits provider/trésorerie retirés. Mesurer l'attente de finalité.
- [ ] Échec mesuré : dataset et compute non consommé remboursés, retenue bornée, crédit borrower retiré.
- [ ] Expiration sans consommation : remboursement à échéance avec le runner indisponible.
- [ ] Réponse Next/RPC perdue et runner interrompu : reprise sans recalcul indu, double règlement ni nouveau nonce incertain.
- [ ] Volume restauré : budgets et anti-rejeu conservés ; registre absent refusé ; identité Phala stable après redémarrage.
- [ ] Suppression de dataset avec prêt actif refusée ; reaper/alertes et échéance d'arrêt vérifiés.
- [ ] Staging remis à zéro et nouveaux datasets rattachés au runner actif ; aucune clé ou donnée brute ne transite par Next pendant le nouveau parcours Phala. Les anciens modèles et crédits staging sont hors périmètre par décision de Ali.

## Coût du prochain créneau

L'API confirme `0,058000 USD/h` de compute et `0,002780 USD/h` de disque, soit **0,060780 USD/h** au total. Une session de deux heures représente **0,121560 USD**, disque de la session inclus, avant coussin et autres fournisseurs. Le disque continue à coûter environ 2,0016 USD sur 30 jours même à l'arrêt. La [grille Phala](https://cloud.phala.com/about/pricing) distingue ces deux frais.

La politique d’essai installée utilise les crédits Phala existants, avec une enveloppe logicielle de 5 USD dont 4,02 USD de réserve fixe ; ce n’est ni un achat ni une marge commerciale. Le créneau de validation du 25 septembre est borné à 45 minutes, soit environ 0,046 USD estimé au maximum pour compute et disque pendant ce créneau. Aucun entraînement client n’est autorisé avec ces crédits. Un nouveau créneau doit être annoncé et supervisé avant redémarrage.
