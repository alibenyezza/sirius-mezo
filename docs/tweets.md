# Archive du compte X @Sirius_data

- **Profil :** https://x.com/Sirius_data
- **Nom affiché :** Sirius
- **Bio :** Rent data. Never expose it.
- **Site :** https://sirius-data.tech/
- **Contrat indiqué dans la bio :** 0x72e936815982a577386e8fcde94f5c9335836c88
- **Période couverte :** 27 août 2026 au 29 septembre 2026
- **Contenu retrouvé :** 19 publications rédigées par le compte, dont 6 avec vidéo, 2 avec image et 1 article long

> **Note de couverture :** X affiche 21 « Posts » sur le profil, tandis que le flux public expose 19 publications rédigées par le compte. Les 2 éléments d’écart sont vraisemblablement des reposts, des publications supprimées ou des éléments non exposés publiquement. Ils ne peuvent pas être archivés de façon fiable à partir des sources publiques disponibles.
>
> **Transcriptions :** génération automatique avec Whisper small.en, puis correction des noms propres et termes techniques. Les passages à fort accent ou faible clarté restent des transcriptions de bonne foi, non des citations certifiées.

## Synthèse du contenu

Sirius présente une infrastructure de prêt de données confidentielles pour l’IA. Les données sont chiffrées côté navigateur, traitées dans un environnement d’exécution de confiance, puis conservées hors chaîne. La blockchain sert au règlement, à la provenance, à la vérification d’identité et aux preuves publiques. Le compte documente le produit, les contrats, le hashlock de paiement, le crypto-shredding, les modèles de régression, les preuves publiques, les comptes MPC et la feuille de route vers le mainnet.

## Publications complètes

### 1. 29/09/2026 20:41 UTC

ID : `2105035382538506516`  
https://x.com/Sirius_data/status/2105035382538506516

> An NDA tells someone what they're not allowed to do with your data.  
> It doesn't stop them.  
> On Sirius the borrower never gets the choice: the dataset stays encrypted, training runs inside an enclave, and all that leaves is the model.  
> What's the one dataset you'd never share, even under NDA?

### 2. 25/09/2026 12:25 UTC

ID : `2103461004063453216`  
https://x.com/Sirius_data/status/2103461004063453216

> We're building Sirius: train a model on someone else's private data without ever seeing it. Data stays encrypted, you only get the model.  
> Live on testnet with tabular datasets, linear and logistic regression.  
> What would you want to borrow first?

### 3. 25/09/2026 12:26 UTC

ID : `2103461051433894184`  
https://x.com/Sirius_data/status/2103461051433894184

> If you picked "something else" or have a dataset you can't share but would let people train on, reply or DM. We're doing 10 short calls with early users this month.

### 4. 24/09/2026 17:38 UTC

ID : `2103177147477119379`  
https://x.com/Sirius_data/status/2103177147477119379

> Sirius update  
> We've been heads-down building. Next on the road to mainnet:  
> → Taking training to the next level with confidential computing  
> → Escrow update: pay-per-compute, settled on-chain  
> → Bigger datasets, async training, new models  
> → KYB verification, followed by an independent audit  
> Your data stays protected. The compute comes to it.

**Média :** https://video.twimg.com/amplify_video/2103177081374851072/vid/avc1/928x806/_K1Na--I6bzezb13.mp4?tag=29

#### Transcription de la vidéo

**[00:00]** No spoken words detected. The clip is a short silent visual animation.

### 5. 22/09/2026 15:51 UTC

ID : `2102425505660011000`  
https://video.twimg.com/amplify_video/2102424790589927424/vid/avc1/1920x1080/yIXUQmXpffie_FiK.mp4?tag=29

> Introducing Private AI Training.  
> Your data trains their AI. They never get to see it.  
> Encrypted in your browser → opened only inside a hardware vault → a fingerprint on-chain  
> never the data → the model ships sealed → one transaction pays the seller and opens the capsule.  
> No way to cheat.  
> Train on data. Without exposing data.

