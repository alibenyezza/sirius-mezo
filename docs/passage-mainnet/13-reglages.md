# Réglages

Nouvelle section. Accès depuis le bouton profil ([05](05-wallet.md)).

## Ce qu'on a dit

- Ajouter cette section.
- Testnet ou mainnet ?
- Minimaliste, avec un affichage « bientôt ».

## Testnet ou mainnet : pas de bascule dans l'application

**Avis retenu.** Pas d'interrupteur testnet / mainnet dans les réglages. Chaque site est lié à un seul réseau :

- `sirius-data.tech`, la production : mainnet ;
- le site de staging : testnet.

Une bascule dans la même application mélangerait deux bases de données, deux jeux de contrats et deux machines Phala. Le code bloque d'ailleurs ce mélange depuis la garde de chaîne de la base. À la place, les réglages **affichent** le réseau et proposent un lien « Essayer sur le testnet », qui ouvre le site de staging.

## Avant le 6 — P1

Page `/settings`, minimaliste :

- **Réseau** : affiché, non modifiable, avec le lien vers le testnet.
- **Langue** : anglais, le français plus tard.
- **Visite guidée** : relancer le tuto ([04](04-dashboard.md)).
- **Bientôt** : notifications, préférences d'affichage, menu replié par défaut. Grisés, avec la mention « Soon ».

Les réglages sont stockés dans la table des utilisateurs ([16](16-socle-technique.md)).

## Après le 6

- Notifications par email : emprunt de mon dataset, entraînement terminé, paiement reçu. Demande de stocker un email, donc une mention dans les conditions d'utilisation.
- Menu replié par défaut ([04](04-dashboard.md)).
- Français.

## Terminé quand

- Avant le 6 : la page existe, affiche le réseau, relance le tuto, et montre les réglages à venir en « Soon ».
