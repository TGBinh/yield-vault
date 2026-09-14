import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import {
  ActiveAllocationRiskResponseDto,
  StrategiesResponseDto,
  StrategyEventDto,
  StrategyRiskDto,
} from './dto/strategy-event.dto';

interface StrategyEventRow {
  tx_hash: string;
  log_index: number;
  chain_id: number;
  block_number: string;
  block_timestamp: string;
  contract_address: string;
  event_name: string;
  payload: Record<string, unknown>;
}

const STRATEGY_REGISTERED_EVENT = 'StrategyRegistered';
const ACTIVE_STRATEGY_CHANGED_EVENT = 'ActiveStrategyChanged';
const ALLOCATIONS_UPDATED_EVENT = 'AllocationsUpdated';

interface RiskScoreFromEngine {
  strategy_id: string;
  tvl_score: number;
  utilization_score: number;
  volatility_score: number;
  age_score: number;
  composite_score: number;
}

interface OptimizeResponse {
  risk_scores: RiskScoreFromEngine[];
  optimization_result: {
    allocations: { strategy_id: string; expected_apy: number }[];
  };
}

/**
 * Suy ra địa chỉ strategy liên quan từ payload JSONB, tuỳ theo tên event
 * (ABI arg names khác nhau giữa các loại event).
 */
function extractStrategyAddress(
  eventName: string,
  payload: Record<string, unknown>,
): string | null {
  if (eventName === STRATEGY_REGISTERED_EVENT) {
    return (payload?.strategy as string) ?? null;
  }
  if (eventName === ACTIVE_STRATEGY_CHANGED_EVENT) {
    return (payload?.current as string) ?? null;
  }
  return null;
}

@Injectable()
export class StrategiesService {
  private readonly riskEngineUrl: string;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {
    this.riskEngineUrl = this.config.get<string>('RISK_ENGINE_URL', 'http://localhost:8002');
  }

  async getStrategies(): Promise<StrategiesResponseDto> {
    const result = await this.pool.query<StrategyEventRow>(
      `SELECT tx_hash, log_index, chain_id, block_number, block_timestamp,
              contract_address, event_name, payload
       FROM strategy_events
       WHERE confirmed = true
       ORDER BY block_number DESC, log_index DESC`,
    );

    const events: StrategyEventDto[] = result.rows.map((row) => ({
      txHash: row.tx_hash,
      logIndex: row.log_index,
      chainId: row.chain_id,
      blockNumber: row.block_number.toString(),
      blockTimestamp: row.block_timestamp,
      contractAddress: row.contract_address,
      eventName: row.event_name,
      payload: row.payload,
      strategyAddress: extractStrategyAddress(row.event_name, row.payload),
    }));

    // Chiến lược đang active: ưu tiên event ActiveStrategyChanged mới nhất
    // (payload.current), nếu chưa từng đổi thì lấy strategy được register mới nhất.
    const latestActiveChange = events.find(
      (event) => event.eventName === ACTIVE_STRATEGY_CHANGED_EVENT,
    );
    const latestRegistered = events.find(
      (event) => event.eventName === STRATEGY_REGISTERED_EVENT,
    );

    const activeStrategyAddress =
      latestActiveChange?.strategyAddress ??
      latestRegistered?.strategyAddress ??
      null;

    return {
      events,
      activeStrategyAddress,
    };
  }

  /// Vault Security Audit - Medium: PolicyService trước đây tự SQL thẳng vào bảng
  /// strategy_events (thuộc StrategiesModule) thay vì đi qua service này - vi phạm
  /// module boundary. Tập trung SQL whitelist strategy về đúng 1 chỗ, giữ nguyên điều
  /// kiện confirmed = true (đã vá ở Vault Security Audit - High trước đó).
  async getConfirmedStrategyAddresses(): Promise<string[]> {
    const result = await this.pool.query<{ strategy: string }>(
      `SELECT DISTINCT payload->>'strategy' AS strategy
       FROM strategy_events
       WHERE event_name = $1 AND confirmed = true AND payload->>'strategy' IS NOT NULL`,
      [STRATEGY_REGISTERED_EVENT],
    );
    return result.rows.map((r) => r.strategy);
  }

