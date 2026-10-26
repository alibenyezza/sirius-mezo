# Reprise v7 et conditions d’exploitation

État local du 23 septembre 2026. Aucun contrat public, environnement privé, abonnement ou secret distant n’a été modifié. Ce document décrit le code préparé et les opérations à effectuer dans l’environnement concerné.

L'[exercice de reprise suivant](BACKUP-RECOVERY.md) couvre la restauration du paquet complet et deux arrêts `SIGKILL` du registre synthétique. La livraison, le déchiffrement et la restauration hors ligne sont vérifiés pour les deux modèles du wallet local. Onze modèles restent liés à d'anciens wallets de test inaccessibles ; la copie hors machine est différée par Ali.

## Résultat perdu entre runner et Next

Après validation du grant et des scopes on-chain, le runner fixe le contexte de livraison du prêt dans SQLite, sans DEK ni clé enveloppée. Le résultat du calcul, sa mesure et la clôture de sa réservation sont enregistrés dans une même transaction. Une réponse perdue, une erreur d’attestation ou une indisponibilité de PostgreSQL ne nécessitent plus de nouvelle exécution.

Le reaper appelle `recover-loan-job` avec le devis signé du prêt. Cette opération exige la capability de transport et le devis conservé par le runner ; elle ne démarre aucun calcul et ne livre aucune clé. Next vérifie l’attestation reconstruite avant la persistance et le règlement. Un contexte absent ou un calcul encore sans mesure renvoie un statut sans épuiser les requêtes de clôture réservées. La mise à jour du résultat et le règlement utilisent des conditions sur l’état et la révision de la ligne.

La protection commence au checkpoint SQLite du résultat. Une coupure pendant le calcul ou entre l’upload IPFS et ce checkpoint reste une consommation incertaine : aucune consommation maximale n’est inventée et aucun recalcul automatique n’est lancé. Le budget engagé reste consommé ; le remboursement contractuel à échéance reste accessible. Une perte ou un retour arrière du volume SQLite nécessite une reprise opérateur.

## Transactions et finalité

Le journal conserve la transaction EIP-1559 signée sous AES-256-GCM, avec une clé dérivée dans le runner et liée à l’intention. Hash, nonce et journal sont persistés atomiquement avant l’envoi. Ni la transaction brute ni son préimage n’apparaissent en clair dans SQLite ou les diagnostics.

Après absence de reçu, le runner peut rediffuser exactement les mêmes octets : trois envois au total, espacés d’au moins 30 secondes. Une réservation atomique borne les reprises concurrentes. Réseau, signataire, contrat, nonce, valeur nulle, calldata, hash et plafonds de gas sont revérifiés après déchiffrement. Il n’y a ni hausse des frais ni nouveau nonce. Une transaction déjà confirmée est réconciliée avant tout nouvel engagement du wallet.

Une ancienne intention sans journal chiffré, un nonce occupé par une autre transaction ou une transaction toujours introuvable après trois envois reste bloqué. Ne pas supprimer la ligne, recréer le registre ou déduire l’absence de diffusion d’un timeout.

| Configuration commune Next / reaper / runner | Effet |
|---|---|
| `SIRIUS_EVM_FINALITY=finalized` | Exige un reçu canonique et un bloc couvert par le tag RPC `finalized`. Refuse l’absence de ce tag. Valeur par défaut en production ; obligatoire sur mainnet. |
| `SIRIUS_EVM_FINALITY=confirmations` | Mode de test : profondeur de blocs configurée, sans promesse de finalité irréversible. |
| `SIRIUS_EVM_CONFIRMATIONS` | Entier de 1 à 100 ; le runner impose aussi le minimum de sa politique de gas. Synchroniser les valeurs dans les trois services. |

Le contrôle v7 avant calcul vérifie `matchesScope` dans le bloc confirmé et dans l’état courant : un ancien bloc confirmé ne permet pas d’ignorer une échéance ou une clôture récente. Règlement, réconciliation des résolutions et livraison de clé vérifient la canonicité et la politique de finalité. L’activation v7 du runner vérifie la disponibilité du bloc confirmé.

Ces contrôles ne prouvent pas qu’un RPC dit vrai ni que le tag du rollup correspond à la garantie commerciale attendue. Sa sémantique, sa latence, les pannes et les réorganisations doivent être validées sur Mezo avant activation. Le préimage de `release` est toujours visible du RPC avant inclusion ; v7 conserve la clé modèle dans le runner jusqu’à la confirmation.

