"use client";

import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { formatEther, type Hex } from "viem";
import { EXPLORER_URL, LIVE_VOTE_ADDRESS, liveVoteAbi, publicClient } from "@/lib/config";

type Results = { votes: bigint[]; pot: bigint; voters: bigint; open: boolean };

const ROW_HEIGHT = 120;

export default function ScreenPage() {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [origin, setOrigin] = useState("");
  const [question, setQuestion] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [results, setResults] = useState<Results>();
  const [rate, setRate] = useState(0);
  const [bumped, setBumped] = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState(false);
  const [payoutTx, setPayoutTx] = useState<Hex>();
  const history = useRef<{ t: number; total: bigint }[]>([]);
  const prevVotes = useRef<bigint[]>([]);
  const wasOpen = useRef<boolean | null>(null);
  const confettiRef = useRef<HTMLCanvasElement>(null);
  const [paidOut, setPaidOut] = useState<bigint>(BigInt(0));

  // Fit the 1920x1080 stage into the window.
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      setScale(s);
      setOffset({ x: (window.innerWidth - 1920 * s) / 2, y: (window.innerHeight - 1080 * s) / 2 });
    };
    fit();
    setOrigin(window.location.origin);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    let stop = false;
    (async () => {
      const [q, options] = await Promise.all([
        publicClient.readContract({ address: LIVE_VOTE_ADDRESS, abi: liveVoteAbi, functionName: "question" }),
        publicClient.readContract({ address: LIVE_VOTE_ADDRESS, abi: liveVoteAbi, functionName: "getOptions" }),
      ]);
      if (!stop) {
        setQuestion(q);
        setLabels([...options[0]]);
      }
    })().catch(console.error);

    // The projector is the only client that polls, once per second.
    const tick = async () => {
      try {
        const [votes, pot, voters, open] = await publicClient.readContract({
          address: LIVE_VOTE_ADDRESS,
          abi: liveVoteAbi,
          functionName: "getResults",
        });
        if (stop) return;
        const now = Date.now();
        const total = votes.reduce((a, b) => a + b, BigInt(0));
        history.current = [...history.current.filter((h) => now - h.t <= 5500), { t: now, total }];
        setRate(Number(total - history.current[0].total));

        const changed = new Set<number>();
        votes.forEach((v, i) => {
          if (prevVotes.current[i] !== undefined && v > prevVotes.current[i]) changed.add(i);
        });
        prevVotes.current = [...votes];
        if (changed.size) {
          setBumped(changed);
          setTimeout(() => setBumped(new Set()), 500);
        }
        setResults({ votes: [...votes], pot, voters, open });
        if (open) setPaidOut(pot);

        if (wasOpen.current === true && !open) {
          // Poll just closed: suspense, then reveal with confetti.
          setRevealed(false);
          setTimeout(() => {
            setRevealed(true);
            fireConfetti(confettiRef.current);
          }, 2000);
          findPayout().then(setPayoutTx).catch(() => {});
        } else if (wasOpen.current === null && !open) {
          setRevealed(true);
          findPayout().then(setPayoutTx).catch(() => {});
        }
        wasOpen.current = open;
      } catch (err) {
        console.error(err);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const votes = results?.votes ?? labels.map(() => BigInt(0));
  const order = labels.map((label, i) => ({ label, i, v: votes[i] ?? BigInt(0) })).sort((a, b) => (b.v > a.v ? 1 : b.v < a.v ? -1 : a.i - b.i));
  const max = order[0]?.v || BigInt(1);
  const total = votes.reduce((a, b) => a + b, BigInt(0));
  const pot = results ? Number(formatEther(results.pot)) : 0;
  const pct = (v: bigint) => (max > BigInt(0) ? Number((v * BigInt(1000)) / max) / 10 : 0);
  const host = origin.replace(/^https?:\/\//, "");
  const open = results?.open ?? true;
  const winner = order[0];

  return (
    <div className="screen-root">
      <div className="stage" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
        {open ? (
          <div className="live">
            <div className="scan">
              <h2>Scan to vote</h2>
              <div className="qr-frame">
                {origin && <QRCodeCanvas value={origin} size={420} bgColor="#F4F2FF" fgColor="#12102B" level="M" />}
              </div>
              <div className="url">
                <small>or go to</small>
                {host}
              </div>
            </div>
            <div className="results">
              <div className="results-head">
                <h2>Live results</h2>
                <div className="rate">{rate} votes / 5 s</div>
              </div>
              <p className="question">{question}</p>
              <div className="total num">
                <b>{String(total)}</b>votes
                <span>
                  {pot.toFixed(3)} MON · {String(results?.voters ?? 0)} people
                </span>
              </div>
              <div className="bars">
                {order.map((o, rank) => (
                  <div
                    key={o.label}
                    className={`bar-row${rank === 0 && o.v > BigInt(0) ? " lead" : ""}${bumped.has(o.i) ? " bump" : ""}`}
                    style={{ top: rank * ROW_HEIGHT }}
                  >
                    <div className="name">{o.label}</div>
                    <div className="track">
                      <div className="fill" style={{ width: `${pct(o.v)}%` }} />
                    </div>
                    <div className="count">{String(o.v)}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className={`win${revealed ? "" : " suspense"}`}>
            <div className="win-main">
              <div className="lead-in">And the pot goes to…</div>
              <div className="team reveal">{winner?.label}</div>
              <div className="stats reveal num">
                {String(winner?.v ?? 0)} votes · {total > BigInt(0) ? Math.round((Number(winner?.v ?? 0) / Number(total)) * 100) : 0}% ·{" "}
                {Number(formatEther(paidOut)).toFixed(3)} MON paid out on-chain
              </div>
              <div className="thanks reveal">
                {payoutTx ? `Payout tx ${payoutTx.slice(0, 10)}…${payoutTx.slice(-6)}` : "Thanks to everyone who voted."}
              </div>
            </div>
            <div className="podium reveal">
              {order.slice(0, 3).map((o) => (
                <div key={o.label}>
                  <p>
                    <span>{o.label}</span>
                    <span>{String(o.v)}</span>
                  </p>
                  <i style={{ width: `${pct(o.v)}%` }} />
                </div>
              ))}
            </div>
          </div>
        )}
        <canvas ref={confettiRef} className="confetti" width={1920} height={1080} />
      </div>
      {payoutTx && !open && (
        <a
          href={`${EXPLORER_URL}/tx/${payoutTx}`}
          target="_blank"
          rel="noreferrer"
          style={{ position: "fixed", right: 16, bottom: 12, color: "var(--muted)", fontSize: 13 }}
        >
          view payout on explorer
        </a>
      )}
    </div>
  );
}

/** Look up the Closed event in recent blocks (RPCs limit log ranges, so stay small). */
async function findPayout(): Promise<Hex | undefined> {
  const latest = await publicClient.getBlockNumber();
  const logs = await publicClient.getContractEvents({
    address: LIVE_VOTE_ADDRESS,
    abi: liveVoteAbi,
    eventName: "Closed",
    fromBlock: latest > BigInt(90) ? latest - BigInt(90) : BigInt(0),
    toBlock: latest,
  });
  return logs.at(-1)?.transactionHash ?? undefined;
}

/** One confetti burst in Signal and Chalk (from the design mockup). */
function fireConfetti(cv: HTMLCanvasElement | null) {
  if (!cv || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ctx = cv.getContext("2d");
  if (!ctx) return;
  const parts = Array.from({ length: 180 }, () => ({
    x: 960 + (Math.random() - 0.5) * 300,
    y: 420,
    vx: (Math.random() - 0.5) * 34,
    vy: -Math.random() * 30 - 8,
    s: 10 + Math.random() * 14,
    r: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.3,
    c: Math.random() < 0.6 ? "#FFD23F" : "#F4F2FF",
  }));
  const t0 = performance.now();
  const frame = (now: number) => {
    ctx.clearRect(0, 0, 1920, 1080);
    const age = now - t0;
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 2200) / 1000);
    parts.forEach((p) => {
      p.vy += 0.9;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    });
    if (age < 3200) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, 1920, 1080);
  };
  requestAnimationFrame(frame);
}
