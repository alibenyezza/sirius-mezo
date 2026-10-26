# Plan de finition Sirius — vers mainnet

Plan initial communiqué par Ali : 22 septembre 2026 → mars 2027. Consolidation : **23 septembre 2026**.

Objectif : passer de la démonstration à un service qu'un client accepte de payer, avec une porte vérifiable avant chaque phase. Les dates et charges sont des objectifs du plan initial, à recalibrer selon les résultats et la disponibilité de Ali et Ali.

Ce document conserve les phases produit, les responsabilités et les pistes de financement. [BUSINESS-PLAN.md](BUSINESS-PLAN.md) centralise désormais coûts totaux, hypothèses de revenus et rentabilité ; [ROADMAP.md](ROADMAP.md) décrit l'état technique et [DECISIONS.md](DECISIONS.md) conserve les décisions validées. Les recommandations de revue sont identifiées comme **propositions à arbitrer** : leur enregistrement ne vaut pas adoption. Aucun financement, entretien ou pilote n'est considéré comme obtenu sans preuve.

**Mise à jour technique après correctifs locaux :** le [parcours v7](BILLING-INTEGRATION.md) est raccordé et testé, avec réservation du budget jusqu’à la clôture. Le [suivi de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) distingue les correctifs apportés aux neuf constats initiaux des risques encore bloquants. Aucun tarif validé, déploiement v7, migration distante ou redémarrage Phala ne découle de cette mise à jour. Le calendrier, les responsabilités et les pistes commerciales ci-dessous restent ceux du plan, sans nouvelle validation externe.

## Lecture des statuts

| Statut | Sens |
|---|---|
| Réalisé localement | Code et validation locale documentés ; ne prouve pas un déploiement ou une validation distante. |
| Partiel | Certaines briques existent, l'intégration ou la validation reste à terminer. |
| Prévu | Travail inscrit dans le plan, sans réalisation complète documentée. |
| Proposé | Recommandation de revue à arbitrer par Ali et Ali. |
| À vérifier | Information externe ou action commerciale non confirmée par les éléments disponibles. |
| Différé / hors périmètre | Sujet conservé pour mémoire, sans travail prévu dans le parcours actuel. |

Pour changer un statut, noter la date, la preuve et l'environnement concerné. Une porte se franchit lorsque toutes ses preuves de réussite sont disponibles. Aucune des quatre portes n'est documentée comme franchie au 23 septembre.

## Point de départ

| Sujet | État au 23 septembre | Référence / limite |
|---|---|---|
| Démonstration EVM | Socle applicatif et contrats testnet existants ; intégration complète à valider | [Roadmap technique](ROADMAP.md). `main` reste distinct de mainnet. |
| Capacités d'entraînement | Régressions linéaire et logistique, limite d'entrée de 3 Mio, délai v7 borné par devis entre 1 et 30 s | [Facturation compute](COMPUTE-BILLING.md). La CVM préparée dispose d'un vCPU. La valeur commerciale de ces capacités reste à tester. |
| Confidentialité en production | Partiel, bascule non effectuée | CVM amorcée et attestée, identité stable vérifiée, puis arrêtée à la demande de Ali. Aucun prêt complet Phala actif validé. [Point de reprise](PHALA.md). |
| Règlement et revenus Sirius | Parcours v7 intégré localement ; activation encore bloquée | [Escrow v7](ESCROW-V7.md) distingue prix dataset et compute. Application et runner prennent en charge v7 avec activation explicite ; v6 reste le mode par défaut. Règlement autonome des résultats persistés et livraison différée testés localement ; reprise Next couverte localement ; coupure avant checkpoint runner, finalité cible et tarifs restent ouverts. |
| Dépenses runner | Garde-fous réalisés localement ; exploitation non activée | [Budgets runner](RUNNER-BUDGETS.md). Budget du parcours complet réservé avant devis, devis expirés non verrouillés libérés et transactions confirmées réconciliées. Comptabilité et plafonds fournisseurs restent à intégrer. |
| Upload et jobs longs | Prévu | L'enveloppe chiffrée passe encore par Next. Upload direct avec reprise et file d'entraînement longue restent à construire. |
| KYB | Contrats stricts disponibles ; émetteur externe à intégrer | Dernier état distant documenté : KYB ouvert pour la démonstration testnet. |
| Audit externe et mainnet | Prévu | Les revues locales ne constituent pas un audit externe. Aucune validation mainnet documentée. |
| Utilisateurs et datasets externes | À vérifier | Le plan initial indique zéro utilisateur externe et quatre datasets de l'équipe. Cela ne prouve ni l'état commercial actuel ni le décompte des listings : consulter [PHALA.md](PHALA.md) pour le dernier état de la base. |
| Token | À vérifier | Le plan initial mentionne un lancement par un tiers et 86 holders. Adresse du token, créateur, allocation, termes et décompte ne sont pas vérifiés ici. |

