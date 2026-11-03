"use client";

import { useEffect, useState } from "react";
import type { PlatformFee } from "@/lib/mezo/platform-fee-math";

/**
 * Frais de plateforme de l'escrow configuré, lus une fois via `/api/mezo/features`.
 * `undefined` pendant le chargement, `null` quand l'escrow n'en prélève pas.
 */
export function usePlatformFee(): PlatformFee | null | undefined {
  const [fee, setFee] = useState<PlatformFee | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fetch("/api/mezo/features", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { platformFee?: PlatformFee | null } | null) => {
        if (alive) setFee(body?.platformFee ?? null);
      })
      .catch(() => {
        if (alive) setFee(null);
      });
    return () => {
      alive = false;
    };
  }, []);
  return fee;
}
