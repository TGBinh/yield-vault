"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchLatestRecommendation,
  fetchUserPositions,
  fetchVaultSummary,
  fetchVaultSummaryByChain,
} from "@/lib/backend";

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

/**
 * GĐ5 - Multichain: TVL/deposit/withdraw của TỪNG chain đang chạy indexer riêng, không
 * cộng gộp (mỗi chain có Vault/StrategyManager độc lập). Poll chậm hơn vault-summary vì
 * đây là dữ liệu tổng quan, không cần cập nhật theo từng giây như dashboard chính.
 */
export function useVaultSummaryByChain() {
  return useQuery({
    queryKey: ["backend", "vault-summary-by-chain"],
    queryFn: fetchVaultSummaryByChain,
    refetchInterval: 30000,
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

/**
 * Phase 4: Risk/Optimization Engine -> AI Engine -> Policy Engine chain. Not polled
 * aggressively (this triggers real LLM calls + on-chain reads server-side) - refetch on
 * demand instead of a short interval.
 */
export function useLatestRecommendation() {
  return useQuery({
    queryKey: ["backend", "latest-recommendation"],
    queryFn: fetchLatestRecommendation,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
