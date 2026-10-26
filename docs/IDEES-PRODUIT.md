# Idées produit — après le mainnet (8 octobre 2026)

Notes de discussion entre Ali et Claude, à trier avec Ali. Rien ici n'est décidé ni chiffré précisément : les
durées sont des ordres de grandeur, les coûts (Phala, stockage, cartes graphiques) restent à mesurer avant tout
engagement. Point de départ : aujourd'hui Sirius ne loue que des **CSV** et n'entraîne que des **régressions
linéaire et logistique**, dans une CVM Phala (Intel TDX) sur processeur.

Ce qui rend Sirius unique, et doit guider le choix : **calculer sur des données que personne ne voit** (enclave
attestée) **et payer automatiquement on-chain** (escrow MUSD, release à la livraison).

## 1. Le waouh : ce que seul Sirius peut faire

| # | Idée | Waouh | Attire du monde | Faisabilité |
|---|---|---|---|---|
| 1.1 | Kaggle inversé : les données entrent en compétition | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ fournisseurs | infra actuelle |
| 1.2 | Agents IA qui achètent des données tout seuls | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ communauté Virtuals | API + Sirio |
| 1.3 | « Get paid every time an AI learns from you » | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ grand public | preuves zkTLS + juridique |
| 1.4 | Oracle d'IA privée pour les smart contracts | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | complexe, partenaires DeFi |

**Recommandation** : lancer 1.1 et 1.2 ensemble, sous un seul message — *« Sirius : la place de marché où les
données entrent en compétition, et où les agents IA viennent les acheter »*. Puis 1.3 comme coup grand public une
fois le juridique et la preuve d'origine réglés.

### 1.1 Kaggle inversé : primes sur les données

