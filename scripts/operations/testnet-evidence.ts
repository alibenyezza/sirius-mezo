// B2.4 — Preuve d'un parcours réel sur testnet, en lecture seule.
// Relève au même bloc stable : soldes ETH et USDC des wallets, crédits dus dans chaque escrow,
// comptabilité des escrows, état des prêts suivis et reçus canoniques des transactions du
// parcours. Deux relevés se comparent pour obtenir les deltas d'une étape. Les reçus sortent au
// format attendu par le rapprochement A2 (`--receipts`). Aucune signature, aucune transaction.
import type { Abi, Hex } from "viem";
import { erc20Abi } from "../../src/lib/evm/abi/erc20";
import { siriusescrowAbi } from "../../src/lib/evm/abi/siriusescrow";
import { siriusescrowv7Abi } from "../../src/lib/evm/abi/siriusescrowv7";

export type EscrowVersion = "v5" | "v6" | "v7";
const ABIS: Record<EscrowVersion, Abi> = { v5: siriusescrowAbi as Abi, v6: siriusescrowAbi as Abi, v7: siriusescrowv7Abi as Abi };
const STATUS = ["none", "locked", "released", "refunded", "failed"];
const lower = (value: string) => value.toLowerCase();
const isAddress = (value: string) => /^0x[0-9a-f]{40}$/i.test(value);
const isHash = (value: string) => /^0x[0-9a-f]{64}$/i.test(value);

/** Sous-ensemble du client viem utilisé, toutes lectures épinglées au bloc stable. */
export interface EvidenceReader {
  getChainId(): Promise<number>;
  getBlock(args: { blockNumber: bigint }): Promise<{ number: bigint | null; hash: Hex | null; timestamp: bigint }>;
  getBalance(args: { address: Hex; blockNumber: bigint }): Promise<bigint>;
  readContract(args: { address: Hex; abi: Abi; functionName: string; args?: readonly unknown[]; blockNumber: bigint }): Promise<unknown>;
  getTransactionReceipt(args: { hash: Hex }): Promise<{ transactionHash: Hex; status: "success" | "reverted"; blockNumber: bigint; blockHash: Hex;
    gasUsed: bigint; effectiveGasPrice: bigint; from: Hex; to: Hex | null }>;
}

export interface EvidenceInput {
  reader: EvidenceReader;
  chainId: number;
  stableBlock: { number: bigint; hash: Hex };
  usdc: { address: string; decimals: number };
  accounts: Array<{ label: string; address: string }>;
  escrows: Array<{ address: string; version: EscrowVersion }>;
  loans?: Array<{ escrow: string; loanKey: string }>;
  transactions?: string[];
  now?: number;
}

