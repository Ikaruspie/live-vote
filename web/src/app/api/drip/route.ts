import { createWalletClient, isAddress, type Hex } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";
import { chain, DRIP_AMOUNT, publicClient, transport } from "@/lib/config";

// Runs server-side only: DRIP_PRIVATE_KEY never reaches the browser.
const key = process.env.DRIP_PRIVATE_KEY as Hex | undefined;
const account = key ? privateKeyToAccount(key, { nonceManager }) : undefined;
const wallet = account ? createWalletClient({ account, chain, transport }) : undefined;

/**
 * Hard cap shared by every server instance: the DRIP wallet's on-chain transaction
 * count is the counter, so no storage is needed. Raise DRIP_MAX_NONCE to allow more.
 */
const MAX_NONCE = Number(process.env.DRIP_MAX_NONCE ?? 400);

/**
 * Per-instance rate limit. Deliberately not per IP: at a venue every phone shares
 * the same Wi-Fi, so a per-IP limit would block the whole room.
 */
const MAX_PER_MINUTE = 120;
const recent: number[] = [];

// Best-effort guard against the same address hitting the route twice within one instance.
const pending = new Set<string>();

export async function POST(request: Request) {
  if (!wallet || !account) return Response.json({ error: "Drip not configured" }, { status: 500 });

  const { address } = (await request.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) {
    return Response.json({ error: "Invalid address" }, { status: 400 });
  }
  const addr = address.toLowerCase();
  if (pending.has(addr)) return Response.json({ status: "pending" });

  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_PER_MINUTE) {
    return Response.json({ error: "Too many top-ups right now, try again in a minute" }, { status: 429 });
  }

  // One top-up per address, checked on-chain so it holds across serverless instances:
  // only fresh wallets (no balance, never sent a transaction) get funded.
  const [balance, nonce, dripNonce] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.getTransactionCount({ address }),
    publicClient.getTransactionCount({ address: account.address, blockTag: "pending" }),
  ]);
  if (balance > BigInt(0) || nonce > 0) return Response.json({ status: "already-funded" });
  if (dripNonce >= MAX_NONCE) {
    return Response.json({ error: "All top-ups for this event are used up" }, { status: 429 });
  }

  recent.push(now);
  pending.add(addr);
  try {
    const receipt = await wallet.sendTransactionSync({ to: address, value: DRIP_AMOUNT });
    return Response.json({ status: "funded", hash: receipt.transactionHash });
  } catch (err) {
    console.error("drip failed", err);
    return Response.json({ error: "Drip failed, try again" }, { status: 502 });
  } finally {
    pending.delete(addr);
  }
}
