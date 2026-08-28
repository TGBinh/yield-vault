export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";

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

export function fetchUserPositions(address: string): Promise<UserPositions> {
  return fetchJson<UserPositions>(`/user/${address}/positions`);
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
