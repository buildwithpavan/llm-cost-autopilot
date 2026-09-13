import { ChevronDown } from "lucide-react";

export function EnvironmentIndicator({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 12px",
        height: 32,
        borderRadius: "var(--r-tab)",
        background: "var(--bg-env-pill)",
        border: "1px solid var(--border-default)",
        fontFamily: "var(--font-sans)",
        fontSize: 11,
        color: "var(--text-primary)",
        lineHeight: 1,
        textTransform: "capitalize",
      }}
    >
      {label}
      <ChevronDown size={12} strokeWidth={1.5} aria-hidden />
    </span>
  );
}
