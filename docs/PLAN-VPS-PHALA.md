# Testnet sur VPS et espace Phala — plan actualisé le 26 septembre 2026

## Objectif et périmètre

**Priorité validée : proposer rapidement des sessions publiques de démonstration Phala, activées et désactivées manuellement par les opérateurs autorisés et financées par Sirius.** Les deux heures évoquées étaient un ordre de grandeur, pas une durée imposée. Les visiteurs choisissent un dataset fourni sur le site ou importent leur propre CSV, entraînent un modèle et récupèrent leur résultat. L’objectif est de profiter de l’attention actuelle portée à Phala avec une fonctionnalité utilisable. Ce plan ne vérifie ni ne reprend de chiffre de performance de son token.

Conserver Sirius sur Mezo testnet pour les essais courants et prévoir leur déplacement sur le VPS. Pour accélérer la page Phala, proposer de réaliser ce déplacement après sa première version : le runner VPS ne doit pas devenir une dépendance du lancement Phala. Le réseau reste le testnet dans les deux parcours ; choisir Phala ne nécessite pas de passer mainnet.

Le changement de direction et le développement sont validés. Ce plan remplace le projet de bascule globale de staging vers Phala. Le [journal d’implémentation et de reprise](PHALA-DEMO-IMPLEMENTATION.md) distingue chaque modification locale de son activation distante. La décision D-25 actualise D-21 en conservant les garanties strictes du parcours Phala. Le [runbook](PHALA-DEMO-RUNBOOK.md) décrit la configuration et les portes de publication. La [checklist complète du reste à faire](PHALA-DEMO-RESTE-A-FAIRE.md) fait référence pour la suite ; aucune tâche n’est attribuée nominativement.

Les choix produit sont maintenant précisés : **self-train, exemples fournis, financement par Sirius et ouverture/fermeture manuelles réservées aux opérateurs autorisés**. Le financement doit accepter les crédits Phala disponibles ou une enveloppe payée par Sirius. Aucun paiement utilisateur n’est prévu pour cette démonstration. Cette décision autorise à concevoir un financement par crédits pour les testeurs extérieurs pendant ces sessions ; elle remplace la restriction antérieure aux deux wallets internes pour ce seul usage. Les clients commerciaux permanents restent hors de ce périmètre.

Le financement et les limites d’admission sont renseignés avant l’ouverture ; un horaire de fermeture n’est pas obligatoire. L’autorisation de développement ne démarre pas la CVM et ne choisit pas implicitement une dépense.

## État de départ sur lequel repose le plan

Cette section décrit la situation avant P01–P07. Le financement sponsorisé, les exemples et la livraison après arrêt ont depuis été implémentés et testés localement ; leur validation distante reste à faire. La checklist et le journal font référence pour l’état actuel.

- Les nouveaux reapers staging et production sont hébergés sur le VPS. Ce ne sont pas des services d’entraînement. Le Compose VPS ne déclare actuellement que le reaper.
- Le client appelle un runner distant lorsque `RUNNER_URL` est renseignée ; sinon il exécute le handler dans le processus Next. Le transfert des reapers n’a pas déplacé le calcul de Next vers le VPS.
- Le code sélectionne un seul runner par instance applicative. Les règles actuelles refusent un runner distant VPS en mode production ; tout HTTPS est traité comme RA-TLS. Un runner VPS demande donc une implémentation explicite, pas seulement une nouvelle URL.
- Le parcours self-train existe. Il contrôle le propriétaire, le KYB et le titre EVM du dataset ; il ne crée pas de prêt. Il faut réutiliser ce parcours et ajouter un financement explicite de démonstration par Sirius, sans assimiler des crédits ou apports à une marge acquise ni supposer que l’escrow de prêt facture déjà le self-train.
- Deux modèles tabulaires existent : régression linéaire et logistique. Le calcul reste court et borné. Changer d’hébergeur n’ajoute ni algorithme, ni traitement asynchrone, ni capacité pour de gros fichiers.
- Des CSV de démonstration existent déjà dans `public/examples/regression/` et `public/examples/classification/`, ainsi qu’un générateur dans `scripts/generate-example-datasets.mjs`. Sélectionner deux exemples, réutiliser leurs données et vérifier leur compatibilité avec la session Phala ; les datasets ne sont pas à créer de zéro.
- La livraison de clé du self-train passe actuellement par `POST /api/train/[id]/key`, qui appelle le runner. Le nouveau téléchargement après arrêt exige donc une adaptation effective, pas seulement un changement d’interface.
- Le runner Phala, ses mesures et sa stabilité après redémarrage ont été vérifiés. La CVM est arrêtée ; le parcours navigateur complet et la reprise réelle restent à valider.
- Le watchdog extérieur sait demander l’arrêt de la CVM à une échéance persistante. Ce timer reste désactivé pour le nouveau fonctionnement manuel demandé ; la supervision collecte l’état et alerte sans programmer d’ouverture ou de fermeture. Le mode de crédits existant impose un domaine staging et jusqu’à dix wallets internes : le transformer en démonstration publique avec quotas demande un mode explicite et des tests, pas simplement une liste de wallets vide.
- Des variables Phala/v7 sont déjà préparées dans Vercel staging et GitHub. Avant un prochain déploiement complet, les réconcilier avec la nouvelle cible afin de ne pas activer involontairement l’ancien plan.

