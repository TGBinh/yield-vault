import { assertHttpsInProduction } from "@/lib/env-guard";

export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

assertHttpsInProduction("Backend URL", BACKEND_URL);

export type VaultSummary = {
  totalDeposited: string;
  totalWithdrawn: string;
  tvl: string;
  totalShares: string;
  sharePrice: string | null;
  depositCount: number;
  withdrawalCount: number;
};

export type PositionEvent = {
  txHash: string;
  logIndex: number;
  chainId: number;
  blockNumber: string;
  blockTimestamp: string;
  vaultAddress: string;
  assets: string;
  shares: string;
};

export type UserPositions = {
  userAddress: string;
  totalDeposited: string;
  totalWithdrawn: string;
  netAssets: string;
  netShares: string;
  deposits: PositionEvent[];
  withdrawals: PositionEvent[];
};

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`);
  if (!res.ok) {
    throw new Error(`Backend request failed: ${res.status} ${path}`);
  }
  return (await res.json()) as T;
}

export function fetchVaultSummary(): Promise<VaultSummary> {
  return fetchJson<VaultSummary>("/vault/summary");
}

/// GĐ5 - Multichain: mỗi chain chạy 1 Vault/StrategyManager độc lập, không chia sẻ thanh
/// khoản - TVL từng chain hiển thị riêng, KHÔNG cộng gộp (xem comment ở
/// backend/src/vault/dto/vault-summary.dto.ts).
export type ChainVaultSummary = {
  chainId: number;
  tvl: string;
  totalShares: string;
  depositCount: number;
  withdrawalCount: number;
};

export function fetchVaultSummaryByChain(): Promise<ChainVaultSummary[]> {
  return fetchJson<ChainVaultSummary[]>("/vault/summary-by-chain");
}

export function fetchUserPositions(address: string): Promise<UserPositions> {
  // Vault Security Audit: address hiện luôn đến từ useAccount() (hex hợp lệ), nhưng
  // encode để phòng thủ tầng sâu - không tin ngầm định câu chuyện "nguồn luôn sạch".
  return fetchJson<UserPositions>(`/user/${encodeURIComponent(address)}/positions`);
}

export type AllocationSuggestion = {
  strategyId: string;
  targetWeightBps: number;
  riskScore: number;
  expectedApy: number;
};

export type Recommendation = {
  allocations: AllocationSuggestion[];
  source: "ai" | "deterministic";
  confidence: number;
  explanation: string;
  riskFlags: string[];
};

export type PolicyVerdict = {
  approved: boolean;
  reason: string;
  executionIntent: {
    allocations: { strategyId: string; targetWeightBps: number }[];
    approvedAt: string;
    expiresAt: string;
  } | null;
};

export type RecommendationPipelineResult = {
  optimizationResult: {
    allocations: {
      strategy_id: string;
      target_weight_bps: number;
      risk_score: number;
      expected_apy: number;
      rationale: string;
    }[];
    total_weight_bps: number;
    generated_at: string;
  };
  recommendation: Recommendation;
  policyVerdict: PolicyVerdict;
};

export function fetchLatestRecommendation(): Promise<RecommendationPipelineResult> {
  return fetchJson<RecommendationPipelineResult>("/recommendations/latest");
}
