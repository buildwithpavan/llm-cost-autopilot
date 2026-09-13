/**
 * Brand mark reproduced from Figma node 44:6 — three rotated rects
 * (#3385ff logo-blue, #6b47ff logo-purple, #596bff logo-cyan) inside a 28px box.
 */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <span
      aria-label="LLM Cost Autopilot"
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flex: `0 0 ${size}px`,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 6,
          top: 3,
          width: 8,
          height: 20,
          borderRadius: 2,
          background: "var(--logo-blue)",
          transform: "rotate(-25deg)",
          transformOrigin: "50% 50%",
        }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 6,
          top: 3,
          width: 8,
          height: 21,
          borderRadius: 2,
          background: "var(--accent-purple)",
          transform: "rotate(25deg)",
          transformOrigin: "50% 50%",
        }}
      />
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 9,
          top: 11,
          width: 12,
          height: 5,
          borderRadius: 1,
          background: "var(--accent-teal)",
          transform: "rotate(-12deg)",
          transformOrigin: "50% 50%",
        }}
      />
    </span>
  );
}
