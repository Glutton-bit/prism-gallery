"use client";
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  const text = `${error?.name}: ${error?.message}\n\n${error?.stack ?? ""}`;
  return (
    <html lang="en">
      <body style={{ background: "#0a0a0a", color: "#fff", fontFamily: "sans-serif", padding: 16 }}>
        <h2>Prism Gallery error</h2>
        <p>Screenshot this screen and send it to Claude.</p>
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, background: "#1c1c1e", padding: 12, borderRadius: 12 }}>{text}</pre>
        <button onClick={reset}>Try again</button>
      </body>
    </html>
  );
      }
