# Sirius — coûts totaux et business plan

Version de travail du **23 septembre 2026**. Montants en **USD hors taxes**, sauf prix client explicitement indiqués en USDC. Un mois de simulation représente 30 jours. Ce document centralise les hypothèses économiques ; les procédures restent dans [le plan mainnet](MAINNET-PLAN.md), [la facturation](COMPUTE-BILLING.md) et [la préparation opérationnelle](OPERATIONS-PREPARATION.md).

## 1. Synthèse

| Question | Réponse au stade actuel |
|---|---|
| Combien le projet a-t-il déjà coûté ? | **Total historique non établi** : les factures et le temps passé n'ont pas été réconciliés. Aucun montant nul n'est présumé. |
| Quel coût Phala persiste à l'arrêt ? | **2,0016 USD pour 30 jours** de disque de 20 Go, aux tarifs relevés le 23 septembre. |
| Combien prévoir pour les essais Phala préparés ? | **3,209940 USD estimés**, 4,02 USD avec coussin de 25 % ; enveloppe proposée de **5 USD**, non approuvée. |
| Quel budget mensuel pour un petit pilote ? | **150 USD d'infrastructure de base**, puis coûts variables et temps de travail, selon les hypothèses détaillées ci-dessous. |
| Quel budget jusqu'à un mainnet audité ? | Scénario central de **36 447,86 USD de trésorerie à prévoir sur sept périodes mensuelles**, réserve incluse, sans rémunération des fondateurs. Il dépend surtout du devis d'audit. |
| Quel revenu Sirius ? | Le **prix compute** réglé après réussite ; le prix dataset appartient au provider. Aucun chiffre d'affaires réel réconcilié n'est établi dans le dépôt. |
| Quel prix de départ étudier ? | **Minimum proposé de 7 USDC par réussite**, hors dataset et frais wallet. Hypothèse commerciale, non validée et non activée. |
| Le projet est-il rentable ? | Non démontré. Le modèle à 7 USDC couvre l'infrastructure à partir de **22 réussites/mois** sous les hypothèses retenues ; il ne couvre pas encore nécessairement le travail et le lancement. |

**État réel :** démonstration EVM sur testnet ; parcours v7 intégré localement ; Phala arrêté au dernier contrôle du 23 septembre à 14:48 UTC. Aucun tarif commercial, nouveau contrat public v7 ou budget réel n'est activé. Les 5 USD concernent les essais Phala ; le budget global inclut aussi exploitation, audit, préparation commerciale et temps de travail.

### Comment lire les montants

- **Relevé** : tarif public ou information technique vérifiée, sans supposer que l'abonnement correspondant est souscrit.
- **Hypothèse** : montant choisi pour rendre le budget calculable ; ce n'est ni une facture, ni un devis fournisseur, ni une décision de dépense.
- **À réconcilier** : coût réel, financement ou revenu que les éléments disponibles ne permettent pas d'établir.

À la demande de Ali, aucun questionnaire sur les abonnements n'est nécessaire pour cette version. Le présent récapitulatif les inclut sous hypothèses, sans modifier les comptes ni les offres existantes.

## 2. Produit, client et valeur vendue

Sirius vise les organisations qui disposent de données utiles à l'entraînement mais veulent en contrôler l'accès, et les équipes qui souhaitent entraîner un modèle sur ces données. La proposition est un accès limité au calcul, avec dataset chiffré, exécution confidentielle, devis accepté avant paiement et livraison du modèle après règlement.

| Partie | Besoin à vérifier auprès des prospects | Valeur proposée |
|---|---|---|
| Provider | Exploiter économiquement ses données avec un accès contrôlé | Fixer un prix dataset, limiter le profil autorisé et percevoir le règlement |
| Borrower | Tester la valeur de données externes sans en acquérir une copie brute | Connaître le prix avant exécution et récupérer le modèle produit |
| Organisation cliente | Comprendre qui a calculé quoi, sur quel périmètre et à quel coût | Traçabilité du parcours, conditions signées et preuves d'exécution |

**Cible initiale proposée :** un seul cas d'usage tabulaire B2B, par exemple prévision ou scoring, avec un provider et un borrower identifiés. Le choix du secteur reste à arbitrer avec Ali et Ali. La taille du marché, la demande solvable et les prix acceptables ne sont pas mesurés ; aucun chiffre de marché n'est inventé.

