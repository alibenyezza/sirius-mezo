import { NextResponse } from "next/server";
import { mezoFeatures } from "@/lib/mezo/features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fonctions Mezo activées sur cette instance : lu par les écrans pour afficher ou non leurs boutons. */
export function GET() {
  return NextResponse.json(mezoFeatures(), { headers: { "cache-control": "no-store" } });
}
