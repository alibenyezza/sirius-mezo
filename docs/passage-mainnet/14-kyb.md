# KYB

Fichiers : `src/components/kyb/KybInviteForm.tsx`, `src/lib/kyb/invitation.ts`, `src/lib/sirius/kyb.ts`, `src/app/api/onboarding/**`, `scripts/operations/kyb-invite.ts`, `contracts/src/SiriusKybRegistry.sol`.

## Ce qu'on a dit

- Ajouter cette section.
- Seulement pour les entreprises ?
- Quels avantages ?
- Affichage « bientôt ».

## Ce qui existe déjà

- Sur mainnet, le registre KYB est **strict** : seules les adresses vérifiées peuvent prêter et emprunter.
- Pour la bêta, la vérification passe par une **invitation signée** par un vérificateur Sirius. L'entreprise colle son invitation et devient vérifiée on-chain. Le formulaire apparaît sur la marketplace et Mes datasets quand le KYB manque.

### Décision du 4 octobre : strict, utilisé comme invitation

- Le registre **ouvert** a été envisagé puis écarté : il est refusé sur mainnet par trois garde-fous volontaires (`scripts/deploy-policy.ts`, `scripts/phala-v7-preflight.ts`, `scripts/operations/release-check.mjs`), et le registre est figé dans l'escrow (`immutable kyb`) : passer plus tard d'ouvert à strict obligerait à redéployer l'escrow.
- **Invitation** : un code signé hors ligne (EIP-712) pour une adresse précise, généré avec `scripts/operations/kyb-invite.ts`. La personne le colle une fois sur `/kyb` et l'accepte on-chain. Valable jusqu'à 365 jours, usage unique (nonce). Aucun justificatif exigé pendant la bêta : Sirius choisit qui reçoit un code.
- **Vérificateur** : `0xDf432930e4999eD8aeF94Ab72F6bE3D60F6e7455` (compte dédié, sans fonds, distinct de l'admin).
- **Admin du registre** : le Safe 2/3. Safe de test créé sur Mezo Testnet : `0x9Db6D525773630c97deaF07b03cae29818E043f5` (Ali, Ali, clé de secours). Le Safe mainnet est à créer avec une vraie clé de secours hors ligne. Safe gère bien Mezo (31612) et son testnet (31611).

## Avis sur les questions

- **Pour qui** : sur mainnet, tout utilisateur qui veut emprunter ou publier doit être vérifié, puisque le contrat l'exige. Pendant la bêta, cela revient aux entreprises invitées. Les particuliers peuvent consulter la marketplace sans KYB ([02](02-general.md)).
- **Avantages** : le KYB n'est pas un bonus, c'est l'accès. Ce qu'on met en avant :
  - badge « Fournisseur vérifié » sur ses datasets ;
  - plafonds de prêt plus élevés après la bêta ;
  - accès anticipé aux nouveaux modèles.

## Avant le 6 — P1

Page `/kyb`, accessible depuis le bouton profil :

- **État** : vérifié, avec la date d'expiration de l'attestation, ou non vérifié.
- **Non vérifié** : le formulaire d'invitation existant, et « Pas d'invitation ? Écrivez-nous : sirius.data.contact@gmail.com ».
- **Bientôt** : vérification en ligne sans invitation, avantages listés. Grisés, avec « Soon ».

## Accès instantané (vérificateur automatique)

Fichiers : `src/lib/kyb/auto-invite.ts`, `src/lib/sirius/kyb-auto-invite.ts`, `src/app/api/kyb/auto-invite/route.ts`, `src/components/kyb/KybInstantAccess.tsx`, table `KybAutoInvite`.

Décision des fondateurs : ouvrir le mainnet **sans contact manuel**, en gardant des interrupteurs. Le registre reste strict ; on y ajoute un **second vérificateur, automatique**, dont la clé vit sur Vercel et ne fait que signer. Sur `/kyb`, un wallet connecté et non vérifié voit « Obtenir l'accès instantané » : le serveur signe une invitation EIP-712 **pour l'adresse de la session uniquement**, le wallet l'accepte on-chain par le même chemin qu'un code collé (une transaction, gas à sa charge). Le code collé reste proposé, en second.

- **Validité** : 30 jours. Renouvelable dans les 7 derniers jours de l'attestation **si elle vient du vérificateur automatique**, ou dès qu'elle n'est plus valide (expirée, vérificateur retiré). Une attestation de l'équipe n'est jamais remplacée ici : son renouvellement passe par `kyb-invite.ts`.
- **Refus définitifs** : wallet **révoqué** on-chain (`attestationOf.revoked`) ou **bloqué** côté site (`UserProfile.blockedAt`) → 403, retour par l'équipe uniquement.
- **Plafonds** (en base, donc partagés entre instances) : 1 invitation par wallet et par 24 h — la même est resservie entre-temps si le wallet a refusé la transaction —, `SIRIUS_KYB_AUTO_INVITE_MAX_PER_IP_HOUR` par adresse IP et par heure (défaut 3, seulement quand l'ingress transmet l'IP : `SIRIUS_TRUST_PROXY_HEADERS=true`) et `SIRIUS_KYB_AUTO_INVITE_MAX_PER_HOUR` par heure (défaut 120). Journal : wallet, expiration ; jamais la clé.
- **Traces** : table `KybAutoInvite` (wallet, code, IP éventuelle) ; le reaper supprime les lignes de plus de 48 h, par lots.
- **Fermé par défaut** : avant de signer, le serveur vérifie sur le registre que l'adresse de la clé est un vérificateur actif (`isVerifier`) ; sinon 503, même drapeau posé.

### Mise en place

1. Générer la clé sur un poste d'opérateur : `openssl rand -hex 32`, préfixer `0x`. Dériver l'adresse (`node -e "console.log(require('viem/accounts').privateKeyToAccount(process.argv[1]).address)" 0x…`). Clé **dédiée** : ni le vérificateur humain (`0xDf43…7455`), ni `SIRIUS_KYB_VERIFIER_KEY` (démo testnet, interdite sur mainnet). Aucun ETH nécessaire.
2. Safe admin `0xb6288dA83c69B1337525ad73298A36334Aa68631` → registre `0x8bd1590e2e223605adf3ea83dfa4cd272033c24c` → `addVerifier(<adresse dérivée>)`.
3. Vercel, projet de production : `SIRIUS_KYB_AUTO_INVITE_KEY` (Sensitive) puis `SIRIUS_KYB_AUTO_INVITE=true`, redéployer. Au démarrage, les logs annoncent l'adresse du vérificateur automatique et les plafonds. `SIRIUS_KYB_AUTO_INVITE=true` sans clé valide refuse de démarrer ; `release-check` n'admet la clé que sur Next et seulement avec le drapeau.

### Attestation parrainée à la connexion (KYB invisible)

Fichiers : `prepareSponsoredAttestation` / `submitSponsoredAttestation` dans `src/lib/kyb/auto-invite.ts`, `src/app/api/kyb/auto-attest/route.ts`, `attestViaAutoSponsor` dans `src/lib/kyb/client.ts`.

Décision des fondateurs (12 octobre 2026) : plus aucune étape KYB visible. Le registre et l'escrow ne changent pas ; juste après la connexion, le wallet signe **son consentement** (EIP-712, aucune transaction, aucun ETH) et le **vérificateur automatique** envoie `attestWithConsent` en payant le gas. L'utilisateur se connecte et peut aussitôt louer ou publier. Si le parrainage échoue ou est coupé, le parcours habituel (accès instantané, code d'invitation) reste proposé.

- **Mêmes règles que l'accès instantané** : wallet bloqué ou révoqué refusé, attestation de l'équipe jamais remplacée, renouvellement dans les 7 derniers jours, mêmes plafonds en base (une émission par wallet et par 24 h, par IP et par heure, par heure).
- **Aucune dépense inutile** : signature vérifiée hors chaîne, transaction simulée avant l'envoi, une seule transaction du vérificateur à la fois par instance.
- **Gas** : approvisionner l'adresse du vérificateur automatique. Sous **0,0002 ETH**, le parrainage s'arrête (503) pour garder la réserve des révocations ; les utilisateurs retombent sur l'accès instantané.
- **Activation** : `SIRIUS_KYB_AUTO_SPONSOR=true` sur Vercel (production), en plus de `SIRIUS_KYB_AUTO_INVITE=true` et de sa clé, puis redéploiement. Coupure : retirer le drapeau (retour au bouton d'accès instantané).

### Interrupteurs

- **Drapeau** : `SIRIUS_KYB_AUTO_INVITE` retiré ou à `false`, redéploiement → plus aucune invitation émise (route 404, bouton absent). Les attestations déjà acceptées courent jusqu'à leur terme (30 jours au plus).
- **Un wallet** : `POST /api/admin/kyb/revoke` avec `{ "subject": "0x…" }`, session d'un wallet de `SIRIUS_ADMIN_ADDRESSES` (contrôle d'origine comme toute route qui écrit). Le serveur envoie `revoke(subject)` signé par la clé automatique — le contrat n'accepte la révocation que de l'émetteur, une attestation de l'équipe répond 403 — attend la confirmation, relit le registre et passe le `Credential` en `REVOKED`. Cette transaction coûte du gas : **approvisionner l'adresse du vérificateur automatique de ~0,001 ETH** (sans ETH, 503 explicite). Fonctionne drapeau coupé, tant que la clé est présente. Le wallet révoqué ne peut plus obtenir d'accès instantané : seule l'équipe le réinvite.
- **Safe** : `removeVerifier(<adresse>)` sur le registre → **toutes** les attestations émises par le vérificateur automatique cessent d'être valides sur-le-champ (`isKybValid` compare l'époque). C'est la réponse à une clé compromise. Pour rouvrir ensuite : nouvelle clé, `addVerifier`.

### Risque résiduel

La clé est sur Vercel. Volée, elle permet de faire vérifier **n'importe quelle adresse** : l'équivalent d'un registre ouvert, le temps que l'on s'en aperçoive. Atténuation : les plafonds bornent le débit (une invitation par wallet et par 24 h, N par heure — mais un voleur de clé peut signer hors de l'application, sans ces plafonds), les attestations sont courtes, et `removeVerifier` annule tout ce qu'elle a signé en une transaction du Safe. Les attestations du vérificateur humain ne sont pas touchées.

## Après le 6 — V1.2

- Parcours de vérification sans invitation : formulaire entreprise, contrôle par un vérificateur, attestation signée. Le choix d'un prestataire de KYB est à faire.
- Statut KYB stocké dans la table des utilisateurs ([16](16-socle-technique.md)) pour l'affichage. La source de vérité reste le contrat.
- Badge « Vérifié » sur la marketplace.
- Renouvellement avant expiration de l'attestation, avec un rappel.

## Terminé quand

- Avant le 6 : la page affiche l'état, permet de coller une invitation, et présente la suite en « Soon ».
