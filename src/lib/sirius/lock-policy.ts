import { LOCK_AUTHORIZATION_TTL_SECONDS } from "@/lib/evm/lock-authorization";
import { AppError } from "@/lib/app-error";
import { PENDING_REAPER_TTL_MS } from "./reaper-policy";

/**
 * Marge sous le plafond du contrat (`deadline <= block.timestamp + 5 min`). Le dernier bloc a
 * quelques secondes de retard sur l'horloge du serveur : une échéance à pile cinq minutes est
 * refusée (`InvalidLockAuthorization`) quand la transaction part aussitôt, comme le relais
 * `lockWithSignature` qui re-signe l'autorisation juste avant d'envoyer.
 */
export const LOCK_AUTHORIZATION_CLOCK_MARGIN_SECONDS = 30;

export function lockAuthorizationDeadline(createdAt: Date, now = Date.now()): number {
  // L'autorisation expire avant que le reaper puisse libérer le dataset.
  const deadline = Math.min(
    Math.floor(now / 1_000) + LOCK_AUTHORIZATION_TTL_SECONDS - LOCK_AUTHORIZATION_CLOCK_MARGIN_SECONDS,
    Math.floor((createdAt.getTime() + PENDING_REAPER_TTL_MS - 60_000) / 1_000),
  );
  if (deadline < Math.floor(now / 1_000) + 60) {
    throw new AppError("Préparation du prêt expirée. Relance l’emprunt ; l’approbation du stablecoin reste acquise.", 409);
  }
  return deadline;
}
