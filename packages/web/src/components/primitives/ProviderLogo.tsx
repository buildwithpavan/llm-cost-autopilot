/**
 * Generic model marker + model identity helpers.
 *
 * IMPORTANT: This project deliberately does NOT render vendor/provider logos
 * or trademark-like approximations. Model identity is communicated through the
 * MODEL NAME (primary) and provider/family text (secondary). The mark below is
 * an abstract, neutral "model chip" — a rounded node grid that does not
 * resemble any real vendor mark. It is purely decorative and secondary to the
 * model name.
 */

type Family =
  | "openai"
  | "anthropic"
  | "google"
  | "mock-cheap-small"
  | "mock-cheap-large"
  | "mock-fast"
  | "generic";

// Restrained, model-family accents (NOT brand colors — internal palette only).
const FAMILY_ACCENT: Record<Family, string> = {
  openai: "#26d68a",
  anthropic: "#f2ab47",
  google: "#4085ff",
  "mock-cheap-small": "#47d1d1",
  "mock-cheap-large": "#3fb8c4",
  "mock-fast": "#636eff",
  generic: "#94a1b2",
};

const FAMILY_LABEL: Record<Family, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  "mock-cheap-small": "mock-cheap",
  "mock-cheap-large": "mock-cheap",
  "mock-fast": "mock-fast",
  generic: "provider",
};

function resolveFamily(providerId: string, modelId?: string): Family {
  const id = providerId.toLowerCase();
  const mid = (modelId ?? "").toLowerCase();
  if (id.includes("openai") || id.includes("gpt")) return "openai";
  if (id.includes("anthropic") || id.includes("claude")) return "anthropic";
  if (id.includes("google") || id.includes("gemini") || id.includes("palm")) return "google";
  if (id.includes("mock-cheap")) {
    return mid.includes("large") ? "mock-cheap-large" : "mock-cheap-small";
  }
  if (id.includes("mock-fast")) return "mock-fast";
  return "generic";
}

/** Abstract neutral model-chip glyph. Deliberately vendor-agnostic. */
function ChipMark({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <rect
        x="4.5"
        y="4.5"
        width="15"
        height="15"
        rx="4"
        fill="none"
        stroke={color}
        strokeWidth="1.6"
      />
      <circle cx="9.5" cy="9.5" r="1.5" fill={color} />
      <circle cx="14.5" cy="9.5" r="1.5" fill={color} opacity="0.65" />
      <circle cx="9.5" cy="14.5" r="1.5" fill={color} opacity="0.65" />
      <circle cx="14.5" cy="14.5" r="1.5" fill={color} />
      <path
        d="M9.5 9.5 L14.5 14.5 M14.5 9.5 L9.5 14.5"
        stroke={color}
        strokeWidth="0.9"
        opacity="0.35"
      />
    </svg>
  );
}

/**
 * Kept named `ProviderLogo` for call-site stability, but renders a generic
 * neutral model marker — never a vendor logo. Prefer showing the model name
 * prominently alongside this mark.
 */
export function ProviderLogo({
  providerId,
  modelId,
  size = 20,
  variant = "tile",
}: {
  providerId: string;
  modelId?: string;
  size?: number;
  variant?: "tile" | "bare";
}) {
  const family = resolveFamily(providerId, modelId);
  const color = FAMILY_ACCENT[family];
  const label = FAMILY_LABEL[family];

  if (variant === "bare") {
    return (
      <span
        aria-label={`${label} model marker`}
        title={label}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        <ChipMark color={color} size={size} />
      </span>
    );
  }

  const tile = size + 8;
  return (
    <span
      aria-label={`${label} model marker`}
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: tile,
        height: tile,
        borderRadius: 8,
        background: `radial-gradient(circle at 32% 28%, ${color}2e, transparent 72%), var(--bg-inset)`,
        border: `1px solid ${color}55`,
        flexShrink: 0,
      }}
    >
      <ChipMark color={color} size={size} />
    </span>
  );
}

export function resolveProviderFamilyColor(providerId: string, modelId?: string): string {
  return FAMILY_ACCENT[resolveFamily(providerId, modelId)];
}

export function resolveProviderFamilyName(providerId: string, modelId?: string): string {
  return FAMILY_LABEL[resolveFamily(providerId, modelId)];
}

/** Model-specific accent used for candidate-card borders / score tints. */
export function resolveModelAccent(providerId: string, modelId: string): string {
  return FAMILY_ACCENT[resolveFamily(providerId, modelId)];
}
