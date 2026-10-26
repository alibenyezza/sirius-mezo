# Facturation du compute au borrower

Point de reprise du 23 septembre 2026. **Priorité avant tout nouveau déploiement de contrats pour Phala.** [Escrow v7](ESCROW-V7.md), les [budgets durables](RUNNER-BUDGETS.md) et le [parcours devis → prépaiement → calcul → règlement/remboursement](BILLING-INTEGRATION.md) sont implémentés localement. Les tarifs réels, la comptabilité et les plafonds fournisseurs restent à valider ; aucun tarif commercial ni nouvel escrow de facturation n’est déployé.

**Activation toujours bloquée.** Les [correctifs locaux de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) couvrent la reprise des transactions confirmées, le règlement des résultats v7 persistés, le devis obligatoire, la livraison différée et le cache actif de `wrappedKey`. La récupération des résultats durables et les courses PostgreSQL ont été validées localement. La [préparation opérationnelle](OPERATIONS-PREPARATION.md) apporte le chiffrage et la restauration/migration sur une copie réelle. Restent la coupure avant checkpoint runner, la finalité/RPC, les anciennes clés et la validation économique complète. Phala reste arrêté ; aucune migration ni activation distante n'a été effectuée.

## Objectif et orientation

Le borrower doit connaître et accepter le prix du dataset et celui de l’entraînement avant tout calcul. Pour le MVP, retenir un **devis fixe garanti en USDC**, bloqué en escrow avant démarrage. Aucun supplément automatique ni prélèvement supplémentaire pendant un job. Une erreur d’estimation doit rester dans un budget préalablement réservé ; elle ne donne jamais droit à des dépenses ou reprises illimitées.

**Orientation demandée par Ali le 23 septembre :** augmenter le tarif minimum pour tous les emprunts afin de couvrir une faible fréquentation, et empêcher qu’erreurs ou abus puissent vider les wallets ou créer des dépenses non couvertes. L’objectif est un PnL non négatif. Les réservations et plafonds locaux sont intégrés ; leur calibration, la comptabilité et les contrôles fournisseurs restent à compléter. Un tarif élevé, une réserve de trésorerie ou un seuil d’alerte ne prouvent pas à eux seuls cet objectif.

Le devis distingue le prix du provider, le prix du compute et leur total. Les frais réseau en ETH sont affichés séparément et restent des estimations du wallet. Les USDC versés à Sirius rémunèrent son service ; ils ne rechargent pas automatiquement le compte Phala, dont la facture reste payée par l’opérateur.

Le périmètre initial concerne les prêts borrower/provider. La facturation des entraînements personnels et le choix VPS/Phala ne sont pas ajoutés implicitement à ce chantier.

## État actuel à prendre en compte

- Le mode par défaut reste v6 : prix dataset seul et crédit provider. Le mode explicite `SIRIUS_BILLING_VERSION=7` exige le nouveau contrat et le devis signé avec ses deux montants.
- La [nouvelle intégration](BILLING-INTEGRATION.md) réserve le budget de clôture avant émission du devis, exige l'acceptation du devis v7, vérifie les conditions avant calcul et mesure les échecs. Elle récupère le résultat durable après perte de la réponse Next et réconcilie les transactions ; une coupure avant le checkpoint SQLite du runner peut encore empêcher la clôture. Une migration Prisma additive est préparée et vérifiée sur une copie locale de la base réelle, sans modification distante.
- Le contrat crédite un forfait compute par profil, avec minimum commun, lors du `release`. Le reaper peut déclencher ce règlement sans nouveau grant du borrower dès que le résultat v7 est persisté. Le temps actif mesuré en échec comprend les transferts ; son taux doit être justifié par les coûts engagés et rester sans marge commerciale.
- L’ingestion impose 20 millions d’opérations au maximum. Le job v7 ajoute un délai global de 1 à 30 secondes et un worker terminable, sans remplacer les plafonds fournisseur et le superviseur d’infrastructure.
- Aucun budget réel, tarif commercial ou plafond fournisseur actif n’est introduit par les fixtures de tests. Ali a choisi le compte `0xb6acf8a998bb8efa34a954cd6334ccc15da7f919` pour le déploiement et la trésorerie testnet.

