# A2 — Comptabilité et outils d'exploitation

Préparation locale du 24 septembre 2026, Ali, branche `feat/operations-accounting` depuis `staging` (`332afae`). Référence de périmètre : [répartition A1/A2](WORK-PLAN-1-7.md) ; interface consommée : [export comptable A1](RUNNER-RECOVERY-A1.md#interface-fournie-à-ali).

Rien de ce qui suit n'active Phala, n'engage de dépense, ne modifie un compte fournisseur, n'applique de migration ni n'envoie de transaction. Les seules lectures réseau sont des appels RPC publics en lecture sur Mezo testnet.

## État des tranches

| Tranche | Livrable | État |
|---|---|---|
| A2.0 Contrat d'export | `accounting-export.mjs`, exemple `fixtures/runner-accounting-export.v1.json`, générateur `accounting-fixture.ts` | Fait, testé |
| A2.1 Rapprochement comptable | `reconcile.mjs`, kit `escrow-testkit.ts`, relevés réels v5/v6 en fixtures | Fait, testé, vérifié sur les relevés réels |
| A2.2 Relevé des escrows | `escrow-events.ts` et sa CLI | Fait, testé, vérifié sur le RPC public |
| A2.3 Tarifs et financement des essais | `deploy/operations/tariff-proposal.json`, `tariffs.mjs` | Fait, proposé, non approuvé |
| A2.4 Limites fournisseurs | `deploy/operations/supplier-limits.json`, `supplier-limits.mjs` | Fait ; tableaux de bord à relever |
| A2.5 Superviseur | `supervisor.mjs`, unité watchdog durcie | Fait ; canal du contrôle de budget à convenir avec Ali |
| A2.6 Restauration du volume runner | `restore-gap.mjs`, procédure ci-dessous | Fait ; copie hors machine à décider |
| A2.7 Inventaire historique | Section ci-dessous | Fait, à valider avec Ali |
| A2.8 Matrice navigateur | [BROWSER-TEST-MATRIX.md](BROWSER-TEST-MATRIX.md) | Fait |
| Pilote | [PILOT-INTERVIEWS.md](PILOT-INTERVIEWS.md) | Guide prêt ; entretiens à mener |

Validation locale sous Linux (WSL Ubuntu, Node 22.23.2, même version que la CI) : **56 tests d'exploitation**, typage et lint réussis. Trois tests historiques d'archives échouent sous Windows seulement, faute de permissions POSIX ; ils passent sous Linux.

## Commandes à ajouter au manifeste (intégration Ali)

**Intégration du 25 septembre :** les commandes ci-dessous sont maintenant dans `package.json`, avec `ops:db-inventory`, `ops:testnet-evidence` et `ops:runner-monitor`. Le canal RA-TLS de supervision et le financement des essais internes sont décrits dans [PHALA-TRIAL-CREDITS.md](PHALA-TRIAL-CREDITS.md). Le tarif commercial proposé ici reste non activé. La copie hors machine reste différée ; le staging repart sans reprendre les historiques à la demande de Ali, selon [PHALA-V7-STAGING.md](PHALA-V7-STAGING.md).

Le manifeste reste sous la responsabilité de Ali. Les nouveaux tests sont déjà repris par `test:operations`. Commandes proposées :

```json
"ops:accounting-fixture": "node --import tsx scripts/operations/accounting-fixture.ts",
"ops:escrow-events": "NODE_OPTIONS=\"--conditions=react-server\" node --import tsx scripts/operations/escrow-events-cli.ts",
"ops:tariffs": "node scripts/operations/tariffs.mjs",
"ops:suppliers": "node scripts/operations/supplier-limits.mjs",
"ops:supervise": "node scripts/operations/supervisor.mjs",
"ops:restore-gap": "node scripts/operations/restore-gap.mjs",
"ops:reconcile": "node scripts/operations/reconcile.mjs"
```

## A2.0 — Contrat de l'export runner

`validateAccountingExport` lit l'export `runner:budget export` de façon stricte : un champ inconnu, absent ou mal typé arrête la lecture et nomme le chemin du champ, jamais sa valeur. Contrôles de cohérence : une mesure absente n'est acceptée que pour `not-started` et `uncertain` ; chaque transaction en attente pointe vers une opération de transaction encore réservée ; chaque opération rattachée pointe vers un devis exporté.

L'exemple versionné est produit par le vrai `BudgetLedger` avec les cinq cas utiles : opération hors devis, succès réglé, échec mesuré avec règlement incertain, calcul incertain, devis jamais démarré. Le test régénère cet export et compare sa structure à l'exemple : **si A1 change le format, ce test échoue** et il faut régénérer l'exemple avec `ops:accounting-fixture` puis relire la comptabilité.

`allocationCheck` applique la règle anti double compte de A1 (budgets des devis + opérations hors devis = total alloué), en USD et en wei. Un écart est rapporté, jamais corrigé.

## A2.2 — Relevé des escrows

`ops:escrow-events v7:0xESCROW:BLOC [v6:0x…:BLOC …] [--chunk=5000]` relève tous les journaux des escrows listés jusqu'au bloc stable de la politique de finalité de l'application, puis les décode avec les ABI générées. Montants en chaînes d'entiers exacts. Aucun compte de signature, aucun `.env` chargé.

Le relevé est complet ou refusé : autre réseau, log retiré ou hors plage, log d'un autre contrat, doublon, deux hashes pour un bloc, ou bloc devenu non canonique en fin de lecture. Un journal que l'ABI ne connaît pas est conservé brut et compté.

Vérification réelle en lecture seule, le 24 septembre 2026 :

| Escrow | Événements relevés | Explorateur | Décodés |
|---|---:|---:|---:|
| v6 `0x805a…cba0` | 9 | 9 | 9 |
| v5 `0xede8…700e` | 37 | 37 | 37 |

Le token USDC de l'escrow v6 (`0x1d6c58bb2f60b5a18ee4a72096f7743f01db0213`) déclare **18 décimales** sur la chaîne, pas 6 : toute conversion doit lire les décimales du token.

## A2.3 — Tarifs et financement des essais

`ops:tariffs --decimals=18 [--usdc=0x…]` lit la [proposition](../deploy/operations/tariff-proposal.json) et le [plan de coûts](../deploy/operations/testnet-plan.json) :

- **Couverture :** avec les hypothèses du business plan (150 USD de base, 34 tentatives à 0,10 USD, 30 réussites, coussin de 25 %), le coût par réussite est de **6,391667 USD** ; le minimum proposé de **7 USDC** le couvre, soit environ 18,25 USD de marge sur le mois supposé.
- **Prix :** 7 USDC pour les deux profils actuels, converti avec les décimales du token et arrondi vers le haut.
- **Retenue en échec :** tarif de calcul Phala à la milliseconde, arrondi vers le bas, sans marge : au plus **0,000483 USDC** pour 30 secondes. Avec un token à 18 décimales ce tarif vaut 0 et aucune retenue n'a lieu, plutôt qu'une retenue gonflée par l'arrondi.
- **Essais :** enveloppe proposée de 5 USD pour dix sessions de deux heures ; source de financement à désigner ; un apport n'est jamais une marge acquise.
- **Arrêts :** cinq scénarios avec déclencheur, mécanisme, responsable et coût résiduel, dont le disque facturé après l'arrêt.

L'outil ne produit une politique au format exact de `RUNNER_BILLING_POLICY_FILE` qu'une fois **tous** les bloqueurs levés : approbation d'Ali et de Ali avec date et fin de validité, financement désigné et approuvé, deux profils calibrés sur la CVM, plafonds fournisseurs et benchmark Phala vérifiés, adresse du token fournie. Son installation dans le runner reste une opération de Ali.

## A2.4 — Limites des fournisseurs

La [fiche fournisseurs](../deploy/operations/supplier-limits.json) résume ce que permet la documentation officielle, relue le 24 septembre 2026 :

| Fournisseur | Plafond bloquant | Point d'attention |
|---|---|---|
| Phala | Partiel : en prépayé, solde vérifié avant démarrage | Disque facturé même arrêté ou espace suspendu ; recharge automatique à désactiver |
| Vercel | Partiel : pause de la production au budget | Contrôle toutes les quelques minutes ; sièges et modules exclus |
| Neon | Offre gratuite seulement | Offres payantes : alertes à 80/100 %, pas de plafond |
| Pinata | Aucun documenté | Dépassements facturés au Go et aux requêtes |
| VPS OVHcloud | Inconnu | Reapers staging/production actifs sur 162.19.66.80, watchdog installé mais désactivé ; anciens reapers non arrêtés. Offre et plafonds du compte à relever, voir [migration](VPS-MIGRATION.md) |
| RPC | Sans objet | RPC public, sans coût direct |
| GitHub | Partiel | Actions bloquées au quota sans moyen de paiement |

`ops:suppliers` ne déclare un fournisseur vérifié qu'après relevé de son tableau de bord depuis moins de 31 jours : date, auteur, offre observée, recharge automatique désactivée, plafond ou alerte relevé. Tant que ce n'est pas fait, `providerCapsVerified` reste faux et bloque la politique tarifaire.

## A2.5 — Superviseur

`ops:supervise session.json cvm.json [budget-check.json]` combine l'échéance de session (même règle que le watchdog) et le dernier `runner:budget check` connu. Niveaux : `ok`, `warning`, `critical` (code de sortie 0, 1, 2). Le rapport ne démarre, n'arrête et ne supprime rien. Quand les admissions sont bloquées, il recommande d'avancer l'arrêt s'il n'y a plus de travail en cours, ou d'attendre la réconciliation sinon.

Testé contre la sortie réelle de `runner:budget check` et, de bout en bout, avec le vrai watchdog face à une fausse CLI Phala : rien avant l'échéance, échec visible après l'échéance sans `--apply-stop`, demande d'arrêt avec, alerte opérateur si l'API tombe, jamais de démarrage ni de suppression.

L'unité `sirius-phala-watchdog.service` est durcie (masque de fichiers, protections noyau et périphériques, aucune capacité, sockets IP et Unix seulement). Sous une unité systemd transitoire avec la fausse CLI, le watchdog lit toujours la CVM et demande l'arrêt. Score d'exposition `systemd-analyze security` : **8,5 → 3,0**.

**Installation du 25 septembre :** `GET /operations/budget`, secret de supervision dédié et collecteur `ops:runner-monitor` en RA-TLS. Le superviseur accepte le rapport horodaté, y compris lorsque le budget est épuisé. Les unités sont installées sous `sirius-ops` sur le nouveau VPS, avec configurations privées, runtime et profil Phala vérifiés ; timers désactivés, CVM arrêtée. Vérifier la collecte réelle depuis cet hôte au prochain créneau ; voir [la procédure](PHALA-TRIAL-CREDITS.md#canal-de-supervision).

## A2.6 — Restauration du volume runner

`ops:restore-gap export-restauré.json dernier-export.json` refuse la réouverture tant que le registre restauré a oublié quelque chose par rapport au dernier export connu : opérations et devis postérieurs, opérations revenues en arrière, transactions dont les nonces sont déjà consommés, exposition allouée manquante. Deux registres contradictoires ou deux wallets différents sont signalés, jamais fusionnés. L'exercice est rejoué sur le vrai registre : sauvegarde cohérente, dépenses et transaction signée après la copie, perte du volume, restauration.

Procédure après perte ou remplacement du volume Phala :

1. Suspendre les admissions et arrêter tous les écrivains ; ne jamais lancer `runner:replay init` ni `runner:budget init` pour « repartir ».
2. Restaurer le volume entier (registre, WAL éventuel, répertoire anti-rejeu et ses sous-répertoires `grant` et `capability`) depuis la copie la plus récente.
3. Exporter le registre restauré (`runner:budget export`) et le comparer au dernier export conservé hors de la CVM avec `ops:restore-gap`.
4. Relever les escrows (`ops:escrow-events`) et le nonce du wallet opérationnel ; toute transaction ou nonce postérieur à la copie est traité par la réconciliation (`runner:transactions reconcile`), jamais re-signé.
5. Rapprocher les factures fournisseurs postérieures à la copie.
6. Rouvrir seulement si l'écart est nul et la chaîne cohérente ; sinon escalade, les allocations inconnues restent comptées.

Cette procédure suppose des **exports réguliers conservés hors de la CVM**. Sans eux, un retour arrière cohérent reste indétectable.

**Décision en attente (Ali et Ali) : copie hors machine.** La sauvegarde PostgreSQL chiffrée et sa clé sont aujourd'hui sur le même Mac. Options : second support chiffré détenu par l'autre fondateur, avec la clé chez le premier ; ou stockage objet chiffré côté client, avec la clé hors de ce stockage. Dans les deux cas, clé et paquet ne doivent jamais être au même endroit.

## A2.7 — Inventaire historique

Relevé en lecture seule le 24 septembre 2026, complété par [l'exercice de reprise](BACKUP-RECOVERY.md). Rien n'a été supprimé.

### Copies pouvant contenir d'anciennes clés enveloppées

| Copie | Contenu sensible | Détenteur | Traitement |
|---|---|---|---|
| Base PostgreSQL de production | `wrappedKey` mis à null à la suppression ; historique du fournisseur | Neon | Relever la fenêtre de restauration du fournisseur ; elle peut conserver d'anciennes valeurs |
| Snapshot `.ops/snapshot-2026-09-23…` | Dump chiffré AES-256-GCM | Mac de Ali | Clé sur la même machine : voir la décision de copie hors machine |
| Registre runner du volume Phala | Anciens résultats de scellement (`operations.result`) | Disque Phala, CVM arrêtée | `sanitize-key-cache` hors service, sur la copie explicitement fournie |
| Sauvegardes du registre (`VACUUM INTO`) | Même contenu que le registre à la date de copie | Selon l'opérateur | À inventorier, puis nettoyer avant tout archivage |
| Snapshots éventuels du fournisseur Phala | Image du disque | Phala | Existence et rétention à demander |

### Modèles historiques

13 blobs de modèles sauvegardés et relus avec empreintes identiques. 2 modèles livrés, déchiffrés et restaurés hors ligne, clés sauvegardées chiffrées. 11 restent liés à d'anciens wallets de test inaccessibles : conserver blobs et ancienne instance, sans contourner le contrôle du propriétaire.

### Escrows historiques

Calcul à partir du relevé complet des événements :

| Escrow | Prêts | Crédits dus, non retirés | Prêts encore ouverts |
|---|---|---:|---|
| v6 `0x805a…cba0` | 3 verrouillés, 2 réglés | 20 USDC (10 + 10) | **1 prêt de 10 USDC, échéance 1er octobre 2026 à 08:13 UTC (10:13 à Paris)** |
| v5 `0xede8…700e` | 10 verrouillés, 7 réglés, 3 remboursés | 100 USDC sur 5 comptes | Aucun |

Deux constats nouveaux par rapport au relevé du 23 septembre :

- Le prêt v6 ouvert a été verrouillé au bloc 123536029, après le relevé documenté. À suivre jusqu'à règlement ou remboursement à échéance, et à garder dans les escrows historiques autorisés.
- Un crédit v5 de 20 USDC est dû au compte `0xf39f…2266`, **premier compte par défaut de Hardhat, dont la clé privée est publique**. N'importe qui peut le retirer. Montant testnet sans valeur, mais cette adresse ne doit jamais recevoir de fonds réels.

### Accès historiques à conserver

- Ancienne instance `https://sirius-data.tech` et ses clés : nécessaires à la livraison des modèles historiques.
- Adresses des escrows v5 et v6 dans `SIRIUS_LEGACY_ESCROW_ADDRESSES`.
- Répertoire anti-rejeu : conserver `grant` et `capability`.

## A2.1 — Rapprochement comptable

`ops:reconcile export.json releve.json[,releve2.json] --sirius=0xBENEFICIAIRE,0xRUNNER --decimals=18 [--invoices=f] [--receipts=f] [--previous=rapprochement-precedent.json] [--eth-usd-upper=MICROS]` croise l'export du registre (A2.0), le relevé des escrows (A2.2), les factures fournisseurs et, s'ils sont joints, les reçus de transactions. Les bornes USD/USDC viennent de la proposition tarifaire. Code de sortie : 0 sans écart, 1 avec avertissements, 2 avec écarts critiques, 3 si une entrée est illisible.

Chaque montant tombe dans une seule case :

| Case | Source | Règle |
|---|---|---|
| Revenu acquis | Crédits on-chain aux comptes Sirius | Compute d'un prêt réglé, retenue d'un échec mesuré ou d'un remboursement à échéance ; converti au plancher USD/USDC, arrondi bas. Séparé en « dans l'escrow » et « retiré ». |
| Dû aux tiers | Crédits aux autres comptes moins leurs retraits | Dataset des providers, remboursements des borrowers ; converti au plafond, arrondi haut. |
| Dépôts verrouillés | Prêts sans résolution jusqu'au bloc stable | Remboursables : jamais un revenu, même au nom du bénéficiaire compute. |
| Charges engagées | Factures payées ou dues ; gas réel des reçus | Gas converti au plafond ETH/USD si la borne est fournie, sinon laissé en wei. |
| Provisions | Factures estimées | Ni engagées ni ignorées. |
| Réservations | Totaux de l'export | Expositions maximales : ni revenus ni charges. |
| Incertain | Transactions en attente, calculs sans checkpoint durable, reçus d'échec non enregistrés on-chain | Conservé hors revenus et hors charges. |

Le lien entre registre et chaîne est exact : un devis s'appelle `loan:chainId:escrow:loanKey` et son règlement `release:` ou `failure:` avec les mêmes références ; le hash de transaction de l'opération doit porter l'événement `LoanReleased` ou `LoanFailed` de ce prêt. Écarts signalés, jamais corrigés, par gravité :

- **Critiques :** règlement v7 on-chain sans opération dans le registre (autre instance ou registre perdu), transaction minée sans l'événement attendu, consommation enregistrée différente du reçu d'échec, retenue supérieure au plafond du verrouillage, retraits supérieurs aux crédits, total alloué incohérent, état revenu en arrière depuis le rapprochement précédent, ligne du registre disparue.
- **Avertissements :** règlement réussi selon le registre mais absent de la chaîne jusqu'au bloc stable, transaction en attente déjà minée (lancer `runner:transactions reconcile`), calcul incertain, reçu d'échec non enregistré, verrouillage introuvable, gas réel inconnu, journal non décodé.
- **Informations :** escrow historique v5/v6 sans registre, escrow non relevé, remboursement réclamé par le borrower, facture estimée, reçu sans opération.

Rejouer le rapprochement avec un export plus récent met à jour les observations : la clé d'une entrée est (chainId, wallet, nature, identifiant), la première date d'observation est conservée et rien n'est compté deux fois. Le résultat « acquis moins engagé » est indicatif : revenus au plancher, charges au plafond, hors réservations et incertains ; ce n'est pas un PnL et il n'inclut aucun apport, dépôt ni token testnet.

Vérifié sur les relevés réels v5 et v6 (fixtures versionnées) : aucun revenu Sirius, 120 USDC dus à cinq comptes historiques, un prêt v6 de 10 USDC encore verrouillé, aucun écart critique. Les tests rejouent aussi, avec de vrais événements encodés par les ABI : un succès réglé, un échec mesuré, un calcul incertain, un devis jamais verrouillé, un règlement orphelin, une retenue au-dessus du plafond, un retrait sans crédit, un recul du registre, des factures et des reçus.

Reste hors du moteur : la trésorerie réellement disponible (soldes bancaires et wallets) et le rapprochement des factures avec les périodes d'usage, qui demandent les relevés des comptes fournisseurs (A2.4).