### Corrections par rapport au plan initial

- **Facturation avant Phala** : D-22 et D-23 remplacent le redéploiement immédiat d'un v6 auquel on ajouterait simplement `feeBps`. Le chantier porte sur le devis signé, les deux prix, les budgets et les remboursements. L'estimation « commission en un jour » ne couvre pas cette intégration.
- **V7 existe déjà localement** : la version finale auditée ne peut pas être désignée à l'avance comme un futur « v7 ». Identifier précisément l'artefact audité et déployé, avec ses éventuelles corrections.
- **Phala est arrêté** : préparer localement ; prévenir Ali du créneau et du coût avant toute utilisation payante, conformément au [runbook](PHALA.md). Conserver CVM, clés, crédits et modèles historiques.
- **Revenus à distinguer** : la rémunération compute de Sirius n'est pas une commission proportionnelle au prix du dataset. Son tarif et sa marge restent à définir. Des crédits ou règlements testnet ne constituent pas du chiffre d'affaires réel.
- **Financements à requalifier** : l'ouverture d'un programme et son enveloppe collective ne prouvent ni l'éligibilité de Sirius, ni une candidature déposée, ni une somme disponible pour l'audit.

## Phases et portes

| Phase | Fenêtre cible initiale | Question de sortie | État |
|---|---|---|---|
| 0 — Rendre la promesse vraie | 22 septembre → mi-octobre 2026, environ 3 semaines | Un prêt complet est-il réglé par Phala actif avec la rémunération Sirius prévue ? | Partiel ; dépend des corrections et de la validation compute. |
| 1 — Un produit utile | Mi-octobre → fin novembre, environ 6 semaines | 100 Mo sont-ils entraînés en asynchrone, avec un modèle non linéaire livré et des prospects prêts à tester ? | Prévu. |
| 2 — Un client réel | Décembre, environ 4 semaines | Un tiers extérieur a-t-il utilisé ses données et le KYB externe fonctionne-t-il en staging ? | Prévu ; activité commerciale à vérifier. |
| 3 — Audit, KYB, mainnet | Janvier → mars 2027, environ 10 semaines | Toutes les conditions mainnet sont-elles satisfaites et prouvées ? | Prévu, conditionné au financement et aux validations. |

Les candidatures et la prospection peuvent avancer en parallèle. Les portes techniques protègent les usages qu'elles débloquent ; elles n'imposent pas d'attendre pour parler aux prospects.

## Phase 0 — Rendre la promesse vraie

### Chantiers

| Travail | Responsable du plan | Statut et livrable |
|---|---|---|
| Facturation du compute | Ali pour le volet revenu initial ; intégration technique à coordonner avec Ali | Intégré localement, activation bloquée. Corriger les défauts de l’audit ; finaliser tarifs, trésorerie, comptabilité et plafonds fournisseurs, puis valider le parcours à deux wallets et les reprises. Suivre [COMPUTE-BILLING.md](COMPUTE-BILLING.md), [ESCROW-V7.md](ESCROW-V7.md) et [RUNNER-BUDGETS.md](RUNNER-BUDGETS.md). Charge à réestimer. |
| Activation Phala | Ali | Partiel. Après validation compute : déployer les contrats retenus avec l'identité attestée, activer la CVM existante, recapturer et épingler MRTD / RTMR3 / compose hash. Estimation initiale : 1–2 semaines, hors intégration compute restante. |
| Migration applicative | Ali | Prévu. Appliquer `20260919000000_track_runner_provenance` et `20260923000000_add_compute_billing`, réimporter les datasets, vérifier le préflight `runner:check-migration`, synchroniser Next et reaper, préserver escrows, crédits et modèles historiques. Le contrat `0x805a…` reste accessible en historique. |
| Candidatures immédiates | Ali | À vérifier. Founder House Singapour, Buildathon en ligne, dossier Zama v2 après activation Phala, contact Phala sur les crédits. Estimation initiale de préparation : 2 jours. Voir les conditions actualisées plus bas. |
| Token et transparence | Ali + Ali | Prévu ; informations externes à vérifier. Obtenir wallet créateur, allocation et termes. Publier une page « État du protocole » indiquant ce qui est actif, démo ou testnet. Estimation initiale : 1 jour. |

