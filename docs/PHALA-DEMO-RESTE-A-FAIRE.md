# Reste à faire — espace Phala puis runner VPS

État documentaire du **26 septembre 2026**, sans attribution nominative des tâches. Cette liste reprend le reste à faire communiqué dans la conversation. Elle complète le [plan](PLAN-VPS-PHALA.md), le [journal avant/après](PHALA-DEMO-IMPLEMENTATION.md) et le [runbook technique](PHALA-DEMO-RUNBOOK.md).

## Point de départ

Le parcours `/phala`, l’accès opérateur non listé `/operator`, les sessions manuelles, les quotas, le financement sponsorisé et la livraison chiffrée après arrêt sont implémentés localement. Les tests locaux, le typage, le lint et le build passent. La migration de livraison est préparée, pas appliquée à distance. **Cette nouvelle version n’est ni publiée ni validée sur Phala réel.**

Les reapers staging et production ont été transférés sur le nouveau VPS. Le calcul habituel n’a pas encore été déplacé sur ce VPS. La CVM était arrêtée au dernier contrôle distant documenté ; aucune lecture distante nouvelle n’a été faite pour rédiger cette checklist. La bascule globale v7 de staging et le nettoyage Neon de l’ancien lot B sont différés.

Les validations locales enregistrées sont : 366 tests au dernier passage applicatif complet, puis 20 tests ciblés après les derniers ajouts (15 Phala et 5 provenance), 3 scénarios navigateur simulés. Ces nombres se recouvrent ; ne pas les additionner ni les présenter comme un parcours matériel attesté.

## P08 — Configurer, déployer et valider l’espace Phala

### 1. Choisir les domaines

- [x] Confirmer le sous-domaine de l’espace Phala, par exemple `confidential.sirius-data.tech` ; cet exemple n’est pas encore une cible validée. Choisi : `phala.sirius-data.tech` (D-26).
- [x] Choisir l’origine HTTPS du contrôleur extérieur. Choisie : `https://ctl.sirius-data.tech`.
- [x] Configurer DNS, certificats valides et renouvellement TLS. Enregistrement A dans le DNS Vercel, Caddy avec certificat Let’s Encrypt renouvelé automatiquement (valide jusqu’au 25 décembre 2026).

### 2. Configurer les opérateurs

- [x] Choisir explicitement les deux wallets autorisés à activer, désactiver et arrêter Phala. Deux wallets choisis le 26 septembre 2026.
- [x] Renseigner la même allowlist `SIRIUS_DEMO_OPERATORS` dans Next et le contrôleur. Identique aux deux endroits, en minuscules.
- [x] Ne pas promouvoir automatiquement les anciens wallets provider/borrower de test. Liste saisie explicitement.
- [x] Générer le code d’accès (`pnpm ops:demo-operator-code`), renseigner `SIRIUS_DEMO_OPERATOR_CODE_HASH` dans Next et transmettre le code aux opérateurs hors chat et hors Git. Sans cette variable, `/operator` refuse tout accès. Code généré le 26 septembre selon Ali. La variable reste cependant absente du projet Vercel staging au contrôle qui a suivi le déploiement : la poser, puis redéployer.

### 3. Affecter le financement

- [x] Relever les crédits Phala réellement utilisables et dater ce relevé. Relevé du 26 septembre 2026 : 14,62 USD de crédits prépayés sur le tableau de bord.
- [x] Choisir crédits seuls, budget Sirius ou financement mixte. Crédits seuls.
- [x] Affecter explicitement le complément payé éventuel et le plafond cumulé. Aucun complément payé ; plafond cumulé 14 USD.
- [x] Prévoir la réserve de disponibilité de la machine, de stockage et d’arrêt ; calibrer les coûts des opérations. Réserve fixe 4 USD ; coûts 0,01 / 0,10 / 0,30 USD par requête / scellement / entraînement.
- [x] Préparer les politiques privées sans assimiler crédits ou apports à une marge acquise. Aucun montant n’est approuvé par cette checklist. Politiques générées hors Git, validées par l’initialiseur de volume, copiées sur le VPS sous `sirius-ops` ; marge acquise et liquidités à 0.

