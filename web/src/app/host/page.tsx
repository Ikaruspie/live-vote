"use client";

import { useEffect, useState } from "react";
import { EXPLORER_URL, LIVE_VOTE_ADDRESS } from "@/lib/config";

export default function HostPage() {
  const [hostKey, setHostKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; hash?: string }>();

  useEffect(() => {
    setHostKey(new URLSearchParams(window.location.search).get("key") ?? "");
  }, []);

  async function closePoll() {
    if (!confirm("Close the poll and pay the pot to the winner? This can't be undone.")) return;
    setBusy(true);
    setResult(undefined);
    try {
      const res = await fetch("/api/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: hostKey }),
      });
      const data = (await res.json()) as { hash?: string; error?: string };
      setResult(res.ok ? { ok: true, text: "Poll closed, pot paid out.", hash: data.hash } : { ok: false, text: data.error ?? "Failed" });
    } catch {
      setResult({ ok: false, text: "Network error, try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="p-wrap">
      <div className="p-eyebrow">LIVE VOTE · HOST</div>
      <h1>Host controls</h1>
      <p className="p-sub">
        Contract{" "}
        <a className="underline" href={`${EXPLORER_URL}/address/${LIVE_VOTE_ADDRESS}`} target="_blank" rel="noreferrer">
          {LIVE_VOTE_ADDRESS.slice(0, 8)}…{LIVE_VOTE_ADDRESS.slice(-6)}
        </a>
      </p>

      {!hostKey ? (
        <div className="p-status error">Missing host key. Open this page as /host?key=…</div>
      ) : (
        <button className="opt" style={{ marginTop: 24, justifyContent: "center" }} onClick={closePoll} disabled={busy}>
          <b>{busy ? "Closing…" : "Close poll & pay out"}</b>
        </button>
      )}

      {result && (
        <div className={`p-status ${result.ok ? "ok" : "error"}`}>
          {result.text}
          {result.hash && (
            <a href={`${EXPLORER_URL}/tx/${result.hash}`} target="_blank" rel="noreferrer">
              view tx
            </a>
          )}
        </div>
      )}
    </main>
  );
}