Références : [runner applicatif](../src/lib/runner/config.ts), [transport](../src/lib/tee/runner-client.ts), [Compose VPS](../deploy/vps/compose.yaml), [self-train](../src/lib/sirius/self-train.ts), [lot B](PHALA-V7-STAGING.md).

## Avis et architecture recommandée

Un parcours court et réellement exécuté dans Phala peut convertir l’attention en essais du produit. Le message de lancement doit décrire exactement ce qui fonctionne : modèles tabulaires proposés, tailles acceptées, attestation et conditions d’accès. Il ne faut pas annoncer un partenariat Phala sans accord ni présenter cette première version comme une plateforme de fine-tuning de LLM. L’intérêt pour le token n’établit pas la demande pour Sirius ; mesurer les uploads et entraînements terminés par des personnes extérieures.

L’architecture complète ajoute un service à exploiter et ne valide pas à elle seule le marché du data lending : une personne qui entraîne sur son fichier ne prouve pas encore qu’un tiers achètera l’accès à des données. La première livraison doit donc rester centrée sur Phala/self-train.

Conserver Next.js, Prisma/PostgreSQL, les modèles actuels et les composants existants. Déployer le même code applicatif avec deux configurations indépendantes ; ne pas créer deux copies du dépôt.

| Parcours | Présentation | Calcul | Identité et stockage |
|---|---|---|---|
| Sirius testnet | Entraînement de démonstration ; opérateur du serveur susceptible d’accéder aux données en clair | Service runner dédié sur VPS, HTTPS authentifié | Identité VPS, clés propres, base et volumes de démonstration |
| Espace Phala | Entraînement confidentiel, disponibilité et preuve d’attestation visibles | CVM Phala, RA-TLS vérifiée | Identité Phala, base dédiée, clés conservées dans l’enclave |

Une entrée **« Entraînement confidentiel »** sur le site mène à la page Phala. Pour le MVP, recommander un sous-domaine du même site, par exemple `confidential.sirius-data.tech`, servi par une instance séparée du même code. Son URL exacte reste proposée. Cela conserve une seule identité runner par application et les contrôles de session/origine existants. La page de présentation est à `/phala` sur le site principal ; le parcours dédié est à `/phala` et l’accès opérateur à `/operator`, liée nulle part et protégée par wallet, signature et code d’accès.

Exiger absolument toute l’application sous un même domaine et un simple chemin est possible, mais ajoute le routage des API, les cookies, les signatures d’origine et la sélection du runner par requête. Ce travail n’est pas inclus dans l’estimation du MVP proposé.

Les bases peuvent appartenir au même projet Neon, mais doivent avoir des accès séparés. Préférer une base Phala neuve : elle évite de vider la base de démonstration et n’est pas accessible aux anciens reapers. Garder les historiques existants en lecture/livraison sur leur environnement. Aucune conversion automatique d’un dataset VPS en dataset Phala : son propriétaire le redépose avec le chiffrement destiné à Phala.

Les autorisations, reçus, résultats et livraisons restent liés à la destination choisie dès le dépôt. Un arrêt Phala provoque un refus ou une attente explicitement annoncée ; il ne déclenche jamais un calcul sur VPS. TLS classique pour le VPS et RA-TLS pour Phala doivent rester distincts. Ne pas utiliser `NODE_ENV=development`, un simulateur ou une fausse attestation pour faire démarrer le service VPS.

