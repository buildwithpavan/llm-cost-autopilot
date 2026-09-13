"use client";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to the console; the backend correlation ID is not
    // available here, but the digest lets us match Next.js server logs.
    console.error("[lca:web] boundary caught error", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        background: "var(--bg-canvas)",
        color: "var(--text-primary)",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600 }}>Something went wrong.</div>
      <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-secondary)" }}>
        {error.digest ?? error.message}
      </code>
      <button
        type="button"
        onClick={reset}
        style={{
          marginTop: 6,
          padding: "6px 14px",
          border: "1px solid var(--border-default)",
          borderRadius: "var(--r-tab)",
          background: "var(--bg-card)",
          color: "var(--text-primary)",
          fontSize: 11,
        }}
      >
        Retry
      </button>
    </div>
  );
}