**Média :** https://video.twimg.com/amplify_video/2102424790589927424/vid/avc1/1920x1080/yIXUQmXpffie_FiK.mp4?tag=29

#### Transcription de la vidéo

**[00:01-00:25]** Hi, it's Ali from Sirius. Today, we'll see exactly how Sirius is designed to protect a dataset. First, your browser encrypts the file before the upload. The encrypted file is then sent to the TEE, a trusted execution environment. The design uses a hardware-protected TEE. It opens your file, fingerprints it, then encrypts it again for storage.

**[00:25-00:51]** The blockchain records that fingerprint and basic details. The raw file stays off-chain. A buyer locks payment in a smart contract. The TEE checks the agreement, then trains and encrypts the model. The buyer saves a sealed capsule holding the model's decryption key. Opening it needs two things, a private key in their browser and a settlement secret.

**[00:51-01:19]** The browser already has the key. The secret is still missing. One transaction makes the seller's payment withdrawable and publishes the secret at the same time. The buyer can then open the capsule and decrypt the model. That secret does not unlock the dataset. Deleting the dataset removes Sirius's stored encrypted copy of its key and blocks new training through Sirius.

**[01:19-01:28]** The deletion stays recorded, while a model already delivered remains with its buyer. That's Sirius: private data, useful models.

### 6. 22/09/2026 10:56 UTC

ID : `2102351279750017189`  
https://x.com/Sirius_data/status/2102351279750017189

> Your data trains their AI. They never get to see it.  
> On Sirius, your dataset is encrypted in your browser before it leaves your laptop. It’s decrypted only inside a hardware vault.  
> Neither we, the buyer, nor the chain can access it.  
> The chain stores a fingerprint. The buyer receives a trained model locked in a sealed capsule. A single transaction pays the seller and unlocks the model simultaneously.  
> No payment without delivery. No delivery without payment.  
> Live on Mezo testnet.  
> Try it: https://sirius-data.tech

**Média :** https://pbs.twimg.com/card_img/2104887411884863488/KCQY7-Fh?format=jpg&name=800x419

### 7. 16/09/2026 12:45 UTC

ID : `2100204494197789148`  
https://x.com/Sirius_data/status/2100204494197789148

> MPC powered accounts  
> No wallet. No seed phrase. No extension.  
> Your private key is generated as encrypted fragments distributed across a network of nodes and is never assembled in one place.  
> Threshold signatures handle every transaction securely.  
> Sign in, publish a dataset or license one.  
> Same protocol. Same TEE training. Same on chain proofs.  
> The security stays. The friction disappears.

### 8. 13/09/2026 14:25 UTC

ID : `2099142505681801644`  
https://x.com/Sirius_data/status/2099142505681801644

> Why does Sirius need a blockchain if the data stays offchain?  
> Because putting private data onchain would defeat the entire point.  
> The chain is the neutral settlement layer:  
> → lock payment  
> → prove settlement  
> → verify identity  
> → record provenance  
> Meanwhile:  
> Data → encrypted & offchain  
> Compute → confidential enclave  
> Settlement → onchain  
> Each layer does one job.  
> No blockchain forced into places where a database works better.

### 9. 10/09/2026 21:14 UTC

ID : `2098158295106375899`  
https://x.com/Sirius_data/status/2098158295106375899

> Every dataset on Sirius is anchored on-chain when it’s published. Until today, you had to own it to see that.  
> Now every listed dataset has a public proof page. No account, no wallet :  
> on-chain title, mint transaction, merkle root and the training profile locked at publication.  
> The encrypted file is linked too. Download it, it’s unreadable.  
> A proof only its owner can reach isn’t a proof. It’s a claim.

**Média :** https://video.twimg.com/amplify_video/2098157300825415681/vid/avc1/1920x1080/appOXpdD-JdPsM13.mp4?tag=29

#### Transcription de la vidéo

**[00:01-00:29]** Hi everyone, I'm Ali, again from Sirius. A quick one today: we shipped something this morning and I want to show you. The concept of Sirius lets a company lend out a dataset it can't share. The data gets encrypted in the browser, it is trained inside a secure enclave, and the payment settles on-chain.