export async function collectEvidence(input: EvidenceInput) {
  const { reader, stableBlock } = input;
  if (!Number.isSafeInteger(input.chainId) || input.chainId < 1 || !isHash(stableBlock.hash) || stableBlock.number < BigInt(0)) throw new Error("Bloc stable invalide");
  if (!isAddress(input.usdc.address) || !Number.isSafeInteger(input.usdc.decimals) || input.usdc.decimals < 6 || input.usdc.decimals > 30) throw new Error("Token USDC invalide");
  if (!input.accounts.length || input.accounts.some((a) => !isAddress(a.address) || !a.label)) throw new Error("Comptes à relever invalides");
  if (!input.escrows.length || input.escrows.some((e) => !isAddress(e.address) || !(e.version in ABIS))) throw new Error("Escrows à relever invalides");
  const labels = new Set(input.accounts.map((a) => a.label));
  if (labels.size !== input.accounts.length) throw new Error("Libellé de compte en double");
  if (await reader.getChainId() !== input.chainId) throw new Error("RPC sur un autre réseau");
  const block = await reader.getBlock({ blockNumber: stableBlock.number });
  if (block.number !== stableBlock.number || !block.hash || lower(block.hash) !== lower(stableBlock.hash)) throw new Error("Bloc stable non canonique");
  const at = { blockNumber: stableBlock.number };
  const escrowAbi = (address: string) => ABIS[input.escrows.find((e) => lower(e.address) === lower(address))!.version];

  const accounts = [];
  for (const account of input.accounts) {
    const address = lower(account.address) as Hex;
    const [eth, usdc] = await Promise.all([
      reader.getBalance({ address, ...at }),
      reader.readContract({ address: lower(input.usdc.address) as Hex, abi: erc20Abi as Abi, functionName: "balanceOf", args: [address], ...at }),
    ]);
    const credits: Record<string, string> = {};
    for (const escrow of input.escrows) {
      credits[lower(escrow.address)] = String(await reader.readContract({ address: lower(escrow.address) as Hex, abi: ABIS[escrow.version], functionName: "creditOf", args: [address], ...at }));
    }
    accounts.push({ label: account.label, address, ethWei: String(eth), usdcAtomic: String(usdc), credits });
  }

  const escrows = [];
  for (const escrow of input.escrows) {
    const address = lower(escrow.address) as Hex;
    const [version, accounting] = await Promise.all([
      reader.readContract({ address, abi: ABIS[escrow.version], functionName: "VERSION", ...at }),
      reader.readContract({ address, abi: ABIS[escrow.version], functionName: "accounting", ...at }) as Promise<readonly bigint[]>,
    ]);
    if (version !== `sirius-escrow-usdc-${escrow.version}`) throw new Error("Version d'escrow différente de celle annoncée");
    escrows.push({ address, version: escrow.version, lockedAtomic: String(accounting[0]), owedAtomic: String(accounting[1]), balanceAtomic: String(accounting[2]), seq: String(accounting[3]) });
  }

  const loans = [];
  for (const item of input.loans ?? []) {
    if (!isAddress(item.escrow) || !isHash(item.loanKey) || !input.escrows.some((e) => lower(e.address) === lower(item.escrow))) throw new Error("Prêt à relever invalide");
    const address = lower(item.escrow) as Hex;
    const abi = escrowAbi(address);
    const [loan, refundable, releasable] = await Promise.all([
      reader.readContract({ address, abi, functionName: "getLoan", args: [item.loanKey], ...at }) as Promise<Record<string, unknown>>,
      reader.readContract({ address, abi, functionName: "isRefundable", args: [item.loanKey], ...at }),
      reader.readContract({ address, abi, functionName: "isReleasable", args: [item.loanKey], ...at }),
    ]);
    const status = Number(loan.status);
    const v7 = "computeAmount" in loan;
    loans.push({
      escrow: address, loanKey: lower(item.loanKey), status: STATUS[status] ?? `unknown-${status}`,
      borrower: loan.borrower ? lower(String(loan.borrower)) : null, provider: loan.provider ? lower(String(loan.provider)) : null,
      datasetAmountAtomic: String(v7 ? loan.datasetAmount : loan.amount), computeAmountAtomic: v7 ? String(loan.computeAmount) : "0",
      maxFailureFeeAtomic: v7 ? String(loan.maxFailureFee) : "0", consumedComputeAtomic: v7 ? String(loan.consumedCompute) : "0",
      deadlineSeconds: Number(loan.deadline), refundable: Boolean(refundable), releasable: Boolean(releasable),
    });
  }

  const transactions = [];
  for (const hash of input.transactions ?? []) {
    if (!isHash(hash)) throw new Error("Hash de transaction invalide");
    const receipt = await reader.getTransactionReceipt({ hash: lower(hash) as Hex });
    if (lower(receipt.transactionHash) !== lower(hash)) throw new Error("Reçu hors scope");
    if (receipt.blockNumber > stableBlock.number) throw new Error("Transaction au-delà du bloc stable : attendre la finalité");
    const canonical = await reader.getBlock({ blockNumber: receipt.blockNumber });
    if (!canonical.hash || lower(canonical.hash) !== lower(receipt.blockHash)) throw new Error("Reçu non canonique : réorganisation");
    transactions.push({ transactionHash: lower(hash), status: receipt.status, blockNumber: String(receipt.blockNumber), blockHash: lower(receipt.blockHash),
      from: lower(receipt.from), to: receipt.to ? lower(receipt.to) : null, gasUsed: String(receipt.gasUsed), effectiveGasPriceWei: String(receipt.effectiveGasPrice),
      confirmations: String(stableBlock.number - receipt.blockNumber + BigInt(1)) });
  }

  return {
    version: 1 as const, kind: "sirius-testnet-evidence" as const, chainId: input.chainId, observedAtMs: input.now ?? Date.now(),
    stableBlock: { number: String(stableBlock.number), hash: lower(stableBlock.hash), timestampSeconds: String(block.timestamp) },
    usdc: { address: lower(input.usdc.address), decimals: input.usdc.decimals },
    accounts, escrows, loans, transactions,
    /** Même format que l'entrée `--receipts` du rapprochement A2. */
    receiptsForReconcile: transactions.map((tx) => ({ transactionHash: tx.transactionHash, status: tx.status, gasUsed: tx.gasUsed, effectiveGasPriceWei: tx.effectiveGasPriceWei })),
    note: "Relevé en lecture seule au bloc stable. Un solde n'est pas un revenu : voir le rapprochement A2 pour la classification.",
  };
}

