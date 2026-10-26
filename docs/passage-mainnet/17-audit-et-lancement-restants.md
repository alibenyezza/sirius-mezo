# Audit et lancement technique : ce qui reste

État au 2 octobre au soir. Détails techniques dans [../MAINNET-LAUNCH-PLAN.md](../MAINNET-LAUNCH-PLAN.md), [../AUDIT-2026-10-01.md](../AUDIT-2026-10-01.md) et [../MAINNET-RUNBOOKS.md](../MAINNET-RUNBOOKS.md).

## Ce qui est fait

Fusionné dans staging, CI verte :

- Les trois problèmes bloquants de l'audit : coupe-circuit, attente de finalité, prêt bloqué après un raté.
- Neuf des dix problèmes moyens : confirmation du wallet Google, plafonds de prêt, limites d'autorisation, base liée à son réseau, nettoyeur, outillage mainnet, déploiement des contrats, transaction refusée par le réseau, démo orpheline.
- Le dépôt est public, avec branches protégées, approbation de la production et blocage des secrets.

## Ce qui reste — P0

### 1. Connexion anti-phishing (audit M2) — après le lancement

Le message de connexion n'est pas au format standard des wallets (SIWE). Un faux site pourrait obtenir une vraie signature. Les sessions ont déjà été réduites à 24 heures. La correction touche le format vérifié par l'enclave : un jour et demi de travail. **Reportée à la V1.2.** Pendant la bêta, l'accès sur invitation et les plafonds limitent l'impact.

### 2. Test complet sur testnet — lundi 5

Validé avec Ali le 2 octobre : nouvelle machine Phala en mode normal, comptes générés et comptes MetaMask.

1. Quatre wallets de test générés, clés dans un fichier ignoré par git. Les adresses publiques des quatre MetaMask d'Ali.
2. Contrats v7 de répétition sur testnet, KYB strict.
3. Nouvelle machine Phala, environ 0,06 dollar de l'heure, arrêtée à la fin.
4. Initialisation, activation, capture du certificat.
5. Site local branché sur ces contrats, base de test.
6. Jeux de données exigeants : proches de la limite de taille, cas limites, fichiers invalides.
7. Parcours automatiques :
   - un prêt réussi ;
   - un prêt en échec avec retenue du calcul ;
   - un prêt remboursé après le délai de sécurité ;
   - deux emprunts simultanés du même dataset ([02](02-general.md)).
8. Pannes simulées : RPC coupé, frais refusés, moteur redémarré en plein calcul.
9. Parcours manuel avec les MetaMask : publication avec un compte, emprunt avec un autre.
10. Rapport, machine arrêtée.

C'est aussi la répétition de la mise en production.

### 3. Second audit multi-agents — lundi 5

Session cloud sur Fable, environ 100 euros de crédits, plafond de 120 agents. Douze zones, vérification par trois sceptiques, critique de couverture, rapport. Tout problème critique ou élevé est corrigé avant la décision de lundi 20h, ou reporte le lancement.

### 4. Éléments externes — état au 5 octobre

| Élément | Qui le fournit | État |
|---|---|---|
| Adresse officielle MUSD vérifiée ([01](01-decisions-avant-samedi.md)) | Ali | ✅ vérifiée on-chain, empreinte du proxy relevée |
| Safe **2/3** sur mainnet (décidé le 4 octobre) | Ali et Ali | ⏳ Safe de test créé (`0x9Db6…43f5`) ; mainnet à créer avec une clé de secours hors ligne |
| Clé de déploiement avec du BTC mainnet | Ali ou Ali | ⏳ nouveau compte avec ~0,05 ETH |
| Compte vérificateur KYB (registre strict par invitation) | Ali | ✅ `0xDf43…7455` |
| Carte de paiement Phala pour la machine de production | Ali | ⏳ ~45 $/mois |
| Base Neon neuve pour la production | Ali | ⏳ `neonctl` connecté, création possible par Claude sur go |
| Accès RPC mainnet d'archive | Ali | ⏳ |
| Montants comptables du moteur : prix du calcul, frais d'échec, trésorerie, plafond par prêt, plafond total, budget gas | Ali et Ali | ⏳ à décider le 5 au matin |
| `EVM_NETWORK=mainnet` dans l'environnement GitHub production | Ali | ⏳ |
| Configuration du nettoyeur de staging à compléter | Ali | ⏳ |
| Clés MoonPay live (achat par carte) | Ali | ⏳ sinon le choix carte reste masqué |
| Décision RTMR3 pour la machine de production | Ali et Ali | ✅ 5 octobre : ne plus l'épingler (PR #72 (`fix/audit-a-01`)) |

### 5. Mise en production — dimanche 4 et lundi 5 matin

Le gel du code est à dimanche minuit. Ce qui ne dépend pas des pages du site se prépare dimanche, en parallèle du code :

1. Machine Phala de production, en mode normal, avec l'origine `https://sirius-data.tech`.
2. Contrats mainnet : exécution à blanc, puis déploiement avec MUSD, Safe en admin KYB, deux vérificateurs.
3. Initialisation de la machine avec les politiques mainnet, activation, mesures épinglées, redémarrage de vérification.
4. Base de production neuve créée et migrée.

Après le gel, lundi matin :

5. Fusion staging → main par PR, puis approbation du déploiement dans l'onglet Actions.
6. Vercel production configuré pour mainnet, nettoyeur de production démarré.
7. `release-check --network=mainnet` vert.
8. Premier prêt réel de 5 MUSD, de bout en bout, certificat vérifié.
9. Retrait de la clé de déploiement de toute machine, ETH envoyé à l'adresse de règlement.

### 6. Décision — lundi 5 à 20h

Checklist dans [00-PLAN-GLOBAL.md](00-PLAN-GLOBAL.md).
