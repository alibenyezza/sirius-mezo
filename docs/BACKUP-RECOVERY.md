# Sauvegardes et exercice de reprise — 23 septembre 2026

## Résultat vérifié

Le paquet `.ops/recovery-transfer-20260923/recovery.aesgcm` regroupe la sauvegarde PostgreSQL et les 13 blobs de modèles sous chiffrement authentifié. Il contient **110 621 octets**, sans clé de sauvegarde embarquée. Empreinte SHA-256 :

```text
23c476a0520fbe46d905be261a1c89272b7f03e6e2a16712dc4f3e23e5fc83f5
```

Le paquet a été relu, déballé dans un nouveau dossier privé, puis restauré dans PostgreSQL 18 local sans réseau. Les 10 tables sont identiques au snapshot du 23 septembre à 12:52:55 UTC ; les deux migrations en attente préservent toutes les valeurs historiques. Dernière vérification à **14:11:46 UTC**. Les conteneurs temporaires ont été supprimés. Aucun accès à la base distante ni démarrage Phala n'a été nécessaire pendant cet exercice.

Ali conserve pour l'instant la sauvegarde **en local** ; la copie hors machine est différée. La clé reste dans `~/.local/share/sirius/backup-keys/`, séparée du paquet mais sur le même Mac : cette disposition ne couvre pas la perte du Mac. GitHub conserve le code, pas `.ops/`, les secrets ni la base. Ce paquet contient le snapshot existant, pas les modifications ultérieures de la base ni les clés de modèles récupérées ensuite.

## Reproduire la récupération

L'outil utilise les primitives Node standard ; aucune dépendance PostgreSQL n'est nécessaire pour vérifier ou déballer le paquet. Les fichiers d'entrée sont privés (`0600`) et les dossiers de sortie privés (`0700`). Le dossier d'extraction doit être absent ; aucun fichier existant n'est remplacé. La vérification exige tous les modèles référencés par le dump et contrôle leurs empreintes.

```bash
pnpm ops:recovery-pack pack /snapshot /snapshot/models /cle-separee/snapshot.key /dossier-prive/recovery.aesgcm
pnpm ops:recovery-pack verify /dossier-prive/recovery.aesgcm /cle-separee/snapshot.key
pnpm ops:recovery-pack unpack /dossier-prive/recovery.aesgcm /cle-separee/snapshot.key /nouveau-dossier-prive
pnpm ops:postgres verify /nouveau-dossier-prive /cle-separee/snapshot.key
```

Après transfert, comparer l'empreinte du fichier reçu puis authentifier et déballer une copie avec la clé conservée séparément. Conserver également une version des outils permettant cette lecture. L'outil PostgreSQL restaure exclusivement dans un conteneur local jetable ; il n'offre pas de restauration vers une URL distante.

## Modèles historiques : état précis

Les 13 fichiers chiffrés correspondent à **5 prêts réglés et 8 entraînements terminés**, appartenant à **6 wallets**. L'inventaire vérifie les identifiants, bénéficiaires, CID et conditions enregistrées dans le snapshot :

- 7 reçus ont des métadonnées et un profil cohérents avec la base.
- 6 anciens reçus d'entraînement v2 ne contiennent pas de profil. Les identifiants, propriétaire et CID correspondent ; leur profil ne devient pas attesté rétroactivement.
- Les signatures HMAC, le règlement on-chain et le déchiffrement ne sont pas certifiés par cet inventaire. Il ne constitue pas une autorisation de livraison.

Le rapport privé détaillé se trouve dans `.ops/recovery-transfer-20260923/restored/historical-delivery-*.json`. Il indique les wallets et modèles concernés sans conserver les jetons des reçus. La clé maître de l'ancien runner n'est pas disponible dans les fichiers d'environnement locaux vérifiés ; cette absence ne prouve pas sa perte dans l'instance historique.

### Livraison réellement vérifiée

Le **23 septembre à 14:40:34 UTC**, les deux entraînements du wallet local retenu par Ali ont été récupérés via l'instance historique `https://sirius-data.tech` : connexion signée, grant limité à la livraison, enveloppe de clé déchiffrée, empreinte du blob identique à la sauvegarde et modèle ouvert sous AES-GCM. Aucun entraînement ni transaction on-chain n'a été lancé ; aucune master key n'a été exportée. Ce contrôle de l'instance historique ne constitue pas une validation Phala/RA-TLS.

Le premier essai a révélé un défaut de compatibilité : le format historique linéaire ne contient ni `version` ni `mae`, et le lecteur les exigeait. Le lecteur de téléchargements accepte maintenant ce format exact, conserve ces absences et affiche `—` pour les champs manquants. La validation des nouvelles sorties runner reste stricte. Ce correctif est local, non déployé.

Les deux clés sont sauvegardées dans `.ops/model-delivery-verified-20260923/training-*.aesgcm`, avec la même clé de sauvegarde séparée. Les archives de clés et les blobs restaurés ont permis de rouvrir les deux modèles **hors ligne à 14:42:01 UTC**, sans wallet ni ancienne instance. Conserver ce dossier en plus du paquet `recovery.aesgcm`, qui ne contient pas ces nouvelles archives. Les rapports `report.json` et `offline-restore.json` consignent les vérifications ; aucun modèle ni clé n'est enregistré en clair.

| Périmètre | État |
|---|---|
| 2 entraînements du wallet local | Livraison, déchiffrement et restauration hors ligne vérifiés ; clés sauvegardées chiffrées |
| 11 modèles des 5 autres wallets | Anciens wallets de test devenus inaccessibles, confirmé par Ali ; blobs et métadonnées conservés, livraison non vérifiée |

