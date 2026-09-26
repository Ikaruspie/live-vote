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
          // Monad validates balances against state a few blocks back (async execution):
          // give fresh funds ~3 blocks before the first vote.
          if (bal > BigInt(0)) await new Promise((r) => setTimeout(r, 1500));
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
    <main className="p-wrap">
      <div className="p-eyebrow">LIVE VOTE · MONAD TESTNET</div>

      {!open ? (
        <section className="p-centered">
          <div className="big-mark">★</div>
          <h1>Voting is closed</h1>
          <p className="p-sub">The winner is on screen now. Thanks for voting!</p>
        </section>
      ) : (
        <>
          <h1>{question || "Loading poll…"}</h1>
          <p className="p-sub">Every vote is a donation. Each extra vote on the same cause costs more.</p>

          <ul className="options">
            {labels.map((label, i) => {
              const mine = myVotes[i] ?? BigInt(0);
              return (
                <li key={label}>
                  <button
                    className={`opt${mine > BigInt(0) ? " mine" : ""}`}
                    onClick={() => vote(i)}
                    disabled={!ready || busy !== null}
                  >
                    <span>
                      <b>{label}</b>
                      <small className="num">
                        {mine > BigInt(0) ? `Your votes: ${mine} · ` : ""}next vote {formatEther(nextCost(i))} MON
                      </small>
                    </span>
                    <span className="plus">{busy === i ? "…" : "+1"}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className={`p-status ${status.kind === "ok" ? "ok" : status.kind === "error" ? "error" : ""}`} role="status">
            {status.kind === "ok" ? `✓ ${status.text}` : status.kind !== "idle" && status.text}
            {status.kind === "ok" && (
              <a href={`${EXPLORER_URL}/tx/${status.hash}`} target="_blank" rel="noreferrer">
                view
              </a>
            )}
          </div>
        </>
      )}

      <footer className="p-foot num">
        {account && (
          <>
            Your test wallet {account.address.slice(0, 6)}…{account.address.slice(-4)} ·{" "}
            {balance !== undefined ? `${Number(formatEther(balance)).toFixed(3)} MON` : "…"}
            <br />
          </>
        )}
        Watch the big screen for live results · testnet only, no real money
      </footer>
    </main>
  );
}
