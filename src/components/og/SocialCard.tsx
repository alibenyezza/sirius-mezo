import { ImageResponse } from "next/og";

/**
 * Image d'aperçu de lien (Open Graph et X), générée par `next/og` au lieu d'un PNG figé.
 * Utilisée par src/app/opengraph-image.tsx.
 */

const SOCIAL_CARD_SIZE = { width: 1200, height: 630 };

const BACKGROUND = "#111318";
const ACCENT = "#F7931A";

export function socialCard(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px 96px",
          background: BACKGROUND,
          color: "#F5F5F4",
        }}
      >
        <div style={{ display: "flex", width: 120, height: 10, borderRadius: 5, background: ACCENT }} />
        <div style={{ display: "flex", marginTop: 48, fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>
          Sirius on&nbsp;<span style={{ color: ACCENT }}>Mezo</span>
        </div>
        <div style={{ display: "flex", marginTop: 32, maxWidth: 960, fontSize: 40, lineHeight: 1.35, color: "#A8A29E" }}>
          Rent private data for one training run. Pay in MUSD, from your Bitcoin.
        </div>
      </div>
    ),
    SOCIAL_CARD_SIZE,
  );
}