### 4. Fixer les quotas

- [x] Définir les limites globales, par wallet et de concurrence. 20 opérations, 4 par wallet, 1 simultanée (fichier de financement du contrôleur et politique runner identiques).
- [x] Compter le scellement et l’entraînement comme deux opérations distinctes. Comptés ainsi : 4 opérations par wallet = 2 entraînements complets.
- [x] Tenir compte des limites Next existantes : 3 entraînements par wallet et par heure, 30 globaux par heure, un calcul simultané. 2 entraînements par wallet et par session restent sous les 3 par heure de Next.
- [x] Vérifier que les coûts et le budget couvrent aussi les requêtes d’ingestion et de contrôle métier. 10 USD disponibles après réserve couvrent 20 opérations au coût maximal de 0,30 USD plus les requêtes à 0,01 USD.

### 5. Base et migrations — staging (D-26)

- [x] Conserver la base Neon staging existante avec ses accès actuels ; aucune base dédiée n’est créée. Conservée.
- [x] Laisser la pipeline appliquer `20260926000000_add_self_train_delivery` lors de la fusion vers `staging`, avant tout service du nouveau code. Appliquée par le job Migrations du déploiement de `f509cb2`.
- [x] Laisser la pipeline appliquer `20260926120000_add_operator_code_attempts` (tentatives de code opérateur) lors de la fusion des correctifs de recette, puis vérifier son job Migrations. Appliquée par le job Migrations du déploiement de `c98f70b`.
- [ ] Vérifier après fusion, par l’inventaire de base en lecture seule, que la migration est présente et que les lignes historiques sont intactes.
- [ ] Vérifier le stockage des capsules de livraison et les accès réservés au propriétaire.

### 6. Instance Vercel — staging (D-26)

- [x] Ajouter le domaine `phala.sirius-data.tech` au projet Vercel staging et le rendre origine principale ; garder `sirius-mezo-staging.vercel.app` en alias. Fait ; alias conservés.
- [x] Aligner `SIRIUS_APP_ORIGIN`, `NEXT_PUBLIC_SIRIUS_APP_ORIGIN`, les alias et les domaines autorisés de connexion wallet ; la pipeline réécrit ces origines depuis le sélecteur de cible, qui doit connaître le nouveau domaine. Sélecteur de cible mis à jour (D-26), pipeline verte, domaine ajouté aux origines Web3Auth.
- [x] Renseigner `SIRIUS_PHALA_DEMO=true`, `SIRIUS_DEMO_OPERATORS`, `PHALA_DEMO_CONTROLLER_URL` et `PHALA_DEMO_CONTROLLER_SECRET` ; aucune master key d’enclave dans Next. Fait ; les deux opérateurs sont renseignés dans Next et le contrôleur, staging redéployé.
- [x] Ajouter `SIRIUS_LEGACY_ESCROW_ADDRESSES` avec les escrows historiques de staging pour les crédits anciens. Trois escrows historiques renseignés.
- [ ] Configurer le lien `/phala` du site principal vers `phala.sirius-data.tech`.
- [x] Vérifier le faucet et les soldes ETH testnet nécessaires au KYB et au titre du dataset ; le self-train ne demande pas de paiement client. Relevé du 26 septembre : faucet staging 0,009 ETH, signataire Phala 0,010 ETH, trésorerie 0,0079 ETH.

### 7. Configuration staging héritée de l’ancienne bascule

- [x] Inventorier les variables Vercel et GitHub préparées pour l’ancienne bascule v7/Phala : elles sont conservées telles quelles et deviennent la configuration de l’instance de démonstration (D-26).
- [x] Recapturer et remplacer les mesures attendues et l’empreinte d’ingestion après publication de la nouvelle image ; ne pas réutiliser celles de l’ancienne image. Recapturées en mode actif le 26 septembre et remplacées dans le contrôleur, le collecteur et Vercel ; empreinte d’ingestion et signataire inchangés.
- [x] Garder le nettoyage Neon différé ; ne pas reprendre ses commandes. Différé.

