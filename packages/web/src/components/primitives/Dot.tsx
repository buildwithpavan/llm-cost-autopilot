import type { CSSProperties } from "react";

export function Dot({
  color,
  size = 6,
  pulse = false,
  style,
}: {
  color: string;
  size?: number;
  pulse?: boolean;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        boxShadow: pulse ? `0 0 0 3px ${color}22` : undefined,
        animation: pulse ? "lca-pulse 1200ms ease-in-out infinite" : undefined,
        ...style,
      }}
    />
  );
}
