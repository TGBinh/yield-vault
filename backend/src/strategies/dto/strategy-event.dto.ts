export class StrategyEventDto {
  txHash!: string;
  logIndex!: number;
  chainId!: number;
  blockNumber!: string;
  blockTimestamp!: string;
  contractAddress!: string;
  eventName!: string;
  payload!: Record<string, unknown>;
  strategyAddress!: string | null;
}

export class StrategiesResponseDto {
  events!: StrategyEventDto[];
  activeStrategyAddress!: string | null;
}

/// Phase 2 (strategy allocation breakdown + risk score) - 1 strategy trong phân bổ ĐANG
/// CHẠY thật trên chain (weightBps từ AllocationsUpdated mới nhất), gộp với điểm rủi ro
/// risk-engine chấm cho CHÍNH strategy đó (risk-engine's /optimize luôn chấm điểm toàn bộ
/// catalog, không chỉ strategy được chọn phân bổ - xem risk_engine/pipeline.py `run()`).
/// Các field risk có thể null nếu risk-engine không có strategy này trong catalog của nó
/// (vd. strategy on-chain mới đăng ký nhưng chưa cập nhật catalog off-chain).
export class StrategyRiskDto {
  strategyId!: string;
  weightBps!: number;
  riskScore!: number | null;
  tvlScore!: number | null;
  utilizationScore!: number | null;
  volatilityScore!: number | null;
  ageScore!: number | null;
  expectedApy!: number | null;
}

export class ActiveAllocationRiskResponseDto {
  strategies!: StrategyRiskDto[];
  /// ISO timestamp của lần setAllocations() gần nhất indexer đã bắt được. Null nếu chưa
  /// từng thấy event AllocationsUpdated nào đã confirmed - có thể vì chưa rebalance lần
  /// nào, hoặc indexer chỉ mới bắt đầu quét SAU block của lần setAllocations() đó (vd.
  /// deploy.ts gọi setAllocations() bootstrap trước khi indexer khởi động ở local dev).
  asOf!: string | null;
}