### 8. Livrer les modifications sur GitHub

- [ ] Relire le code, les migrations, les fichiers d’exploitation et la documentation ; coordonner les modifications concurrentes.
- [ ] Une fois les opérations Git explicitement demandées, commiter/pousser les fichiers utiles, préparer la PR et valider la CI sur la cible choisie.
- [ ] Exclure secrets, fichiers privés, sauvegardes, `CLAUDE.md` et `AGENTS.md`. Le dépôt partage le contexte via `docs/` ; les deux fichiers de contexte agent restent locaux et se transmettent hors Git.
- [ ] Ne pas déduire l’état GitHub de ces changements locaux : aucun commit/push n’a été exécuté pendant leur implémentation.

### 9. Publier et installer le nouveau runner

- [x] Construire et publier l’image contenant cette implémentation ; conserver son digest immuable. Digest publié par la pipeline staging : `sha256:8a10ab554e5693c70c97831c6df8b8d41774bce680896a368a66ffcbbb513f8e`.
- [x] Préparer les Compose `demo-init` et `demo-active`, avec des volumes dédiés au budget et à l’anti-rejeu. Rendus depuis ce digest, copiés sur le VPS sous `sirius-ops`.
- [x] Initialiser les nouveaux volumes et politiques une seule fois, sans supprimer les registres historiques ni recréer des crédits consommés. Fait le 26 septembre : volumes `sirius_phala_demo_*` créés neufs, démarrage actif réussi, rapport de budget attesté conforme (10 USD disponibles après réserve).
- [x] Vérifier la cohérence testnet/contrats/signataire/politiques. Si les contrats du 25 septembre sont conservés, garder la configuration v7 attendue. Contrats du 25 septembre conservés ; politiques cohérentes (testnet 31611, signataire, trésorerie, USDC 18 décimales).

### 10. Installer le contrôleur sur le VPS

- [x] Installer le service préparé sous `sirius-ops` sur le nouveau VPS, en préservant les reapers. Installé et actif ; reapers intacts.
- [x] Configurer le profil Phala, les secrets, le fichier de financement et l’état persistant avec des permissions privées. Profil `sirius` connecté, secrets générés, financement 14 USD daté, état persistant en 0700/0600.
- [x] Rendre son HTTPS accessible depuis Vercel et vérifier pare-feu, certificat et renouvellement. Caddy sur `ctl.sirius-data.tech` : 401 sans secret, 200 avec ; pare-feu 80/443 ouverts.
- [x] Vérifier qu’un redémarrage du contrôleur ne déclenche pas de démarrage CVM. Vérifié : après redémarrage du service, la CVM reste arrêtée et l’état reste `closed`.
- [x] Garder les watchdogs de fermeture temporisée désactivés. Les lectures et alertes de supervision ne commandent pas d’arrêt. Aucun timer actif.

### 11. Valider l’attestation et les liaisons réelles

- [x] Annoncer le créneau et l’estimation de coût avant la prochaine utilisation Phala. Créneau du 26 septembre annoncé à 0,0608 USD/h.
- [x] Démarrer la nouvelle configuration pour sa validation, puis vérifier la quote matérielle `UpToDate`, son lien au certificat et les mesures. Quote vérifiée (matériel, report data, event log) en amorçage puis en mode actif.
- [x] Épingler MRTD, RTMR3, hash Compose, chaîne KMS et empreinte d’ingestion dans les composants concernés. Épinglés ; hash Compose identique à celui affiché par Phala.
- [x] Vérifier que le signataire correspond aux contrats. Un changement d’identité peut nécessiter de nouveaux contrats ; ne pas partager la clé Phala avec le VPS. Signataire `0x3b31…c8c8d` inchangé, contrats du 25 septembre conservés ; aucune clé Phala sur le VPS.
- [x] Ne pas réutiliser aveuglément les mesures de l’ancienne image et ne pas substituer un runner VPS/Next en cas d’échec. RTMR3 et hash Compose de l’ancienne image remplacés ; aucun repli VPS/Next.

