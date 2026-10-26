// A2.4 — État des limites fournisseurs. Un fournisseur n'est « vérifié » qu'après relevé de son
// tableau de bord (date, auteur, mode observé, recharge automatique, plafond configuré).
// Le résultat alimente `providerCapsVerified` du plan de coûts ; il ne modifie aucun compte.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const REQUIRED_SUPPLIERS = ["phala", "vercel", "neon", "pinata", "vps", "rpc", "github"];
const HARD_CAPS = new Set(["partial", "free-plan-only", "none-documented", "unknown", "not-applicable"]);
const text = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 600;
const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));

export function supplierReadiness(doc, now = Date.now(), maxAgeDays = 31) {
  if (doc?.version !== 1 || !Array.isArray(doc.suppliers)) throw new Error("Fiche fournisseurs invalide");
  const ids = doc.suppliers.map((s) => s?.id);
  if (new Set(ids).size !== ids.length || !REQUIRED_SUPPLIERS.every((id) => ids.includes(id))) {
    throw new Error("Fiche fournisseurs incomplète ou en double");
  }
  const suppliers = doc.suppliers.map((s) => {
    if (!text(s.id) || !text(s.usedFor) || !HARD_CAPS.has(s.hardCap) || !text(s.control) || !text(s.owner)
      || !Array.isArray(s.sources) || !s.dashboard || typeof s.dashboard !== "object") throw new Error("Fournisseur invalide");
    const d = s.dashboard;
    const blockers = [];
    if (!date(d.verifiedAt)) blockers.push("tableau de bord non relevé");
    else if (now - Date.parse(d.verifiedAt) > maxAgeDays * 86_400_000) blockers.push("relevé du tableau de bord trop ancien");
    if (!text(d.verifiedBy)) blockers.push("auteur du relevé absent");
    if (!text(d.observedMode)) blockers.push("offre ou mode de facturation observé absent");
    if (typeof d.autoRecharge !== "boolean") blockers.push("recharge automatique non relevée");
    else if (d.autoRecharge) blockers.push("recharge automatique active");
    if (typeof d.capConfigured !== "boolean") blockers.push("plafond ou alerte non relevé");
    const residualRisk = ["none-documented", "unknown"].includes(s.hardCap) || (s.hardCap !== "not-applicable" && d.capConfigured === false);
    return { id: s.id, owner: s.owner, hardCap: s.hardCap, verified: blockers.length === 0, blockers, residualRisk };
  });
  return {
    providerCapsVerified: suppliers.every((s) => s.verified),
    suppliers,
    note: "Un plafond vérifié ne vaut pas plafond global instantané : délais et postes exclus restent à couvrir par la réserve d'arrêt.",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = supplierReadiness(JSON.parse(readFileSync(process.argv[2] || "deploy/operations/supplier-limits.json", "utf8")));
    console.log(JSON.stringify(report, null, 2));
    if (process.argv.includes("--require-verified") && !report.providerCapsVerified) process.exitCode = 1;
  } catch {
    console.error("Fiche fournisseurs refusée : vérifier sa structure.");
    process.exitCode = 1;
  }
}
