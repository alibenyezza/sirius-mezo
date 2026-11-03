/**
 * Reçu d'exécution hors enclave : ce que le compte de règlement signe.
 *
 * Le message EIP-191 est le hash SHA-256 brut (32 octets) du payload attesté, celui que
 * porterait une quote TDX en mode enclave. Le signataire attendu est le `lockAuthorizer`
 * immuable de l'escrow : la clé à laquelle le contrat fait déjà confiance pour autoriser
 * chaque lock. Un reçu ne prouve pas l'isolation matérielle ; il prouve que l'opérateur de
 * l'escrow s'engage publiquement, et de façon non répudiable, sur ce résultat précis.
 * Module pur, partagé par la signature (serveur) et la vérification.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function receiptMessage(payloadHash: string): { raw: `0x${string}` } {
  const hash = payloadHash.toLowerCase();
  if (!SHA256_HEX.test(hash)) throw new Error("Hash attesté invalide : SHA-256 hexadécimal attendu");
  return { raw: `0x${hash}` };
}

export const RECEIPT_SIGNATURE = /^0x[0-9a-fA-F]{130}$/;
