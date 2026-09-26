"use client";

// Projector view, design v2: donation meter + live race chart + 3-2-1 winner reveal.
// The original /screen stays unchanged as a fallback.
import { useEffect, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { formatEther } from "viem";
import { LIVE_VOTE_ADDRESS, liveVoteAbi, publicClient } from "@/lib/config";

const GOALS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];
const WINDOW = 90; // seconds shown on the race chart

export default function Screen2Page() {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [origin, setOrigin] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [votes, setVotes] = useState<number[]>([]);
  const [pot, setPot] = useState(0);
  const [paidOut, setPaidOut] = useState(0);
  const [open, setOpen] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [goalHit, setGoalHit] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const confettiRef = useRef<HTMLCanvasElement>(null);
  const history = useRef<number[][]>([]);
  const disp = useRef<number[]>([]);
  const dispMax = useRef(10);
  const leader = useRef(-1);
  const leadChangeAt = useRef(-1e9);
  const wasOpen = useRef<boolean | null>(null);
  const lastGoal = useRef(0);
  const labelsRef = useRef<string[]>([]);
  const votesRef = useRef<number[]>([]);

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

  // Poll the contract once per second and sample history for the race chart.
  useEffect(() => {
    let stop = false;
    publicClient
      .readContract({ address: LIVE_VOTE_ADDRESS, abi: liveVoteAbi, functionName: "getOptions" })
      .then((o) => {
        if (stop) return;
        labelsRef.current = [...o[0]];
        setLabels([...o[0]]);
      })
      .catch(console.error);

    const tick = async () => {
      try {
        const [v, p, , isOpen] = await publicClient.readContract({
          address: LIVE_VOTE_ADDRESS,
          abi: liveVoteAbi,
          functionName: "getResults",
        });
        if (stop) return;
        const nums = v.map(Number);
        votesRef.current = nums;
        if (!disp.current.length) disp.current = [...nums];
        history.current = [...history.current, nums].slice(-WINDOW);
        setVotes(nums);
        const potMon = Number(formatEther(p));
        setPot(potMon);
        if (isOpen) setPaidOut(potMon);
        setOpen(isOpen);

        const lead = nums.indexOf(Math.max(...nums));
        if (Math.max(...nums) > 0 && lead !== leader.current) {
          leader.current = lead;
          leadChangeAt.current = performance.now();
        }
        const goalIdx = GOALS.findIndex((g) => g > potMon);
        if (goalIdx > lastGoal.current) {
          lastGoal.current = goalIdx;
          setGoalHit(true);
          setTimeout(() => setGoalHit(false), 1200);
        }

        if (wasOpen.current === true && !isOpen) runReveal();
        else if (wasOpen.current === null && !isOpen) setRevealed(true);
        wasOpen.current = isOpen;
      } catch (err) {
        console.error(err);
      }
    };

    // 3-2-1, then the winner and confetti.
    const runReveal = () => {
      setRevealed(false);
      [3, 2, 1].forEach((n, i) => setTimeout(() => setCount(n), i * 1000));
      setTimeout(() => setCount(null), 3000);
      setTimeout(() => {
        setRevealed(true);
        fireConfetti(confettiRef.current);
      }, 3600);
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  // Race chart animation loop.
  useEffect(() => {
    let raf = 0;
    const draw = (now: number) => {
      const c = canvasRef.current?.getContext("2d");
      const names = labelsRef.current;
      const target = votesRef.current;
      if (c && names.length && target.length) {
        target.forEach((t, i) => {
          disp.current[i] = (disp.current[i] ?? t) + (t - (disp.current[i] ?? t)) * 0.12;
        });
        drawRace(c, now, names, history.current, disp.current, dispMax, leader.current, leadChangeAt.current);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const goal = GOALS.find((g) => g > pot) ?? GOALS[GOALS.length - 1];
  const total = votes.reduce((a, b) => a + b, 0);
  const order = labels.map((label, i) => ({ label, v: votes[i] ?? 0, i })).sort((a, b) => b.v - a.v || a.i - b.i);
  const winner = order[0];
  const host = origin.replace(/^https?:\/\//, "");

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
                <div className="raised">
                  <b className="num">{pot.toFixed(3)}</b>MON raised
                </div>
              </div>
              <div className="meter-sub">
                <span>
                  <b className="num">{total}</b> votes
                </span>
                <span className="num">Goal {goal} MON</span>
              </div>
              <div className={`meter-bar${goalHit ? " hit" : ""}`}>
                <i style={{ width: `${Math.min(100, (pot / goal) * 100)}%` }} />
              </div>
              <div className="chart">
                <canvas ref={canvasRef} width={1100} height={600} />
              </div>
            </div>
          </div>
        ) : (
          <div className={`win${revealed ? "" : " suspense"}${count !== null ? " counting" : ""}`}>
            <div className="win-main">
              <div className="lead-in">And the pot goes to…</div>
              <div className="team reveal">{winner?.label}</div>
              <div className="stats reveal num">
                {winner?.v ?? 0} votes · {total ? Math.round(((winner?.v ?? 0) / total) * 100) : 0}%
              </div>
              <div className="thanks reveal">
                Together we raised <b>{paidOut.toFixed(3)} MON</b>, paid out on-chain.
              </div>
            </div>
            <div className="podium reveal">
              {order.slice(0, 3).map((o) => (
                <div key={o.label}>
                  <p>
                    <span>{o.label}</span>
                    <span>{o.v}</span>
                  </p>
                  <i style={{ width: `${winner?.v ? (o.v / winner.v) * 100 : 0}%` }} />
                </div>
              ))}
            </div>
          </div>
        )}
        {count !== null && (
          <div className="count3" key={count}>
            {count}
          </div>
        )}
        <canvas ref={confettiRef} className="confetti" width={1920} height={1080} />
      </div>
    </div>
  );
}

const mix = (a: number[], b: number[], f: number) =>
  `rgba(${a.map((v, i) => (i < 3 ? Math.round(v + (b[i] - v) * f) : +(v + (b[i] - v) * f).toFixed(3))).join(",")})`;
const LINE = [244, 242, 255, 0.45];
const GOLD = [255, 210, 63, 1];
const TEXT = [244, 242, 255, 1];

function drawRace(
  c: CanvasRenderingContext2D,
  now: number,
  names: string[],
  history: number[][],
  disp: number[],
  dispMax: { current: number },
  leaderId: number,
  leadChangeAt: number,
) {
  const W = 1100, H = 600, PL = 8, PR = 560, PT = 40, PB = H - 30, LX = 600;
  c.clearRect(0, 0, W, H);
  const target = Math.max(10, ...disp) * 1.15;
  dispMax.current += (target - dispMax.current) * 0.06;
  const n = Math.max(history.length, 2);
  const x = (i: number) => PL + (i / (WINDOW - 1)) * (PR - PL);
  const y = (v: number) => PB - (v / dispMax.current) * (PB - PT);
  const head = n - 1;
  const f = Math.min(1, (now - leadChangeAt) / 900);
  const heat = (id: number) => (id === leaderId ? f : 0);

  c.lineWidth = 2;
  c.strokeStyle = "rgba(244,242,255,.09)";
  for (let k = 0; k <= 4; k++) {
    const gy = PB - (k * (PB - PT)) / 4;
    c.beginPath();
    c.moveTo(PL, gy);
    c.lineTo(PR, gy);
    c.stroke();
  }

  const path = (id: number) => {
    c.beginPath();
    history.forEach((h, i) => (i ? c.lineTo(x(i), y(h[id] ?? 0)) : c.moveTo(x(0), y(h[id] ?? 0))));
    if (!history.length) c.moveTo(x(0), y(disp[id]));
    c.lineTo(x(head), y(disp[id]));
  };

  const ids = names.map((_, i) => i).sort((a, b) => heat(a) - heat(b));
  ids.forEach((id) => {
    const h = heat(id);
    if (h > 0) {
      path(id);
      c.lineTo(x(head), PB);
      c.lineTo(x(0), PB);
      c.closePath();
      const g = c.createLinearGradient(0, PT, 0, PB);
      g.addColorStop(0, `rgba(255,210,63,${0.28 * h})`);
      g.addColorStop(1, "rgba(255,210,63,0)");
      c.fillStyle = g;
      c.fill();
    }
    path(id);
    c.lineJoin = "round";
    c.lineCap = "round";
    c.lineWidth = 8 + 4 * h;
    c.strokeStyle = mix(LINE, GOLD, h);
    c.shadowColor = `rgba(255,210,63,${0.7 * h})`;
    c.shadowBlur = 28 * h;
    c.stroke();
    c.shadowBlur = 0;
    const hx = x(head), hy = y(disp[id]);
    if (id === leaderId) {
      const ph = (now % 1400) / 1400;
      c.beginPath();
      c.arc(hx, hy, 16 + ph * 40, 0, Math.PI * 2);
      c.strokeStyle = `rgba(255,210,63,${(1 - ph) * f})`;
      c.lineWidth = 4;
      c.stroke();
    }
    c.beginPath();
    c.arc(hx, hy, 12 + 4 * h, 0, Math.PI * 2);
    c.fillStyle = mix(TEXT, GOLD, h);
    c.fill();
  });

  // Labels in a column to the right, nudged apart so they never overlap.
  const GAP = 68;
  const labels = names.map((name, id) => ({ name, id, hy: y(disp[id]), ly: y(disp[id]) })).sort((a, b) => a.ly - b.ly);
  labels.forEach((l, i) => {
    l.ly = Math.max(l.ly, 30, i ? labels[i - 1].ly + GAP : 0);
  });
  for (let i = labels.length - 1; i >= 0; i--) {
    const cap = i === labels.length - 1 ? H - 30 : labels[i + 1].ly - GAP;
    labels[i].ly = Math.min(labels[i].ly, cap);
  }
  c.textBaseline = "middle";
  labels.forEach(({ name, id, hy, ly }) => {
    c.beginPath();
    c.moveTo(x(head) + 20, hy);
    c.lineTo(LX - 14, ly);
    c.strokeStyle = "rgba(244,242,255,.22)";
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = mix(TEXT, GOLD, heat(id));
    c.textAlign = "left";
    c.font = "700 44px Inter, system-ui, sans-serif";
    c.fillText(name.length > 16 ? name.slice(0, 15) + "…" : name, LX, ly);
    c.textAlign = "right";
    c.font = "900 56px Inter, system-ui, sans-serif";
    c.fillText(String(Math.round(disp[id])), W, ly);
  });
}

/** One confetti burst in Signal and Chalk. */
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
