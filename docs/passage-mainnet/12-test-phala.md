# Démo « Test Phala »

Fichiers : `src/app/(app)/phala/page.tsx`, `src/components/phala-demo/*`, `src/lib/phala-demo/*`, `scripts/operations/demo-controller.ts`.

## Ce qu'on a dit

- On la garde, désactivable quand on veut comme aujourd'hui.
- Améliorer l'expérience et les statistiques d'entraînement, selon ce que Phala peut fournir.
- Un certificat pour chaque entraînement, avec la preuve de calcul Phala.

## Rappels

- La démo tourne **sur le testnet uniquement**. Le code refuse de la démarrer sur mainnet. Elle reste donc sur staging après le lancement.
- Elle est ouverte et fermée par le contrôleur, avec un coût d'environ 0,06 dollar de l'heure quand la machine tourne.
- Une session orpheline ne bloque plus la réouverture depuis la correction M7 du 2 octobre. Elle prend effet au prochain déploiement de l'image de démo.
- Tant que Phala n'a pas répondu, on reste factuel dans la communication : « runs on Phala Cloud ».

## Avant le 6 — P2

Rien d'obligatoire. La démo n'est pas sur le chemin du mainnet.

- Si un créneau de démo est ouvert pour l'annonce, redéployer d'abord l'image de démo à jour, pour embarquer la correction M7.

### Ce qui a été fait le 4 octobre

- **Session publique** de 16h à minuit sur `demo.sirius-data.tech`, annoncée sur X. Fermeture automatique par une minuterie systemd sur le VPS, machine arrêtée ensuite.
- **Adresse démo isolée** (PR #51) : `demo.sirius-data.tech` est attachée à **un déploiement figé** du projet Vercel staging (`vercel alias set`, pas un domaine du projet), donc les fusions dans staging ne la déplacent pas. Sur cette adresse, seules `/phala`, `/terms` et les routes API de la session sont servies ; le reste renvoie vers `/phala` ou répond 404.
- **Connexion** : MetaMask demande désormais le compte avant le réseau (PR #52) ; la page démo propose le menu de choix du wallet (PR #54, #55).
- **RTMR3 change à chaque redémarrage de la machine** (3 octobre `cb0402c9…`, 4 octobre `7388e541…`) alors que MRTD, compose hash, journal d'événements et TCB restent identiques. Chaque ouverture après un arrêt demande de ré-épingler `SIRIUS_EXPECTED_RTMR3` dans `phala-demo-controller.env`, `runner-monitor.env` et Vercel staging, puis de redéployer et de replacer l'adresse démo. L'outil d'Ali bloque Claude sur ce ré-épinglage : Ali le fait. **Décision du 5 octobre (Ali) : ne plus vérifier RTMR3.** Appliquée par la PR #72 (`fix/audit-a-01`) : `SIRIUS_EXPECTED_RTMR3` n'est plus lu ni exigé ; l'identité du code repose sur MRTD, le compose hash et le journal d'événements rejoué vers le RTMR3 de la quote. Plus de ré-épinglage ni de redéploiement après un redémarrage de la machine.

### Machine de démo séparée — reportée après le passage mainnet

Staging et la démo partagent la même machine (`app_8e14…`) et la même base. Une machine dédiée à la démo est une **nouvelle identité d'enclave** : nouvelle clé maîtresse, clé d'ingestion et clé de règlement à épingler, contrats testnet liés à la clé de règlement de la machine actuelle, fichiers privés du runner et accès au registre d'images à refaire, nouveau projet Vercel. Chiffrage : 4 à 6 heures avec des risques de blocage. **Décision du 5 octobre : après le lancement**, en réutilisant la procédure de création de la machine de production. La branche Neon `demo` (`br-silent-mountain-ayiozi18`, copie de Staging) est déjà créée.

### Sessions du 5 octobre

10h–13h et 18h–22h (heure de Paris). Fermetures automatiques à 13h et 22h. Avant chaque ouverture : démarrage de la machine, ré-épinglage de RTMR3 par Ali, redéploiement et ouverture (ré-épinglage et redéploiement inutiles une fois la PR #72 (`fix/audit-a-01`) déployée sur staging).

## Après le 6 — V1.2

### Statistiques

Ce que l'enclave et Phala peuvent fournir sans rien exposer de la donnée :

- durée d'entraînement mesurée dans l'enclave ;
- métriques du modèle : R² ou exactitude ;
- mesures de la machine (MRTD, RTMR3, hash de composition), horodatage et état du TCB de la quote ;
- nombre d'entraînements de la session, places restantes.

Les afficher pendant et après l'entraînement, avec une courte explication de chaque ligne.

### Certificat

Même page de certificat que pour les emprunts ([09](09-train-et-certificat.md)), adaptée au self training de la démo : pas de règlement on-chain, mais la quote et le hash du résultat.

### Expérience

- Un parcours guidé en trois étapes : choisir un fichier d'exemple ou le sien, entraîner, voir le modèle et son certificat.
- Un état clair quand la démo est fermée : prochaine ouverture si elle est prévue, sinon contact.

## Terminé quand

- La démo s'ouvre et se ferme comme aujourd'hui.
- Après : statistiques et certificat visibles pour chaque entraînement de démo.
