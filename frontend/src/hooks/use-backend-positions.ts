"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchUserPositions, fetchVaultSummary } from "@/lib/backend";

/**
 * Reads indexed history from the backend (Postgres, populated by the indexer)
 * rather than the chain directly - this is what powers TVL trend and personal
 * transaction history, complementing the live on-chain reads in useVaultData.
 */
export function useVaultSummaryFromBackend() {
  return useQuery({
    queryKey: ["backend", "vault-summary"],
    queryFn: fetchVaultSummary,
    refetchInterval: 15000,
    retry: 1,
  });
}

export function useUserPositionsFromBackend(address: string | undefined) {
  return useQuery({
    queryKey: ["backend", "user-positions", address],
    queryFn: () => fetchUserPositions(address as string),
    enabled: !!address,
    refetchInterval: 15000,
    retry: 1,
  });
}
