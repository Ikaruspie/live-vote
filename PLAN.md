# Live Vote – Build Plan (Monad Blitz Berlin, 26.09.2026)

> **One-liner:** Scan a QR code, vote live on which cause gets the pot. Every vote is a micro-donation. The whole room pays at once, and Monad settles it in under a second.

Plan created 13:12. **Code freeze 17:00. Submission deadline 17:30** (the brief PDF says "Submission freeze 5:45 PM"; confirm with the organisers and plan for 17:30).

---

## 1. Blitz requirements (all must be met, or we're out)

| # | Requirement (source: Monad Blitz Berlin.pdf) | How we meet it | Done |
|---|---|---|---|
| 1 | All code written today; standard libraries are OK | New repo, created today | ☐ |
| 2 | **Live deployment** with a public demo link. Local-only = disqualified | Frontend on **Vercel**, contract on **Monad testnet (10143)** | ☐ |
| 3 | **Public GitHub repo** | Create on github.com (the `gh` CLI isn't installed), then push | ☐ |
| 4 | 3-minute demo, slides optional | Demo script below; the room takes part | ☐ |
| 5 | Submit at **blitz.devnads.com**. Submission order = pitch order | Submit as soon as it's live (~16:45) | ☐ |

**How it's scored:** 50% judges + 50% participant votes. The brief says to focus on *novel mechanics, exploring the limits of Monad, solving problems in new ways*, and to worry less about perfect UI, long feature lists and slides.

---

## 2. What we're building (and NOT building)

**Core flow (the only thing that has to be on-chain):**
1. The host opens a poll: *"Which cause gets tonight's pot?"* with 3–4 options, each with a recipient wallet.
2. The audience scans a QR code, and the page opens on their phone. **No MetaMask:** the page creates a burner wallet in the browser and tops it up with test MON automatically.
3. People tap to vote. **Quadratic cost:** your 1st vote costs 1 unit, 2 votes cost 4 units in total, 3 cost 9. Your money goes into the pot.
4. The big screen shows live bars, a vote counter, "MON raised," and "votes in the last 5 seconds."
5. The host presses **Close**, and the contract sends the whole pot to the winning cause's wallet. Show the transaction in the explorer.

**NOT building:** accounts or login, real charity integration, multiple polls, admin UI polish, fiat, mainnet, proof of personhood. Put these on the roadmap slide only.

**Causes:** use generic demo causes (e.g. "Food bank", "Animal shelter", "Winter homeless aid") with **our own test wallets** as recipients. Don't use real charity names or logos: it's testnet money, and we mustn't imply a real organisation receives it.

---

## 3. Architecture

```
Phone (burner wallet in localStorage)
   │  1. POST /api/drip  ──►  Vercel API route (funded DRIP key, testnet only) sends 0.03 MON
   │  2. vote(option, n) ─────────────────────────────►  LiveVote.sol on Monad testnet
Big screen (/screen)  ◄── polls getResults() every 1s ──┘
Host (/host)  ── closePoll() ──► contract pays out the pot to the winner
```

- **Stack:** Next.js (App Router) + viem 2.40+ (native Monad testnet support) + Foundry (Monad Foundry if available, otherwise standard `forge`). Use **MONSKILLS** for scaffolding and wallet setup.
- **Pages:** `/` (vote, mobile-first), `/screen` (projector view with the QR code), `/host` (open/close, protected by a simple secret in the URL).
- **Secrets:** `DEPLOYER_PRIVATE_KEY` and `DRIP_PRIVATE_KEY` only in `.env` (git-ignored) and in Vercel env vars. **Never commit them.** Use a fresh wallet that holds only test MON.

### Contract `LiveVote.sol` (one contract)
- `constructor(string question, string[] labels, address[] recipients, uint256 unitPrice)`
- `vote(uint8 option, uint16 n) payable`: cost = `((k+n)² − k²) × unitPrice`, where `k` = the voter's current votes on that option. Refund any overpayment. Emit `Voted(voter, option, n, paid)`.
- `getResults() view returns (uint256[] votes, uint256 pot, uint256 voters, bool open)`
- `close()` (owner only): picks the option with the most votes and sends the pot to its recipient. Emits `Closed(winner, amount)`.
- **"Limits of Monad" detail (step 6, optional):** instead of one counter per option (every vote writes the same storage slot, so parallel execution has to re-execute conflicting transactions), use **16 counters per option** chosen by `voter % 16`. `getResults()` adds them up. Votes then rarely conflict and run in parallel. Talking point: *"We designed the contract for Monad's parallel execution."*

### Gas and money budget (check before the demo)
- Monad charges for the **gas limit**, not the gas used. Set a fixed gas limit per vote (e.g. 120k) instead of estimating it, which is also faster (per the Monad docs).
- Budget (updated in section 8, because we have <5 MON): drip **0.03 MON** per phone, `unitPrice` **0.0005 MON**. ~100 phones ≈ 3 MON. More MON from the Blitz platform claim, faucet.monad.xyz or the mentors.

### Handling RPC limits (public RPC ≈ 20–50 req/s)
- Phones **don't poll**: they only send transactions and show their own receipt, using `eth_sendRawTransactionSync` so it feels instant.
- **Only `/screen` polls** `getResults()`, once per second.
- The drip and the phones rotate between the main RPC and backup RPCs (`rpc.ankr.com/monad_testnet`, `rpc-testnet.monadinfra.com`) if they hit errors.

---

## 4. Timeline (checkpoints are hard stops)

| Time | Builder (Claude Code) | Pitch lead (Person B) | Checkpoint |
|---|---|---|---|
| **13:15–13:30** | Answer the open questions (section 8). Create the GitHub repo and Vercel project. Put test MON on the deployer and drip wallets | Collect testnet MON (Blitz claim + faucet); pick the 3–4 causes | Wallets funded |
| **13:30–14:15** | **Step 1:** write `LiveVote.sol`, test it with `forge test` (quadratic cost, close pays the winner), deploy to testnet, verify it in the explorer | Write the pitch draft (section 6) | ✅ Contract live + explorer link |
| **14:15–15:00** | **Step 2:** Next.js app: `/` voting with burner wallet + `/api/drip`. Deploy to Vercel **immediately**, even if it's ugly | Test on your own phone via the Vercel link | ✅ **Ugly but live**: one vote from a phone works |
| **15:00–15:45** | **Step 3:** `/screen` (QR code, live bars, counters) + `/host` (close) | Get 3–5 people from other teams to vote at once as a load test | ✅ Full flow end to end |
| **15:45** | 🛑 **FEATURE FREEZE** (the notes say 15:30; we're 15 min later because we started later) | | |
| **15:45–16:15** | **Step 4:** fixes only. Load test: a bot script sends 50 votes in parallel (local nonce tracking, `Promise.all`) | **Record the backup video** of a full run | ✅ Backup video exists |
| **16:15–16:30** | **Step 5 (only if everything is green):** sharded counters or a "votes/sec" counter | Rehearse the pitch (twice) | |
| **16:30–16:45** | Final deploy, test the link in a private browser window, open a **fresh poll** for the pitch, README with links | Prepare demo tabs: `/screen`, explorer, backup video | ✅ Final link works |
| **16:45–17:00** | **Submit on blitz.devnads.com** (earlier = earlier pitch slot) | | ✅ Submitted |
| **17:00** | ❄️ CODE FREEZE | | |

**Rule every 45 min:** is there a deployable, working version right now? If not, fix it before starting anything new.

---

## 5. Demo script (90 seconds of the 3 minutes)

1. `/screen` on the projector: big QR code + the question *"Which cause gets tonight's pot?"*
2. "Everyone take out your phone and scan. You have 30 seconds. No wallet, no app."
3. The bars jump live. The counter shows e.g. *"73 voters, 214 votes, 1.9 MON raised"* and *"38 votes in the last 5 s."*
4. Say: "Every one of those votes is a real on-chain payment, confirmed in about 0.6 seconds."
5. Host presses **Close** → the pot goes to the winner → open the payout transaction in the explorer.
6. **If it fails:** play the backup video. Spend at most one sentence on the problem.

## 6. Pitch (3 min, strict)

1. **Hook (10 s):** "It's Slido, but every vote is a donation, and you just paid."
2. **Pain (15 s):** "Live polls cost nothing, so they mean nothing. Donations at events are slow, opaque and eaten by card fees; a €0.20 donation doesn't survive a card fee."
3. **Live demo (60–90 s):** section 5.
4. **Why Monad (15 s):** "A hundred people paying at the same second, each confirmed in 0.6 s, for a fraction of a cent. Ethereum does ~28 transactions a second with 12-second blocks. This room alone would jam it. Plus quadratic voting so the richest person can't buy the result, and a contract built for parallel execution."
5. **Next (10 s):** "For conferences, club nights and street festivals. Next: email login (Privy), euro stablecoin, verified charity wallets. We're continuing at Monad's Metropolis hackathon." Say your names and thank the room.

## 7. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Public RPC rate-limited during the live vote | Backup RPCs + only the screen polls. Test in the 15:45 load test |
| Drip wallet runs empty | Fund it with ≥15 MON; the drip caps at 1 top-up per burner |
| Contract won't deploy with Foundry | Deploy with Remix in the browser, then give Claude the address |
| Vercel build fails | Paste the build log into Claude; last resort: demo from the laptop (the link must still exist for the submission) |
| Venue Wi-Fi down | Phone hotspot |
| Claude usage limit | Person B continues in a second account with this PLAN.md + the last error |
| Live demo fails on stage | Backup video |

---

## 8. Decisions (answered 13:20)

- **Wallet:** burner wallet + auto top-up. ✅
- **GitHub + Vercel:** both ready. ✅ (The `gh` CLI isn't installed, so create the repo on github.com.)
- **MONSKILLS:** installed. ✅
- **Test MON: under 5, which is the #1 blocker.** Person B, **right now:** claim on blitz.devnads.com, use faucet.monad.xyz, and ask the mentors. Target ≥10 MON.
  - Until then, **shrink the budget:** drip = **0.03 MON** per phone, `unitPrice` = **0.0005 MON**, and a fixed gas limit of **100k** (≈0.005 MON per vote).
  - 0.03 MON ≈ 4–5 votes per person, so ~100 phones ≈ 3 MON drip. Deploying and testing ≈ 0.5 MON.
- **Still open:** which 3–4 causes (Person B decides).

---

## 9. The improved build prompt (paste into Claude Code at 13:30)

> Use the installed MONSKILLS, starting with the monskill routing skill. Build **Live Vote** on Monad testnet (chain ID 10143) following `live-vote/PLAN.md` exactly. Treat that file as the spec and the timeline.
>
> **Scope:** one Solidity contract (`LiveVote.sol`, section 3) and one Next.js app with three routes: `/` (mobile voting), `/screen` (projector with QR + live bars), `/host` (close the poll). Audience users must not need MetaMask: use a burner wallet in localStorage topped up via a `/api/drip` route. Use quadratic vote pricing and a fixed gas limit.
>
> **Rules:** store private keys only in a git-ignored `.env` and in Vercel env vars, never in code. Testnet only. Mobile-first UI; function beats polish.
>
> **Order of work, with a checkpoint after each step (stop and show me the result):** (1) contract + forge tests + deploy + explorer link, (2) voting page + drip deployed to Vercel, working from my phone, (3) screen + host pages, (4) a load-test script that sends 50 parallel votes.
>
> **Done means:** public GitHub repo, live Vercel link, verified contract link, README with the links and a one-paragraph explanation. First give me your plan in five bullet points and wait for my OK. If anything in PLAN.md is unclear, ask me before you build.

### What your original prompt was missing (and the version above adds)
1. **Time and hard checkpoints.** Without a freeze and step-by-step stops, Claude builds too much at once, and you only find out at 16:30 that nothing works.
2. **A concrete definition of "done"**: the repo, Vercel, explorer links and README the submission needs.
3. **The audience wallet decision.** The demo lives or dies on "no MetaMask for the room." Say so explicitly, otherwise you'll get a MetaMask connect button.
4. **What *not* to build.** Explicit exclusions stop scope creep.
5. **Secrets rules.** A committed private key in a public repo is the classic hackathon accident.
6. **A reference to the spec file** instead of re-explaining everything, which saves Claude usage (the prep notes warn that Claude Pro's usage limit runs out fast).
7. **Load and RPC limits.** The public RPC handles ~20–50 req/s, and your demo has 100 phones.