  /// Phase 2 (strategy allocation breakdown + risk score) - gộp 2 nguồn: (1) weightBps
  /// THẬT đang chạy on-chain, suy ra từ AllocationsUpdated mới nhất đã index (KHÔNG gọi
  /// risk-engine's /optimize để lấy weight - đó là 1 đề xuất MỚI, có thể khác hoàn toàn
  /// phân bổ thật đang active); (2) điểm rủi ro risk-engine chấm cho từng strategy đó,
  /// đọc từ risk_scores (risk-engine LUÔN chấm toàn bộ catalog, không chỉ strategy được
  /// đề xuất - xem risk_engine/pipeline.py `run()`), KHÔNG dùng field "risk_score" bên
  /// trong allocations (đó là điểm cho phân bổ ĐỀ XUẤT, không phải phân bổ ĐANG CHẠY).
  ///
  /// GAP THẬT đã phát hiện khi viết hàm này, ghi lại thay vì giấu (đúng convention đã
  /// dùng xuyên suốt codebase, vd. PolicyService's "max-change" rule): risk-engine
  /// (`strategy_catalog.py`) định danh strategy bằng SLUG cố định ("aave-usdc",
  /// "morpho-usdc"), trong khi on-chain/indexer định danh bằng ĐỊA CHỈ CONTRACT thật
  /// (0x...) - 2 KHÔNG BAO GIỜ khớp nhau qua join `.toLowerCase()` này trên bất kỳ
  /// deployment thật nào (chỉ khớp "tình cờ" nếu ai đó test bằng dữ liệu giả trùng tên).
  /// Kết quả: `riskById.get(strategyId)`/`apyById.get(strategyId)` sẽ LUÔN trả undefined
  /// trên deployment testnet/production thật -> field risk/apy luôn null, KHÔNG throw lỗi
  /// (an toàn, đã có `?? null` fallback) nhưng cũng không hữu ích như tên hàm gợi ý. Đây
  /// là gap kiến trúc PRE-EXISTING của risk-engine (cùng loại mismatch tồn tại từ GĐ4 ở
  /// chính PolicyService's whitelist check), không phải lỗi mới của Phase 2 - cần 1 lớp
  /// mapping slug<->address (env config hoặc bảng riêng) để sửa triệt để, ngoài phạm vi 1
  /// tính năng UI đơn lẻ.
  async getActiveAllocationWithRisk(): Promise<ActiveAllocationRiskResponseDto> {
    const activeResult = await this.pool.query<{
      payload: { strategies: string[]; weightsBps: string[] };
      block_timestamp: string;
    }>(
      `SELECT payload, block_timestamp FROM strategy_events
       WHERE event_name = $1 AND confirmed = true
       ORDER BY block_number DESC, log_index DESC LIMIT 1`,
      [ALLOCATIONS_UPDATED_EVENT],
    );

    if (activeResult.rows.length === 0) {
      return { strategies: [], asOf: null };
    }

    const { payload, block_timestamp } = activeResult.rows[0];
    const activeAllocation = payload.strategies.map((strategyId, i) => ({
      strategyId: strategyId.toLowerCase(),
      weightBps: Number(payload.weightsBps[i]),
    }));

    const riskScores = await this.fetchRiskScores();
    const riskById = new Map(riskScores.risk_scores.map((rs) => [rs.strategy_id.toLowerCase(), rs]));
    const apyById = new Map(
      riskScores.optimization_result.allocations.map((a) => [a.strategy_id.toLowerCase(), a.expected_apy]),
    );

    const strategies: StrategyRiskDto[] = activeAllocation.map(({ strategyId, weightBps }) => {
      const risk = riskById.get(strategyId);
      return {
        strategyId,
        weightBps,
        riskScore: risk?.composite_score ?? null,
        tvlScore: risk?.tvl_score ?? null,
        utilizationScore: risk?.utilization_score ?? null,
        volatilityScore: risk?.volatility_score ?? null,
        ageScore: risk?.age_score ?? null,
        expectedApy: apyById.get(strategyId) ?? null,
      };
    });

    return { strategies, asOf: block_timestamp };
  }

  private async fetchRiskScores(): Promise<OptimizeResponse> {
    const res = await fetch(`${this.riskEngineUrl}/optimize`);
    if (!res.ok) {
      throw new Error(`risk-engine /optimize returned ${res.status}`);
    }
    return (await res.json()) as OptimizeResponse;
  }
}