### Porte de sortie — preuves manquantes

- [ ] Bloqueurs de l’audit local corrigés et revérifiés, notamment timeout RPC, abandon, devis obligatoire, échéance/finalité et copies de clés. Tarifs, comptabilité et plafonds fournisseurs validés.
- [ ] Un prêt complet sur l'instance de production et la chaîne testnet : upload → lock → entraînement → release → ouverture du modèle.
- [ ] Runner Phala actif, quote matérielle vérifiée `UpToDate`, mesures actives épinglées et identité stable.
- [ ] Prix et bénéficiaires conformes au devis ; revenu compute crédité à la trésorerie puis retrait vérifié. Les retraits restent pull-only : `release` crédite, il ne transfère pas directement à la trésorerie.
- [ ] Aucun démarrage ni repli en processus possible sur la cible de production ; absence du log « runner in-process » confirmée.
- [ ] Historiques préservés et préflights de migration réussis.

Financements visés dans le plan : Founder House / Buildathon, crédits Phala, programme Zama. Aucun versement n'est documenté comme acquis. L'activation Phala seule ne valide pas encore la confidentialité des modèles exportés ; voir la proposition R4.

## Phase 1 — Un produit qui vaut quelque chose

| Travail | Responsable du plan | Statut, cible et charge initiale |
|---|---|---|
| Upload direct vers la CVM | Ali | Prévu, 1–2 semaines. Le navigateur envoie l'enveloppe chiffrée au runner ; Next conserve autorisation et reçu. Grant signé lié au hash de l'enveloppe, chunking et reprise. Cible initiale : plafond de 1 Go, démonstration à 100 Mo. |
| Entraînement asynchrone | Ali | Prévu, 2 semaines. File persistante, statut interrogeable, résultat récupérable ensuite, durée de minutes à heures bornée par profil/dataset, traitement des orphelins avec le reaper. Les reprises de paiement existantes ne constituent pas cette file. |
| Modèles à arbres | Ali | Prévu, 2–3 semaines. Gradient boosting ou forêts sur tabulaire, profil d'entraînement v2 ancré on-chain, modèle livré dans la capsule. Borner profondeur, feuilles et taille des sorties ; cela ne prouve pas à lui seul l'absence de fuite. |
| Dix entretiens | Ali | Prévu ; réalisation à vérifier. Choisir un secteur : petites fintechs/scoring crédit, risque assurance ou benchmark RH. Question de départ : quelle donnée ne pouvez-vous pas partager et qui voudrait entraîner dessus ? Réseaux DVB, KryptoSphere, Mezo / Arbitrum. Charge initiale : 2 h/jour en parallèle. |

### Porte de sortie — preuves manquantes

- [ ] Dataset de 100 Mo uploadé sans transiter par Vercel et entraîné en asynchrone dans l'enclave.
- [ ] Modèle non linéaire livré dans la capsule et ouvert après `release`.
- [ ] Au moins trois personnes extérieures acceptent de tester avec leurs données ; conserver date, contexte et accord de suivi sans publier leurs données privées.

Financements visés : guichet Arbitrum confirmé avant dépôt, NVIDIA Inception, Filecoin uniquement si une évolution de stockage justifie ce travail. L'objectif de 1 Go et le choix des arbres restent à confronter aux besoins des prospects, selon R2.

## Phase 2 — Un client réel

