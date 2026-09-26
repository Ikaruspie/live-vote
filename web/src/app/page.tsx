"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createWalletClient, formatEther, type Hex, type PrivateKeyAccount } from "viem";
import { generatePrivateKey, nonceManager, privateKeyToAccount } from "viem/accounts";
import {
  chain,
  EXPLORER_URL,
  LIVE_VOTE_ADDRESS,
  liveVoteAbi,
  publicClient,
  transport,
  VOTE_GAS_LIMIT,
} from "@/lib/config";

const STORAGE_KEY = "live-vote-burner";

// Testnet-only burner wallet, kept in this browser.
function loadBurner(): PrivateKeyAccount {
  let key: Hex | null = null;
  try {
    key = localStorage.getItem(STORAGE_KEY) as Hex | null;
  } catch {}
  if (!key) {
    key = generatePrivateKey();
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {}
  }
  return privateKeyToAccount(key, { nonceManager });
}

type Status =
  | { kind: "idle" }
  | { kind: "info"; text: string }
  | { kind: "ok"; text: string; hash: Hex }
  | { kind: "error"; text: string };

export default function VotePage() {
  const [account, setAccount] = useState<PrivateKeyAccount>();
  const [question, setQuestion] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [myVotes, setMyVotes] = useState<bigint[]>([]);
  const [unitPrice, setUnitPrice] = useState<bigint>(BigInt(0));
  const [gasFee, setGasFee] = useState<bigint>(BigInt(0));
  const [balance, setBalance] = useState<bigint>();
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "info", text: "Setting up your wallet…" });
  const walletRef = useRef<ReturnType<typeof createWalletClient>>(undefined);

  const refresh = useCallback(async (acc: PrivateKeyAccount, count: number) => {
    const [bal, results, ...votes] = await Promise.all([
      publicClient.getBalance({ address: acc.address }),
      publicClient.readContract({ address: LIVE_VOTE_ADDRESS, abi: liveVoteAbi, functionName: "getResults" }),
      ...Array.from({ length: count }, (_, i) =>
        publicClient.readContract({
          address: LIVE_VOTE_ADDRESS,
          abi: liveVoteAbi,
          functionName: "votesOf",
          args: [acc.address, BigInt(i)],
        }),
      ),
    ]);
    setBalance(bal);
    setOpen(results[3]);
    setMyVotes(votes as bigint[]);
    return bal;
  }, []);

  useEffect(() => {
    const acc = loadBurner();
    setAccount(acc);
    walletRef.current = createWalletClient({ account: acc, chain, transport });

    (async () => {
      try {
        const [q, options, unit, gasPrice] = await Promise.all([
          publicClient.readContract({ address: LIVE_VOTE_ADDRESS, abi: liveVoteAbi, functionName: "question" }),
          publicClient.readContract({ address: LIVE_VOTE_ADDRESS, abi: liveVoteAbi, functionName: "getOptions" }),
          publicClient.readContract({ address: LIVE_VOTE_ADDRESS, abi: liveVoteAbi, functionName: "unitPrice" }),
          publicClient.getGasPrice(),
        ]);
        setQuestion(q);
        setLabels([...options[0]]);
        setUnitPrice(unit);
        setGasFee(VOTE_GAS_LIMIT * gasPrice);

        let bal = await refresh(acc, options[0].length);
        if (bal === BigInt(0)) {
          setStatus({ kind: "info", text: "Topping up your wallet with test MON…" });
          await fetch("/api/drip", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: acc.address }),
          });
          for (let i = 0; i < 20 && bal === BigInt(0); i++) {
            await new Promise((r) => setTimeout(r, 500));
            bal = await publicClient.getBalance({ address: acc.address });
          }
          setBalance(bal);
        }
        setStatus(
          bal > BigInt(0)
            ? { kind: "info", text: "Ready. Tap to vote!" }
            : { kind: "error", text: "Couldn't top up your wallet. Reload to try again." },
        );
      } catch (err) {
        console.error(err);
        setStatus({ kind: "error", text: "Network is busy. Reload to try again." });
      }
    })();
  }, [refresh]);

  const nextCost = (i: number) => (BigInt(2) * (myVotes[i] ?? BigInt(0)) + BigInt(1)) * unitPrice;

  async function vote(i: number) {
    const wallet = walletRef.current;
    if (!wallet || !account || busy !== null) return;
    const cost = nextCost(i);
    if (balance !== undefined && balance < cost + gasFee) {
      setStatus({ kind: "error", text: "Out of test MON. Thanks for voting!" });
      return;
    }
    setBusy(i);
    setStatus({ kind: "info", text: "Sending your vote…" });
    const started = performance.now();
    try {
      const request = {
        account,
        chain,
        address: LIVE_VOTE_ADDRESS,
        abi: liveVoteAbi,
        functionName: "vote",
        args: [BigInt(i), BigInt(1)],
        value: cost,
        gas: VOTE_GAS_LIMIT,
      } as const;
      let hash: Hex;
      try {
        // eth_sendRawTransactionSync: the receipt comes back in the same request.
        const receipt = await wallet.writeContractSync(request);
        hash = receipt.transactionHash;
      } catch (err) {
        if (!String(err).includes("sendRawTransactionSync")) throw err;
        hash = await wallet.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
      }
      const ms = Math.round(performance.now() - started);
      setStatus({ kind: "ok", text: `Vote confirmed on-chain in ${ms} ms`, hash });
      await refresh(account, labels.length);
    } catch (err) {
      console.error(err);
      const msg = String(err);
      setStatus({
        kind: "error",
        text: msg.includes("PollClosed") ? "The poll is closed." : "Vote failed. Try again.",
      });
      await refresh(account, labels.length).catch(() => {});
    } finally {
      setBusy(null);
    }
  }

  const ready = balance !== undefined && balance > BigInt(0) && open;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-[#0A1A3F] via-[#14306B] to-[#2A4F9C] px-4 py-8 text-white">
      <div className="mx-auto flex max-w-md flex-col gap-6">
        <header className="text-center">
          <p className="text-sm uppercase tracking-[0.25em] text-blue-200">Live Vote · Monad</p>
          <h1 className="mt-3 text-3xl font-bold leading-tight">{question || "Loading poll…"}</h1>
          <p className="mt-2 text-sm text-blue-100">
            Every vote is a micro-donation. More votes on one cause cost more (quadratic).
          </p>
        </header>

        <section className="flex flex-col gap-3">
          {labels.map((label, i) => (
            <button
              key={label}
              onClick={() => vote(i)}
              disabled={!ready || busy !== null}
              className="flex items-center justify-between rounded-2xl bg-white/10 px-5 py-5 text-left ring-1 ring-white/20 transition active:scale-[0.98] enabled:hover:bg-white/20 disabled:opacity-50"
            >
              <span>
                <span className="block text-xl font-semibold">{label}</span>
                <span className="text-sm text-blue-100">
                  your votes: {String(myVotes[i] ?? 0)} · next: {formatEther(nextCost(i))} MON
                </span>
              </span>
              <span className="rounded-full bg-white px-4 py-2 text-base font-bold text-[#14306B]">
                {busy === i ? "…" : "+1"}
              </span>
            </button>
          ))}
        </section>

        <div
          className={`rounded-xl px-4 py-3 text-center text-sm ${
            status.kind === "error" ? "bg-red-500/20 text-red-100" : status.kind === "ok" ? "bg-emerald-500/20 text-emerald-100" : "bg-white/10 text-blue-100"
          }`}
        >
          {status.kind !== "idle" && status.text}
          {status.kind === "ok" && (
            <a className="ml-1 underline" href={`${EXPLORER_URL}/tx/${status.hash}`} target="_blank" rel="noreferrer">
              view
            </a>
          )}
          {!open && <p className="mt-1 font-semibold">This poll is closed.</p>}
        </div>

        <footer className="text-center text-xs text-blue-200">
          {account && (
            <>
              Your test wallet {account.address.slice(0, 6)}…{account.address.slice(-4)} ·{" "}
              {balance !== undefined ? `${Number(formatEther(balance)).toFixed(3)} MON` : "…"}
              <br />
            </>
          )}
          Testnet only · no real money
        </footer>
      </div>
    </main>
  );
}