## Parcours de la première page Phala

1. Présenter les modèles disponibles, limites mesurées et état de la session : ouverte, fermée, capacité momentanément atteinte ou service indisponible. Aucun compte à rebours de fermeture n’est imposé. Pour le visiteur, l’entraînement est offert par Sirius lorsque la session est ouverte.
2. Connecter le wallet testnet et vérifier la session et les quotas avant toute opération consommatrice. Conserver les contrôles KYB et les signatures nécessaires au parcours existant ; indiquer les étapes de financement testnet encore requises.
3. Choisir un dataset prêt à entraîner ou importer son CSV. Pour les exemples, présélectionner colonne cible et modèle ; l’import personnel garde ces choix explicites. Garder le dataset de travail privé, hors marketplace par défaut.
4. Chiffrer le fichier dans le navigateur pour la clé d’ingestion Phala vérifiée ; Next ne reçoit que l’enveloppe chiffrée si le transport actuel est réutilisé. Les gros uploads directs et leur reprise restent un lot ultérieur.
5. Enregistrer le titre EVM privé nécessaire au self-train, réserver un budget financé, entraîner puis afficher métriques et preuve du runner.
6. Récupérer le modèle chiffré et sa clé réservée au propriétaire. Documenter la conservation et la suppression sans promettre l’effacement de toutes les copies de sauvegarde.

Le prêt d’un dataset tiers, son devis et son escrow ne font pas partie de cette première page. Les dépendances actuelles du self-train au KYB testnet et au titre EVM restent à conserver et à expliquer dans les étapes wallet ; les supprimer serait un autre chantier. Les contrats actuels ont un signataire immuable ; si une nouvelle identité est nécessaire, vérifier leurs liaisons avant de réutiliser les contrats déployés. Ne pas partager la clé de Phala avec le VPS.

Sélectionner parmi les exemples existants deux petits datasets synthétiques et déterministes, un pour la régression et un pour la classification binaire. Les tester avec les profils exacts du runner ; donner une description et des métriques attendues sous forme de fourchettes. Le bouton « Utiliser cet exemple » charge le CSV dans le navigateur puis suit le même chiffrement et le même entraînement Phala qu’un import personnel. Chaque visiteur obtient son propre résultat ; la page ne substitue pas un modèle précalculé à l’exécution annoncée. Les exemples restent téléchargeables.

Afficher les limites avant le dépôt, refuser un calcul hors quota avant de consommer des ressources et restituer un résultat utilisable avec métriques et preuve. La limite existante de calcul court reste en place pour cette livraison.

## Activation et désactivation manuelles

Prévoir un écran opérateur réservé aux opérateurs autorisés avec authentification et autorisations vérifiées côté serveur. Les clés d’administration Phala restent sur le superviseur extérieur ; elles ne sont jamais envoyées au navigateur ni publiées dans les variables frontend.

| Commande | Comportement attendu |
|---|---|
| Préparer une session | Renseigner source de financement, limites d’admission et quotas ; vérifier ressources et supervision avant ouverture, sans fermeture programmée |
| Activer | Sur action d’un opérateur autorisé seulement, demander le démarrage de la CVM si nécessaire ; ouvrir l’accès après attestation et contrôles réussis, puis enregistrer l’heure d’ouverture |
| Désactiver | Sur action d’un opérateur autorisé seulement, refuser les nouvelles admissions, afficher « Session fermée », terminer les travaux déjà admis dans leurs limites puis demander l’arrêt de la CVM ; cette séquence fait partie de la commande manuelle |
| Arrêt d’urgence | Fermer les admissions, demander l’interruption des travaux et l’arrêt de la CVM ; afficher l’état réel et alerter si l’arrêt n’est pas confirmé |

La fermeture est une configuration persistante lue à l’exécution, avec contrôle de concurrence ; elle ne dépend pas d’une variable `NEXT_PUBLIC_*`, d’un redéploiement Vercel ou du seul masquage d’un bouton. Une page déjà ouverte et un appel direct aux API doivent respecter la fermeture.