La récupération complète des 13 modèles n'est donc pas revendiquée. Conserver l'ancienne instance et ses clés pendant la préparation ; ne pas contourner les contrôles de propriétaire, demander les clés privées dans une conversation ni importer la master key historique dans Phala.

### Reproduire la livraison autorisée

```bash
pnpm ops:verify-model-delivery https://sirius-data.tech /env-prive /inventaire.json /snapshot-restaure /snapshot-restaure/models/manifest.json /cle-separee/snapshot.key /nouveau-dossier-prive
```

Le fichier d'environnement explicite fournit `MEZO_DEPLOYER_KEY`. Depuis la réservation du self training à l'équipe ([10-self-training](passage-mainnet/10-self-training.md)), l'adresse dérivée de cette clé doit figurer dans `SIRIUS_ADMIN_ADDRESSES` de l'instance interrogée, sinon il s'arrête sans message lisible : exit 1, un diagnostic JSON sur stderr (`phase` « historique-proprietaire » ou « livraison-cle », `verified: false` ; le `httpStatus` de ce JSON peut refléter la déconnexion finale), et `failurePhase` + `httpStatus: 403` dans `report.json` : dès `GET /api/train` sur une instance hors démo, ou sur `POST /api/train/[id]/key` sur l'instance de démo Phala, où la liste reste ouverte. Seuls les modèles d'entraînement de l'inventaire passent par ces routes ; les prêts passent par `/api/loans`, non concerné. L'outil sélectionne uniquement les modèles de ce compte, vérifie le domaine, le réseau testnet et la session du challenge avant signature, puis demande uniquement les clés des modèles terminés. Il contrôle le CID contre le snapshot et le blob contre son empreinte sauvegardée. Le dossier de sortie doit être absent. La connexion consomme les challenges et grants habituels, sans modifier prêts, entraînements ou contrats. En cas de format non reconnu, le diagnostic contenant la clé et le blob reste lui-même chiffré ; aucun secret n'est imprimé.

## Registre runner après arrêt brutal

Deux tests utilisent un vrai processus enfant, le registre SQLite et un arrêt `SIGKILL`, puis une sauvegarde cohérente et une restauration dans un autre fichier. La source est supprimée pour la vérification ; tous les identifiants, clés et budgets sont synthétiques.

| Coupure | Résultat vérifié après restauration |
|---|---|
| Avant checkpoint du résultat | Réservation et coût conservés ; mesure et résultat absents ; aucun recalcul automatique |
| Après checkpoint et journalisation de la transaction | Résultat récupéré sans calcul, budget identique, même nonce et hash, journal chiffré lisible avec la même clé uniquement |
| Transaction toujours sans reçu | Délai entre reprises conservé, trois envois identiques au maximum, nouvelle intention refusée tant que l'incertitude subsiste |

Aucun envoi RPC n'est effectué par ces nouveaux tests. Les contrôles de reçus canoniques et le scénario EVM de règlement restent couverts par les suites existantes. Cet exercice ne valide pas une restauration du disque réel de Phala, une perte matérielle, une sauvegarde ancienne ni la finalité du réseau cible.

### Procédure en cas d'incident réel

1. Suspendre les nouvelles admissions et arrêter tous les écrivains du registre ; conserver les fichiers et journaux d'origine.
2. Vérifier la date de sauvegarde, la même identité runner et l'ensemble des engagements intervenus depuis cette copie. Une date inconnue ou des opérations non réconciliées interdit la remise en service.
3. Préparer la restauration dans un nouveau dossier privé, avec la même politique et l'accès à la même clé. Ne jamais initialiser un registre vide ni modifier les compteurs pour récupérer de la marge.
4. Exécuter `runner:budget inspect`, puis `runner:transactions reconcile` avec le bon réseau. Une transaction signée peut seulement être rediffusée dans la limite de son journal ; une intention ancienne ou toujours inconnue reste bloquée. Un calcul interrompu sans mesure ne devient pas un frais facturable.
5. Comparer les engagements restaurés à la chaîne et aux coûts engagés, puis vérifier les récupérations de modèles avant réouverture. La restauration du registre anti-rejeu doit préserver les grants consommés ; ne pas remettre ce répertoire à zéro.

Les [commandes de reprise](RECOVERY-OPERATIONS.md) détaillent les contrôles. Le remboursement contractuel à échéance et les retraits restent indépendants du runner. L'existence d'une sauvegarde ne prouve pas qu'elle est la plus récente et ne permet pas de dupliquer un budget sur deux machines.

## Validation de cette passe

- **308 tests applicatifs** réussis, dont les arrêts brutaux, la compatibilité historique, l'évaluation et le refus des formats altérés.
- **15 tests des outils d'exploitation** réussis : archives, paquet complet, inventaire historique, portée des signatures de livraison, coûts, configurations et superviseur.
- Typage applicatif, lint et build local réussis ; aucun déploiement distant déclenché.
- Phala n'a pas été démarré ; aucune transaction, rotation PostgreSQL ou commande Git exécutée.

Cette étape couvre les deux modèles dont le wallet est disponible. Les onze anciens modèles de test restent conservés sans accès vérifié et la copie hors machine est différée. La préparation des tarifs et plafonds fournisseurs constitue l'étape suivante ; tout essai Phala reste soumis à une décision explicite de Ali.
