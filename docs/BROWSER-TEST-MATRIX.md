# Matrice des tests navigateur — parcours à deux wallets

Préparation A2.8 du 24 septembre 2026 pour le point 5 du [plan de travail](WORK-PLAN-1-7.md) (lot B). Elle sert à suivre le parcours réel à deux wallets sur testnet ; elle ne l'exécute pas.

**Colonnes :** « e2e » renvoie aux suites Playwright existantes, où wallets et services externes sont simulés. « Testnet » est à faire avec deux vrais wallets, le runner Phala attesté et la v7, dans un créneau annoncé à Ali.

**Rôles :** A est le provider, B le borrower. Chaque scénario note les transactions, le solde USDC avant et après, et l'export comptable du runner.

## Parcours nominal

| # | Scénario | Attendu | e2e existant | Testnet |
|---|---|---|---|---|
| N1 | A et B se connectent, par wallet ou Google | Session signée, réseau testnet vérifié | `wallet.spec.ts` | À faire |
| N2 | A publie un dataset chiffré avec un profil valide | Carte publiée, preuve vérifiable | `datasets.spec.ts`, `sirius.spec.ts` | À faire |
| N3 | B demande un devis v7 et le signe | Devis signé affiché : prix dataset, prix compute, retenue maximale en échec | Non couvert | À faire |
| N4 | B verrouille les USDC | `LoanLocked` avec les montants du devis | Non couvert | À faire |
| N5 | Entraînement dans l'enclave et règlement | `LoanReleased`, crédits à A (dataset) et au bénéficiaire compute | Non couvert | À faire |
| N6 | B ouvre son modèle | Modèle déchiffré dans le navigateur, preuve cohérente | `sirius.spec.ts` (preuves) | À faire |
| N7 | A retire son crédit | `Withdrawn`, solde de A augmenté | `audit-regressions.spec.ts` (retrait) | À faire |
| N8 | Export comptable et relevé des escrows | Montants identiques entre export, événements et soldes | Outils A2 testés | À faire |

## Incidents

| # | Incident provoqué | Attendu | e2e existant | Testnet |
|---|---|---|---|---|
| I1 | B refuse la signature du challenge | Cause affichée, nouvel essai possible | `wallet.spec.ts` | À faire |
| I2 | B change de compte pendant la connexion | Connexion tardive invalidée | `audit-regressions.spec.ts`, `account-switch.spec.ts` | À faire |
| I3 | B change de compte ou de réseau pendant le parcours | Aucune réponse de l'ancien compte réutilisée | `account-switch.spec.ts` | À faire |
| I4 | B annule le devis après signature | Réservation conservée jusqu'à expiration, pas de libération au clic | Non couvert | À faire |
| I5 | Échec mesuré de l'entraînement | `LoanFailed` : remboursement moins la retenue plafonnée | Non couvert | À faire |
| I6 | Coupure du runner avant le checkpoint | Pas de retenue inventée ; remboursement contractuel à échéance | Tests A1 (registre) | À faire, créneau Phala |
| I7 | Réponse perdue après résultat durable | Reprise par le reaper, sans nouveau paiement | Tests A1 (registre) | À faire, créneau Phala |
| I8 | Échéance dépassée sans règlement | B récupère ses fonds même runner arrêté | `responsive.spec.ts` (récupération du lock lisible) | À faire |
| I9 | Erreur de finalisation d'un dataset | Carte gardée, nouvel essai possible | `datasets.spec.ts` | À faire |
| I10 | RPC indisponible pendant le règlement | Aucune livraison prématurée, reprise bornée | Préflight A1 | À faire, créneau Phala |

## Affichage

Les suites `responsive.spec.ts` et `documentation.spec.ts` couvrent la lisibilité des cartes, des états de prêt et des preuves aux différentes largeurs. Sur testnet, refaire N1 à N7 sur un téléphone réel.

## Données à relever pour chaque scénario testnet

Date, wallets A et B, hash des transactions, blocs, soldes USDC avant et après, sortie de `runner:budget export`, relevé `ops:escrow-events`, résultat observé, écart éventuel. Les scénarios N3 à N5 et I4 à I7 ne sont pas couverts par les suites e2e actuelles : ce sont les priorités du parcours réel.
