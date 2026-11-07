import { NextResponse } from "next/server";
import { AppError } from "./app-error";

export { AppError };

/**
 * Réponse d'erreur uniforme. Les AppError exposent leur message ;
 * Les erreurs techniques restent opaques, y compris dans les logs : leur cause
 * peut contenir un préimage, un jeton RPC ou une chaîne de connexion.
 *
 * Seule la *classe* de l'erreur est journalisée : elle ne transporte aucun secret et
 * suffit à distinguer une panne réseau d'une erreur Prisma ou d'un bug — sans elle, un
 * 500 en recette ne laissait strictement rien à lire.
 */
export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Les trois premières lignes `at …` de la pile : des emplacements de code, jamais le
  // message, qui peut porter un secret. Sans elles, un TypeError en production ne dit pas où.
  const frames = err instanceof Error && typeof err.stack === "string"
    ? err.stack.split("\n").filter((line) => line.trim().startsWith("at ")).slice(0, 3).map((line) => line.trim()).join(" | ")
    : "";
  console.error(`[api] erreur interne (${err instanceof Error ? err.name : typeof err})${frames ? ` ${frames}` : ""}`);
  return NextResponse.json({ error: "Erreur interne — réessaye." }, { status: 500 });
}
