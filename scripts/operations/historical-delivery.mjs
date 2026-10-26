export function historicalDeliveryInventory(rows) {
  const results = rows.map((row) => {
    let state = "missing-receipt";
    let mismatches = [];
    try {
      if (typeof row.receipt === "string" && row.receipt.length <= 8192) {
        const parts = row.receipt.split(".");
        if (parts.length !== 2 || Buffer.from(parts[1], "base64url").length !== 32) throw new Error();
        const receipt = JSON.parse(Buffer.from(parts[0], "base64url").toString());
        const loan = row.kind === "loan";
        const legacyProfile = receipt.version === 2 && receipt.modelId === undefined && receipt.modelVersion === undefined;
        const subject = loan ? receipt.borrower : receipt.owner;
        const checks = { version: [2, 3].includes(receipt.version), kind: receipt.kind === row.kind,
          id: (loan ? receipt.loanId : receipt.jobId) === row.id, datasetId: receipt.datasetId === row.datasetId,
          cid: receipt.modelCid === row.cid, modelId: legacyProfile || receipt.modelId === row.modelId,
          modelVersion: legacyProfile || receipt.modelVersion === row.modelVersion,
          subject: /^0x[0-9a-f]{40}$/.test(row.subject) && subject === row.subject,
          ...(loan ? { chainId: receipt.chainId === row.chainId,
            escrow: receipt.escrow === row.escrow && /^0x[0-9a-f]{40}$/.test(row.escrow), loanKey: receipt.loanKey === row.loanKey } : {}) };
        mismatches = Object.entries(checks).filter(([, matches]) => !matches).map(([field]) => field);
        const matches = mismatches.length === 0;
        state = matches ? (legacyProfile ? "legacy-profile-unattested" : "metadata-consistent") : "scope-mismatch";
        if (matches && row.status !== (loan ? "SETTLED" : "DONE")) state = "not-deliverable";
      }
    } catch { state = "invalid-receipt"; }
    return { kind: row.kind, id: row.id, subject: row.subject, state, mismatches };
  });
  return { checkedAt: new Date().toISOString(), historicalReferences: rows.length,
    metadataConsistent: results.filter((item) => item.state === "metadata-consistent").length,
    legacyProfileUnattested: results.filter((item) => item.state === "legacy-profile-unattested").length,
    metadataCompatible: results.filter((item) => ["metadata-consistent", "legacy-profile-unattested"].includes(item.state)).length,
    requiredWallets: [...new Set(results.map((item) => item.subject))].length,
    receiptSignaturesVerified: false, onChainSettlementVerified: false, modelDecryptionVerified: false, results };
}