Dans le conteneur de la prochaine image, depuis `/workspace`, avec sa configuration et son registre :

```bash
node --conditions=react-server --import tsx scripts/runner-transactions.ts reconcile
node --conditions=react-server --import tsx scripts/runner-transactions.ts rebroadcast
```

`reconcile` ne diffuse rien. `rebroadcast` utilise uniquement les reprises restantes de la transaction déjà signée. Ces commandes restent disponibles lorsque les admissions HTTP sont suspendues ou que la politique de prix est périmée. Elles n’exportent pas la clé de règlement. Le code de sortie vaut 1 tant qu’une intention reste en attente. Les alias locaux correspondants sont `pnpm runner:transactions reconcile` et `pnpm runner:transactions rebroadcast` ; l’image ne nécessite pas pnpm.

## Registre et anciennes copies de clés

Le répertoire du registre et celui de sa sauvegarde doivent être privés (`0700`). Les fichiers sont créés exclusivement en `0600` ; aucune commande ne remplace une sauvegarde existante.

```bash
node --conditions=react-server --import tsx scripts/runner-budget.ts inspect /chemin/prive/ledger.sqlite /chemin/prive/budget-policy.json
node --conditions=react-server --import tsx scripts/runner-budget.ts check /chemin/prive/ledger.sqlite /chemin/prive/budget-policy.json
node --conditions=react-server --import tsx scripts/runner-budget.ts backup /chemin/prive/ledger.sqlite /chemin/prive/budget-policy.json /chemin/prive/backup-unique.sqlite
node --conditions=react-server --import tsx scripts/runner-budget.ts sanitize-key-cache /chemin/prive/copie-hors-service.sqlite /chemin/prive/budget-policy.json
```

`check` expose expiration, coupe-circuit, marges réservables, intentions publiques et calculs incomplets ; son code de sortie devient non nul en cas de blocage. Le brancher au superviseur extérieur au conteneur et à une alerte opérateur. Il ne suspend pas un abonnement et ne remplace pas un plafond fournisseur.

`backup` produit une image cohérente avec le WAL via `VACUUM INTO`, puis synchronise fichier et répertoire. Les réservations, devis, mesures et journaux chiffrés sont conservés. Ne jamais restaurer une copie plus ancienne pour regagner du budget. Avant restauration : arrêter les écrivains, comparer les intentions à la chaîne, vérifier l’identité de la CVM et réconcilier les dépenses survenues depuis la copie. Le code ne peut pas prouver qu’une sauvegarde est la plus récente ni empêcher un administrateur de dupliquer le volume sur deux CVM.

`sanitize-key-cache` retire les anciens résultats de scellement de la copie SQLite explicitement fournie, réécrit la base et tronque son WAL. À effectuer hors service. Cela ne purge ni les sauvegardes PostgreSQL, ni les snapshots du fournisseur, ni les copies déjà exportées, ni les blocs historiques d’un support SSD. Inventorier chaque copie et sa rétention avec le fournisseur avant toute promesse d’effacement cryptographique. L’interface annonce désormais seulement la suppression de la clé active et du titre ; les modèles livrés restent utilisables.

## Validation locale

