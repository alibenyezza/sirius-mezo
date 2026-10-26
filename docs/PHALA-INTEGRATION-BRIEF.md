# Sirius — dstack Integration Brief

**Confidential data lending on Intel TDX**
Prepared for Phala Network · September 2026

---

## 1. Summary

Sirius is a protocol for renting access to valuable datasets without ever exposing them.
A data owner publishes an encrypted dataset; a buyer submits a supported training workload;
the model is produced inside a TEE and delivered against an on-chain settlement. The raw
data never leaves the enclave, and the buyer receives only the trained model.

The protocol runs end-to-end on the Mezo testnet today. The confidential compute
layer is implemented against dstack and validated against a simulator; what remains is
deployment on a real CVM and the capture of its measurements.

This document describes how Sirius uses dstack, what is already built, and what our
deployment on Phala Cloud will look like.

---

## 2. Why we need an attested TEE

Sirius rests on a claim: sensitive data can be made useful without its owner surrendering
a copy. Without hardware attestation, that claim reduces to "trust the operator not to look",
which is precisely the assumption our users cannot make — they are companies whose datasets
are their commercial position.

Attestation is what converts the claim into something a counterparty verifies independently.
It is the reason we are on dstack rather than a conventional container platform, and it is
the milestone we treat as gating everything else on our roadmap.

---

## 3. Architecture

```
Browser                     Next.js (serverless)             CVM (dstack / TDX)
  │                                │                                │
  ├── AES-256-GCM encrypt          │                                │
  ├── encrypted blob ─────────────►│── IPFS pin                     │
  │                                │                                │
  │                                ├── HTTPS + RA-TLS ─────────────►│ seal-dataset
  │                                │                                │ run-training
  │                                │◄──── TDX quote + capsule ──────┤ escrow-hashlock
  │                                │                                │
  │                          Mezo (EVM)                  │
  │                                │◄──── SiriusEscrow.release ─────┤
  └──── capsule opened by published preimage ──────────────────────►│
```

Three components:

- **Next.js application** — orchestration, catalogue, application database. Serverless,
  holds no enclave secret, and never receives a plaintext dataset: encryption happens in the
  browser before upload.
- **Confidential runner** — a standalone HTTP service, the only holder of the enclave master
  key. This is the workload we deploy on Phala. It is deliberately separate from the Next.js
  application so that the measured code stays minimal and stable, per Phala's own guidance on
  keeping `compose_hash` small.
- **EVM contracts** — `SiriusEscrow` (USDC hashlock), `SiriusKybRegistry` (EIP-712 attestations),
  `SiriusDatasetRegistry` (non-transferable dataset title with tombstone on destruction).

Settlement is atomic by construction: the preimage that unlocks the buyer's model capsule is
published in the same transaction that credits the provider. Neither side can take the other's
half and leave.

---

## 4. How we use dstack

Integration lives in `src/lib/tee/dstack.ts`, `src/lib/tee/quote.ts` and
`src/lib/tee/identity.ts`, against `@phala/dstack-sdk` 0.5.8.

### 4.1 Enclave-sealed master key

```
DstackClient().getKey("sirius/master/v1")
```

The master key is derived inside the CVM and never injected through the environment. Every
other secret in the system descends from it: dataset key wrapping, the escrow preimage, HMAC
receipts, and the EVM account that submits `release` and `refund`.

The derivation path is versioned and treated as immutable — rotating it without a migration
plan would make every previously encrypted dataset unrecoverable. We refuse an empty
`signature_chain` outside the simulator, and pin its canonical SHA-256 so that a key delivered
by an unexpected KMS is rejected rather than used.

### 4.2 Attestation bound to business output

```
DstackClient().getQuote(payloadHash)
```

`report_data` carries the hash of the actual job result, not a nonce. The application therefore
verifies not merely that *a* TDX enclave answered, but that the enclave produced *this* result,
before accepting the capsule and authorising settlement. Quotes are persisted per loan and
exposed at `GET /api/loans/[id]/attestation`.

### 4.3 Full code identity

Beyond the quote signature and TCB status, we replay the RTMR3 event log, bind the
`compose-hash` event strictly, and pin `mrTd`, `RTMR3` and `compose_hash`. An unset pin yields
an *indeterminate* identity rather than a passing one — verification is tri-state by design,
so a missing configuration cannot be mistaken for a successful check.

### 4.4 RA-TLS

The runner serves TLS 1.3 with a dstack-issued certificate whose SHA-256 is carried in the
quote's `report_data`. The application fetches `/ra-tls` once, verifies the quote against the
presented certificate, and pins it. Trust comes from the attested measurement rather than from
a certificate authority. Capture tooling: `pnpm runner:capture-ra-tls`.

---

## 5. Implementation status

