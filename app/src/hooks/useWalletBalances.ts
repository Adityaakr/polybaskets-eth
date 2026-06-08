import { useQuery } from "@tanstack/react-query";
import { createPublicClient, http } from "viem";
import { config, hoodiChain } from "@/config";

const ERC20 = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const publicClient = createPublicClient({ chain: hoodiChain, transport: http(config.ethRpc) });

export interface WalletBalances {
  eth: bigint; // native ETH on Hoodi (18 dec)
  wvara: bigint; // wVARA token balance (12 dec)
}

/** Read the connected wallet's live on-chain balances (ETH + wVARA). Polls every 5s + on focus. */
export function useWalletBalances(address?: string | null) {
  return useQuery<WalletBalances>({
    queryKey: ["wallet-balances", address],
    enabled: Boolean(address),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    staleTime: 2_000,
    queryFn: async () => {
      const a = address as `0x${string}`;
      const [eth, wvara] = await Promise.all([
        publicClient.getBalance({ address: a }),
        config.wvaraAddress
          ? publicClient
              .readContract({ address: config.wvaraAddress, abi: ERC20, functionName: "balanceOf", args: [a] })
              .catch(() => 0n)
          : Promise.resolve(0n),
      ]);
      return { eth, wvara: wvara as bigint };
    },
  });
}
