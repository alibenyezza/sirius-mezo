# À tester au passage mainnet

Ce qui ne peut pas se vérifier sur le testnet Mezo, faute de MUSD, de MoonPay ou de Safe de production. À dérouler juste après la fusion staging → main et la configuration de la production, avant la décision de lancer.

Chaque ligne se coche avec la date, la personne et la preuve (hash de transaction, capture).

## 1. Contrats et jeton

- [ ] Exécution à blanc du déploiement avec MUSD `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, puis déploiement réel, contrats vérifiés sur l'explorateur.
- [ ] `SIRIUS_USDC_CODE_HASH=0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6` en production ; le préflight passe (empreinte du proxy MUSD relue le 4 octobre).
- [ ] Registre KYB **strict** ; admin = Safe mainnet ; vérificateur = `0xDf432930e4999eD8aeF94Ab72F6bE3D60F6e7455`.
- [ ] Clé de déploiement vidée et retirée de toute machine après le déploiement.

## 2. KYB par invitation

- [ ] Générer un code avec `scripts/operations/kyb-invite.ts` pour une adresse de test.
- [ ] Le coller sur `/kyb`, accepter on-chain, vérifier l'état « vérifié » et la date d'expiration.
- [ ] Une adresse sans code ne peut ni publier ni emprunter.

## 3. Safe 2/3

- [ ] Safe mainnet créé (Ali, Ali, clé de secours hors ligne), seuil 2.
- [ ] Une transaction d'admin KYB signée par deux propriétaires passe.

## 4. Ajout de fonds et solde

- [ ] La page Wallet affiche « MUSD » et le **vrai** solde MUSD du compte connecté (18 décimales).
- [ ] « Add funds » → **Depuis un autre wallet** : QR et adresse corrects ; un envoi réel de MUSD depuis un autre wallet arrive et le solde se met à jour.
- [ ] « Add funds » → **Par carte** (si clés MoonPay live configurées) : achat réel de 5 USD minimum en `musd_mezo`, le MUSD arrive sur l'adresse du compte. Sans clés live, vérifier que le choix carte est masqué.
- [ ] La paire de clés MoonPay est bien live des deux côtés (une paire mélangée afficherait le choix mais MoonPay refuserait).

## 5. Machine Phala de production

- [ ] Machine neuve, initialisée avec les politiques mainnet, mesures épinglées.
- [x] Décision RTMR3 prise le 5 octobre (Ali) : ne plus l'épingler ; appliquée par la PR #72 (`fix/audit-a-01`) (`SIRIUS_EXPECTED_RTMR3` facultatif et ignoré, identité par MRTD, compose hash et journal rejoué).
- [ ] Redémarrage de vérification de la machine de production : même adresse de règlement, même MRTD et compose hash, runner, reaper et règlement opérationnels sans ré-épinglage.
- [ ] `release-check --network=mainnet` vert.

## 6. Bout en bout

- [ ] Premier prêt réel de 5 MUSD : verrouillage, entraînement, règlement, modèle téléchargé.
- [ ] Certificat d'exécution public affiché et vérifié (`/certificate/<id>`).
- [ ] Mention « By signing in, you accept the Terms » visible sous la connexion ; `/terms` à jour (MUSD, 3 jours, conservation 24 mois).
- [ ] Plafonds par prêt et totaux configurés et refusés au-delà.