| Travail | Responsable du plan | Statut, cible et charge initiale |
|---|---|---|
| Pilote externe | Ali | Prévu, environ 4 semaines. Transformer un des trois accords en pilote gratuit sur testnet, avec données réelles dans l'enclave. Le plan initial autorise l'équipe ou un partenaire à jouer l'acheteur. Mesurer temps, qualité du modèle et blocages. |
| KYB externe en staging | Ali | Contrats préparés, intégration prévue sur 1–2 semaines. Évaluer Sumsub, Persona ou équivalent ; relier les décisions de vérification à un émetteur externe d'attestations, clé en KMS/HSM. Ne pas supposer que le prestataire émet directement les attestations EIP-712 attendues. Le mode ouvert reste disponible pour les tests isolés. |
| Dossiers avec preuve du pilote | Ali | Prévu, environ 3 jours. Alliance avec la cohorte visée de janvier à confirmer ; Zama vers un partenariat nommé, avec palier 1 défini et livré ou en cours. Virtuals après clarification du token. Aucun dépôt ni partenariat confirmé ici. |

### Porte de sortie — preuves manquantes

- [ ] Un tiers hors équipe et hors cercle d'amis a réalisé un prêt complet avec ses données.
- [ ] Ce tiers accepte une référence dans les dossiers, éventuellement anonymisée.
- [ ] Le KYB externe attesté fonctionne de bout en bout en staging.

Cette porte prouve un usage externe. Elle ne prouve pas encore la volonté de payer si l'équipe finance elle-même l'emprunt ; le renforcement commercial R3 reste à arbitrer. L'usage de données sensibles demande également d'arbitrer R4 avant le pilote.

## Phase 3 — Audit, KYB, mainnet

| Travail | Responsable du plan | Statut, cible et charge initiale |
|---|---|---|
| Audit externe | Ali + Ali pour le cadrage ; auditeur à sélectionner | Prévu, 4–6 semaines dont environ 2 d'audit. Périmètre initial annoncé : 5 contrats, à inventorier précisément. Concours Code4rena / Sherlock / CodeHawks envisagé à 10–30 k$, cabinet à 20–50 k$ : estimations du plan, pas des devis. Geler les artefacts deux semaines avant, corriger, faire vérifier les corrections et publier le rapport. |
| Déploiement final | Ali + Ali | Prévu. Déployer les artefacts correspondant au périmètre audité et aux corrections revues. Une modification ultérieure nécessite une nouvelle revue adaptée. Le numéro de version final reste à déterminer. |
| KYB réel en production | Ali | Prévu, environ 1 semaine. Registre strict, émetteur externe, clé KMS/HSM et révocation testée ; aucun KYB ouvert pour les opérations mainnet. |
| Lancement Mezo mainnet | Ali + Ali | Prévu, environ 2 semaines. Activation explicite de `SIRIUS_ALLOW_MAINNET`, token USDC et décimales vérifiés, plafond initial par prêt à décider (exemple du plan : 500 USDC). |
| Exploitation et incidents | Ali + Ali | Prévu. Monitoring du reaper, des échecs de release et du solde de règlement. Procédure de suspension des nouveaux listings/admissions et de remboursement après échéance. Documenter les contrôles effectifs ; l'escrow immuable n'acquiert pas une fonction de pause par simple fermeture de l'interface. |

Porte de sortie : l'intégralité de la checklist suivante, avec preuves. Le financement de l'audit est une dépendance explicite : Arbitrum était la première piste du plan, Zama / Open House des alternatives. Sans budget disponible pour l'audit et ses corrections, le mainnet attend.

## Checklist mainnet du plan

Toutes les cases restent ouvertes. Chaque preuve doit indiquer réseau, adresses/version, environnement, date et résultat ; aucune donnée sensible ni clé privée dans ce document.