**[00:29-00:58]** Nobody ever sees the raw data, not the borrower and not even us. Every dataset published on Sirius is now anchored on-chain. The moment it goes live, its title, the file's Merkle root, and the training profile are all written to Mezo. Until today, you had to own the dataset to see any of it.

**[00:58-01:23]** which is really ridiculous, right? So a proof, only its owner can look at it, isn't really a proof. So that's what we fixed. So I will show you how it works right now. If I go to my data sets, and here I see a lot of them, which is already published.

**[01:23-01:48]** When I open the public proof as the owner, I can see the on-chain proof. But the interesting part is what happens when I copy the link and open it in a private browser. Here, I'm not connected to any wallet or to Sirius. I paste the link.

**[01:48-02:13]** I can see the on-chain proof even though I'm not connected. I can also see the on-chain title, the anchoring transaction, the Merkle root, and the details needed to verify the dataset. That's the feature we added. Take a look and tell us what you think.

### 10. 06/09/2026 14:02 UTC

ID : `2096599896178532648`  
https://x.com/Sirius_data/status/2096599896178532648

> Sirius now supports binary logistic regression alongside linear regression.  
> Predict continuous values or classify probabilities. The right model for the right problem.  
> More models. More use cases. Same privacy.

**Média :** https://video.twimg.com/amplify_video/2096599797767548931/vid/avc1/1920x1080/m1szzv5XX8Vq1vk8.mp4?tag=29

#### Transcription de la vidéo

**[00:00-00:27]** Sirius supports two training profiles, so the important update is I choose the models on the upload of the datasets, not on the training, so if I want to upload datasets, I have no choice between linear regressions and binary logistic regressions, so linear regressions is for continuous values, like a price, revenue or energy demand,

**[00:27-00:54]** And binary logistic regression is for all 0 or 1 answers, like default, credit default for example. So if I want to upload the credit default data sets, I can. So I choose binary logistic regression and I can upload data sets. I publish it and sign the transaction.

**[00:54-01:20]** So the data is public. And if I want to upload another data set, for example energy demand, I can choose linear regressions, choose the file, and upload also the data set.

**[01:20-01:46]** On the training profile, I can now see the training parts, energy demand tests, and credit defaults. The two data I just uploaded, I can borrow one of them, confirm the transaction.

**[01:46-02:14]** The transaction has been confirmed. I can now run the job in the TEE and train the model. I can see that this is a logistic regression training. Once the training is finished, I can verify and download

**[02:15-02:27]** my model. I can use the downloaded model to request a prediction or evaluate it with a test CSV file.

### 11. 03/09/2026 19:15 UTC

ID : `2095591429716230607`  
https://x.com/Sirius_data/status/2095591429716230607

> Crypto-shredding.  
> Destroy the key → the dataset becomes permanently unrecoverable, even by us.  
> The data disappears.  
> The on-chain proof doesn’t.  
> Verifiable existence. Verifiable destruction.

**Média :** https://video.twimg.com/amplify_video/2095591315375620096/vid/avc1/1920x1080/58sD5uJSYibJ-Rft.mp4?tag=29

#### Transcription de la vidéo

**[00:00-00:29]** Hello everyone. Today we're going to speak about an important feature in our application. When you delete a file somewhere, how do you know it's actually gone? You don't, so watch this. Right now, I've published an energy-demand dataset as a demo. This dataset is encrypted. The file sits in public storage, and anyone can fetch it.

**[00:29-00:56]** It is encrypted with one key, and that key exists in exactly one place. I select the dataset's delete feature and request its deletion. To delete it, I have to confirm the transaction. The encrypted file can remain there forever,

**[00:56-01:20]** but without the key it is just noise, both to an attacker and to us. Here is the part you can check yourself. You can now see that the dataset is deleted. The important part is that the on-chain

**[01:20-01:47]** title is not erased. If I go to my transactions and open the latest one, we can see that the dataset was destroyed. It is marked as destroyed, the data is unrecoverable, and the proof that it existed and was destroyed

