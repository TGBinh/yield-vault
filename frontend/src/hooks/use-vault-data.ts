"use client";

import { useAccount, useReadContracts } from "wagmi";
import { vaultContract, usdcContract, CONTRACTS } from "@/lib/contracts";

/**
 * Central read hook: pulls every value the dashboard needs in one
 * multicall-batched request, and exposes a `refetch` to call after any
 * successful write (deposit/withdraw/faucet/approve).
 */
export function useVaultData() {
  const { address } = useAccount();

  const { data, refetch, isLoading } = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...usdcContract, functionName: "decimals" },
      { ...vaultContract, functionName: "decimals" },
      { ...usdcContract, functionName: "balanceOf", args: [address ?? "0x0"] },
      { ...vaultContract, functionName: "balanceOf", args: [address ?? "0x0"] },
      {
        ...usdcContract,
        functionName: "allowance",
        args: [address ?? "0x0", CONTRACTS.vault],
      },
      { ...vaultContract, functionName: "totalAssets" },
      { ...vaultContract, functionName: "totalSupply" },
    ],
    query: {
      enabled: !!address,
      refetchInterval: 6000,
    },
  });

  const [
    usdcDecimals,
    shareDecimals,
    usdcBalance,
    shareBalance,
    allowance,
    totalAssets,
    totalSupply,
  ] = (data ?? []) as [
    number | undefined,
    number | undefined,
    bigint | undefined,
    bigint | undefined,
    bigint | undefined,
    bigint | undefined,
    bigint | undefined,
  ];

  // convertToAssets depends on shareBalance, so it's a follow-up call.
  const { data: shareValueData, refetch: refetchShareValue } = useReadContracts({
    allowFailure: false,
    contracts: [
      {
        ...vaultContract,
        functionName: "convertToAssets",
        args: [shareBalance ?? 0n],
      },
    ],
    query: {
      enabled: !!address && shareBalance !== undefined,
      refetchInterval: 6000,
    },
  });

  const shareValueInAssets = (shareValueData?.[0] as bigint | undefined) ?? undefined;

  const refetchAll = async () => {
    await refetch();
    await refetchShareValue();
  };

  return {
    address,
    usdcDecimals: usdcDecimals ?? 6,
    shareDecimals: shareDecimals ?? 6,
    usdcBalance,
    shareBalance,
    allowance,
    totalAssets,
    totalSupply,
    shareValueInAssets,
    isLoading,
    refetchAll,
  };
}