L’API et le runner vérifient session, destination, expiration des autorisations et réservations avant le scellement et avant le calcul. Les autorisations sont courtes, liées à la session et à sa version ; une révocation invalide les nouvelles admissions. Si l’état de session est illisible ou périmé, refuser le démarrage. Un calcul déjà admis peut continuer après une fermeture normale, dans sa limite ; seul l’arrêt d’urgence demande son interruption. Mesurer et afficher le délai réel de prise en compte des commandes, sans promettre une coupure instantanée du fournisseur.

Il n’existe ni durée maximale de session imposée, ni fermeture après deux heures, ni ouverture planifiée. Une visite ou un clic utilisateur ne démarre jamais la CVM. Après panne ou redémarrage, conserver l’état persistant ; si la CVM est arrêtée, ne pas la redémarrer automatiquement pour servir une demande. Les limites de durée propres à chaque calcul restent applicables.

Le dépassement d’un quota, un budget insuffisant ou une attestation invalide refusent les nouvelles opérations concernées sans changer la décision opérateur d’ouverture et sans arrêter automatiquement la CVM. Afficher séparément l’état de la session et la disponibilité effective du calcul. Les alertes de consommation et de disponibilité informent les opérateurs, qui décident de fermer, d’arrêter ou de réapprovisionner.

Persister avant arrêt le modèle et une enveloppe de livraison chiffrée pour le propriétaire afin qu’un résultat terminé reste téléchargeable après fermeture, sans redémarrer Phala ni stocker une clé en clair dans Next. Ce comportement est maintenant implémenté et testé localement via une capsule persistée et IndexedDB ; le parcours réel sur Phala reste à valider. La route historique de récupération de clé sollicite toujours le runner. Vérifier aussi la conservation côté utilisateur de la clé privée de livraison, notamment après rechargement ; une enveloppe chiffrée seule ne garantit pas une récupération depuis un autre navigateur. L’arrêt de la CVM ne doit pas rendre les résultats déjà annoncés comme terminés inutilisables.

Garder la page publique avec un état « Démonstration fermée » est recommandé ; son lien dans la navigation peut être masqué séparément. La fermeture de l’accès au calcul constitue le vrai contrôle. La réactivation est une action opérateur explicite, avec nouvelle vérification du budget ; aucune remise à zéro du registre global. Les commandes et leur état sont persistés pour que la désactivation continue même si l’opérateur ferme son navigateur.

## Financement de Phala