| Area | State |
|---|---|
| Enclave-sealed master key (`getKey`) | Implemented, tested against a fake guest agent |
| TDX quote generation and verification | Implemented, validated on a real TDX fixture (`UpToDate`) |
| Event-log replay, `compose_hash` binding, measurement pinning | Implemented; real values not yet captured |
| RA-TLS transport with certificate pinning | Code complete; not yet exercised against a real CVM |
| Isolated runner service, hardened container | Implemented; production image not yet published |
| EVM contracts on Mezo testnet | Deployed |
| Full loan on a real CVM | **Not yet done — this deployment is the remaining step** |

We are explicit about the last line. Everything upstream of it is code we have written and
tested; none of it has met real confidential hardware.

---

## 6. Deployment plan

1. Publish an immutable runner image, pinned by digest rather than tag.
2. Create a CVM from `deploy/phala/compose.yaml`, with sealed environment variables passed
   through `-e` so that no secret enters `compose_hash`.
3. Fund the settlement account. It is derived inside the enclave from the sealed master key;
   its private key is never injected, and its address is read from the runner's boot log.
4. Capture RA-TLS measurements, then pin `SIRIUS_EXPECTED_MRTD`, `SIRIUS_EXPECTED_RTMR3`,
   `SIRIUS_EXPECTED_COMPOSE_HASH`, the KMS signature-chain fingerprint and the ingress key
   fingerprint in the application environment — never in the CVM's own compose, which would
   change the hash at the moment of pinning it.
5. Run an authenticated smoke test over RA-TLS.
6. Stop and restart the same CVM, re-capture, and verify that both the measurements and the
   derived settlement address are unchanged. This is our persistence test for the sealed key.
7. Execute a complete testnet loan: lock, scope check, training, release, capsule opening,
   credit withdrawal.

Steps 1 to 3 are automated in our CI only up to image publication. CVM deployment stays a
manual, human decision: every image or compose change alters the identity the application
pins, and must be followed by a fresh capture.

---

## 7. Workload profile

A single CPU CVM, sized `tdx.small`, is sufficient. The workload is deliberately bounded.

| Dimension | Value |
|---|---|
| Instance | `tdx.small` — 1 vCPU, 2 GB |
| Container limits | 1.0 CPU, 768 MB, 128 PIDs, read-only filesystem, all capabilities dropped |
| Exposed port | 4100, TLS passthrough via the dstack gateway |
| Concurrent training jobs | 1 |
| Concurrent uploads | 1 |
| Request body cap | 24 MB (a 16 MiB dataset plus envelope overhead) |
| Training timeout | 15 s, cooperative |
| Dataset bounds | 20 000 rows, 64 columns |
| Model bounds | 31 features, 20 M estimated operations |
| Persistent volume | Anti-replay registry only, a few MB |

Topology: one stable CVM, started and stopped manually during test sessions rather than
created per job. A stable `app_id` is a hard requirement — the sealed key depends on it.

Supported operations, all explicitly enumerated rather than arbitrary code:
`dataset-ingress-key`, `seal-dataset`, `run-training`, `escrow-hashlock`, `run-loan-job`,
`settle-loan`, `loan-model-key`, `self-train-key`.

---

## 8. Security posture

The runner is the trust boundary, and is treated as such.

- **No arbitrary code execution.** Buyers select from a catalogue of protocol-supported
  workloads. Deterministic linear regression today; classification and tree-based models next.
  Arbitrary buyer code is explicitly out of scope.
- **Output gate.** Model weights are quantised to 6 significant figures, serialised canonically
  with a fixed field order, and capped at 256 KB with at most 10 000 coefficients. This bounds
  the capacity of any covert channel out of the enclave rather than trusting the training code
  not to open one.
- **Anti-inversion floor.** Training is refused below 100 rows, or below 10 rows per parameter,
  to prevent trivial reconstruction of small datasets from the coefficients.
- **Authorisation.** Every call carries a capability scoped to one operation and one resource,
  plus a 60-second P-256 wallet grant. A persistent anti-replay registry survives restarts.
- **Transport.** Capability verified before the request body is read; `Content-Length` mandatory;
  differentiated size caps; connection, request and job ceilings.
- **Key destruction.** Deleting a dataset destroys its wrapped key and leaves an on-chain
  tombstone. The encrypted blob may remain pinned on IPFS indefinitely and is unreadable to
  everyone, operator included.

---

## 9. References

- Repository: `github.com/alibenyezza/sirius-mezo`
- CVM manifest: `deploy/phala/compose.yaml`
- dstack integration: `src/lib/tee/dstack.ts`, `src/lib/tee/quote.ts`, `src/lib/tee/identity.ts`
- Runner service: `src/runner/`
- Deployment procedure: `docs/PHALA.md`
- Architecture and decisions: `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`

## Contact

**Ali Ben Yezza** — Co-founder, Sirius
byezzaali@gmail.com