- `pnpm test` : **308 tests réussis**, dont reprise des conflits Prisma, finalité, journal chiffré, sauvegarde et concurrence anti-rejeu entre huit processus.
- `pnpm test:operations` : **15 tests réussis**, couvrant archives authentifiées, paquet de récupération, inventaire et portée des signatures de livraison historiques, coûts, contrôle des configurations et superviseur d'arrêt ; commande ajoutée à la CI.
- `pnpm contracts:test` : **79 tests réussis** ; `pnpm test:e2e` : **62 tests réussis**, avec wallets simulés.
- `pnpm test:billing` : parcours réussi avec vrais contrats et runner sur EVM locale, IPFS et persistance Next simulés ; perte du résultat Next suivie de récupération par le vrai reaper, premier envoi RPC perdu puis rediffusion des mêmes octets et règlement, sans nouveau grant ni upload.
- `SIRIUS_TEST_DATABASE_URL=postgresql://…@127.0.0.1:…/postgres pnpm test:postgres` : crée puis supprime une base aléatoire locale ; applique les migrations avec des historiques existants et teste les admissions concurrentes des fonctions applicatives. Les dépendances EVM/runner y sont simulées, la base et les processus sont réels. Toute URL distante est refusée.
- Cette suite PostgreSQL 17 a réussi avec huit processus : dernier créneau de draft provider, ingestion globale, prêt en attente et entraînement global. La CI lance aussi PostgreSQL 17 et cette suite.
- Lint, typages application/v7 et build Next réussis.
- La [préparation opérationnelle](OPERATIONS-PREPARATION.md) vérifie aussi la restauration de la base réelle sur PostgreSQL 18 local, les migrations et les 13 copies de blobs historiques. La passe suivante valide le déchiffrement et la restauration hors ligne de deux modèles historiques ; la restauration du volume runner Phala reste à éprouver.
- `pnpm audit --audit-level=moderate` réussit : aucune alerte modérée, haute ou critique ; une alerte faible persiste sur `elliptic` 6.6.1 ([GHSA-848j-6mx2-7j84](https://github.com/advisories/GHSA-848j-6mx2-7j84)). Le registre npm expose toujours 6.6.1 comme dernière version lors de cette vérification ; la plage corrigée proposée par le scanner ne correspond pas à une version publiée. Voir l’analyse de portée dans l’audit.

## Configuration locale retrouvée

Le contrôle des six fichiers `.env*` privés, demandé par Ali, retrouve la clé `MEZO_DEPLOYER_KEY` dans `.env`, associée au compte public `0xb6acf8a998bb8efa34a954cd6334ccc15da7f919`. Le réseau configuré est le testnet ; ce compte diffère du précédent déployeur de production. Aucune transaction n’a été signée ou diffusée pendant ce contrôle.

Aucun de ces fichiers ne contient de politique tarifaire, de `RUNNER_BILLING_POLICY_FILE` ni de `RUNNER_BUDGET_FILE`. **Ali a ensuite retenu la même adresse pour le déploiement et la trésorerie compute testnet : `computeRecipient = 0xb6acf8a998bb8efa34a954cd6334ccc15da7f919`.** Cette valeur est à intégrer à la politique de facturation avec les tarifs validés. La clé du compte reste locale ; le runner utilise sa propre clé d’enclave pour signer devis et règlements. Les permissions des six fichiers privés sont désormais `0600` ; leurs valeurs n’ont pas été modifiées et les environnements n’ont pas été mélangés.

## Conditions externes encore nécessaires

1. Conserver les identifiants PostgreSQL existants, conformément à la demande de Ali. L’exposition évoquée dans une ancienne note n’a pas été établie ; aucune rotation n’est exigée par cette passe. La [préparation opérationnelle](OPERATIONS-PREPARATION.md) documente les vérifications et sauvegardes réalisées.
2. Tarifs, justificatifs comptables et intégration du bénéficiaire compute confirmé ci-dessus ; plafonds effectifs Phala, stockage, RPC et hébergement, alertes et responsable de l’arrêt. Le compte de déploiement/trésorerie reste distinct du compte opérationnel Phala. Aucun chiffre synthétique ne doit être présenté comme une marge acquise.
3. Inventaire et traitement des anciennes copies de clés, restauration du volume runner. La copie hors machine est différée ; deux modèles historiques sont récupérés et onze restent sans wallet de test accessible. La base réelle est déjà restaurée et migrée sur une copie locale, les 13 blobs sont sauvegardés et les crédits des deux escrows historiques ont été contrôlés en lecture seule.
4. Validation RPC/finalité et parcours à deux vrais wallets sur testnet avec le runner Phala attesté. Prévenir Ali du créneau et du coût avant toute remise en marche Phala.
5. Publier et figer les images construites localement, valider les politiques, initialiser le volume, déployer les contrats v7, appliquer les migrations distantes et épingler les mesures actives. `deploy/phala/compose.v7.yaml` prépare la surcharge locale ; le Compose d’amorçage reste la référence du déploiement arrêté. Renseigner un digest SHA-256 validé dans `SIRIUS_RUNNER_IMAGE`, fusionner les deux fichiers puis mesurer le Compose final. Le contrôle des trois environnements et le superviseur extérieur sont préparés ; celui-ci reste à installer et surveiller.
6. Avant données sensibles : revue des modèles exportés et entraînements répétés. Avant mainnet : KYB externe strict, clé KMS/HSM, audit indépendant avec corrections revérifiées, plafonds d’exposition, pilote et procédures d’incident validés.

Les uploads volumineux, jobs longs asynchrones et nouveaux modèles restent des évolutions produit distinctes. Ils nécessitent de nouveaux profils, limites et validations ; cette passe ne les active pas.