**[01:47-02:00]** is permanent and public. This was a small feature demo to help you learn more about the application. I hope it helped. See you soon.

### 12. 02/09/2026 20:10 UTC

ID : `2095243002268537205`  
https://x.com/Sirius_data/status/2095243002268537205

> The borrower-side flow is now live end to end on testnet.  
> Compute travels to the dataset, not the other way around the borrower never touches the raw data.  
> What comes back is the trained model: coefficients, metrics and a verifiable content ID, ready to evaluate against your own test set.

**Média :** https://pbs.twimg.com/media/HRPLbcCXMAE5_ng.jpg?name=orig

### 13. 01/09/2026 19:34 UTC

ID : `2094871421134741738`  
https://x.com/Sirius_data/status/2094871421134741738

> Sirius currently relies on 3 core contracts.  
> SiriusEscrow  
> Atomic settlement between the data owner and user through a SHA-256 hashlock.  
> SiriusKybRegistry  
> Onchain verification of valid KYB status, including expiration and revocation.  
> SiriusDatasetRegistry  
> Records dataset provenance without putting the dataset itself onchain.  
> The blockchain doesn't store private data or run ML workloads.  
> It handles what it's actually good at: settlement, identity & provenance.

### 14. 01/09/2026 14:23 UTC

ID : `2094793284409319848`  
https://x.com/Sirius_data/status/2094793284409319848

> The most important part of Sirius doesn't happen onchain. It happens offchain.  
> A dataset goes through:  
> AES-256-GCM encryption client-side  
> Encrypted blob stored on IPFS  
> Decryption only inside a confidential enclave  
> Model training in memory  
> Authorized output leaves, dataset doesn’t  
> The goal is simple:  
> Sirius shouldn't be able to read your data, neither should the buyer.  
> The data doesn't go to the model.  
> The model goes to the data.

### 15. 31/08/2026 14:57 UTC

ID : `2094439561866756509`  
https://x.com/Sirius_data/status/2094439561866756509  
https://x.com/i/article/2094437619107045376  
#### Article complet : Sirius Roadmap

**Image de couverture :** https://pbs.twimg.com/media/HRDwjwrWMAAMevx.jpg

**Sirius Roadmap: What We Build Next and Why**

Most roadmaps are lists of features with dates attached.

Ours isn't.

At Sirius, the order matters because every step unlocks the next one. Moving faster on the wrong thing doesn't get us closer to the product we're trying to build.

So here's exactly what we're building next, in order.

##### Where Sirius stands today

Sirius already runs end-to-end on testnet:

encrypt → train → settle

The protocol works.

But there's an important distinction between a system that works and a system whose confidentiality guarantees can be independently verified.

Today, that distinction is our biggest priority.

The next milestone isn't another feature.

It's making the core promise of Sirius verifiable.

##### Phase 1 - Make privacy verifiable

Run Sirius inside a real, hardware-attested TEE.

This comes before everything else.

Sirius is built around a simple idea: sensitive data should be usable without requiring its owner to expose it.

That promise means very little if users ultimately have to trust us not to inspect their data.

The goal of deploying on real confidential hardware is to remove that trust assumption.

Instead of:

"Trust Sirius. We can't see your data."

We want:

"Verify it yourself."

Hardware attestation should allow anyone to verify that the expected environment is actually running the workload.

No trust in our word required.

This is the only item on the current roadmap that fundamentally changes the nature of the product.

Which is why nothing comes before it.

##### Phase 2 - Make Sirius usable on real workloads

Once the confidential compute layer is proven on real hardware, the next constraint is usability.

Today, Sirius works with our demo CSV.

Real enterprise datasets are a different story.

Two things need to change.

**More model types**

Linear regression is enough to prove a pipeline.

It isn't enough to build a data market.

We'll add classification and tree-based models to the catalogue.

Importantly, Sirius won't simply allow arbitrary code to execute against private datasets.

Each workload is controlled and explicitly supported by the protocol.

More models means more potential use cases without sacrificing the security model.

**Async jobs + real data volumes**

Enterprise datasets don't fit neatly inside a 15-second request or a 16 MB limit.

