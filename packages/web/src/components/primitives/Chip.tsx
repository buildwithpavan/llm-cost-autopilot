import type { CSSProperties, ReactNode } from "react";

export function Chip({
  children,
  color = "var(--text-secondary)",
  bg = "transparent",
  border,
  style,
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
  border?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        fontFamily: "var(--font-mono)",
        fontSize: 9,
        color,
        background: bg,
        border: border ? `1px solid ${border}` : "1px solid transparent",
        borderRadius: 3,
        letterSpacing: 0.08,
        ...style,
      }}
    >
      {children}
    </span>
  );
}