- [ ] **Phala seul runner de production** : quote matérielle vérifiée, MRTD / RTMR3 / compose hash épinglés, identité stable au redémarrage, aucun chemin métier en processus.
- [ ] **Audit externe publié et corrections validées** : toutes les trouvailles hautes/moyennes fermées ; artefacts déployés correspondant à la version revue, incluant les corrections.
- [ ] **KYB réel des deux côtés** : émetteur externe, clé en KMS/HSM, révocation testée ; mode ouvert limité aux environnements de démonstration/test, jamais mainnet.
- [ ] **Rémunération Sirius active et trésorerie contrôlée** : devis, répartition et retraits vérifiés ; multisig prévu, exemple initial 2 sur 2 minimum. Schéma de signatures et récupération à choisir explicitement ; aucun wallet personnel comme trésorerie cible.
- [ ] **Pilote externe d'au moins quatre semaines sans incident** : données d'un tiers, testnet, enclave ; journal d'exploitation et retour utilisateur disponibles.
- [ ] **Expiration et incidents reproduits** : prêt expiré remboursé, runner interrompu pendant le calcul, reprise sans double facturation, suppression d'un dataset avec prêt actif refusée, reaper et retraits validés.
- [ ] **Plafonds et monitoring actifs** : montant maximal par prêt décidé, alertes sur release et gas, responsables d'intervention et procédure de suspension écrite.
- [ ] **Page « État du protocole » publiée et à jour** : distinction mainnet/testnet/démo, état de Phala et de l'audit, capacités et limites, relation au token explicitée.

Les ajouts proposés à cette checklist (revue hors chaîne, fuite des modèles, exposition cumulée, disponibilité effective du réseau/token) figurent dans R4 et R7. Ils ne sont pas présentés comme déjà arbitrés.

## Financements — pistes, sources et vérification

Responsable du suivi proposé dans le plan : **Ali**, avec Ali pour les preuves techniques. Les tiers ci-dessous reprennent l'ordre de priorité du plan initial, pas des probabilités de succès mesurées. Programmes français exclus du périmètre de recherche initial.

**Contrôle documentaire ciblé du 23 septembre 2026.** « Page repérée » confirme une source, pas l'ouverture, l'éligibilité ni les conditions actuelles. Reconfirmer avant toute candidature ou dépense. Aucun dossier envoyé, financement accordé ou versement reçu n'est établi par ce dépôt.

### Tier 1 — adéquation directe envisagée

