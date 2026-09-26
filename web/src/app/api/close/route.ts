import { createWalletClient, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chain, LIVE_VOTE_ADDRESS, liveVoteAbi, transport } from "@/lib/config";

// Server-side only: the contract owner key closes the poll.
const key = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
const hostKey = process.env.HOST_KEY;

export async function POST(request: Request) {
  if (!key || !hostKey) return Response.json({ error: "Close not configured" }, { status: 500 });

  const { key: provided } = (await request.json().catch(() => ({}))) as { key?: string };
  if (provided !== hostKey) return Response.json({ error: "Wrong host key" }, { status: 401 });

  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain, transport });
  try {
    const receipt = await wallet.writeContractSync({
      address: LIVE_VOTE_ADDRESS,
      abi: liveVoteAbi,
      functionName: "close",
      gas: BigInt(150_000),
    });
    return Response.json({ status: receipt.status, hash: receipt.transactionHash });
  } catch (err) {
    const msg = String(err);
    console.error("close failed", err);
    return Response.json(
      { error: msg.includes("PollClosed") ? "Poll is already closed" : "Close failed, try again" },
      { status: 502 },
    );
  }
}
