# Live Vote – Roadmap

Known limits of the hackathon version, and how we'd solve each one.

## Next (weeks)

| Issue today | Solution |
|---|---|
| Test MON only, no real donations | Euro stablecoin on Monad mainnet |
| Causes are our own test wallets | Verified charity wallets, confirmed by the organiser |
| Burner wallet lives in the browser (clear it and it's gone) | Email / Google login with embedded wallets (e.g. Para) |
| A new poll needs a code deploy by us | Poll form for organisers + factory contract (one contract per poll) |

## Later (months)

| Issue today | Solution |
|---|---|
| One person can vote with many wallets, which weakens quadratic voting | One person = one voter: check-in at the event or proof of personhood |
| Top-up can be drained by scripts (today: capped at 400 transactions + rate limit) | Top-ups tied to login / event check-in |
| The host decides when the poll ends | Fixed closing time in the contract, closable by anyone |
| Money stays locked if a poll is never closed | Automatic close at the deadline, or refunds |
| A tie goes to the cause listed first | Split the pot between tied causes |
| Speed depends on public RPCs | Dedicated RPC provider |
| No history of past polls | Indexer + history page with receipts |

## Where it's used

Conferences, club nights, street festivals, school and university events. Next stop: Monad's **Metropolis** hackathon.