Les capacités actuelles sont les régressions linéaire et logistique, des entrées limitées à 3 Mio et des jobs v7 bornés entre 1 et 30 secondes. L'upload de 100 Mo, les arbres et les traitements longs sont des objectifs futurs. Les performances locales ne prouvent pas celles de Phala. Un modèle exporté peut divulguer des informations sur son entraînement : la promesse commerciale doit suivre le périmètre de confidentialité réellement vérifié.

Les alternatives à comparer pendant les entretiens sont le partage direct sous accord, un environnement privé construit par le client et l'utilisation de données publiques ou synthétiques. L'avantage de Sirius doit se mesurer en qualité du résultat, temps d'intégration, contrôle d'accès et coût complet ; la présence d'un TEE ne suffit pas à prouver un avantage commercial.

## 3. Coûts récurrents du projet

### 3.1 Phala : montants calculables aujourd'hui

Référence préparée : une CVM `tdx.small`, un vCPU, 2 Go de RAM et un disque de 20 Go. Calcul : **0,058 USD/h**. Stockage : **0,000139 USD/Go/h**, facturé aussi à l'arrêt. Sources relevées le 23 septembre : [types d'instances Phala](https://cloud.phala.com/about/instance-types), [facturation calcul et stockage](https://cloud.phala.com/about/pricing).

| Usage sur 30 jours | Calcul | Disque | Total Phala |
|---|---:|---:|---:|
| CVM arrêtée pendant toute la période | 0,000000 | 2,001600 | **2,001600** |
| Une session de 2 h | 0,116000 | 2,001600 | **2,117600** |
| Dix sessions de 2 h | 1,160000 | 2,001600 | **3,161600** |
| Dix sessions avec réserve de 5 min de délai d'arrêt chacune | 1,208340 | 2,001600 | **3,209940** |
| Disponibilité continue, 720 h | 41,760000 | 2,001600 | **43,761600** |

Le [plan JSON](../deploy/operations/testnet-plan.json) et `pnpm ops:costs` reproduisent ces calculs. L'enveloppe de 5 USD est une proposition pour le quatrième scénario, sans achat de crédit. La réserve de cinq minutes ne borne pas une panne du superviseur ou de l'API. Le disque continue de coûter après les 30 jours ; aucune suppression automatique n'est prévue.

### 3.2 Budget mensuel de référence pour un petit pilote

**Hypothèse :** une CVM disponible en continu, deux personnes pouvant déployer, faible trafic et petits modèles actuels. Les autres abonnements réels sont inconnus ; le tableau constitue un budget de travail complet pour ce périmètre technique.

| Poste | Base mensuelle retenue | Nature et périmètre |
|---|---:|---|
| Phala calcul + disque | 43,7616 | Tarif relevé, une seule CVM `tdx.small`, 720 h |
| Vercel Pro, deux sièges de déploiement | 40,00 | Référence publique : 20 USD avec un siège, puis 20 USD pour le second ; consommation au-delà des inclusions à ajouter. [Source Vercel](https://vercel.com/docs/plans/pro-plan). |
| PostgreSQL / Neon | 10,00 | Provision interne, **pas un tarif Neon vérifié ni l'offre actuelle présumée** |
| Pinata Picnic | 20,00 | Référence publique mensuelle ; dépassements et compatibilité des usages à vérifier. [Source Pinata](https://pinata.cloud/pricing). |
| VPS du reaper et supervision | 10,00 | Provision interne ; hébergement et capacité à confirmer |
| RPC et lectures réseau | 5,00 | Provision interne ; gas des transactions traité séparément |
| Domaine et renouvellement | 5,00 | Provision de 60 USD/an répartie mensuellement ; facture réelle non vérifiée |
| Sauvegardes, logs et monitoring supplémentaires | 10,00 | Provision interne ; aucun nouveau service activé |
| **Sous-total technique modélisé** | **143,7616** | Hors coûts variables supplémentaires et travail humain |
| **Base de planification arrondie** | **150,00** | Les 6,2384 USD d'écart constituent un petit coussin, pas une limite fournisseur |

Le crédit d'usage inclus dans Vercel Pro ne s'ajoute pas au revenu de Sirius et ne se déduit pas une deuxième fois de l'abonnement. Les 10 USD de sauvegardes ne sont pas un deuxième disque Phala. Le poste domaine est une répartition comptable : le paiement réel peut être annuel. Un deuxième runner ou un environnement de staging payant supplémentaire demanderait un poste distinct.

Avec les mêmes hypothèses hors Phala, le mois de dix essais représente **103,21 USD** arrondis au centime supérieur : 100 USD d'autres postes + 3,209940 USD de Phala. Le **coût réel** reste la somme des factures ; une offre gratuite ou déjà mutualisée peut réduire la dépense supplémentaire, sans que ce soit présumé ici.

### 3.3 Coûts variables et travail

Le modèle de rentabilité ci-dessous ajoute une hypothèse de **0,10 USD par tentative**, réussie ou échouée, pour les frais supplémentaires au-delà des postes déjà budgétés : transferts, dépassements d'API, gas du runner et traitement d'incident. Ce montant doit être remplacé par une mesure ; ce n'est pas un coût Phala par entraînement ni un plafond de facturation des échecs.

Le calcul Phala, déjà alloué dans les 150 USD, n'est pas refacturé dans cette hypothèse de coût. Une hausse de taille, de durée, de stockage ou de concurrence impose de recalculer les deux postes. L'enveloppe ne démontre pas la capacité à servir les futurs jobs de 100 Mo ou 1 Go.

Le développement, la maintenance, la vente et le support ont un coût même si les fondateurs ne se paient pas. Pour rendre ce coût visible, une simulation valorise **100 heures mensuelles cumulées pour l'équipe à 30 USD/h**, soit **3 000 USD/mois**. Il s'agit d'une convention de travail, sans salaire, taux de marché ou charges sociales présumés. Si ces heures sont rémunérées, intégrer le décaissement et ses charges à la trésorerie au lieu de compter deux fois le même travail.

## 4. Budget total jusqu'au mainnet

### 4.1 Infrastructure par phase

Les durées ci-dessous sont des périodes de budget arrondies couvrant le parcours septembre 2026 → mars 2027 ; elles ne remplacent pas les portes techniques du [plan mainnet](MAINNET-PLAN.md). À partir de la phase 1, une provision de **200 USD/mois** remplace la base de 150 USD pour laisser de la place aux évolutions. Elle n'est pas un dimensionnement validé des futurs modèles.

| Phase | Périodes budgétées | Infrastructure retenue | Condition de progression |
|---|---:|---:|---|
| 0 — Préparation et essais | 1 | 103,21 | Préparation locale ; essais payants soumis à autorisation et financement |
| 1 — Produit et entretiens | 2 | 400,00 | Besoin pilote confirmé, ressources recalibrées si taille ou modèles évoluent |
| 2 — Pilote externe | 1 | 200,00 | Parcours et confidentialité adaptés aux données utilisées |
| 3 — Audit, corrections, lancement | 3 | 600,00 | Audit financé, corrections vérifiées et portes mainnet franchies |
| **Total infrastructure sur sept périodes** | **7** | **1 303,21** | Hypothèse d'exploitation ; consommations exceptionnelles à ajouter |

### 4.2 Scénario central de trésorerie

Toutes les lignes ci-dessous sont des **provisions à arbitrer**, non des commandes ou factures. L'audit à 25 000 USD reprend un point de travail dans les fourchettes du plan initial ; obtenir un devis couvrant contrats, runner, clés, attestation, livraison et revue des corrections. Le seul prix ne garantit pas ce périmètre.

| Poste jusqu'au lancement | Hypothèse centrale USD |
|---|---:|
| Infrastructure des sept périodes | 1 303,21 |
| Frais variables ordinaires : provision de 100 tentatives par période × 7 × 0,10 USD | 70,00 |
| Audit indépendant et vérification des corrections | 25 000,00 |
| Entité, conseil et contrats commerciaux/données | 2 500,00 |
| Mise en place KYB externe et KMS/HSM | 500,00 |
| Prospection, accueil du pilote et outils supplémentaires | 500,00 |
| Déploiements, gas et consommations techniques exceptionnelles | 500,00 |
| **Budget avant réserve** | **30 373,21** |
| Réserve de 20 %, arrondie au centime supérieur | 6 074,65 |
| **Trésorerie totale à prévoir dans ce scénario** | **36 447,86** |

Ce total exclut taxes, rémunérations/charges des fondateurs et déplacements ; la prospection est supposée distante. Le poste accueil/outils ne rémunère pas une deuxième fois les heures de l'équipe. Les opérations courantes restent dans l'infrastructure et ses frais variables ; la provision de 500 USD concerne les opérations exceptionnelles, dont le lancement. Les consommations KYB récurrentes et les offres effectivement requises doivent être intégrées dès que leur devis est connu.

**Sensibilité au seul prix d'audit**, en gardant les autres provisions identiques :

| Hypothèse d'audit, issue des estimations du plan initial | Trésorerie simulée, réserve de 20 % incluse |
|---|---:|
| 10 000 USD | 18 447,86 USD |
| 25 000 USD | 36 447,86 USD |
| 50 000 USD | 66 447,86 USD |

Ces montants ne sont pas une fourchette garantie du coût mainnet. Un audit, une intégration ou un usage plus large peut la dépasser. Les 700 tentatives sont une provision de dépenses et ne présument aucune vente. En ajoutant la valorisation de **700 heures × 30 USD = 21 000 USD**, le scénario central représente **57 447,86 USD de moyens économiques**, réserve incluse. La réserve est de l'argent à prévoir, pas une charge déjà consommée.

Les dépenses antérieures ne sont pas incorporées faute de factures réconciliées. Pour obtenir le coût total depuis la création, ajouter leur montant justifié au budget futur, sans les compter une deuxième fois dans les soldes de crédits déjà achetés. La rémunération dataset versée au provider n'est pas un coût financé par Sirius dans le parcours normal : elle est payée par le borrower et ne constitue pas du chiffre d'affaires Sirius.

## 5. Modèle de revenus et prix proposés

### 5.1 Flux implémenté en v7

```text
Paiement borrower = prix dataset + prix compute
Réussite          = crédit dataset au provider + crédit compute à Sirius
Échec mesuré      = remboursement dataset + compute non consommé
                    avec retenue des seuls frais justifiés, plafonnés et annoncés
```

Les frais du wallet pour les transactions sont séparés. Les crédits escrow doivent être retirés ; ils ne sont pas nécessairement déjà présents dans le wallet de trésorerie. Une retenue sur échec rembourse des frais éligibles : elle n'embarque pas la marge commerciale du succès. Sans preuve de consommation, aucune retenue maximale n'est inventée.

Sirius ne prélève actuellement **aucune commission proportionnelle au prix dataset dans le parcours v7 décrit**. Un futur abonnement, partage de revenu provider ou service supplémentaire demanderait une décision produit et son implémentation. Les dépôts remboursables, apports, tokens testnet et crédits fournisseurs ne deviennent pas des revenus compute.

### 5.2 Grille de travail à tester commercialement

| Offre proposée | Prix de travail | Périmètre et statut |
|---|---:|---|
| Petit entraînement réussi | **7 USDC minimum** | Minimum commun aux deux profils actuels ; dataset et frais wallet séparés. Non activé. |
| Profil plus coûteux | Devis supérieur au minimum | Après benchmark, coût complet et limites justifiables ; aucun supplément après acceptation |
| Pilote B2B accompagné | **1 500 USD**, hypothèse | Jusqu'à 20 h d'accompagnement et bilan sur un cas d'usage borné ; prix et contenu à négocier. Prestation distincte, non implémentée dans l'escrow. |
| Abonnement entreprise / instance dédiée | Sur étude ultérieure | Aucun prix récurrent, engagement de disponibilité ou fonctionnalité promis au stade actuel |

Le prix de 7 USDC provient d'un exercice de coût, **pas d'une disposition à payer observée** : avec 30 réussites, 34 tentatives à 0,10 USD et 150 USD de base, le coût est de 153,40 USD ; après coussin de 25 %, il faut **6,40 USD par réussite**. Arrondir la proposition à 7 laisse une marge dans ce scénario, sans garantir les mois moins actifs.

Les simulations supposent **1 USDC = 1 USD** uniquement pour comparer prix et coûts. Elles ne constituent pas une garantie de conversion ni de liquidité : taux effectif, frais et accès au règlement doivent entrer dans la politique finale. Les montants contractuels restent en unités atomiques avec les décimales lues sur le token.

Le pilote accompagné rémunérerait une prestation distincte : cadrage, intégration et bilan. Les frais compute/dataset éventuels seraient annoncés séparément ; aucun même poste ne doit être facturé deux fois. Sur testnet, un paiement faucet n'est pas un revenu client réel. La prestation ne peut pas promettre des capacités ou une confidentialité encore non validées.

## 6. Rentabilité et trésorerie

### 6.1 Hypothèses reproductibles

```text
S = nombre de réussites vendues dans la période
A = plafond(S / 0,90), approximation de planification avec 90 % de réussite
P = 7 USD de revenu compute par réussite
F = 150 USD de base mensuelle
c = 0,10 USD de coût supplémentaire par tentative

Revenu compute          = P × S
Coût d'exploitation     = F + c × A
Solde d'exploitation    = P × S - F - c × A
```

Le taux de réussite est une hypothèse, pas une mesure. Les reprises du même résultat ne deviennent pas de nouvelles ventes. Les retenues sur échec et revenus d'accompagnement sont exclus de ce tableau ; les coûts des tentatives échouées y sont conservés. Si des échecs surviennent sans aucune réussite, ajouter leur nombre réel à `A`, même lorsque `S = 0`.

| Réussites/mois | Tentatives modélisées | Revenu compute | Coûts modélisés | Solde avant travail, lancement et taxes |
|---:|---:|---:|---:|---:|
| 0 | 0 | 0,00 | 150,00 | **−150,00** |
| 10 | 12 | 70,00 | 151,20 | **−81,20** |
| 30 | 34 | 210,00 | 153,40 | **56,60** |
| 100 | 112 | 700,00 | 161,20 | **538,80** |
| 300 | 334 | 2 100,00 | 183,40 | **1 916,60** |

Ces volumes sont des scénarios, sans prévision de ventes ni preuve de capacité. Le coût de 0,10 USD et les inclusions des fournisseurs doivent rester valables à chaque volume. Le solde positif du tableau n'est ni le bénéfice net de l'entreprise ni le remboursement de l'investissement initial.

### 6.2 Seuil de couverture selon le prix

| Prix par réussite, hypothèse USD | Réussites pour couvrir F = 150 USD | Réussites en ajoutant 3 000 USD de temps mensuel |
|---:|---:|---:|
| 2 | 80 | 1 668 |
| 5 | 31 | 645 |
| 7 | **22** | **458** |
| 10 | 16 | 319 |

Seuils calculés avec `A = plafond(S / 0,90)`, hors récupération du budget initial. À 100 réussites/mois au prix proposé, le solde de 538,80 USD devient **−2 461,20 USD** après valorisation des 100 heures. Cela justifie de tester aussi une prestation B2B facturée et une valeur client supérieure, sans présumer qu'un prix plus élevé sera accepté.

Pour un pilote accompagné vendu 1 500 USD, 20 h valorisées à 30 USD représentent 600 USD : contribution de **900 USD avant infrastructure, frais additionnels et taxes**. Ces 20 heures doivent être incluses dans le suivi global de l'équipe et ne pas être déduites une deuxième fois.

### 6.3 Financement et scénario sans vente ni grant

- Aucun grant, investissement, crédit annoncé ou revenu token n'est inscrit comme financement acquis.
- Les pistes de financement restent dans [MAINNET-PLAN.md](MAINNET-PLAN.md#financements--pistes-sources-et-vérification) ; vérifier leurs conditions au moment d'une candidature, sans engager une dépense sur un versement espéré.
- Sans vente, six mois au socle de 150 USD consomment 900 USD avant coûts variables, travail et lancement. Cette illustration de fonctionnement ne s'ajoute pas au budget des mêmes périodes.
- Les apports financent éventuellement les essais mais restent des apports. Le registre strict actuel exige une marge acquise : inscrire un apport dans `earnedMarginUsdMicros` pour démarrer serait incorrect. Le financement des essais doit être traité explicitement avant activation.
- Sans financement disponible pour l'audit et ses corrections, le mainnet reste différé. La préparation locale et la validation commerciale peuvent continuer dans le périmètre autorisé.

Une fois les soldes rapprochés, calculer l'autonomie comme `trésorerie libre / consommation nette mensuelle`, après déduction des dettes et des fonds appartenant aux clients/providers. Aucune autonomie chiffrée n'est annoncée sans trésorerie réelle établie.

## 7. Acquisition et plan commercial

Les rôles et échéances reprennent le plan Ali/Ali ; les actions commerciales ci-dessous sont proposées, sans entretien, contrat ou paiement présumé obtenu.

| Étape | Action et responsable proposé | Preuve recherchée |
|---|---|---|
| Comprendre le besoin | Ali : 10 entretiens sur un secteur ; Ali : qualification technique | Donnée réellement bloquée, utilisateur du modèle, fréquence du besoin, capacité et volonté de payer |
| Constituer un premier échange | Ali : identifier un provider et un borrower externes ; Ali : vérifier le profil exploitable | Accord sur un cas précis, droits d'usage à vérifier, critère de résultat et prix discuté |
| Démontrer | Ali : parcours à deux wallets et scénarios d'échec sur données adaptées au niveau de validation | Modèle utile, règlement conforme, coût observé, absence de double facturation |
| Vendre le pilote | Ali + Ali : périmètre, durée, prix et conditions écrites | Engagement client externe ; prix payé ou engagement conditionnel clairement distingués |
| Mesurer quatre semaines | Ali : exploitation ; Ali : retour et suite commerciale | Réussites, coûts complets, support consommé, volonté de réutiliser et référence autorisée |

Commencer par la vente directe d'un cas documenté et une démonstration reproductible. Aucun budget publicitaire n'est engagé dans cette version. Les coûts d'acquisition incluent le temps de prospection ; aucune hypothèse de clientèle gratuite ou de demande automatique via un token n'est retenue.

## 8. Indicateurs et conditions de poursuite

| Axe | Mesures à suivre |
|---|---|
| Commercial | Entretiens, prospects qualifiés, prix accepté, pilotes externes payés, répétition d'usage |
| Revenus | Compute définitivement acquis, retraits réconciliés, prestations encaissées, remboursements séparés |
| Coûts | Infrastructure, échecs, transferts/gas, heures de support, dépenses engagées non encore facturées |
| Marge | Contribution par réussite, résultat mensuel avec et sans valorisation du temps, coût d'acquisition |
| Technique | Taux de réussite, durées, disponibilité, récupération sans recalcul ni refacturation |
| Exposition | Engagements cumulés, fonds dus, liquidité gas, historique des budgets et capacité de clôture |

Avant un tarif public : benchmark Phala autorisé, mesure du coût complet, prix testé auprès d'un acheteur et politique signée cohérente. Avant données sensibles : garanties de traitement et de sortie adaptées et vérifiées. Avant mainnet : audit, corrections, KYB externe, finalité du réseau et parcours opérationnel validés. Les pannes avant checkpoint, les anciennes copies de clés et les transactions introuvables restent décrites dans [le suivi d'audit](AUDIT-2026-09-23.md).

## 9. Décisions encore ouvertes et entretien du document

Les éléments prêts à discuter sont le minimum de 7 USDC, le pilote accompagné à 1 500 USD, le budget mensuel de référence et l'enveloppe de lancement. **Aucun n'est adopté par sa seule présence dans ce fichier.** Les plafonds fournisseurs, le financement réel et les tarifs définitifs restent à valider au moment de l'activation concernée.

À chaque nouveau devis, mesure ou accord client : remplacer l'hypothèse concernée, conserver date/source, recalculer les totaux et aligner [MAINNET-PLAN.md](MAINNET-PLAN.md), [COMPUTE-BILLING.md](COMPUTE-BILLING.md) et [ROADMAP.md](ROADMAP.md). `pnpm ops:costs` couvre uniquement les tableaux Phala ; les projections globales ci-dessus ont été recalculées séparément en décimal, elles ne constituent pas une politique de facturation exécutable.
