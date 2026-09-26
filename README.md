# Live Vote

**Scan a QR code, vote live on which cause gets the pot. Every vote is a micro-donation.** Live Vote turns a room into a live, on-chain donation poll: the audience scans a QR code, gets a wallet in the browser automatically (no app, no MetaMask), and taps to vote. Each vote is a real payment on Monad, priced quadratically so no single person can buy the result. The projector shows live bars as votes land, and when the host closes the poll, the smart contract pays the whole pot to the winning cause in one transaction that anyone can verify.

Built at **Monad Blitz Berlin, 26.09.2026**.

## Links

| | |
|---|---|
| **Live app (vote)** | https://live-vote-eight.vercel.app |
| **Projector screen** | https://live-vote-eight.vercel.app/screen |
| **Contract (Monad testnet)** | [`0xEAF5AA4abe61Cc8D15BEFBC78f1c40c23C7dBEAA`](https://testnet.monadvision.com/address/0xEAF5AA4abe61Cc8D15BEFBC78f1c40c23C7dBEAA) |
| Explorer (Monadscan) | https://testnet.monadscan.com/address/0xEAF5AA4abe61Cc8D15BEFBC78f1c40c23C7dBEAA |

The contract is verified on MonadVision and Monadscan.

## How it works

1. **Scan.** The phone page creates a burner wallet in the browser and asks `/api/drip` for 0.1 test MON (server-side key, one top-up per fresh wallet, capped and rate-limited).
2. **Vote.** Each tap sends `vote(option, 1)` to [`LiveVote.sol`](contracts/src/LiveVote.sol). Cost is quadratic per voter and cause: the k-th vote costs `(2k − 1) × 0.0005 MON`. Votes use `eth_sendRawTransactionSync`, so the receipt comes back in the same request.
3. **Watch.** `/screen` polls `getResults()` once per second and shows live bars, total votes, MON raised and votes in the last 5 seconds.
4. **Close.** The host presses *Close poll & pay out* (`/host`). `close()` sends the whole pot to the cause with the most votes and emits `Closed`. The screen switches to the winner and shows the payout transaction.

```
contracts/   Foundry project: LiveVote.sol, tests, deploy script
web/         Next.js app: / (vote), /screen (projector), /host, /api/drip, /api/close
web/scripts/loadtest.mjs   50 wallets voting at the same moment
```

## Why Monad

- **A whole room pays at once.** Load test: **50 wallets voting at the same moment, 50/50 confirmed in ~3 s, in 2–3 blocks**; a single vote confirms in **under 400 ms**. On Ethereum (~28 TPS, 12 s blocks) a room like this jams the chain.
- **Micro-donations only work with near-zero fees.** A 20-cent vote can't survive card fees or expensive gas.
- **Built for parallel execution.** Vote and voter counters are split into 16 shards by voter address, so simultaneous voters rarely write the same storage slot.
- **Monad-specific details we handled:** a fixed gas limit per vote (Monad charges the gas *limit*), and a short wait after the top-up, because balances are checked against state a few blocks back (async execution).

## Run it yourself

```bash
# contracts
cd contracts && forge install --no-git foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts && forge test
# web (needs DRIP_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, HOST_KEY in web/.env.local)
cd web && npm install && npm run dev
```

## Roadmap

See [ROADMAP.md](ROADMAP.md). The top three:

1. **One person = one voter** (event check-in or proof of personhood), which makes quadratic voting fair.
2. **Euro stablecoin + verified charity wallets**, for real donations to real organisations.
3. **Email login instead of a browser wallet**, plus a form for organisers to create their own polls.

Testnet only: no real money is involved.