Training needs to become asynchronous.

Jobs need to survive longer execution times.

Storage needs to handle realistic volumes.

Until then, Sirius can demonstrate the architecture.

After this phase, it can start handling the kind of datasets the architecture was designed for.

##### Phase 3 - Make both sides comfortable using it

Confidential compute protects the data.

It doesn't solve every trust problem between two businesses.

For Sirius to move from technically functional to commercially usable, both sides need additional guarantees.

**Real KYB**

Sirius already has a governed KYB registry.

The next step is connecting it to real external verification and making it part of the active settlement flow.

For sensitive data markets, knowing that the counterparty is a verified legal entity isn't an optional UX feature.

It's infrastructure.

**Quality recourse**

Privacy protects the supplier.

But what protects the buyer?

A dataset can be private and authentic while still being useless.

Bad labels. Excessive noise. Poor quality.

An enterprise paying for a workload needs a way to challenge a transaction when the underlying dataset doesn't deliver what was represented.

The contract already contains a dispute window.

The next step is making it actually usable.

A sustainable data market needs protection on both sides.

##### What this actually takes

Phases 1–3 represent roughly:

21–27 days of engineering work

At our current pace, that's around 4.5 months of execution.

Expected infrastructure cost:

~$110–260/month

We're publishing these numbers because a roadmap should describe the actual path ahead, not make the path look shorter than it is.

And among everything above, one milestone matters more than the others:

real hardware-attested confidential compute.

More models make Sirius better.

Async infrastructure makes Sirius usable at scale.

KYB and dispute resolution make Sirius viable for businesses.

But real TEE deployment is what turns the central privacy promise from an assertion into something independently verifiable.

That's why it comes first.

##### What comes after

Once those foundations are proven, Sirius can move toward the larger vision:

→ broader confidential ML workloads  
→ stronger privacy guarantees  
→ synthetic data generation inside the enclave  
→ multi-party computation across datasets that would normally never be able to interact

The end goal isn't simply a marketplace where someone can rent a CSV.

It's infrastructure where valuable datasets can participate in an economy without needing to circulate in plaintext.

The data stays protected.

The compute comes to it.

The owner retains control.

And settlement happens onchain.

We're not presenting Sirius as a finished v1 waiting for users.

We're building the pieces in the order required for the system to actually hold up.

More soon.

### 16. 29/08/2026 08:17 UTC

ID : `2093613905213886575`  
https://x.com/Sirius_data/status/2093613905213886575

> Renting data to a stranger creates an obvious problem:  
> Who trusts who first?  
> The buyer doesn't want to pay before receiving the output.  
> The provider doesn't want to provide compute without knowing they'll get paid.  
> Sirius uses a SHA-256 hashlock to bind both events together.  
> The output is encrypted using two components:  
> → a key generated client-side  
> → a secret generated inside the enclave  
> The buyer receives the encrypted output before paying but can't unlock it.  
> The transaction that reveals the secret is also the transaction that settles payment.  
> Payment = delivery.  
> Not two trust-based events.  
> One atomic onchain event.

### 17. 28/08/2026 20:42 UTC

ID : `2093439043383992639`  
https://x.com/Sirius_data/status/2093439043383992639

> Today, a data owner basically has 2 options:  
> Keep the data → $0 revenue, asset sits idle  
> Sell the data → lose control the second it's downloaded  
> Neither makes sense.  
> So we're building a third option: don't sell the data, rent the compute around it.  
> More soon

### 18. 28/08/2026 15:09 UTC

ID : `2093355189403025746`  
https://x.com/Sirius_data/status/2093355189403025746

> Sirius is entering @MezoApp through @virtuals_io.  
> Sirius is building the confidential data layer for AI.  
> The data stays encrypted.  
> The model comes to the data.  
> The owner stays in control.  
> Private data. Confidential compute. Onchain settlement.  
> CA: 0x72E936815982A577386e8fcDe94f5C9335836C88  
> https://app.virtuals.io/virtuals/137992

