import type { CSSProperties, ReactNode } from "react";

/** Inline monospace span for identifiers, timestamps, and technical metadata. */
export function Mono({
  children,
  size = 9,
  color = "var(--text-secondary)",
  weight = 400,
  style,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  weight?: 400 | 500 | 600;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size,
        fontWeight: weight,
        color,
        fontVariantLigatures: "none",
        fontFeatureSettings: "'tnum' 1",
        ...style,
      }}
    >
      {children}
    </span>
  );
}
