# Entraînement et certificat

Fichiers : `src/app/(app)/train/page.tsx`, `src/lib/loans/client.ts`, `src/lib/sirius/settle.ts`, `src/app/api/loans/[id]/attestation`, `src/lib/tee/attestation.ts`, `src/app/proof/[id]/page.tsx`.

## Ce qu'on a dit

- Self training : on le garde ? Au début, non, contact seulement. Une page dédiée plus tard ([10](10-self-training.md)).
- Retirer le catalogue.
- Garder les datasets empruntés.
- Un entraînement est déjà payé avec l'emprunt. Chaque ré-entraînement est payé.
- Avertissement sur la qualité des entraînements, et sur l'inutilité d'un ré-entraînement selon le type de modèle.
- Statistiques poussées sur l'entraînement, selon ce que Phala peut fournir.
- Bouton de remboursement uniquement pour les échecs, ceux qui n'ont pas téléchargé de modèle.
- Un certificat pour chaque entraînement, avec la preuve de calcul Phala.

---

## Avant le 6 — P1

### Nettoyage de la page

- **Catalogue retiré** de la page Train.
- **Self training caché** pour les utilisateurs, visible seulement des opérateurs ([10](10-self-training.md)). À la place, un encart : « Want to train on your own data? Contact us at sirius.data.contact@gmail.com. »
- **Datasets empruntés** conservés, avec pour chacun son état : en attente de finalité du paiement, en cours, terminé, échoué, remboursé.

### Ré-entraînement

- Un bouton **Ré-entraîner** sur un emprunt terminé ouvre un **nouvel emprunt complet**, avec le prix total affiché avant paiement ([01](01-decisions-avant-samedi.md)).
- Avertissement à côté du bouton :
  > « Linear and logistic regression are deterministic: retraining on the same data gives the same model. Retrain only if the dataset has changed. »

### Remboursement des échecs uniquement

- Le bouton **Remboursement** n'apparaît que pour un entraînement échoué dont aucun modèle n'a été livré.
- Il explique ce qui est rendu : tout, sauf le calcul réellement consommé et mesuré par l'enclave.
- Un emprunt réussi n'a pas de bouton de remboursement.

### Avertissement qualité

Encart sur la page, texte commun de [16](16-socle-technique.md).

### Certificat d'exécution — P1, sinon début de V1.1

Le moteur produit déjà, pour chaque entraînement d'emprunt, une **attestation** : le résultat est signé par l'enclave, avec la quote matérielle TDX, le hash de composition et la liaison au prêt. Elle est stockée par prêt et servie par `GET /api/loans/[id]/attestation`. Le certificat est donc surtout un travail de présentation.

- Page publique `/certificate/[loanId]`, sans connexion, sur le modèle de `/proof/[id]` :
  - dataset, empreinte du modèle livré, date ;
  - « Exécuté dans une enclave Intel TDX sur Phala Cloud », avec les mesures (MRTD, RTMR3, hash de composition) et leur correspondance avec les valeurs épinglées ;
  - transaction de règlement avec le lien explorateur ;
  - bouton pour télécharger l'attestation brute, au format JSON, pour une vérification indépendante.
- Un bouton **Certificat** sur chaque entraînement terminé.

---

## Après le 6 — V1.1 et V1.2

- **Statistiques d'entraînement** : durée mesurée dans l'enclave, métriques du modèle (R² pour la régression linéaire, exactitude pour la logistique), taille du modèle. Ce qui vient de Phala : mesures, horodatage de la quote, état du TCB. Voir [12](12-test-phala.md).
- **Certificat vérifiable par un tiers** : une commande ou une page qui revérifie la quote sans faire confiance à Sirius.

## Terminé quand

- Avant le 6 : catalogue retiré, self training caché, ré-entraînement en nouvel emprunt, remboursement limité aux échecs, avertissements visibles.
- Certificat : chaque entraînement terminé a sa page publique avec la preuve Phala et le règlement.
