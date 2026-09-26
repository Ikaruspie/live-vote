// Load test: 50 burner wallets vote at the same moment on the live contract.
// Run from web/: node --env-file=.env.local scripts/loadtest.mjs [count]
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseEther, formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { monadTestnet as chain } from "viem/chains";

const CONTRACT = "0x2C6Ee378dB96A16fF22204d19E9b9Bb94533a321";
const RPCS = ["https://testnet-rpc.monad.xyz", "https://rpc.ankr.com/monad_testnet", "https://rpc-testnet.monadinfra.com"];
const COUNT = Number(process.argv[2] ?? 50);
const FUND = parseEther("0.04"); // one vote: 0.0005 MON + gas
const VOTE_GAS = 180_000n;
const TRANSFER_GAS = 21_000n;

const abi = [
  { type: "function", name: "vote", stateMutability: "payable", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "unitPrice", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { type: "function", name: "getOptions", stateMutability: "view", inputs: [], outputs: [{ type: "string[]" }, { type: "address[]" }] },
];

const clients = RPCS.map((url) => createPublicClient({ chain, transport: http(url) }));
const main = clients[0];

const drip = privateKeyToAccount(process.env.DRIP_PRIVATE_KEY);
const [unitPrice, [labels], gasPrice, dripNonce, dripBal] = await Promise.all([
  main.readContract({ address: CONTRACT, abi, functionName: "unitPrice" }),
  main.readContract({ address: CONTRACT, abi, functionName: "getOptions" }),
  main.getGasPrice(),
  main.getTransactionCount({ address: drip.address, blockTag: "pending" }),
  main.getBalance({ address: drip.address }),
]);
// Fixed fee fields: no per-transaction RPC lookups before sending.
const fees = { maxFeePerGas: (gasPrice * 12n) / 10n, maxPriorityFeePerGas: gasPrice / 10n || 1n };
console.log(`DRIP ${drip.address} has ${formatEther(dripBal)} MON, gas price ${gasPrice / 1_000_000_000n} gwei`);

const bots = Array.from({ length: COUNT }, () => privateKeyToAccount(generatePrivateKey()));

// 1. Fund all bots in one parallel batch (local nonce counting, Monad docs pattern).
console.log(`Funding ${COUNT} bots with ${formatEther(FUND)} MON each…`);
const dripWallet = createWalletClient({ account: drip, chain, transport: http(RPCS[0]) });
const fundTxs = await Promise.all(
  bots.map(async (bot, i) =>
    main.sendRawTransaction({
      serializedTransaction: await dripWallet.signTransaction({
        to: bot.address, value: FUND, gas: TRANSFER_GAS, nonce: dripNonce + i, chainId: chain.id, ...fees,
      }),
    }),
  ),
);
await Promise.all(fundTxs.map((hash) => main.waitForTransactionReceipt({ hash })));
const rc = await Promise.all(fundTxs.map((hash) => main.getTransactionReceipt({ hash })));
console.log("Funded:", rc.map((r) => r.status).join(","), "bot0 balance", formatEther(await main.getBalance({ address: bots[0].address })));

// Monad checks balances against state from a few blocks back (async execution),
// so give fresh funds ~3 blocks before spending them.
await new Promise((r) => setTimeout(r, 2000));

// 2. Pre-sign every vote, then release them all at once, spread across RPCs.
const signed = await Promise.all(
  bots.map((bot, i) =>
    bot.signTransaction({
      to: CONTRACT,
      data: encodeFunctionData({ abi, functionName: "vote", args: [BigInt(i % labels.length), 1n] }),
      value: unitPrice, gas: VOTE_GAS, nonce: 0, chainId: chain.id, type: "eip1559", ...fees,
    }),
  ),
);

console.log(`Sending ${COUNT} votes at once…`);
const t0 = performance.now();
const results = await Promise.allSettled(
  signed.map(async (tx, i) => {
    const client = clients[i % clients.length];
    try {
      // eth_sendRawTransactionSync returns the receipt in the same request.
      return await client.sendRawTransactionSync({ serializedTransaction: tx });
    } catch (e) {
      if (process.env.DEBUG) console.log("sync err", i, e.details ?? e.shortMessage);
      const hash = await main.sendRawTransaction({ serializedTransaction: tx });
      return await main.waitForTransactionReceipt({ hash });
    }
  }),
);
const ms = Math.round(performance.now() - t0);

const ok = results.filter((r) => r.status === "fulfilled" && r.value.status === "success");
const blocks = new Set(ok.map((r) => r.value.blockNumber));
console.log(`\n${ok.length}/${COUNT} votes confirmed in ${ms} ms across ${blocks.size} block(s)`);
results.forEach((r, i) => {
  if (r.status === "rejected") console.log(`  bot ${i} failed: ${String(r.reason?.details ?? r.reason?.shortMessage ?? r.reason).slice(0, 160)}`);
});
