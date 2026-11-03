import { NextResponse } from "next/server";
import { mezoFeatures } from "@/lib/mezo/features";
import { readPlatformFee } from "@/lib/mezo/platform-fee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fonctions Mezo activées sur cette instance, et frais de plateforme lus sur l'escrow :
 * les écrans s'en servent pour afficher leurs boutons et ce que le fournisseur recevra.
 */
export async function GET() {
  const platformFee = await readPlatformFee();
  return NextResponse.json({ ...mezoFeatures(), platformFee }, { headers: { "cache-control": "no-store" } });
}
