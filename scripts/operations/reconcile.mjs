// A2.1 — Rapprochement comptable.
// Croise l'export du registre runner (A1, validé par A2.0), le relevé des escrows (A2.2), les
// factures fournisseurs et, s'ils sont fournis, les reçus de transactions. Chaque montant tombe
// dans une seule case : revenu acquis, dû aux tiers, charge engagée, réservation ou incertain.
// Un dépôt remboursable n'est jamais un revenu. Les écarts sont listés, jamais corrigés.
// Rejouer le rapprochement avec un export plus récent met à jour les observations sans créer une
// seconde dépense : la clé d'une entrée est (chainId, wallet, nature, identifiant).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { allocationCheck, validateAccountingExport } from "./accounting-export.mjs";

const MICROS = 1_000_000n;
const WEI = 10n ** 18n;
// Formats réels du runner : src/lib/billing/runner.ts (devis) et settlement.ts (règlements).
const WORKFLOW_ID = /^loan:(\d{1,12}):(0x[0-9a-f]{40}):(0x[0-9a-f]{64})$/i;
const SETTLEMENT_ID = /^(release|failure):(\d{1,12}):(0x[0-9a-f]{40}):(0x[0-9a-f]{64})$/i;
const INVOICE_STATUS = new Set(["paid", "due", "estimated"]);
const VERSIONS = new Set(["v5", "v6", "v7"]);
// Ordre des états : revenir en arrière signale un registre ou une chaîne qui a reculé.
const RANK = {
  loan: { open: 0, released: 1, failed: 1, refunded: 1 },
  workflow: { "not-started": 0, uncertain: 1, "result-missing": 1, "result-durable": 2, "failure-measured": 2 },
  operation: { reserved: 0, succeeded: 1, failed: 1 },
  invoice: { estimated: 0, due: 1, paid: 2 },
};

const unsigned = (value) => typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/.test(value);
const int = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const text = (value, max = 256) => typeof value === "string" && value.length > 0 && value.length <= max;
const isAddress = (value) => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value);
const isHash = (value) => typeof value === "string" && /^0x[0-9a-f]{64}$/i.test(value);
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const lower = (value) => String(value).toLowerCase();
const ceilDiv = (value, divisor) => (value + divisor - 1n) / divisor;
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0n);

