import { createPublicClient, fallback, http, parseEther } from "viem";
import { monadTestnet } from "viem/chains";

export { liveVoteAbi } from "./abi";

export const chain = monadTestnet;

/** Current poll contract on Monad testnet (chain 10143). */
export const LIVE_VOTE_ADDRESS = "0x36eb3A9E67c35248a3eDE9f359e346F5Ba4E0C14" as const;

export const EXPLORER_URL = "https://testnet.monadvision.com";

/** Main RPC first, then the backups from PLAN.md. viem's fallback switches on errors. */
export const RPC_URLS = [
  "https://testnet-rpc.monad.xyz",
  "https://rpc.ankr.com/monad_testnet",
  "https://rpc-testnet.monadinfra.com",
];

export const transport = fallback(RPC_URLS.map((url) => http(url, { retryCount: 1 })));

/**
 * Monad charges for the gas limit, not gas used, so keep this tight.
 * A first vote measured ~151k gas on testnet (cold storage slots); 180k leaves headroom.
 */
export const VOTE_GAS_LIMIT = BigInt(180_000);

/** Top-up per burner wallet: roughly 4–5 votes at ~100 gwei. */
export const DRIP_AMOUNT = parseEther("0.1");

export const publicClient = createPublicClient({ chain, transport });
