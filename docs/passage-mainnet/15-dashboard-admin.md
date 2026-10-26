# Dashboard admin

## Ce qu'on a dit

- Réservé à l'équipe.
- Modulable au maximum.
- Une sous-section self training.
- Pouvoir entraîner de nouveaux modèles en test sur des données d'utilisateurs ?
- Geler des adresses, bloquer des gens ?

## Accès

- Route `/admin`, réservée aux adresses de `SIRIUS_ADMIN_ADDRESSES` ([10](10-self-training.md)), contrôlée côté serveur sur chaque route.
- Toute action d'admin est journalisée : qui, quoi, quand.

## Avant le 6 — P2

Rien d'obligatoire. Pendant la bêta, la supervision passe par les outils existants : rapport de budget du moteur, `/status`, runbooks.

## Après le 6 — V1.2

### Modules

Des blocs indépendants, à afficher ou masquer :

- **Santé** : machine Phala, budget du moteur, solde ETH de règlement, nettoyeur, dernière passe.
- **Activité** : emprunts, entraînements et règlements du jour et de la semaine, échecs.
- **Explorer global** : toutes les actions, avec filtres ([11](11-explorer.md)).
- **Traçage** : journal des accès et empreintes des modèles livrés ([06](06-mes-datasets.md)).
- **Self training** ([10](10-self-training.md)).
- **Utilisateurs** : wallets, KYB, datasets, emprunts.

### Entraîner de nouveaux modèles sur des données d'utilisateurs

**Avis : uniquement avec le consentement explicite du fournisseur**, la case de l'upload ([07](07-upload.md)), et uniquement dans l'enclave.

- La liste des datasets disponibles pour la recherche ne montre que ceux dont le consentement est actif.
- La donnée n'est jamais déchiffrée hors de l'enclave. Seuls des modèles et des métriques en sortent.
- Le retrait du consentement s'applique aux usages futurs.

Sans consentement, entraîner sur la donnée d'un utilisateur serait une violation de la promesse centrale de Sirius et des conditions d'utilisation.

### Geler des adresses

- **Côté site** : une liste de blocage en base. Un wallet bloqué ne peut plus se connecter, publier ni emprunter via Sirius. Motif et auteur enregistrés.
- **Côté contrat** : le Safe peut **révoquer l'attestation KYB** d'une adresse. Elle ne peut plus prêter ni emprunter, même hors de notre site. C'est la vraie protection, mais elle passe par une signature du Safe.
- **Ce qu'on ne peut pas faire** : saisir ou geler des fonds déjà dans l'escrow. Le contrat ne le permet pas, et c'est voulu. Les prêts en cours se terminent ou se remboursent normalement.
- Mentionner dans les conditions d'utilisation que Sirius peut suspendre l'accès d'un compte en cas d'abus.

## Terminé quand

- Après : `/admin` réservé, modules de santé et d'activité, blocage côté site journalisé, procédure de révocation KYB par le Safe documentée dans les runbooks.
