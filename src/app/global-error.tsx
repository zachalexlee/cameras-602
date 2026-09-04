"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#060a0d", color: "#d6e2ea", fontFamily: "ui-monospace, Menlo, monospace" }}>
        <div style={{ border: "1px solid #2b4252", padding: "24px 28px", maxWidth: 480 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#ef5a5a", marginBottom: 12 }}>System fault</div>
          <p style={{ margin: "0 0 12px", fontSize: 14 }}>The dashboard could not render.</p>
          <p style={{ margin: "0 0 16px", fontSize: 11, color: "#6f8796" }}>{error.message || "Unknown error"}{error.digest ? ` · ${error.digest}` : ""}</p>
          <button onClick={reset} style={{ font: "inherit", fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", background: "transparent", color: "#5cc8e8", border: "1px solid #5cc8e8", padding: "8px 14px", cursor: "pointer" }}>
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