Les USDC testnet ne paient pas la facture réelle de Phala. Son offre CPU facture la machine pendant son fonctionnement, même entre deux entraînements ; le disque reste facturé quand elle est arrêtée. Voir la [tarification officielle](https://cloud.phala.com/about/pricing).

Les essais publics sont sponsorisés par Sirius. Prévoir un mode de financement de démonstration propre à ce testnet, qui conserve les réservations persistantes et la séparation comptable avec les recettes commerciales. La politique stricte existante ne doit pas être rendue globalement permissive pour permettre cette démonstration.

| Mode proposé | Autorisation de financement |
|---|---|
| Crédits Phala uniquement | Utiliser une enveloppe bornée par les crédits utilisables vérifiés et une réserve d’exploitation ; bloquer si ce financement ne peut plus être établi |
| Budget Sirius | Utiliser un montant réellement disponible et explicitement affecté à la session, même en l’absence de crédits |
| Crédits + budget Sirius | Autoriser aussi un complément payé plafonné ; l’épuisement des crédits n’autorise jamais un dépassement du complément configuré |

Le mode ne constitue pas une commande de sélection du solde chez Phala : le fournisseur applique ses propres règles de prélèvement. Vérifier son relevé de crédits réellement utilisables et son mode de facturation, puis rapprocher les dépenses. Ne pas présenter une limite logicielle comme un plafond fournisseur garanti. Le passage d’un financement par crédits à un complément payé doit être autorisé dans la configuration de la session, pas déclenché implicitement.

L’estimation et le suivi couvrent la disponibilité de la machine pendant toute la session, préparation, stockage, calcul et réserve d’arrêt ; le gas testnet est suivi séparément. Ne pas budgéter uniquement la durée du code d’entraînement. Sans arrêt automatique, un plafond d’admission n’empêche pas les frais d’une CVM laissée allumée : afficher le temps écoulé, le coût estimé et les alertes à l’opérateur. Relever aussi les charges résiduelles du disque conservé après fermeture.

Prévoir une limite globale d’entraînements, une limite par compte et une concurrence initiale d’un calcul ; valeurs ajustables avant ouverture. À saturation, indiquer « Réessayez dans un instant » plutôt que construire une file asynchrone pour ce MVP. Protéger aussi ingestion et endpoints coûteux : wallet/IP seuls ne suffisent pas, le plafond global financé reste obligatoire. Journaliser les ouvertures, fermetures et consommations ; une nouvelle session ne recrée pas des crédits déjà engagés.

## Lots, dépendances et portes de sortie

Les tâches sont organisées par périmètre, sans attribution nominative. Les lots 1 et 2 sont implémentés localement ; l’exploitation distante, la finition et la répétition restent à terminer selon la checklist. Le journal distingue les preuves locales des preuves distantes.

| Lot | Travail | Porte de sortie |
|---|---|---|
| 0 — Configuration de la première livraison | Origines et accès opérateurs, base/configuration dédiées, réconciliation Vercel/GitHub, financement et quotas | Aucune confusion entre les environnements ; enveloppe affectée et accès prêts |
| 1 — Page et datasets | Finaliser les libellés, étapes wallet, limites et messages ; valider les exemples et l’import sur les vrais services | Parcours utilisateur complet et résultat récupérable après fermeture |
| 2 — Sessions et Phala | Publier l’image, installer le contrôleur HTTPS, initialiser les volumes dédiés, vérifier l’attestation et les budgets, préparer la supervision et la reprise | Self-train réel terminé, commandes opérateur effectives et dépenses suivies |
| 3 — Répétition puis session publique | Tester fermeture normale/urgence, refus visiteur, réouverture, concurrence, budget insuffisant et livraison après arrêt | Seuls les opérateurs autorisés ouvrent et ferment ; parcours reproductible par un visiteur |
| 4 — Runner VPS, après la première livraison Phala | Destination VPS explicite, HTTPS authentifié, provenance, persistance, limites de ressources et isolation du reaper | Un entraînement est réellement exécuté sur le VPS, sans prétendre être une exécution Phala |

Les finitions d’interface et la préparation de l’infrastructure peuvent avancer en parallèle après accord sur les formats API. La répétition dépend des deux. Le runner VPS reste un lot distinct, pas une condition de lancement de la page Phala.

Pour éviter les conflits : annoncer dans chaque ticket les fichiers concernés, coordonner les migrations et les modifications de `src/lib/runner/*`, `src/lib/tee/runner-client.ts`, `src/runner/*`, `deploy/*`, de la pipeline et du manifeste. Préserver les changements concurrents. Préparer des PR distinctes pour les périmètres indépendants ; aucune fusion implicite vers les branches de déploiement.

## Charge indicative et suites

Les estimations ci-dessous sont celles du cadrage initial, pas une nouvelle estimation du travail restant après P01–P07. Réévaluer P08 selon les accès disponibles et les résultats des essais réels.

Pour deux développeurs, conserver **trois à cinq jours de travail comme cible provisoire**, en réutilisant le self-train, l’accès opérateur Phala et les deux modèles existants. Le contrôle manuel des sessions à chaud et la livraison après arrêt sont maintenant explicitement dans le MVP ; confirmer cette estimation après inventaire de ces deux points. Une nouvelle CVM/identité ou un défaut lors du test réel peut l’allonger. La date d’ouverture dépend d’un vrai entraînement terminé et récupéré, ainsi que d’une désactivation vérifiée.

Le plan complet incluant ensuite le runner VPS reste de l’ordre de **deux à trois semaines**, à affiner après ce premier parcours. Aucun calendrier d’ouverture n’est garanti par la seule disponibilité de l’interface.

Après preuve du parcours : upload direct plus volumineux, entraînement asynchrone, modèles à arbres et ouverture à davantage d’utilisateurs. Ces capacités restent nécessaires pour dépasser la démonstration actuelle. Le pilote de data lending et la checklist mainnet sont différés ; ils ne sont pas validés par le seul self-train.

Le développement est lancé et suivi dans le journal avant/après. Aucun démarrage Phala, nettoyage Neon, publication ou commande Git ne découle de la rédaction de ce plan.