## Parcours cible

1. À l’ingestion, le runner valide le profil et les caractéristiques nécessaires à l’estimation, puis les lie au dataset dans son reçu, sans exposer les données brutes.
2. Avant l’emprunt, produire un devis signé à durée de validité courte. Il lie au minimum le borrower, le provider, le dataset, le profil et ses paramètres, l’identité du runner, le réseau/contrat, les deux prix, le bénéficiaire compute, les limites d’exécution, la version du tarif et la règle de retenue en cas d’échec avec son plafond et son barème de coûts.
3. Afficher le devis puis faire accepter et verrouiller exactement le total en USDC. Lire les décimales du token ; persister et signer les montants en unités atomiques entières.
4. Le runner vérifie le paiement confirmé, toutes les conditions signées et la réservation durable du budget maximal avant de déchiffrer pour l’entraînement ou de calculer. Un devis seul ne déclenche aucun job. L’admission financière est atomique entre toutes les instances ; une comptabilité indisponible ou incertaine bloque les nouveaux jobs.
5. À la réussite, publier le préimage et créditer atomiquement le provider pour le dataset et la trésorerie Sirius pour le compute. Conserver les retraits pull-only et la protection de la livraison du modèle jusqu’au règlement.
6. **Politique MVP choisie par Ali :** en cas d’échec, rembourser le dataset et le compute non consommé ; retenir uniquement les frais d’exécution engagés, vérifiables, plafonnés et annoncés dans le devis. Sans démarrage, aucun frais de calcul n’est acquis. Les frais réseau payés directement par le wallet ne sont pas remboursés par le protocole ni comptés une seconde fois dans la retenue. Définir la procédure anticipée et une récupération à échéance utilisable même si le runner est indisponible ; un message d’erreur HTTP ne suffit pas à autoriser un remboursement ou une retenue.

```text
retenue en échec = min(frais d’exécution justifiés,
                      plafond de retenue accepté,
                      montant compute déposé)
remboursement en échec = prix dataset + prix compute - retenue
```

Le prix fixe complet s’applique à la réussite. En échec, la marge commerciale et les provisions non consommées ne deviennent pas des frais d’exécution. La mesure doit être authentifiée par le runner et exploitable par la procédure contractuelle sans exposer le dataset. L’absence de preuve ne vaut pas consommation de la totalité du devis.

**Évolution éventuelle, non retenue pour le MVP :** rembourser intégralement et absorber les coûts avec une réserve limitée, alimentée par la marge déjà acquise, en bloquant les nouveaux jobs avant son épuisement. Ali souhaite seulement garder cette possibilité pour plus tard.

Les reprises doivent être idempotentes : aucun double prélèvement, double crédit ou double remboursement. Une perte de réponse après règlement doit permettre de retrouver le modèle sans facturer un nouvel entraînement.

## Estimer et fixer le prix