function validateEvents(input, chainId) {
  const docs = Array.isArray(input) ? input : [input];
  if (!docs.length) throw new Error("Relevé des escrows absent");
  const escrows = new Map();
  const events = [];
  const seen = new Set();
  let stable = null;
  for (const doc of docs) {
    if (doc?.version !== 1 || doc.kind !== "sirius-escrow-events" || !Array.isArray(doc.events) || !Array.isArray(doc.escrows)
      || !doc.stableBlock || !unsigned(doc.stableBlock.number) || !isHash(doc.stableBlock.hash)) throw new Error("Relevé des escrows invalide");
    if (doc.chainId !== chainId) throw new Error("Relevé des escrows sur un autre réseau");
    const number = BigInt(doc.stableBlock.number);
    if (stable === null || number < stable.number) stable = { number, hash: lower(doc.stableBlock.hash) };
    for (const escrow of doc.escrows) {
      if (!isAddress(escrow.address) || !VERSIONS.has(escrow.version) || !unsigned(escrow.fromBlock) || !unsigned(escrow.toBlock)) {
        throw new Error("Escrow relevé invalide");
      }
      const address = lower(escrow.address);
      const known = escrows.get(address);
      if (known && known.version !== escrow.version) throw new Error("Version d'escrow contradictoire entre relevés");
      const from = BigInt(escrow.fromBlock), to = BigInt(escrow.toBlock);
      escrows.set(address, { address, version: escrow.version, events: (known?.events ?? 0) + escrow.events,
        fromBlock: known && known.fromBlock < from ? known.fromBlock : from, toBlock: known && known.toBlock > to ? known.toBlock : to });
    }
    for (const event of doc.events) {
      if (!isAddress(event.escrow) || !VERSIONS.has(event.version) || !unsigned(event.blockNumber) || !isHash(event.blockHash)
        || !isHash(event.transactionHash) || !int(event.logIndex) || (event.name !== null && !text(event.name))
        || (event.args !== null && (typeof event.args !== "object" || Array.isArray(event.args)))) throw new Error("Événement relevé invalide");
      const key = `${lower(event.blockHash)}:${event.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }
  }
  events.sort((a, b) => {
    const block = BigInt(a.blockNumber) - BigInt(b.blockNumber);
    return block !== 0n ? (block < 0n ? -1 : 1) : a.logIndex - b.logIndex;
  });
  return { stableBlock: stable, escrows: [...escrows.values()], events };
}

function validateInvoices(invoices) {
  if (!Array.isArray(invoices)) throw new Error("Factures invalides");
  const ids = new Set();
  return invoices.map((invoice) => {
    if (!invoice || !text(invoice.id) || !text(invoice.supplier, 64) || !isDate(invoice.periodStart) || !isDate(invoice.periodEnd)
      || invoice.periodStart > invoice.periodEnd || !unsigned(invoice.amountUsdMicros) || !INVOICE_STATUS.has(invoice.status)
      || (invoice.reference !== undefined && !text(invoice.reference))) throw new Error("Facture invalide");
    if (ids.has(invoice.id)) throw new Error("Facture en double");
    ids.add(invoice.id);
    return { id: invoice.id, supplier: invoice.supplier, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd,
      amountUsdMicros: invoice.amountUsdMicros, status: invoice.status, reference: invoice.reference ?? null };
  });
}

function validateReceipts(receipts) {
  if (!Array.isArray(receipts)) throw new Error("Reçus invalides");
  const byHash = new Map();
  for (const receipt of receipts) {
    if (!receipt || !isHash(receipt.transactionHash) || !["success", "reverted"].includes(receipt.status)
      || !unsigned(receipt.gasUsed) || !unsigned(receipt.effectiveGasPriceWei)) throw new Error("Reçu invalide");
    const hash = lower(receipt.transactionHash);
    if (byHash.has(hash)) throw new Error("Reçu en double");
    byHash.set(hash, { ...receipt, transactionHash: hash });
  }
  return byHash;
}

/**
 * @param {{
 *   export: object, events: object | object[], siriusAccounts: string[], usdcDecimals: number,
 *   usdPerUsdc?: { lowerMicros: string, upperMicros: string }, ethUsdMicrosUpperBound?: string | null,
 *   invoices?: object[], receipts?: object[], previous?: object | null, now?: number,
 * }} input
 */
export function reconcile(input) {
  const now = input.now ?? Date.now();
  const exp = validateAccountingExport(input.export);
  const chainId = exp.chainId;
  const wallet = lower(exp.wallet);
  const chain = validateEvents(input.events, chainId);
  if (!Array.isArray(input.siriusAccounts) || !input.siriusAccounts.length || !input.siriusAccounts.every(isAddress)) {
    throw new Error("Comptes Sirius requis : bénéficiaire compute et wallet runner");
  }
  const sirius = new Set(input.siriusAccounts.map(lower));
  if (!int(input.usdcDecimals, 6, 30)) throw new Error("Décimales du token à lire sur le contrat (6 à 30)");
  const bounds = input.usdPerUsdc ?? { lowerMicros: String(MICROS), upperMicros: String(MICROS) };
  if (!unsigned(bounds.lowerMicros) || !unsigned(bounds.upperMicros) || BigInt(bounds.lowerMicros) > MICROS || BigInt(bounds.upperMicros) < MICROS) {
    throw new Error("Bornes de conversion USD/USDC invalides");
  }
  const ethUsdUpper = input.ethUsdMicrosUpperBound ?? null;
  if (ethUsdUpper !== null && !unsigned(ethUsdUpper)) throw new Error("Borne ETH/USD invalide");
  const invoices = validateInvoices(input.invoices ?? []);
  const receipts = validateReceipts(input.receipts ?? []);
  const scale = 10n ** BigInt(input.usdcDecimals);
  // Revenus convertis au plancher, dettes et charges au plafond : jamais à l'avantage de Sirius.
  const usdLower = (atomic) => atomic * BigInt(bounds.lowerMicros) / scale;
  const usdUpper = (atomic) => ceilDiv(atomic * BigInt(bounds.upperMicros), scale);

  const gaps = [];
  const gap = (severity, code, ref, detail) => gaps.push({ severity, code, ref, detail });

  // 1. Chaîne : prêts, crédits par compte, index des transactions.
  const versionOf = new Map(chain.escrows.map((escrow) => [escrow.address, escrow.version]));
  const loans = new Map();
  const accounts = new Map();
  const txIndex = new Map();
  const loanOf = (escrow, loanKey) => {
    const ref = `${escrow}:${lower(loanKey)}`;
    if (!loans.has(ref)) {
      loans.set(ref, { ref, escrow, version: versionOf.get(escrow), loanKey: lower(loanKey), status: "open", borrower: null, provider: null,
        computeRecipient: null, datasetAmount: null, computeAmount: null, maxFailureFee: null, deadline: null, lockTx: null, lockBlock: null,
        resolutionTx: null, resolutionBlock: null, refundAmount: null, retainedFee: null, executions: [], credits: [], workflowId: null });
    }
    return loans.get(ref);
  };
  const accountOf = (address) => {
    const key = lower(address);
    if (!accounts.has(key)) accounts.set(key, { address: key, accrued: 0n, withdrawn: 0n, lastBalance: null });
    return accounts.get(key);
  };
  const resolve = (loan, status, event) => {
    if (loan.status !== "open") gap("critical", "loan-resolved-twice", loan.ref, "deux résolutions pour le même prêt dans le relevé");
    loan.status = status;
    loan.resolutionTx = lower(event.transactionHash);
    loan.resolutionBlock = event.blockNumber;
  };
  let undecoded = 0;
  for (const event of chain.events) {
    const escrow = lower(event.escrow);
    const hash = lower(event.transactionHash);
    if (!txIndex.has(hash)) txIndex.set(hash, []);
    txIndex.get(hash).push(event);
    if (event.name === null || !event.args) { undecoded++; continue; }
    const v7 = (versionOf.get(escrow) ?? event.version) === "v7";
    const a = event.args;
    switch (event.name) {
      case "LoanLocked": {
        const loan = loanOf(escrow, a.loanKey);
        if (loan.lockTx) gap("critical", "loan-locked-twice", loan.ref, "deux verrouillages pour le même prêt");
        loan.borrower = lower(a.borrower);
        loan.provider = lower(a.provider);
        loan.datasetAmount = BigInt(v7 ? a.datasetAmount : a.amount);
        loan.computeAmount = v7 ? BigInt(a.computeAmount) : 0n;
        loan.maxFailureFee = v7 ? BigInt(a.maxFailureFee) : 0n;
        loan.computeRecipient = v7 ? lower(a.computeRecipient) : null;
        loan.deadline = Number(a.deadline);
        loan.lockTx = hash;
        loan.lockBlock = event.blockNumber;
        break;
      }
      case "LoanReleased": {
        const loan = loanOf(escrow, a.loanKey);
        resolve(loan, "released", event);
        loan.provider ??= lower(a.provider);
        loan.datasetAmount ??= BigInt(v7 ? a.datasetAmount : a.amount);
        loan.computeAmount ??= v7 ? BigInt(a.computeAmount) : 0n;
        if (v7) loan.computeRecipient ??= lower(a.computeRecipient);
        break;
      }
      case "LoanFailed": {
        const loan = loanOf(escrow, a.loanKey);
        resolve(loan, "failed", event);
        loan.borrower ??= lower(a.borrower);
        loan.refundAmount = BigInt(a.refundAmount);
        loan.retainedFee = BigInt(a.retainedFee);
        break;
      }
      case "LoanRefunded": {
        const loan = loanOf(escrow, a.loanKey);
        resolve(loan, "refunded", event);
        loan.borrower ??= lower(a.borrower);
        loan.refundAmount = BigInt(v7 ? a.refundAmount : a.amount);
        loan.retainedFee = v7 ? BigInt(a.retainedFee) : 0n;
        break;
      }
      case "ExecutionRecorded":
        loanOf(escrow, a.loanKey).executions.push({ consumedCompute: BigInt(a.consumedCompute), evidenceHash: lower(a.evidenceHash),
          finalFailure: a.finalFailure === true, transactionHash: hash });
        break;
      case "CreditAccrued": {
        const account = accountOf(a.account);
        const amount = BigInt(a.amount);
        account.accrued += amount;
        account.lastBalance = BigInt(a.balance);
        loanOf(escrow, a.loanKey).credits.push({ account: account.address, amount });
        break;
      }
      case "Withdrawn":
        accountOf(a.account).withdrawn += BigInt(a.amount);
        break;
      default:
        break; // PreimageRevealed : sans effet comptable.
    }
  }
  if (undecoded) gap("warning", "undecoded-log", null, `${undecoded} journal(s) non décodé(s) conservé(s) bruts : à examiner`);
  for (const escrow of chain.escrows) {
    if (escrow.version !== "v7") gap("info", "historical-escrow", escrow.address, `escrow ${escrow.version} sans registre runner : crédits dus suivis, aucun revenu Sirius`);
  }

  // 2. Classement des crédits par cause, dépôts encore verrouillés, contrôles de cohérence.
  const revenueByCause = { computeOnRelease: 0n, retainedOnFailure: 0n, retainedOnRefund: 0n, other: 0n };
  const owedByCause = { providerDataset: 0n, borrowerRefund: 0n, other: 0n };
  let lockedDeposits = 0n;
  const openLoans = [];
  for (const loan of loans.values()) {
    if (loan.status === "open") {
      if (loan.lockTx) { lockedDeposits += loan.datasetAmount + loan.computeAmount; openLoans.push(loan.ref); }
      else gap("warning", "loan-without-lock", loan.ref, "événements sans verrouillage ni résolution relevés : montant inconnu");
    } else if (!loan.lockTx) {
      gap("info", "locked-outside-range", loan.ref, "verrouillage antérieur au relevé : montants tirés de la résolution");
    }
    if (loan.lockTx && loan.retainedFee !== null && loan.retainedFee > loan.maxFailureFee) {
      gap("critical", "retained-fee-above-cap", loan.ref, "retenue supérieure au plafond annoncé au verrouillage");
    }
    for (const credit of loan.credits) {
      if (sirius.has(credit.account)) {
        if (loan.status === "released") revenueByCause.computeOnRelease += credit.amount;
        else if (loan.status === "failed") revenueByCause.retainedOnFailure += credit.amount;
        else if (loan.status === "refunded") revenueByCause.retainedOnRefund += credit.amount;
        else { revenueByCause.other += credit.amount; gap("warning", "credit-on-open-loan", loan.ref, "crédit Sirius sur un prêt sans résolution relevée"); }
      } else if (credit.account === loan.provider && loan.status === "released") owedByCause.providerDataset += credit.amount;
      else if (credit.account === loan.borrower && (loan.status === "failed" || loan.status === "refunded")) owedByCause.borrowerRefund += credit.amount;
      else { owedByCause.other += credit.amount; gap("warning", "credit-unexplained", loan.ref, "crédit à un tiers sans cause identifiée"); }
    }
  }
  const accountRows = [...accounts.values()].map((account) => {
    const outstanding = account.accrued - account.withdrawn;
    if (outstanding < 0n) gap("critical", "withdrawal-exceeds-credit", account.address, "retraits supérieurs aux crédits relevés");
    if (account.lastBalance !== null && account.lastBalance > account.accrued) {
      gap("info", "credits-before-pull", account.address, "solde on-chain supérieur aux crédits relevés : crédits antérieurs au relevé");
    }
    return { address: account.address, sirius: sirius.has(account.address), accruedAtomic: String(account.accrued),
      withdrawnAtomic: String(account.withdrawn), outstandingAtomic: String(outstanding) };
  });
  const siriusAccrued = sum(accountRows.filter((row) => row.sirius), (row) => BigInt(row.accruedAtomic));
  const siriusWithdrawn = sum(accountRows.filter((row) => row.sirius), (row) => BigInt(row.withdrawnAtomic));
  const thirdPartyOutstanding = sum(accountRows.filter((row) => !row.sirius), (row) => BigInt(row.outstandingAtomic) > 0n ? BigInt(row.outstandingAtomic) : 0n);

  // 3. Devis du registre face aux prêts on-chain.
  let uncertainWorkflows = 0;
  let claimedFeesUnrecorded = 0n;
  const workflowRows = exp.workflows.map((workflow) => {
    const row = { id: workflow.id, checkpoint: workflow.checkpoint, budgetUsdMicros: workflow.budgetUsdMicros, budgetWei: workflow.budgetWei,
      loan: null, onChainStatus: null };
    if (workflow.checkpoint === "uncertain" || workflow.checkpoint === "result-missing") {
      uncertainWorkflows++;
      gap("warning", "execution-uncertain", workflow.id, `calcul au checkpoint ${workflow.checkpoint} : engagement conservé, aucune facture`);
    }
    const match = WORKFLOW_ID.exec(workflow.id);
    if (!match) { gap("warning", "workflow-id-unparsed", workflow.id, "identifiant de devis hors format loan:chainId:escrow:loanKey : réservation seule"); return row; }
    const [, cid, escrow, loanKey] = match;
    if (Number(cid) !== chainId) { gap("critical", "workflow-chain-mismatch", workflow.id, "devis d'un autre réseau dans ce registre"); return row; }
    row.loan = `${lower(escrow)}:${lower(loanKey)}`;
    if (!versionOf.has(lower(escrow))) { gap("info", "escrow-not-pulled", workflow.id, "escrow du devis absent du relevé : vérification on-chain impossible"); return row; }
    const loan = loans.get(row.loan);
    row.onChainStatus = loan ? loan.status : "not-locked";
    if (!loan) {
      if (workflow.checkpoint !== "not-started") gap("warning", "lock-not-found", workflow.id, "calcul engagé sans verrouillage relevé jusqu'au bloc stable");
      return row;
    }
    loan.workflowId = workflow.id;
    if (loan.status === "released" && workflow.checkpoint !== "result-durable") {
      gap("warning", "ledger-behind-chain", workflow.id, `prêt réglé on-chain mais checkpoint runner ${workflow.checkpoint}`);
    }
    if (loan.status === "failed" && workflow.checkpoint !== "failure-measured") {
      gap("warning", "ledger-behind-chain", workflow.id, `échec réglé on-chain mais checkpoint runner ${workflow.checkpoint}`);
    }
    if (loan.status === "refunded") gap("info", "refund-by-borrower", workflow.id, "remboursement à échéance réclamé on-chain ; le budget du devis reste alloué par prudence");
    if (workflow.failureClaim) {
      const claimed = BigInt(workflow.failureClaim.consumedComputeAtomic);
      const recorded = loan.executions.find((execution) => execution.evidenceHash === lower(workflow.failureClaim.evidenceHash));
      if (!recorded) {
        claimedFeesUnrecorded += claimed;
        gap("warning", "failure-claim-unrecorded", workflow.id, "reçu d'échec préparé mais non enregistré on-chain : retenue incertaine");
      } else if (recorded.consumedCompute !== claimed) {
        gap("critical", "failure-claim-mismatch", workflow.id, "consommation enregistrée on-chain différente du reçu du registre");
      }
    }
    return row;
  });

  // 4. Règlements du registre face aux transactions minées ; gas réel via les reçus.
  const settledOnChain = new Set();
  let gasEngagedWei = 0n;
  const operationRows = exp.operations.map((operation) => {
    const row = { id: operation.id, kind: operation.kind, state: operation.state, workflowId: operation.workflowId,
      budgetUsdMicros: operation.budgetUsdMicros, budgetWei: operation.budgetWei, transactionHash: operation.transactionHash, onChain: null, gasWei: null };
    if (operation.kind !== "transaction") return row;
    const hash = operation.transactionHash ? lower(operation.transactionHash) : null;
    const mined = hash ? txIndex.get(hash) : undefined;
    row.onChain = hash ? Boolean(mined) : null;
    const match = SETTLEMENT_ID.exec(operation.id);
    if (!match) {
      if (hash) gap("info", "operation-id-unparsed", operation.id, "transaction hors format release:/failure: : présence on-chain seule vérifiée");
      if (operation.state === "succeeded" && hash && !mined) gap("warning", "settlement-not-on-chain", operation.id, "transaction réussie selon le registre mais absente du relevé");
    } else {
      const [, kind, cid, escrow, loanKey] = match;
      const loanRef = `${lower(escrow)}:${lower(loanKey)}`;
      if (Number(cid) !== chainId) gap("critical", "operation-chain-mismatch", operation.id, "règlement d'un autre réseau dans ce registre");
      else if (!versionOf.has(lower(escrow))) { if (hash) gap("info", "escrow-not-pulled", operation.id, "escrow du règlement absent du relevé"); }
      else if (mined) {
        const expected = kind === "release" ? "LoanReleased" : "LoanFailed";
        const found = mined.some((event) => event.name === expected && lower(event.escrow) === lower(escrow) && lower(event.args?.loanKey ?? "") === lower(loanKey));
        if (found) settledOnChain.add(`${kind}:${loanRef}`);
        else gap("critical", "settlement-tx-mismatch", operation.id, "transaction minée sans l'événement attendu pour ce prêt");
        if (operation.state === "reserved") gap("warning", "pending-but-mined", operation.id, "transaction en attente déjà minée : exécuter runner:transactions reconcile");
        if (operation.state === "failed") gap("critical", "failed-op-but-mined", operation.id, "opération notée échouée mais transaction minée avec effet");
      } else if (operation.state === "succeeded") {
        gap("warning", "settlement-not-on-chain", operation.id, "règlement réussi selon le registre mais absent du relevé jusqu'au bloc stable");
      }
    }
    if (hash) {
      const receipt = receipts.get(hash);
      if (receipt) {
        row.gasWei = String(BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPriceWei));
        gasEngagedWei += BigInt(row.gasWei);
        if (receipt.status === "reverted" && operation.state === "succeeded") gap("critical", "receipt-reverted", operation.id, "reçu en revert pour une opération notée réussie");
      } else if (operation.state !== "reserved" || mined) {
        gap("warning", "gas-receipt-missing", operation.id, "gas réel inconnu : joindre le reçu canonique");
      }
    }
    return row;
  });
  const operationHashes = new Set(operationRows.map((row) => row.transactionHash && lower(row.transactionHash)).filter(Boolean));
  for (const hash of receipts.keys()) {
    if (!operationHashes.has(hash)) gap("info", "receipt-unmatched", hash, "reçu sans opération correspondante dans le registre");
  }
  for (const loan of loans.values()) {
    if (loan.version !== "v7") continue;
    const kind = loan.status === "released" ? "release" : loan.status === "failed" ? "failure" : null;
    if (kind && !settledOnChain.has(`${kind}:${loan.ref}`)) {
      gap("critical", "on-chain-without-runner-operation", loan.ref, "règlement v7 sans opération dans le registre : autre instance ou registre perdu");
    }
  }

  // 5. Factures et réservations.
  const bySupplier = {};
  let invoicesEngaged = 0n;
  let invoicesEstimated = 0n;
  for (const invoice of invoices) {
    const supplier = bySupplier[invoice.supplier] ??= { engagedUsdMicros: 0n, estimatedUsdMicros: 0n };
    if (invoice.status === "estimated") {
      invoicesEstimated += BigInt(invoice.amountUsdMicros);
      supplier.estimatedUsdMicros += BigInt(invoice.amountUsdMicros);
      gap("info", "invoice-estimated", invoice.id, "montant estimé, non engagé : provision");
    } else {
      invoicesEngaged += BigInt(invoice.amountUsdMicros);
      supplier.engagedUsdMicros += BigInt(invoice.amountUsdMicros);
    }
  }
  const allocation = allocationCheck(exp);
  if (!allocation.usdMicros.matches || !allocation.wei.matches) gap("critical", "allocation-mismatch", null, "total alloué différent de la somme devis + opérations hors devis");
  for (const pending of exp.pendingTransactions) {
    gap("warning", `pending-${pending.recovery}`, pending.id, "transaction incertaine : montant conservé en réservation, aucune charge ni revenu");
  }

  // 6. Entrées idempotentes et comparaison avec le rapprochement précédent.
  const entries = [];
  const entry = (kind, id, classification, data) => entries.push({ key: `${chainId}:${wallet}:${kind}:${id}`, kind, id, classification, ...data,
    firstSeenAtMs: now, lastSeenAtMs: now, observations: 1 });
  for (const loan of loans.values()) {
    entry("loan", loan.ref, loan.status, { escrow: loan.escrow, version: loan.version, loanKey: loan.loanKey, borrower: loan.borrower, provider: loan.provider,
      computeRecipient: loan.computeRecipient, datasetAmountAtomic: loan.datasetAmount === null ? null : String(loan.datasetAmount),
      computeAmountAtomic: loan.computeAmount === null ? null : String(loan.computeAmount),
      maxFailureFeeAtomic: loan.maxFailureFee === null ? null : String(loan.maxFailureFee),
      refundAmountAtomic: loan.refundAmount === null ? null : String(loan.refundAmount),
      retainedFeeAtomic: loan.retainedFee === null ? null : String(loan.retainedFee), deadlineSeconds: loan.deadline,
      lockTransactionHash: loan.lockTx, resolutionTransactionHash: loan.resolutionTx, runnerWorkflowId: loan.workflowId });
  }
  for (const row of workflowRows) entry("workflow", row.id, row.checkpoint, { loan: row.loan, onChainStatus: row.onChainStatus, budgetUsdMicros: row.budgetUsdMicros, budgetWei: row.budgetWei });
  for (const row of operationRows) entry("operation", row.id, row.state, { budgetKind: row.kind, workflowId: row.workflowId, budgetUsdMicros: row.budgetUsdMicros,
    budgetWei: row.budgetWei, transactionHash: row.transactionHash, onChain: row.onChain, gasWei: row.gasWei });
  for (const row of accountRows) entry("account", row.address, row.sirius ? "sirius" : "third-party", { accruedAtomic: row.accruedAtomic,
    withdrawnAtomic: row.withdrawnAtomic, outstandingAtomic: row.outstandingAtomic });
  for (const invoice of invoices) entry("invoice", invoice.id, invoice.status, { supplier: invoice.supplier, periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd, amountUsdMicros: invoice.amountUsdMicros, reference: invoice.reference });
  if (input.previous) {
    const previous = input.previous;
    if (previous.version !== 1 || previous.kind !== "sirius-reconciliation" || previous.chainId !== chainId || lower(previous.wallet) !== wallet
      || !Array.isArray(previous.entries)) throw new Error("Rapprochement précédent d'un autre registre");
    const known = new Map(previous.entries.map((item) => [item.key, item]));
    for (const item of entries) {
      const before = known.get(item.key);
      if (!before) continue;
      known.delete(item.key);
      item.firstSeenAtMs = int(before.firstSeenAtMs) ? before.firstSeenAtMs : now;
      item.observations = (int(before.observations) ? before.observations : 0) + 1;
      const rank = RANK[item.kind];
      if (rank && rank[item.classification] < rank[before.classification]) {
        gap("critical", "classification-regressed", item.key, `état revenu de ${before.classification} à ${item.classification} : registre ou chaîne en recul`);
      }
      if (item.kind === "account" && unsigned(before.accruedAtomic) && unsigned(before.withdrawnAtomic)
        && (BigInt(item.accruedAtomic) < BigInt(before.accruedAtomic) || BigInt(item.withdrawnAtomic) < BigInt(before.withdrawnAtomic))) {
        gap("critical", "account-regressed", item.key, "crédits ou retraits inférieurs au rapprochement précédent");
      }
    }
    for (const item of known.values()) {
      gap(item.kind === "workflow" || item.kind === "operation" ? "critical" : "info", "entry-disappeared", item.key,
        item.kind === "workflow" || item.kind === "operation" ? "ligne du registre disparue : registre remplacé ou restauré" : "entrée absente de ce relevé : plage ou factures différentes");
    }
  }

  // 7. Synthèse.
  const gasUsd = ethUsdUpper === null ? null : ceilDiv(gasEngagedWei * BigInt(ethUsdUpper), WEI);
  const engagedUsd = invoicesEngaged + (gasUsd ?? 0n);
  const acquiredUsd = usdLower(siriusAccrued);
  const severity = { critical: 0, warning: 0, info: 0 };
  for (const item of gaps) severity[item.severity]++;
  const money = (object) => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, String(value)]));
  return {
    version: 1, kind: "sirius-reconciliation", chainId, wallet, observedAtMs: now,
    level: severity.critical ? "critical" : severity.warning ? "warning" : "ok",
    inputs: { exportGeneratedAtMs: exp.generatedAtMs, stableBlock: { number: String(chain.stableBlock.number), hash: chain.stableBlock.hash },
      escrows: chain.escrows.map((escrow) => ({ ...escrow, fromBlock: String(escrow.fromBlock), toBlock: String(escrow.toBlock) })),
      events: chain.events.length, invoices: invoices.length, receipts: receipts.size, usdcDecimals: input.usdcDecimals,
      usdPerUsdc: { lowerMicros: bounds.lowerMicros, upperMicros: bounds.upperMicros }, ethUsdMicrosUpperBound: ethUsdUpper },
    revenue: { acquiredAtomic: String(siriusAccrued), inEscrowAtomic: String(siriusAccrued - siriusWithdrawn), withdrawnAtomic: String(siriusWithdrawn),
      byCause: money(revenueByCause), acquiredUsdMicrosLowerBound: String(acquiredUsd) },
    owed: { outstandingAtomic: String(thirdPartyOutstanding), outstandingUsdMicrosUpperBound: String(usdUpper(thirdPartyOutstanding)),
      lockedDepositsAtomic: String(lockedDeposits), lockedDepositsUsdMicrosUpperBound: String(usdUpper(lockedDeposits)), openLoans,
      accruedByCause: money(owedByCause), byAccount: accountRows },
    charges: { invoicesEngagedUsdMicros: String(invoicesEngaged), gasEngagedWei: String(gasEngagedWei),
      gasEngagedUsdMicrosUpperBound: gasUsd === null ? null : String(gasUsd), engagedUsdMicrosUpperBound: String(engagedUsd),
      bySupplier: Object.fromEntries(Object.entries(bySupplier).map(([supplier, value]) => [supplier, money(value)])) },
    provisions: { invoicesEstimatedUsdMicros: String(invoicesEstimated) },
    reservations: { allocatedUsdMicros: exp.totals.allocatedUsdMicros, allocatedWei: exp.totals.allocatedWei, remainingUsdMicros: exp.totals.remainingUsdMicros,
      remainingWei: exp.totals.remainingWei, workflows: exp.workflows.length, standaloneOperations: exp.operations.filter((operation) => operation.workflowId === null).length,
      allocation, note: "Expositions maximales réservées, pas des factures ; elles ne sont ni revenus ni charges." },
    uncertain: { pendingTransactions: exp.pendingTransactions.length, workflows: uncertainWorkflows, claimedFeesUnrecordedAtomic: String(claimedFeesUnrecorded),
      note: "Conservés hors revenus et hors charges jusqu'à réconciliation." },
    indicative: { acquiredMinusEngagedUsdMicros: String(acquiredUsd - engagedUsd),
      note: ethUsdUpper === null ? "Résultat indicatif hors gas (borne ETH/USD absente), hors réservations et incertains ; ce n'est pas un PnL."
        : "Résultat indicatif hors réservations et incertains ; revenus au plancher, charges au plafond ; ce n'est pas un PnL." },
    gaps, severity, entries,
    note: "Dépôts verrouillés et crédits dus ne sont jamais des revenus. Une entrée déjà vue est mise à jour, jamais comptée deux fois.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Usage : node scripts/operations/reconcile.mjs export.json releve.json[,releve2.json] --sirius=0x…,0x… --decimals=18
    //         [--invoices=f.json] [--receipts=f.json] [--previous=rapprochement.json] [--eth-usd-upper=MICROS] [--tariff=deploy/operations/tariff-proposal.json]
    const args = process.argv.slice(2);
    const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
    const files = args.filter((arg) => !arg.startsWith("--"));
    if (files.length !== 2 || args.some((arg) => arg.startsWith("--") && !/^--(sirius|decimals|invoices|receipts|previous|eth-usd-upper|tariff)=/.test(arg))) throw new Error();
    const read = (path) => JSON.parse(readFileSync(path, "utf8"));
    const tariff = read(option("tariff") ?? "deploy/operations/tariff-proposal.json");
    const report = reconcile({
      export: read(files[0]), events: files[1].split(",").map(read),
      siriusAccounts: (option("sirius") ?? "").split(",").filter(Boolean), usdcDecimals: Number(option("decimals")),
      usdPerUsdc: { lowerMicros: tariff.currency.usdPerUsdcLowerBoundMicros, upperMicros: tariff.currency.usdPerUsdcUpperBoundMicros },
      ethUsdMicrosUpperBound: option("eth-usd-upper") ?? null,
      invoices: option("invoices") ? read(option("invoices")) : [], receipts: option("receipts") ? read(option("receipts")) : [],
      previous: option("previous") ? read(option("previous")) : null,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.level === "critical" ? 2 : report.level === "warning" ? 1 : 0;
  } catch {
    console.error("Rapprochement refusé : vérifier export, relevé, comptes Sirius, décimales du token et fichiers optionnels. Aucune donnée modifiée.");
    process.exitCode = 3;
  }
}