### 12. Finaliser la présentation

- [x] Harmoniser les libellés de la nouvelle page avec le site anglais ; les traductions des erreurs sont déjà ajoutées. Publié sur staging le 26 septembre (`c98f70b`) pour `/phala`, sa page de repli et `/operator`.
- [ ] Relire les étapes wallet, les limites CSV/profils, les états fermé/indisponible et les exemples.
- [ ] Expliquer la conservation du modèle et la nécessité du même navigateur, de la même origine et du même wallet pour sa livraison enregistrée.
- [ ] Décrire exactement les capacités et la preuve disponibles dans les messages de lancement.

### 13. Préparer l’exploitation et la reprise

- [ ] Définir le suivi des dépenses réelles, y compris machine allumée sans calcul et disque après arrêt. Relevé du 26 septembre : CVM allumée 8 h 40 (déploiement 15 h 00, fermeture 23 h 41 UTC) pour deux entraînements, soit environ 0,53 USD de crédits Phala au tarif horaire, à confirmer sur la facturation Phala.
- [ ] Préparer la sauvegarde et la restauration des nouveaux registres, de l’état du contrôleur et des métadonnées de livraison.
- [ ] Définir la procédure de réconciliation après interruption avant de rouvrir une session.
- [ ] Intégrer l’estimation automatique des frais d’hébergement et les notifications externes au panneau ; elles ne sont pas encore livrées. Pour une première session supervisée, documenter et assurer un suivi manuel explicite.
- [ ] Vérifier qu’aucun dépassement de quota ne ferme automatiquement la session : l’arrêt reste une décision opérateur. Un quota logiciel ne plafonne pas à lui seul la facture fournisseur.
- [ ] Exécuter les tests navigateur Phala dans la CI : la pipeline lance la suite principale, qui exclut `e2e/phala`, et jamais `playwright.phala.config.ts` ; confirmer dans le log du job Vérification que les tests de rendu Compose dépendant de Docker y passent.
- [ ] Étendre le contrôle de release au contrôleur de démonstration : `ops:check-release` vérifie Next, reaper et runner, pas l’allowlist, l’URL du contrôleur ni ses pins.
- [ ] Documenter, avant toute ouverture publique, le suivi manuel des coûts, la sauvegarde et la restauration des volumes de démonstration et la réconciliation, avec les outils d’exploitation existants ; leur automatisation peut suivre.

### 14. Répéter le parcours sur les vrais services

- [ ] Une visite ou un utilisateur non opérateur ne démarre rien ; les commandes lui sont refusées.
- [x] Activer manuellement ; n’ouvrir qu’après attestation vérifiée ; refuser un mauvais pin. Première session ouverte le 26 septembre au soir depuis `/operator` ; le contrôleur a refusé le runner tant que son identité n’était pas vérifiable (variables absentes), puis a ouvert après correction.
- [ ] Entraîner les deux exemples et un CSV personnel ; vérifier titre PRIVATE, métriques, fichier de modèle et budget consommé. Les deux exemples sont validés (régression linéaire R² 0,976 sur 112 lignes, régression logistique sur 480 lignes, modèles téléchargés, 4 opérations comptées, 0,43 USD engagés). Le CSV personnel et le second wallet restent à relever : le compteur n’a pas bougé lors de l’essai avec le second wallet.
- [ ] Fermer pendant un calcul : refuser les nouvelles admissions et conserver le résultat engagé avant l’arrêt confirmé.
- [ ] Recharger le navigateur et télécharger le modèle alors que la CVM est arrêtée ; vérifier le refus pour un autre wallet ou une clé locale absente. Non encore relevé ; à faire au début de la prochaine session, CVM éteinte.
- [ ] Réouvrir : conserver les dépenses, refuser un grant de session ancienne, tester quotas et budget insuffisant sans fermeture automatique. Quota par wallet vérifié le 26 septembre : troisième entraînement refusé « Demo quota reached » sans fermeture ; réouverture et budget insuffisant restent à tester.
- [ ] Tester l’arrêt d’urgence pendant l’ouverture puis pendant le calcul ; vérifier l’état réel du fournisseur et la réconciliation avant reprise.
- [x] Redémarrer seulement le contrôleur : aucune commande automatique à Phala ; intervention explicite si une commande a été interrompue. Vérifié en réel le 26 septembre : deux redémarrages pendant une ouverture ont laissé l’état en `error` « Commande interrompue », sans commande CVM, et un nouvel « Open » de l’opérateur a été nécessaire.