Le [business plan](BUSINESS-PLAN.md#5-modèle-de-revenus-et-prix-proposés) centralise les coûts et teste un **minimum de travail de 7 USDC par réussite**, hors dataset et frais wallet. Il s'agit d'une proposition fondée sur des hypothèses de fréquentation et de coûts, non d'un prix accepté par les clients, approuvé par Ali ou chargé dans le runner. La calibration et la convention USD/USDC restent nécessaires.

Construire une grille par profil à partir du nombre de lignes, du nombre de variables, des paramètres et de benchmarks sur la même classe de CVM. Couvrir aussi les coûts de préparation et de livraison, puis figer le prix dans le devis accepté.

```text
prix compute = max(tarif minimum prudent,
                   coût du job couvert par son budget
                   + contribution aux frais fixes
                   + marge de sécurité et marge commerciale)
```

Phala facture la machine pendant qu’elle est allumée, même sans entraînement, et le disque tant qu’il est conservé. La [préparation opérationnelle du 23 septembre](OPERATIONS-PREPARATION.md#coûts-préparés) a vérifié `0.058000` USD/h de calcul et `0.002780` USD/h pour les 20 Go de disque, et prépare des scénarios reproductibles avec `pnpm ops:costs`. Ce relevé ne couvre pas les autres fournisseurs et ne fixe aucun tarif commercial. Facturer uniquement les secondes actives d’un job ne couvre pas nécessairement les périodes d’inactivité. Revérifier la [tarification Phala](https://cloud.phala.com/about/pricing) avant activation.

Le minimum doit être calculé avec une hypothèse de fréquentation basse, puis appliqué à tous les emprunts. Les frais fixes déjà affectés aux jobs ne sont pas comptés une deuxième fois. Aucun volume minimal de clients n’est garanti : même un tarif élevé ne couvre pas une période sans vente. Aucun supplément rétroactif ne corrige cette période.

Le minimum facturé, les marges, la répartition des frais fixes et la convention USD/USDC restent à définir. Les `0,01 USDC` évoqués dans la conversation étaient un exemple d’affichage, pas un tarif validé. Aucun coefficient de performance Phala n’a encore été mesuré pour ce devis. La mesure du temps moyen ou du percentile 95 sert à fixer le prix ; elle ne remplace pas un plafond de dépense effectivement imposé.

**Préparation des essais suivante :** Ali laisse les autres abonnements hors de cette étape. Le [scénario Phala](OPERATIONS-PREPARATION.md#scénario-dessais-phala-préparé) propose une enveloppe de 5 USD pour dix sessions de deux heures et 30 jours de disque, sans approbation de dépense ni activation. Cette enveloppe ne définit pas un prix en USDC et ne crée pas de marge acquise dans le registre strict.

## Admission financière et protection des fonds — intégration locale

Le [registre runner local](RUNNER-BUDGETS.md) implémente les allocations atomiques, plafonds de gas, tentatives uniques, cache des résultats d'entraînement et coupe-circuit. Les devis v7 et la réservation du budget de clôture sont raccordés localement, sans garantir que la reprise puisse atteindre le règlement dans toutes les pannes. Les exigences ci-dessous restent la cible complète : les limites restantes du suivi d'audit, la comptabilité réconciliée, les coûts réels et les contrôles fournisseurs restent à traiter.

### PnL et trésorerie

Suivre séparément les revenus Sirius définitivement acquis, les charges engagées même non encore facturées, les fonds dus aux clients/providers et la trésorerie réellement disponible dans chaque monnaie. Un dépôt remboursable en escrow, un prêt de trésorerie, un apport personnel ou des USDC testnet ne constituent pas un bénéfice. La marge du dataset appartient au provider et ne couvre pas les dépenses Sirius.

Avant toute nouvelle dépense, réserver atomiquement sa perte maximale dans le cas défavorable, y compris si le job échoue et doit être remboursé :

```text
marge disponible = revenus Sirius définitivement acquis
                 - charges déjà engagées
                 - coûts maximaux restant réservés aux opérations en cours
                 - réserve de frais fixes et d’arrêt
                 - coussin de sécurité

admission seulement si marge disponible >= nouvelle exposition maximale
```

Chaque coût figure une seule fois : quand une dépense devient engagée, elle remplace sa réservation. Une réservation ne disparaît pas simplement à l’expiration d’un verrou ou à la réception d’un timeout HTTP. Conserver les engagements incertains jusqu’à réconciliation. Le budget global cumulé ne se réinitialise pas chaque jour ; les plafonds quotidiens sont des restrictions supplémentaires.

Le contrôle doit aussi confirmer les liquidités nécessaires : recevoir des USDC ne paie pas automatiquement les factures Phala en USD ou le gas en ETH. Les taux de conversion, frais et variations doivent avoir une borne prudente ; une donnée de prix absente ou périmée bloque l’admission.

**Limite à expliciter avant activation :** sans revenu acquis initial, le mode strict peut refuser le premier job et le démarrage de l’infrastructure. Un apport finance cette dépense mais ne rend pas le PnL positif. Définir la période comptable et inclure les coûts déjà engagés dans son périmètre ; ne pas masquer une perte en la reclassant en réserve. Une garantie absolue contre toute panne, compromission ou dépense fournisseur non bornée ne peut pas être affirmée. Si une charge ne peut être bornée et couverte, ce mode doit refuser l’exploitation concernée.

### Budgets et arrêt

- Imposer des plafonds par job et globaux pour CPU, mémoire, durée réelle, entrées/sorties, stockage, appels payants, concurrence et gas. Le job v7 ajoute un délai global et un worker terminable. Un contrôle extérieur au processus parent et des bornes réelles fournisseur restent nécessaires.
- Réserver aussi les tentatives de règlement autorisées, le traitement d’un échec et la fermeture des opérations en cours. À l’approche du seuil, arrêter les admissions assez tôt pour conserver ce budget ; ne pas épuiser la réserve avant de pouvoir régler ou rembourser.
- Utiliser un coupe-circuit persistant sur les échecs répétés, les consommations anormales ou un coût incertain. Aucun redémarrage ne remet les compteurs à zéro. La reprise exige une réconciliation et un budget disponible.
- Couvrir les coûts avant paiement : challenges, devis, ingestion, RPC, API publiques, téléchargements et entraînements personnels. Leur éventuelle gratuité est soumise à un budget explicite ; elle ne permet pas de contourner les plafonds des emprunts.
- Ajouter des limites globales en plus des quotas par compte/IP. Le KYB ouvert de démonstration ne bloque pas un attaquant qui crée plusieurs wallets.
- Borner l’uptime et prévoir un superviseur d’infrastructure indépendant. Configurer des offres prépayées ou des plafonds fournisseur vérifiés, sans recharge ni dépassement automatiques. Une alerte seule ne bloque aucune facture. Les frais de stockage et les abonnements persistants restent à couvrir après l’arrêt du compute ; ne pas supprimer la CVM ni les modèles historiques sans décision explicite.

La [documentation Phala](https://cloud.phala.com/about/pricing) confirme que le disque reste facturé quand la machine est arrêtée. Le [contrôle de dépenses Vercel](https://vercel.com/docs/spend-management) peut suspendre les déploiements, mais avec plusieurs minutes de délai et sans couvrir tous les postes facturés. Ces mécanismes imposent une réserve d’arrêt et une vérification de leurs limites ; ils ne constituent pas un plafond global instantané de Sirius. Les autres fournisseurs et offres réellement utilisés restent à vérifier avant activation.

### Wallets, reprises et remboursement

- Séparer la trésorerie des revenus du compte opérationnel qui signe les règlements. Celui-ci ne porte qu’un montant de gas limité, sans accès à la trésorerie ni recharge automatique. Le faucet et le parrainage KYB ont des budgets distincts ; aucun faucet de fonds réels n’est introduit.
- Avant une signature, contrôler contrat, réseau, méthode, prêt, plafond de gas et coût total du rollup. Réserver ce coût durablement. La simulation est un contrôle complémentaire, pas une garantie d’absence de frais en cas de revert.
- Enregistrer l’intention, le nonce et la transaction de manière à permettre une reprise après crash. Une réponse RPC perdue ne justifie pas un nouvel envoi avec un nouveau nonce. Les remplacements éventuels partagent le budget et un nombre maximal de tentatives. Ne jamais recalculer ni refacturer un modèle déjà produit pour retrouver une réponse.
- Conserver les remboursements et crédits dans l’escrow, plafonnés aux sommes déposées et retirables une seule fois. Ne pas indemniser automatiquement depuis la trésorerie Sirius. Le borrower doit pouvoir réclamer son remboursement à échéance même si l’application ou le runner est arrêté.
- Implémenter la retenue de frais après démarrage dans les conditions signées et la machine d’états du contrat, avec preuve du travail facturable et traitement d’une panne avant persistance. Aucune retenue fondée sur une erreur déclarée par Next ou sur un démarrage non vérifiable. Le scénario de remboursement maximal reste réservé tant que le droit à retenir ces frais n’est pas établi.

Le prix minimum et ces plafonds répondent à deux problèmes différents : la rentabilité attendue et la limitation des pertes possibles. Leur présence dans cette spécification ne prouve ni leur implémentation ni l’impossibilité de vider un compte opérationnel en cas de compromission.

## Travail à reprendre

1. Résoudre les risques restants du [suivi de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) : coupure avant checkpoint runner, transaction toujours introuvable après les reprises bornées, finalité du réseau, restauration du volume runner et anciennes copies de clés. Les quotas PostgreSQL et l'anti-rejeu ont été validés entre huit processus ; la coordination de plusieurs CVM n'est pas couverte.
2. Calibrer le minimum commun, les prix par profil, le barème de durée active sans marge en échec et les coûts maximaux réservés. Intégrer la trésorerie confirmée et justifier la marge déjà acquise ; aucune valeur de test ne vaut approbation.
3. Vérifier et imposer les plafonds des fournisseurs et la réserve de frais fixes/arrêt. Le superviseur extérieur est préparé, mais reste à installer, configurer et surveiller avant tout démarrage autorisé. Raccorder la comptabilité réconciliée et valider la reprise du registre sans remise à zéro.
4. Valider le parcours navigateur complet. Ali conserve la sauvegarde en local pour l'instant ; sa copie hors machine est différée. La restauration PostgreSQL 18 et les migrations sur une copie réelle sont vérifiées. Les validations [locales](BILLING-INTEGRATION.md#validation-locale-et-limites) totalisent 308 tests applicatifs, puis 18 tests des outils d'exploitation pour la préparation Phala ; les passes précédentes couvrent aussi 79 tests contrats, 62 tests navigateur et le parcours EVM local. Elles ne prouvent pas la reprise et la facturation complètes en production.
5. Avant les benchmarks réels, annoncer à Ali quand Phala sera utilisé, pour combien de temps et à quel coût estimé. Calibrer ensuite la grille et vérifier l’identité de la même CVM.
6. Après correction des bloqueurs et validation de cette fonctionnalité, préserver les deux modèles récupérés et les onze historiques de test sans wallet accessible (voir [l'exercice de reprise](BACKUP-RECOVERY.md)), puis refaire un snapshot pendant la maintenance décrite dans [PHALA.md](PHALA.md). Publier et figer les images, préparer les contrats de facturation, les migrations et le parcours complet à deux wallets. Aucune de ces opérations distantes n'est effectuée par cette préparation.

## Contraintes de reprise

- La CVM est **arrêtée à la demande de Ali** ; préparer le chantier localement. Ne pas la redémarrer pour coder ou tester localement, ni lancer un benchmark Phala sans l’avoir prévenu du moment et du budget.
- Aucun nouveau déploiement Solidity, changement de base distante ou activation de Phala n’a été effectué pour cette facturation.
- Le compte local confirmé par Ali assure déploiement et trésorerie testnet ; le compte EVM dérivé dans Phala reste distinct et autorise les prêts puis paie le gas des règlements. Aucune clé de déploiement n’est injectée dans la CVM.
- Conserver le KYB ouvert pour la démonstration testnet actuelle. Le mode VPS reste une [spécification différée](RUNNER-MULTI-BACKEND.md).
- Conserver les accès privés et les historiques existants ; ne publier aucun secret dans ces documents. Aucune commande Git sans demande explicite de Ali.