- Un acheteur publie une prime : *« 1 000 MUSD pour des données qui donnent un modèle de fraude > 90 % de
  précision »*, avec un **jeu de test caché** (chiffré, seul l'enclave le lit).
- Les fournisseurs soumettent leurs datasets ; l'enclave entraîne et **note chaque dataset** sur le test caché.
- Le contrat de prime **paie seul le gagnant**, ou répartit selon l'apport de chacun au score.
- Pourquoi : sur Kaggle les modèles s'affrontent ; ici ce sont les données, ce qui est impossible ailleurs sans les
  montrer. Règle notre problème n° 1 : **faire venir des fournisseurs**.
- À construire : contrat de prime (dépôt, échéance, règlement selon un résultat signé par l'enclave), soumission,
  évaluation en série dans l'enclave, classement public sans fuite (scores seulement), page « Bounties ».
- Risques : surapprentissage au test caché (limiter le nombre de soumissions, test caché assez grand), fournisseurs
  qui soumettent des copies du même dataset (empreintes, dédoublonnage dans l'enclave).

### 1.2 Agents IA acheteurs de données

- Une **API pour agents** : chercher un dataset, obtenir le devis, payer en MUSD, lancer l'entraînement, récupérer
  le modèle, sans humain. Paiement à la requête possible (style x402).
- **Sirio en mode agent** : *« Sirio, entraîne-moi un modèle de prédiction de retards de paiement »* → il trouve le
  dataset, montre le devis ; l'utilisateur n'a plus qu'à signer.
- Variante : **données interrogées à l'usage** — l'agent pose une question à un dataset privé (statistique,
  prédiction, extrait autorisé), l'enclave répond, l'agent paie par requête ; le fournisseur est payé à chaque
  requête, pas seulement à chaque prêt.
- Pourquoi : première place de marché de données pensée pour les agents, cœur de la communauté Virtuals.
- Démo vidéo : un agent qui trouve, paie, entraîne et devient plus intelligent en 30 secondes à l'écran.
- Risques : budget et plafonds par agent (clés, limites de dépense), fuite par questions répétées en mode requête
  (limites, agrégats minimum, bruit).

### 1.3 Payé quand une IA apprend de toi

- N'importe qui dépose **ses propres données** (exports Spotify, Google, Strava, Uber, relevés, conversations
  ChatGPT…) ; Sirius les agrège en un grand dataset que des entreprises et labos louent.
- **Chaque contributeur touche des MUSD à chaque entraînement**, au prorata ; personne ne voit ses données.
- Tweet : *« Upload your Spotify history. Every time an AI trains on it, you get paid. Nobody ever sees it. »*
- Fausses données : prouver l'origine de l'export par **zkTLS** (preuve qu'il vient d'un vrai compte, sans le
  montrer).
- Juridique : données personnelles → consentement explicite, retrait, base légale RGPD, à faire valider par un
  juriste avant toute ouverture.

### 1.4 Oracle d'IA privée

- Un smart contract demande une prédiction calculée sur des données privées et la reçoit **avec la preuve**
  d'attestation (bon modèle, vraie enclave).
- Exemples : score de crédit DeFi calculé sur des données bancaires privées ; assurance paramétrique sur un modèle
  météo privé.
- Étape d'après : demande des partenaires DeFi et un format de preuve vérifiable on-chain.

## 2. Rendre les modèles crédibles (base, à faire en premier)

| Brique | Pourquoi | Matériel |
|---|---|---|
| **Arbres boostés** (famille XGBoost / LightGBM) | le standard sur données tabulaires ; gros gain de précision sur nos CSV ; un data scientist qui voit « régression linéaire » repart | processeur, CVM actuelle |
| **AutoML** : l'enclave entraîne plusieurs modèles et livre le meilleur, avec un classement | aucun choix technique pour l'acheteur, très visuel | processeur |
| **Essayer avant d'acheter** : score sur un échantillon avant paiement | lève le frein « je paie des données que je n'ai jamais vues » | processeur |
| **Prévision de séries temporelles** (énergie, ventes, capteurs) | nouveau type d'usage avec les mêmes arbres | processeur |

Ordre de grandeur : 2 à 3 semaines pour les trois premières lignes.

## 3. Nouveaux types de données

### 3.1 Images (modèles visuels)

**Tâches** : classification (OK / défaut), détection d'objets (cadre autour du défaut), segmentation (contour
exact), recherche par similarité, lecture de documents. Commencer par la **classification**.

**Méthode A — vecteurs + petit classifieur (pour commencer)** : un modèle pré-entraîné open source (DINOv2, CLIP)
transforme chaque image en vecteur, sans être modifié ; on entraîne un petit classifieur dessus. Processeur, CVM
actuelle ; souvent bon avec quelques dizaines à centaines d'images par classe ; le modèle livré contient très peu
d'information sur les images.

**Méthode B — affinage complet** : tout le réseau est ajusté ; précision maximale, obligatoire pour la détection
et la segmentation ; **carte graphique sécurisée** (Phala propose des H100 en mode confidentiel, prix et
disponibilité à vérifier) ; plus d'images ; risque de mémorisation → garde-fous.

**Parcours** : le fournisseur dépose un zip (un dossier par catégorie, ou `labels.csv`), **chiffré dans le
navigateur et envoyé en morceaux** directement vers le stockage ; contrôle automatique (formats, classes,
doublons) ; statistiques sans montrer les images. L'acheteur reçoit le modèle chiffré au format **ONNX**, le
certificat et les scores (précision, matrice de confusion) mesurés sur des images mises de côté.

**Démo** : page « Try it » — on dépose une photo, le modèle répond « Défaut détecté – 94 % » avec une carte de
chaleur, dans le navigateur.

**Secteurs** : industrie (défauts), agriculture (maladies), assurance (sinistres), commerce (rayons),
immobilier/satellite. Commencer par **industrie ou agriculture** : pas de visages, pas de santé.

**Risques** : fuite par le modèle (faible en méthode A ; differential privacy et tests de fuite en méthode B) ;
RGPD — exclure visages, plaques, imagerie médicale, case d'engagement + détection automatique de visages ;
licences des modèles de base à vérifier une à une (CLIP sous MIT, DINOv2 sous Apache 2.0 ; éviter les détecteurs
sous AGPL comme YOLO d'Ultralytics, préférer RT-DETR ou YOLOX, à confirmer) ; qualité des étiquettes (révélée par
le score, et par « essayer avant d'acheter »).

**À construire, dans l'ordre** : envoi de gros fichiers (découpé, chiffré, reprise) — brique commune à tous les
nouveaux types ; format de dataset « images » ; entraînement vision dans l'enclave (modèle de base intégré à
l'image du runner, donc attesté) ; devis selon le nombre d'images, CVM avec plus de disque et de mémoire (mise à
niveau + ré-épinglage) ; page « Try it ».

**Premier pas proposé** : test de faisabilité sur quelques centaines d'images publiques (dataset ouvert de défauts
industriels) dans la CVM actuelle : temps, mémoire, coût, précision. Aucun lancement payant sans go.

### 3.2 Textes, audio

- **Textes** (tickets, avis, emails anonymisés) : classement, sentiment ; même méthode vecteurs + classifieur.
- **Audio** (bruits de machines) : maintenance prédictive ; même principe que les images.

### 3.3 LLM affinés sur des données privées

- L'acheteur affine un petit modèle open source (Llama, Mistral, Qwen) sur des textes privés, dans une enclave
  avec carte graphique ; il reçoit le modèle, jamais les documents. *« Fine-tune your AI on data nobody can
  see. »*
- Point délicat : un LLM peut réciter ses données → differential privacy et tests de fuite avant livraison.
- 1 à 2 mois ; d'abord valider le coût des cartes graphiques Phala.

### 3.4 Entraînement sur plusieurs datasets à la fois

- Un modèle entraîné sur les données de plusieurs fournisseurs qui ne se voient jamais ; paiement réparti selon
  l'apport de chacun au score. Récit le plus fort (« les données de tout le monde, vues par personne »), le plus
  complexe ; se marie avec les primes (1.1).

## 4. Feuille de route proposée

| Phase | Contenu | Ordre de grandeur |
|---|---|---|
| 1 | Arbres boostés + AutoML + essayer avant d'acheter | 2–3 semaines |
| 2 (annonce phare) | Primes sur les données (1.1) + API agents / Sirio agent (1.2) | ~1 mois |
| 3 | Gros fichiers + images (méthode A), puis textes et audio | à chiffrer après le test de faisabilité |
| 4 | « Payé quand une IA apprend de toi » (1.3) | après validation juridique et zkTLS |
| 5 | Carte graphique sécurisée : vision méthode B, LLM affinés, oracle (1.4) | selon demande et coûts |

Prochaine étape : choisir la phase 2 à détailler (contrat, parcours, ce qu'il faut construire, délais), et lancer
le plan technique de la phase 1.