**Média :** https://video.twimg.com/amplify_video/2093354993352847360/vid/avc1/1920x1080/mHqVrxVC-nOngLu8.mp4?tag=29

#### Transcription de la vidéo

**[00:00-00:28]** Hello, we are Ali and Ali, the founders of Sirius. We want to start with the problem, because the problem is the entire reason this exists. Today, data is the most valuable asset a company owns, often worth more than its software and sometimes worth more than its product. It comes with three problems nobody has solved. First, you can't share data; you can only give it away.

**[00:28-00:53]** A copy is as good as the original, so the moment it leaves, you've lost it. You can lend a car and get it back; you can't lend a dataset. Second, even when both sides want to work together, the law often makes it impossible. A hospital can't send you patient records, no matter how good your intentions are.

**[00:53-01:19]** And they shouldn't be able to. The third problem follows from the first two: the data that could do the most good is the data that never gets used at all. [A short list of examples is difficult to hear clearly.] Twenty years of lab work can sit on a drive because sharing it once means losing it forever.

**[01:19-01:45]** Almost every AI model in the world today is trained on the data that happens to be shareable, not the data that matters most. That's why we created Sirius. Sirius lets you learn from data without ever handing it over. The dataset stays encrypted with its owner. Instead of sending the data to the buyer, we send the compute to the data. What comes back is a trained model,

**[01:45-02:10]** not a copy. Payment and delivery happen at the same moment, so neither side has to go first. We believe data has stayed outside everything this industry has built, not because nobody tried, but because the missing piece was never storage or another marketplace. It was the ability to use data without receiving it. Here's how it works.

**[02:10-02:37]** Sirius solves the problem in one line: your data stays usable without ever being exposed. Let me show you what that means in practice. Connecting takes one click with a wallet today, with Google login coming, because data owners are not always crypto-native. That matters for adoption.

**[02:38-03:03]** I connect and sign in on Mezo. Every escrow, settlement, and proof we're about to see is anchored there. In the dashboard, we see the balance, EVM transactions, the marketplace, training, and my datasets. There are

**[03:03-03:34]** three things you can do here: browse the market, train a model, or bring your data. Starting with My Datasets, this is the data-owner side. I have one industrial test dataset published in the marketplace. We can upload a dataset, enter its name, description, price, and refund window, and then

**[03:34-04:03]** upload the data. After upload, it appears in the owner's dataset area and can be published. Once the publishing transaction is submitted, we can see that it is public. We can also unlist it or make it private. Now let's go to

**[04:03-04:27]** the borrower side, where we can see the dataset we uploaded and others that have already been published. Let's try to borrow one. Borrowing creates a conditional escrow with a price, refund window, and key details. The data stays encrypted throughout.

**[04:27-04:52]** What you get back is a model, never the raw rows. When we train, we can see the model we selected. At the end of the training area, we can see the models and training runs. We can also verify and download the model once it is

**[04:52-05:18]** trained. That's the full loop: list, borrow, train, and settle, with the data encrypted end-to-end. Sirius is the infrastructure that makes confidential data lending work for AI agents. Thanks, and we hope to keep updating it.

### 19. 27/08/2026 09:15 UTC

ID : `2092903920997642411`  
https://x.com/Sirius_data/status/2092903920997642411

> The world's most valuable data is also the data nobody can use.  
> Healthcare. Finance. Insurance. Industry.  
> Deep history, real-world outcomes, high-quality labels.  
> Exactly what AI needs and exactly what regulation makes nearly impossible to share.  
> Our thesis with Sirius is simple:  
> What if you could extract value from a dataset without ever sharing it?  
> That's what we're building  
>
> https://sirius-whitepaper.vercel.app

## Sources et méthode

- Profil X public et rendu serveur de la timeline
- Flux RSS public FixupX : https://fixupx.com/Sirius_data/feed.xml
- Métadonnées et médias publics FxTwitter/VxTwitter
- Médias originaux hébergés sur video.twimg.com et pbs.twimg.com
- Article long récupéré depuis les métadonnées publiques de la publication 2094439561866756509
- Archive constituée le 30 septembre 2026