export type Evidence = Awaited<ReturnType<typeof collectEvidence>>;

/** Deltas entre deux relevés du même réseau : ce qu'une étape du parcours a changé. */
export function diffEvidence(before: Evidence, after: Evidence) {
  for (const doc of [before, after]) if (doc?.version !== 1 || doc.kind !== "sirius-testnet-evidence") throw new Error("Relevé invalide");
  if (before.chainId !== after.chainId || before.usdc.address !== after.usdc.address) throw new Error("Relevés de réseaux ou de tokens différents");
  if (BigInt(after.stableBlock.number) < BigInt(before.stableBlock.number)) throw new Error("Le relevé « après » précède le relevé « avant »");
  const delta = (a: string, b: string) => String(BigInt(b) - BigInt(a));
  const accounts = after.accounts.map((now) => {
    const was = before.accounts.find((item) => item.address === now.address);
    if (!was) return { label: now.label, address: now.address, new: true, ethWeiDelta: null, usdcAtomicDelta: null, creditsDelta: null };
    const credits: Record<string, string> = {};
    for (const [escrow, value] of Object.entries(now.credits)) credits[escrow] = delta(was.credits[escrow] ?? "0", value);
    return { label: now.label, address: now.address, new: false, ethWeiDelta: delta(was.ethWei, now.ethWei), usdcAtomicDelta: delta(was.usdcAtomic, now.usdcAtomic), creditsDelta: credits };
  });
  const escrows = after.escrows.map((now) => {
    const was = before.escrows.find((item) => item.address === now.address);
    return { address: now.address, version: now.version, lockedAtomicDelta: was ? delta(was.lockedAtomic, now.lockedAtomic) : null,
      owedAtomicDelta: was ? delta(was.owedAtomic, now.owedAtomic) : null, eventsSinceBefore: was ? delta(was.seq, now.seq) : null };
  });
  const loans = after.loans.map((now) => {
    const was = before.loans.find((item) => item.escrow === now.escrow && item.loanKey === now.loanKey);
    return { escrow: now.escrow, loanKey: now.loanKey, statusBefore: was?.status ?? null, statusAfter: now.status,
      consumedComputeDelta: was ? delta(was.consumedComputeAtomic, now.consumedComputeAtomic) : null };
  });
  const seen = new Set(before.transactions.map((tx) => tx.transactionHash));
  const newTransactions = after.transactions.filter((tx) => !seen.has(tx.transactionHash));
  const usdcMoved = accounts.reduce((total, item) => total + (item.usdcAtomicDelta === null ? BigInt(0) : BigInt(item.usdcAtomicDelta)), BigInt(0));
  return {
    version: 1 as const, kind: "sirius-testnet-evidence-diff" as const, chainId: after.chainId,
    blocks: { before: before.stableBlock.number, after: after.stableBlock.number },
    accounts, escrows, loans, newTransactions,
    usdcMovedBetweenTrackedAccountsAtomic: String(usdcMoved),
    gasSpentWei: String(newTransactions.reduce((total, tx) => total + BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPriceWei), BigInt(0))),
    note: "Deltas entre deux blocs stables ; un solde net des comptes suivis différent de zéro signifie qu'un compte non suivi (escrow, tiers) a bougé.",
  };
}

/** `provider:0x…` → { label, address } ; `v7:0x…` → escrow ; `0xESCROW:0xKEY` → prêt. */
export function parseAccount(value: string) {
  const match = /^([a-z][a-z0-9-]{0,31}):(0x[0-9a-fA-F]{40})$/.exec(value);
  if (!match) throw new Error("Compte attendu sous la forme libellé:adresse");
  return { label: String(match[1]), address: String(match[2]).toLowerCase() };
}
export function parseEscrow(value: string) {
  const match = /^(v5|v6|v7):(0x[0-9a-fA-F]{40})$/.exec(value);
  if (!match) throw new Error("Escrow attendu sous la forme version:adresse");
  return { version: match[1] as EscrowVersion, address: String(match[2]).toLowerCase() };
}
export function parseLoan(value: string) {
  const match = /^(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]{64})$/.exec(value);
  if (!match) throw new Error("Prêt attendu sous la forme escrow:clé");
  return { escrow: String(match[1]).toLowerCase(), loanKey: String(match[2]).toLowerCase() };
}
