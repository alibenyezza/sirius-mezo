# Roadmap EVM

Cette roadmap reflète le code présent dans ce dépôt. Une case cochée signifie que la brique est implémentée localement, pas qu'elle a été validée sur un réseau public.

Le [plan global vers mainnet](MAINNET-PLAN.md) conserve les quatre phases, leurs responsables et portes de sortie, les pistes de financement et les recommandations à arbitrer. Les dates cibles et pistes commerciales n'y valent pas validation technique ni financement acquis.

Le [business plan et récapitulatif des coûts](BUSINESS-PLAN.md) centralise désormais les hypothèses d'exploitation, le budget de lancement et la rentabilité. Ses propositions de prix et de dépenses ne valent ni approbation ni activation.

**Facturation demandée par Ali :** le [parcours signé jusqu’au remboursement](BILLING-INTEGRATION.md) est raccordé et testé localement, avec réservation du budget de clôture. Le [suivi de l'audit](AUDIT-2026-09-23.md#suivi-des-correctifs-locaux--23-septembre-2026) distingue les correctifs locaux des risques encore ouverts. La [reprise locale](RECOVERY-OPERATIONS.md) couvre désormais les réponses Next perdues, les rediffusions identiques et les quotas PostgreSQL entre processus. La [préparation opérationnelle](OPERATIONS-PREPARATION.md) ajoute sauvegarde réelle/restauration locale, copie des modèles, images et chiffrage. Tarifs complets, comptabilité, plafonds fournisseurs, anciennes clés et validation Phala restent nécessaires avant activation. Les identifiants PostgreSQL sont conservés à la demande de Ali. Aucun nouveau contrat public v7 n'est déployé ; la CVM reste arrêtée.

**Reprise au 23 septembre 2026 :** lire d’abord [le point de reprise Phala](PHALA.md#reprendre-ici--23-septembre-2026). L'arrêt de la CVM demandé par Ali est confirmé à 13:13 UTC ; le disque reste facturé. Prévenir Ali du moment et du coût avant toute nouvelle utilisation de Phala. Le site, les contrats et la base n’ont pas basculé. Les deux accès de production sont validés, et Pinata est configuré localement pour Phala. Aucun prêt ni entraînement actif observé ; les blobs des modèles de 5 prêts et 8 entraînements sont sauvegardés. Les deux modèles du wallet local sont déchiffrés et restaurés hors ligne ; onze anciens modèles de test restent sans wallet accessible. Ali conserve les sauvegardes en local pour l'instant. Le KYB ouvert actuel est confirmé ; le compte local de déploiement/trésorerie est confirmé par Ali. Ne pas recréer la CVM ni reprendre la configuration des accès CLI déjà effectuée.

## Socle EVM — implémenté

- [x] Définition de Mezo testnet `31611` et mainnet `31612` dans `src/lib/evm/networks.ts`.
- [x] Client RPC `viem`, normalisation EVM des adresses, validation des montants USDC et vérification de signatures EVM.
- [x] `SiriusEscrow` : verrouillage USDC ERC-20 exact, hashlock SHA-256, KYB des deux parties, release avant échéance, remboursement, crédits pull-only et transferts sûrs.
- [x] `SiriusKybRegistry` v3 : attestations KYB EIP-712 liées à l’époque du vérificateur, révocation durable, expiration et gestion des vérificateurs.
- [x] `SiriusDatasetRegistry` : ancrage d'un dataset chiffré, KYB bloquant et tombstone ; l'effacement de toutes les copies de clés n'est pas garanti (S-08).
- [x] Tests Hardhat, scripts de compilation, export ABI, déploiement et smoke test MUSD.
- [x] Liaison EVM dans le runner : dérivation du préimage liée au contrat et au réseau, contrôle KYB + `matchesScope` + escrow, règlement et re-livraison de clé modèle.

## Facturation du compute — priorité avant redéploiement

- [x] Formaliser et signer le devis : prix dataset/compute, total, bénéficiaires, profil, limites, barème d’échec et expiration. Afficher et faire accepter avant paiement.
- [x] Retenir le compte local `0xb6acf8a998bb8efa34a954cd6334ccc15da7f919` pour le déploiement et la trésorerie testnet, selon le choix de Ali.
- [x] Préparer le chiffrage Phala et le banc de benchmarks synthétiques sans activer la CVM.
- [x] Chiffrer dix essais de deux heures avec 30 jours de disque et réserve d'arrêt : 3,209940 USD, 4,02 USD avec coussin ; enveloppe Phala proposée de 5 USD, non approuvée. Les autres abonnements sont laissés hors de cette étape à la demande de Ali.
- [x] Documenter les coûts globaux et le business plan, avec hypothèses d'abonnements, audit, temps de travail, prix proposés et seuils de rentabilité ; aucun montant approuvé implicitement.
- [ ] Valider les tarifs commerciaux complets et le plafond financé des essais.
- [ ] Fixer un tarif minimum prudent couvrant une faible fréquentation ; définir le périmètre du PnL sans compter les fonds clients ni les apports comme des bénéfices.
- [x] Implémenter localement les [budgets runner persistants](RUNNER-BUDGETS.md) : réservation atomique par opération, plafonds de gas, intention/nonce/hash durables, tentative unique, cache des modèles et coupe-circuit. Aucune activation distante.
- [x] Réserver le parcours complet avant devis, conserver le budget de clôture après coupe-circuit et interrompre le worker de calcul à sa limite.
- [ ] Raccorder la comptabilité réconciliée, séparer les comptes effectifs, imposer un superviseur extérieur et borner les dépenses fournisseurs après arrêt.
- [ ] Calibrer sur Phala l'estimation préparée avec les caractéristiques authentifiées du dataset et le banc synthétique local ; prévenir Ali du créneau et du coût avant tout benchmark payant.
- [x] Implémenter séparément [Escrow v7](ESCROW-V7.md), son ABI et ses tests locaux : deux prix bloqués, répartition provider/Sirius, retenue plafonnée par reçus signés et remboursement à échéance sans runner. Branchement applicatif local effectué ; aucun déploiement public.
- [x] Implémenter localement la politique MVP d'échec mesuré : remboursement du dataset et du compute non consommé, retenue des seuls frais engagés, justifiables, plafonnés et annoncés. La reprise des transactions confirmées et la clôture autonome des résultats persistés sont testées ; la réponse Next perdue est récupérable ; le crash avant checkpoint runner et les intentions encore introuvables après trois envois restent des limites.
- [x] Raccorder autorisations, reçus, runner, Prisma, routes, reaper, interface, ABI et contrôles de version ; conserver la lecture des historiques. Migration additive préparée, non appliquée à distance.
- [x] Tester le runner et les contrats sur EVM locale : paiement, calcul, règlement, échec/remboursement, échéance, cache et coupe-circuit. Tester l’acceptation et les transactions navigateur avec wallet simulé.
- [x] Valider les migrations additives avec historiques et les quotas sur PostgreSQL 17, entre huit processus.
- [ ] Valider le parcours visuel à deux wallets et RA-TLS/testnet avant réouverture.

Spécification de reprise et limites : [COMPUTE-BILLING.md](COMPUTE-BILLING.md).

## Audit approfondi du 23 septembre — suivi

- [x] S-01 : réconcilier les transactions runner confirmées avant un nouvel envoi, indépendamment du statut du prêt.
- [x] S-02 : ne livrer la clé v7 qu'après vérification du règlement canonique et des confirmations configurées.
- [x] S-03/S-04 : régler sans nouvelle action du borrower après persistance du modèle ; exiger le devis v7 et reconstruire les transactions v6.
- [x] S-05/S-08 : filtrer les réponses dataset et cesser de conserver la clé enveloppée dans le cache actif du scellement.
- [x] S-06/S-07/S-09 : éviter la saturation ciblée des challenges, sérialiser les quotas PostgreSQL et préserver les réservations anti-rejeu en cours d'écriture.
- [x] Ajouter les régressions locales, `test:billing`, `test:postgres`, `test:operations` et le typage v7 à la CI.
- [x] Récupérer les résultats durables du runner après perte de réponse Next ; tester le reaper sans nouveau grant.
- [x] Ajouter un journal chiffré des transactions, trois envois identiques au maximum, une politique commune de finalité et les outils opérateur.
- [x] Tester les quotas PostgreSQL et l’anti-rejeu entre huit processus ; corriger la reprise des conflits au commit.
- [x] Préparer sauvegarde cohérente et nettoyage des caches de clés SQLite ; corriger la promesse de suppression dans l’interface.
- [x] Sauvegarder la base réelle sous chiffrement, restaurer sur PostgreSQL 18 local et vérifier les migrations avec toutes les lignes historiques.
- [x] Copier et relire les 13 blobs de modèles historiques ; contrôler les crédits dus des deux anciens escrows.
- [x] Préparer un paquet chiffré complet, le restaurer localement et tester les arrêts brutaux avant/après checkpoint SQLite. Inventorier les 13 reçus historiques et leurs six wallets ; voir [l'exercice de reprise](BACKUP-RECOVERY.md).
- [x] Préparer le superviseur extérieur, le contrôle des environnements et les images ; corriger les paramètres du reaper v7.
- [x] Vérifier la livraison et la restauration hors ligne des deux modèles du wallet local ; corriger leur lecture sans inventer version ni MAE. Les onze autres historiques restent conservés sans wallet de test accessible.
- [ ] Valider finalité/pannes sur le réseau cible, restauration du volume runner et traitement des anciennes sauvegardes. La copie hors machine est différée, sauvegarde locale retenue par Ali pour cette étape.

Preuves et limites : [rapport complet](AUDIT-2026-09-23.md). Les tests locaux couvrent les correctifs principaux ; ils ne remplacent pas les validations distantes ni une garantie de finalité ou d'effacement cryptographique.

## Migration produit — en cours

- [x] Déployer les trois contrats durcis sur Mezo testnet et renseigner leurs adresses dans `.env.local`.
- [ ] Configurer l'émetteur KYB externe et sa clé HSM/KMS ; l'application ne signe plus d'attestation KYB.
- [ ] Financer et vérifier le compte EVM dérivé du runner, utilisé pour appeler `release` ; le wallet du borrower signe `refund`.
- [x] Brancher le wallet navigateur EVM sur les appels `mint`, `approve`, `lock`, `withdraw` et les attestations KYB.
- [x] Migrer les routes et écrans dataset, marketplace, entraînement, audit et wallet sur les données et événements EVM.
- [x] Retirer les chemins historiques de l'application, du runner et du manifeste de déploiement.
- [x] Remplacer le manifeste Phala par `EVM_NETWORK`, `EVM_RPC_URL` et les adresses de contrats EVM.
- [x] Imposer le profil d'entraînement à l'upload et le lier au titre DatasetRegistry v4, à l'Escrow v5 et aux reçus du runner.
- [x] Reprendre les locks abandonnés et conserver le déploiement des nouveaux prêts ; permettre la livraison des modèles historiques autorisés.
- [x] Remboursement signé dans le wallet sans master key côté Next ; logs techniques sans préimage ni jeton RPC brut.
- [x] Préflight de migration on-chain, protection contre les transactions en attente et limite d'upload compatible avec l'hébergement Vercel.
- [x] Configurer automatiquement les origines du sign-in par branche, avec des alias explicites et des builds navigateur distincts.
- [x] Conserver le blob au rechargement de l'accueil et afficher les causes des erreurs d'authentification.
- [x] Tester la sélection des cibles, l'isolation des origines et la clé d'ingestion sur les alias ; ajouter un smoke de challenge à la pipeline.
- [ ] Ajouter des tests d'intégration navigateur/runner/contrats sur un nœud EVM local puis sur testnet.

## Correctifs locaux — audit du 12 septembre

- [x] Réabonner le connecteur aux événements du wallet sélectionné (F1).
- [x] Invalider les réponses datasets obsolètes après changement de compte, y compris la pagination (F2).
- [x] Harmoniser le login avec les délégations EOA ; refuser clairement les comptes contractuels non supportés (F3).
- [x] Exiger une autorisation EIP-712 du runner pour les locks v6, avec renouvellement borné après approve (F4).

Preuves, priorités et limites : [audit staging du 12 septembre](AUDIT-STAGING-2026-09-12.md).

## Correctifs locaux — audit du 13 septembre

- [x] Afficher et retirer les crédits des escrows courants et historiques dans Wallet et Dashboard (A1).
- [x] Refuser dès l’ingestion les CSV dont le coût dépasse le budget du profil (A2).
- [x] Invalider les logins tardifs, données et soldes lors d’un changement d’identité wallet (A3–A5).
- [x] Paginer les datasets privés et le catalogue sur Entraîner (A6).
- [x] Séparer les quotas de préparation/soumission KYB et reconnaître l’émetteur du parrainage (A7).
- [x] Lier les signatures KYB strictes à l’époque du vérificateur, y compris avant leur première consommation (A8).
- [x] Vérifier les preuves historiques contre le déploiement autorisé du prêt (A9).

Validation et limites : [correctifs du 13 septembre](AUDIT-CORRECTIFS-2026-09-13.md).

## Validation testnet — à faire

- [ ] Après validation des risques encore ouverts, préparer la [migration v7](BILLING-INTEGRATION.md), exécuter les préflights et republier les datasets avant réouverture. La procédure v6 reste historique ; aucun déploiement v6 intermédiaire n'est prévu.

- [ ] Déployer les contrats retenus et valider le parcours applicatif v7 avec le vrai runner et les adresses publiées. `pnpm contracts:smoke` reste réservé au smoke historique v6 et refuse v7.
- [ ] Attester un provider et un borrower via l'émetteur KYB externe puis `SiriusKybRegistry`.
- [ ] Publier un dataset chiffré, verrouiller un prêt en USDC, entraîner dans le TEE et régler avec `release`.
- [ ] Vérifier sur le réseau cible la capsule historique v6 et la livraison de clé v7 après règlement confirmé.
- [ ] Vérifier le remboursement après échéance et le retrait des crédits par les deux parties.
- [ ] Vérifier le crypto-shredding et le tombstone du registre dataset.
- [ ] Rejouer les reprises après timeout et les scénarios de conflit de réseau ou d'adresse de contrat.
- [ ] Appliquer `20260905010000_track_loan_deployment` et configurer l'historique des escrows sur staging ; valider les correctifs de [l'audit du 5 septembre](AUDIT-CORRECTIFS.md) dans le navigateur.
- [ ] Valider après publication les challenges sur le domaine staging et ses alias, puis répéter après fusion sur main ; vérifier DNS et session réelle. Voir [DEPLOYMENT.md](DEPLOYMENT.md).

## Phala et production — en cours

- [x] Préparer le mode d’amorçage Phala sans contrats, avec refus de toutes les opérations métier.
- [x] Vérifier l’identité de règlement et les liaisons EVM avant activation du runner.
- [x] Imposer Phala sur la cible main indépendamment du testnet et tracer la provenance des datasets, entraînements et prêts.
- [x] Préparer le préflight de bascule et le [runbook Phala](PHALA.md), sans sélecteur VPS ; la validation complète en mode actif reste à réaliser.

- [x] Construire et publier l'image immuable du runner (`phala-ratls-20260919`, registre privé GHCR, digest `sha256:fbc137a97f16213f331ce54916a5053f17c97a06d3f614c8b127365b526c5e19`).
- [x] Amorcer la CVM de production, vérifier la quote Intel et le Compose mesuré, confirmer le transport RA-TLS et le refus des opérations métier.
- [x] Vérifier la persistance de l’identité dérivée de la master key et du compte de règlement EVM au redémarrage de la même CVM.
- [x] Récupérer et valider `DATABASE_URL` de production via le fichier local privé ; lire l’état des prêts, entraînements et références de modèles historiques.
- [x] Valider `PINATA_JWT` de production : correspondance des 15 CID attendus, upload/lecture/suppression d’un fichier synthétique chiffré ; configurer Pinata dans le fichier Phala local.
- [ ] Après validation de la facturation compute, utiliser le signataire confirmé et déployer la version de contrats retenue avec l’autorisateur attesté de Phala ; conserver le KYB ouvert testnet actuel et les escrows historiques, dont `0x805a2c2deaa3a8926e85fed6b341dacb54cacba0`.
- [ ] Financer l’adresse de règlement Phala en ETH testnet et activer la CVM existante avec les nouvelles adresses.
- [ ] Recapturer les mesures RA-TLS actives et épingler les valeurs côté Next ; les mesures d’amorçage ne conviennent pas à la réouverture.
- [ ] Appliquer les migrations de provenance `20260919000000_track_runner_provenance` et de facturation `20260923000000_add_compute_billing` en maintenance, réimporter les datasets et préserver l'accès séparé aux modèles historiques.
- [ ] Synchroniser la configuration Next/reaper, reconstruire et déployer l’application, puis valider les préflights et le parcours navigateur à deux wallets.
- [ ] Exécuter le smoke RA-TLS avec un RPC EVM et des contrats testnet.
- [ ] Faire revoir les contrats et le flux de règlement avant activation mainnet.
- [ ] Obtenir une validation manuelle complète avant toute utilisation avec des fonds réels.

## Post-MVP

- [ ] Jobs asynchrones pour entraînements longs.
- [ ] Budget de confidentialité différentiel et métriques vérifiables.
- [ ] Arbitrage des litiges de qualité.
- [ ] Découverte de datasets et données synthétiques, sans exposer de donnée brute hors TEE.
