# Explorer, ancien « Audit »

Fichiers : `src/app/(app)/audit/page.tsx`, `src/components/layout/Sidebar.tsx`, `scripts/operations/escrow-events*`, `src/lib/evm/history.ts`.

## Ce qu'on a dit

- Renommer la section : « Explorer » ou autre.
- Garder le remboursement en cas d'erreur.
- Une section d'audit par utilisateur, affichée.
- Une section d'audit globale pour nous, sur toutes les actions et tous les datasets entraînés.
- Ajouter des filtres et des indexeurs.
- Repenser et recréer proprement le remboursement.

---

## Avant le 6 — P1

- **Renommage** : « Audit » devient **« Explorer »** dans le menu, le titre et les tutos. La route `/audit` redirige vers `/explorer` pour ne casser aucun lien.
- **Vue par utilisateur** : ce que la page montre déjà, centré sur le wallet connecté. Ses emprunts, ses datasets empruntés, ses règlements et remboursements, chacun avec son lien explorateur et son certificat ([09](09-train-et-certificat.md)).
- **Remboursement conservé** tel qu'il fonctionne aujourd'hui, avec le badge « Remboursé » ajouté avant le lancement.

## Après le 6 — V1.1 et V1.2

### Filtres

Par type d'action (emprunt, règlement, remboursement, publication, destruction), par dataset, par période, par statut.

### Indexation

- Aujourd'hui, l'historique se reconstruit en relisant les événements de l'escrow. Sur mainnet, avec un RPC d'archive payant, relire tout à chaque affichage coûte cher et devient lent.
- Mettre en place un **indexeur** : le nettoyeur ou un worker dédié lit les nouveaux événements à chaque passe et les range dans une table. L'Explorer lit cette table.
- La comptabilité existante (`ops:escrow-events`, `ops:reconcile`) devient une vérification de cet index.

### Vue globale, réservée à l'équipe

- Toutes les actions, tous les datasets, tous les entraînements, avec les filtres. Dans le dashboard admin ([15](15-dashboard-admin.md)).
- Le journal des accès du traçage déclaré ([06](06-mes-datasets.md)).

### Remboursement repensé

- Un parcours unique pour l'emprunteur : l'état explique pourquoi le remboursement est disponible (échec, délai de sécurité dépassé), ce qui sera rendu, puis un bouton.
- Si le remboursement n'est pas encore possible, la date où il le sera.

## Terminé quand

- Avant le 6 : « Explorer » partout, ancienne route redirigée, vue par utilisateur avec certificats et remboursement.
- Après : filtres, indexeur, vue globale admin, parcours de remboursement repensé.