**Porte de publication :** configuration dédiée cohérente, nouvelle attestation vérifiée, parcours réel et fermeture/récupération validés, financement affecté et exploitation supervisée. Les tests locaux avec API simulées ne suffisent pas. L’ouverture publique reste manuelle ; aucune durée de deux heures n’est imposée.

## Fiabilisation technique encore ouverte

Ces limites doivent rester explicites pendant les premiers essais ; les tests locaux verts ne les résolvent pas.

- [ ] Automatiser ou outiller la réconciliation self-train après arrêt brutal : les réservations restent engagées, il ne faut ni fabriquer un succès ni effacer le budget.
- [ ] Fiabiliser la récupération si Next perd la réponse avant de persister la capsule ; un résultat calculé peut alors rester inaccessible depuis la base.
- [ ] Concevoir une récupération facultative après perte de la clé IndexedDB ou changement de navigateur. En l’état, seul le modèle déjà exporté est conservable ailleurs sans cette clé locale.
- [ ] Compléter les alertes et estimations d’hébergement décrites au point 13.

## P09 — Déplacer les entraînements habituels sur VPS

Ce chantier est différé après la première livraison Phala. Le VPS héberge déjà les reapers, pas le runner d’entraînement.

- [ ] Déployer un vrai service runner VPS séparé du reaper.
- [ ] Ajouter une destination VPS explicite et un transport HTTPS authentifié distinct de la RA-TLS Phala.
- [ ] Prévoir identité, clés, provenance et stockage persistants propres au VPS.
- [ ] Fixer les limites CPU/RAM/temps et les quotas ; vérifier sauvegarde/restauration.
- [ ] Adapter la configuration applicative et inventorier les liaisons de contrats/datasets avant la bascule.
- [ ] Tester un entraînement complet, la livraison du modèle et la reprise après redémarrage.
- [ ] Afficher honnêtement les garanties du calcul VPS ; ne jamais présenter ce parcours comme exécuté en enclave Phala.

## Retrait automatique des crédits d’escrow (worker VPS)

Implémenté et testé localement le 26 septembre, désactivé par défaut. Procédure : [DEPLOYMENT.md](DEPLOYMENT.md#retrait-automatique-des-crédits-descrow-worker-vps).

- [x] Publier le code : image worker et Compose. Publiés sur staging le 26 septembre (`c98f70b`) ; relayeur inactif.
- [ ] Décider le seuil minimal et le plafond de gas quotidien. Aucune valeur n’est approuvée.
- [ ] Générer une clé dédiée par worker directement dans `.env.vps`, puis la financer en ETH du réseau visé.
- [ ] Activer, vérifier le journal de démarrage et un premier retrait réel. Le bouton manuel doit rester fonctionnel.
- [ ] Mesurer le coût réel par retrait et le reporter dans le business plan.

## Suites produit différées

- [ ] Uploads plus volumineux et reprise d’envoi.
- [ ] Entraînement asynchrone.
- [ ] Modèles à arbres.
- [ ] Pilote réel de data lending avec des données externes.
- [ ] Reprendre ensuite la checklist mainnet : audit externe corrigé, KYB réel, trésorerie/commission, plafonds, monitoring et procédures d’incident.

La démonstration de self-train ne clôt ni le pilote de data lending ni les portes mainnet. Les obligations historiques restent documentées dans leurs runbooks ; elles ne réactivent pas la remise à zéro de staging ou une fermeture Phala programmée.