| Programme / source | Phase et aide annoncée ou envisagée | Vérification et prochaine étape |
|---|---|---|
| [Founder House Singapore — annonce](https://blog.arbitrum.foundation/founder-house-singapore-apply-now-to-launch-products-on-arbitrum-one-mezo-chain/) et [candidature Luma](https://luma.com/openhouse-singapore) | Phase 0 ; 23–25 octobre 2026. Enveloppe collective de 300 k$ MUSD : top 3 120 k$, Founder-in-Residence Mezo 60 k$, innovation 30 k$, promising products 20 k$, grants 70 k$. | Annonce du 17 septembre vérifiée le 23 : au moins une place du top 3 pour Mezo ; plusieurs versements liés à des jalons. Candidater rapidement ; confirmer admission, date limite, cumul des prix et coût du déplacement. Le plan initial omettait les 20 k$ « promising products ». |
| [Buildathon Singapore — HackQuest](https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon?tab=custom-dfc39bda-c613-4658-8df9-f35b527dace5) et [portail](https://arbitrum-singapore.hackquest.io/) | Phase 0 ; environ 14 septembre → 4 octobre. Enveloppe collective annoncée : 115 k$. | Page vérifiée le 23 : inscription affichée jusqu'au **2 octobre**, soumission jusqu'au **4 octobre** ; vérifier heures/fuseau. Il n'est donc pas établi qu'une dérogation « tardive » soit nécessaire. Répartition initiale 40/20/10 k$ + 30 k$ de grants incomplète ; suivre les tracks affichés avant dépôt. |
| [Arbitrum — programmes](https://arbitrum.foundation/grants) / [Questbook](https://arbitrum.questbook.app/) | Phase 1 ; cible initiale 20–150 k$ en ARB, jalons audit + mainnet. Montant à confirmer. | Vérifié le 23 : Foundation et DAO/Questbook sont des programmes distincts. La page contient des statuts inactifs et des textes contradictoires sur les ouvertures. Confirmer le guichet, l'éligibilité Mezo et les dépenses d'audit ; retirer l'affirmation « confirmé ouvert en continu ». |
| [Zama — fin de Season 4](https://forms.zama.org/developer-program-mainnet-season4-bounty-track) / [actualités officielles](https://community.zama.org/c/news/10) | Phases 0–1 ; dossier v2 puis relation de partenariat. Le plan évoque 5 000 cUSDT par saison, à reconfirmer selon le track. | Vérifié le 23 : le formulaire annonce la fin de Season 4 et Season 5 à venir. Pas de date d'ouverture confirmée. La clôture exacte du 5 septembre et le montant/actif du track Builder restent à vérifier. |
| [Phala Cloud Builders Challenge](https://phala.network/posts/phala-cloud-tee-builders-challenge-empowering-developers-to-build-the-future-of-secure-ai) | Phase 0 ; premier prix historique : 2,5 k$ de crédits Phala + 500 $ de crédits RedPill. | Annonce retrouvée le 23, activité du concours en 2026 non confirmée. Demander à Phala avec le support CVM. Un [Startup Program](https://phala.com/startup-program) a aussi été repéré ; piste distincte, conditions à examiner. |
| [Arbitrum Mentorship — annonce Founder House](https://blog.arbitrum.foundation/founder-house-singapore-apply-now-to-launch-products-on-arbitrum-one-mezo-chain/) | Accompagnement de 8 semaines et réseau ; aucun montant garanti pour Sirius. | L'annonce vérifiée le 23 prévoit une invitation des gagnants au mentorship. Le plan ne doit donc pas se limiter à la cohorte connue d'avril ; confirmer accès et calendrier. |

### Tier 2 — angle produit à justifier

| Programme / source | Phase et aide annoncée ou envisagée | Vérification et condition |
|---|---|---|
| [Filecoin Foundation](https://fil.org/grants) / [Open Grants](https://github.com/filecoin-project/devgrants) | Phase 1 ; cible initiale 10–50 k$. Le dépôt officiel annonce des Open Grants jusqu'à 50 k$. | Sources repérées le 23 ; ouverture et modalités à confirmer. Migration Pinata → Filecoin à justifier par un besoin, avec stockage chiffré et preuves explicites. Ne pas présenter une preuve de stockage comme une preuve de destruction des copies. |
| [NVIDIA Inception](https://www.nvidia.com/en-us/startups/) | Phase 1 ; crédits, outils, offres partenaires et accès à l'écosystème ; pas un financement cash acquis. | Page consultée le 23 : programme gratuit, sans cohortes ni date limite affichée. Éligibilité, bénéfices disponibles et conditions de l'entité à confirmer. Angle initial : futurs workloads/GPU confidentiels. |
| [Ethereum Foundation ESP](https://esp.ethereum.foundation/) / [modalités](https://esp.ethereum.foundation/applicants) | Bien public open source : bibliothèque de capsule à deux clés et d'attestation liée au résultat. Cible initiale 10–100 k$, non confirmée. | Sources consultées le 23 : financement orienté Wishlist/RFP et biens publics. Le rythme « 10 M$/trimestre » du plan initial n'est pas une enveloppe accessible garantie ; montant selon périmètre. Aucun engagement d'extraction de bibliothèque à ce stade. |
| NEAR AI | Montant variable ; piste AI/TEE si les pistes Arbitrum n'aboutissent pas. | Programme, source primaire de candidature et conditions non confirmés. Toute dépendance NEAR modifierait le périmètre EVM actuel et exige un arbitrage. |
| [Virtuals / ACP](https://www.virtuals.io/) | Phase 2 ; piste d'investissement Virtuals Ventures, Sirius comme service Agent Commerce Protocol. | Source ACP repérée le 23 ; guichet Ventures, ticket et conditions non vérifiés. Dépend de la clarification du token et d'un besoin commercial ; aucune intégration ACP engagée. |

### Tier 3 — après preuve d'usage

| Programme / source | Aide envisagée | Vérification et condition |
|---|---|---|
| [Alliance](https://alliance.xyz/) | Investissement annoncé de 500 k$ via SAFE ; candidature visée après le pilote. | Page repérée le 23, conditions à reconfirmer directement. Cohorte de janvier, durée de 10 semaines, taux d'acceptation de 5 % et exigences d'entité du plan initial non validés ici. Vérifier aussi les droits liés au token ; ce n'est pas un grant sans contrepartie. |
| [a16z CSX](https://a16zcrypto.com/accelerator) | Investissement et accompagnement ; ticket non fixé dans le plan. | Page officielle repérée le 23. Calendrier, lieux, conditions et rythme « deux cohortes/an » à confirmer. Pilote souhaité comme preuve. |
| [Base Builder Grants](https://paragraph.com/%40grants.base.eth/calling-based-builders) | Source historique : 1–5 ETH, soutien rétroactif. | Source repérée le 23 ; modalités actuelles à confirmer, y compris candidature. À considérer seulement si un besoin justifie Base ; aucun déploiement multichaîne ajouté au plan. |
| [Optimism Retro Funding](https://atlas.optimism.io/missions) | Montant variable, impact démontré dans l'écosystème concerné. | Source consultée le 23 : anciennes missions et annonce de fermeture d'Atlas le 18 septembre 2026. Guichet actuel non confirmé ; ne pas inscrire de recette attendue. |
| [Gitcoin Grants](https://gitcoin.co/program) / [campagnes](https://gitcoin.co/campaigns) | Montant variable ; projet ouvert et communauté/utilisation à développer. | Sources repérées le 23. Programme et round éligible à confirmer. Gitcoin combine plusieurs mécanismes, dont financement participatif et matching : ne pas le classer intégralement comme rétroactif. |

Les paiements à un wallet ne dispensent pas de vérifier les conditions : bénéficiaire accepté, KYC/KYB, entité, juridiction, accord de grant ou investissement, livrables et calendrier de versement. L'affirmation initiale « seuls les accélérateurs exigent une entité, dans n'importe quel pays » n'est pas confirmée et ne doit pas servir de règle.

Pour chaque candidature réelle, ajouter : responsable, lien du dossier, date de dépôt, montant demandé, statut, jalons, contreparties, prochaine échéance et montants effectivement reçus. Ne pas stocker de documents d'identité ni de secrets dans le dépôt.

## Recommandations de revue — à arbitrer

Ces propositions proviennent de l'avis sur le plan. La priorité compute avant Phala est déjà validée dans D-22/D-23 ; les changements suivants ne le sont pas automatiquement.

| ID | Proposition | Arbitrage attendu |
|---|---|---|
| R1 | Commencer les dix entretiens dès la phase 0, en parallèle du chantier technique. | Ali + Ali : secteur, liste de prospects et disponibilité d'Ali. |
| R2 | Faire déterminer taille et modèle par le besoin du pilote. Garder 100 Mo comme test technique ; différer 1 Go tant que le besoin n'est pas démontré. | Confirmer le périmètre de phase 1. « Personne ne paie pour une régression » et « les arbres débloquent les ventes » restent des hypothèses. |
| R3 | Ajouter un acheteur externe, une métrique de valeur et un prix accepté à la porte commerciale. Viser une prestation pilote facturée avec protocole testnet, ou un engagement écrit conditionné à des résultats précis. | Définir le pilote, ses critères de succès, son prix et la mesure de coût complet/marge. Un achat par l'équipe ne prouve pas la demande solvable. |
| R4 | Avant données sensibles, faire une revue ciblée du runner, des clés, des sorties et des entraînements répétés ; élargir l'audit aux liens attestation → autorisation → paiement → livraison. | Définir périmètre, reviewer, budget et critères de confidentialité. La profondeur d'un arbre ne suffit pas à garantir l'absence de fuite ; les [attaques d'inférence d'appartenance](https://arxiv.org/abs/1610.05820) concernent la sortie du modèle, même si le calcul s'est fait en enclave. |
| R5 | Recalibrer les charges upload/asynchrone/modèles ensemble et prévoir des démonstrations de panne. | Définir tests intermédiaires : upload interrompu, crash de calcul, échéance escrow, réponse de règlement perdue, récupération sans recalcul ni refacturation. Les six semaines restent une hypothèse. |
| R6 | Chiffrer un budget par phase et un scénario sans grant. | Fixer dépenses maximales, trésorerie disponible, financements espérés séparés et décision si aucun n'arrive. Utiliser le tableau ci-dessous. |
| R7 | Compléter la porte mainnet par une limite d'exposition cumulée, en plus du plafond par prêt, et vérifier disponibilité effective du réseau/token et capacité de suspension. | Fixer exposition totale, concurrence, responsabilités et preuves opérationnelles. Un plafond de 500 USDC par prêt ne borne pas mille prêts simultanés. |

### Budget par phase — proposition R6 chiffrée, non approuvée

Le [budget central](BUSINESS-PLAN.md#4-budget-total-jusquau-mainnet) donne un scénario sur sept périodes de 30 jours : **1 303,21 USD d'infrastructure**, puis frais variables, audit et préparation, pour **36 447,86 USD de trésorerie à prévoir avec réserve**, hors rémunération des fondateurs et taxes. Les montants sont des hypothèses de travail, non des devis ou plafonds approuvés. Aucune capacité de financement n'est déduite des concours, dépôts clients, tokens testnet ou crédits annoncés.

| Phase | Coûts à inclure | Provision d'infrastructure / financement | Scénario sans grant à décider |
|---|---|---|---|
| 0 | CVM et disque, stockage, hébergement/RPC, gas et intégration compute | 103,21 USD pour une période / non confirmé | Poursuivre la préparation locale ; définir les dépenses payantes acceptables avant activation. |
| 1 | Benchmarks, upload/stockage, jobs longs, développement et prospection | 400 USD pour deux périodes / non confirmé | Réduire le périmètre selon le besoin du pilote et les moyens disponibles ; recalibrer l'infrastructure. |
| 2 | Exploitation, support, KYB externe et revue avant données sensibles si R4 retenue | 200 USD pour une période / non confirmé | Définir durée et coût supportables du pilote, prix éventuel et conditions d'arrêt. |
| 3 | Audit, corrections, déploiement, KYB, monitoring et réserve | 600 USD pour trois périodes, hors postes de lancement détaillés dans le business plan / non confirmé | Mainnet différé tant que l'audit et ses corrections ne sont pas financés et validés. |

Les périodes arrondies servent au budget et ne remplacent pas les fenêtres cibles ni les portes de sortie. Le scénario suppose une prospection distante ; ajouter tout déplacement décidé ensuite. Le minimum compute de 7 USDC et le pilote accompagné à 1 500 USD du [business plan](BUSINESS-PLAN.md#5-modèle-de-revenus-et-prix-proposés) sont proposés, non adoptés. La facturation et les opérations restent suivies dans [COMPUTE-BILLING.md](COMPUTE-BILLING.md) et [PHALA.md](PHALA.md). Une marge positive par job ne prouve pas la couverture des périodes sans vente ni du travail de l'équipe.

## Hors périmètre et sujets différés du plan initial

| Sujet | Orientation conservée | Condition / référence |
|---|---|---|
| Promotion du token | Aucune promotion avant la porte de phase 0 ; clarifier et publier l'état du protocole. | Franchir la porte technique ne règle pas automatiquement les questions de créateur, allocation et termes. |
| Bots de trading | Hors périmètre Sirius, sans financement ni utilisation de son nom. | Exclusion du plan initial. |
| AetherPay | Différé après le pilote. | Éventuel dossier Arbitrum ultérieur, sans charger le parcours actuel. |
| Runner VPS / multi-backend | Différé ; Phala seul runner de production. | D-21 et [spécification différée](RUNNER-MULTI-BACKEND.md). Le VPS du reaper reste distinct d'un runner alternatif. |
| FHE pour l'entraînement | Hors périmètre du plan. | Angle Zama envisagé : règlement/inférence. Le ralentissement « 2–3 ordres de grandeur » du plan initial n'est pas un benchmark Sirius validé ; ne pas le présenter comme une mesure universelle. |

## Mise à jour du plan

Actualiser ce document à chaque porte ou décision commerciale importante. Conserver ici les objectifs, propriétaires, preuves et arbitrages ; lier les spécifications au lieu de les recopier. Reporter uniquement les décisions explicitement adoptées dans [DECISIONS.md](DECISIONS.md), puis aligner la [roadmap technique](ROADMAP.md). Les échéances externes doivent être revérifiées avant action, même si une source avait été consultée le 23 septembre.
