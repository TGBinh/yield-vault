import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { PG_POOL } from '../database/database.constants';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  ExecutionIntent,
  PolicyVerdict,
  RecommendationDto,
} from './dto/recommendation.dto';

const BPS_DENOMINATOR = 10_000;
const BPS_SUM_TOLERANCE = 5; // rounding drift, same tolerance risk-engine's own optimizer allows

/// Hard safety limits - deliberately NOT trusting risk-engine's own optimizer caps
/// (defense in depth per PLAN.md §4: mọi lớp phải tự kiểm tra, không tin tưởng ngầm vào
/// lớp trước). These are independent, hardcoded here regardless of what the AI/risk
/// engine claims to have already enforced.
const MAX_SINGLE_STRATEGY_BPS = 7_000; // no strategy > 70% of the vault
const MIN_REBALANCE_INTERVAL_MS = 60 * 60 * 1000; // 1 rebalance/hour max
const REBALANCE_COOLDOWN_KEY = 'policy:last-rebalance-approved-at';
const MIN_CONFIDENCE_THRESHOLD = 0.3;
const EXECUTION_INTENT_TTL_MS = 15 * 60 * 1000; // human must approve within 15 minutes

// Max-change-vs-current-allocation is a rule PLAN.md GD4 calls for ("giới hạn % thay
// đổi phân bổ tối đa/lần") but is NOT enforced yet: the backend has no live source for
// "current on-chain allocation" (StrategyManager.weightBps() isn't indexed - only
// individual events are). Wiring it in without real current-state data would either be
// a no-op or, worse, silently compare every proposal against an assumed-zero baseline
// and reject almost everything for the wrong reason. Left as a documented gap rather
// than a rule that looks enforced but isn't meaningful.

/// PLAN.md GD4 §4/§9: "Policy/Safety Engine... validate mọi Recommendation theo rule
/// cứng... Không có đường nào trong code cho phép AI Engine gọi thẳng Execution Engine
/// mà bỏ qua Policy Engine". This service IS that gate - nothing downstream (a future
/// Keeper Bot) should ever consume a Recommendation directly; only an ExecutionIntent
/// this service produced after every rule below passed.
@Injectable()
export class PolicyService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async evaluate(recommendation: RecommendationDto): Promise<PolicyVerdict> {
    const registeredStrategies = await this.getRegisteredStrategies();

    const rejection = this.checkRules(recommendation, registeredStrategies);
    if (rejection) {
      return { approved: false, reason: rejection, executionIntent: null };
    }

    // Vault Readiness Report - Phase 0: cooldown giờ nằm ở Redis (SET NX PX), không còn
    // in-memory - sống sót qua restart và đúng ngay cả khi chạy nhiều backend instance
    // cùng lúc, vì SET NX là 1 lệnh atomic (2 instance không thể cùng "thắng" claim).
    const cooldownRejection = await this.tryClaimRebalanceSlot();
    if (cooldownRejection) {
      return { approved: false, reason: cooldownRejection, executionIntent: null };
    }

    const executionIntent = this.buildExecutionIntent(recommendation);
    return { approved: true, reason: 'All policy checks passed', executionIntent };
  }

  private async tryClaimRebalanceSlot(): Promise<string | null> {
    const now = Date.now();
    const claimed = await this.redis.set(
      REBALANCE_COOLDOWN_KEY,
      String(now),
      'PX',
      MIN_REBALANCE_INTERVAL_MS,
      'NX',
    );
    if (claimed === 'OK') return null;

    const lastApprovedAtMs = Number(await this.redis.get(REBALANCE_COOLDOWN_KEY));
    const elapsed = now - lastApprovedAtMs;
    const waitMinutes = Math.ceil((MIN_REBALANCE_INTERVAL_MS - elapsed) / 60_000);
    return `Rebalance cooldown active - last approval was ${Math.round(elapsed / 60_000)} min ago, must wait ${waitMinutes} more minute(s)`;
  }

  private checkRules(
    recommendation: RecommendationDto,
    registeredStrategies: Set<string>,
  ): string | null {
    const sum = recommendation.allocations.reduce((acc, a) => acc + a.targetWeightBps, 0);
    if (Math.abs(sum - BPS_DENOMINATOR) > BPS_SUM_TOLERANCE) {
      return `Allocations sum to ${sum} bps, expected ${BPS_DENOMINATOR} (+-${BPS_SUM_TOLERANCE})`;
    }

    for (const allocation of recommendation.allocations) {
      if (!registeredStrategies.has(allocation.strategyId.toLowerCase())) {
        return `Strategy ${allocation.strategyId} is not a registered strategy (whitelist violation)`;
      }

      if (allocation.targetWeightBps > MAX_SINGLE_STRATEGY_BPS) {
        return `Strategy ${allocation.strategyId} requests ${allocation.targetWeightBps} bps, exceeds max single-strategy cap of ${MAX_SINGLE_STRATEGY_BPS} bps`;
      }
    }

    if (recommendation.confidence < MIN_CONFIDENCE_THRESHOLD) {
      return `Confidence ${recommendation.confidence} is below the minimum threshold of ${MIN_CONFIDENCE_THRESHOLD}`;
    }

    return null;
  }

  private buildExecutionIntent(recommendation: RecommendationDto): ExecutionIntent {
    const now = new Date();
    return {
      allocations: recommendation.allocations.map((a) => ({
        strategyId: a.strategyId,
        targetWeightBps: a.targetWeightBps,
      })),
      approvedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXECUTION_INTENT_TTL_MS).toISOString(),
    };
  }

  private async getRegisteredStrategies(): Promise<Set<string>> {
    const result = await this.pool.query<{ strategy: string }>(
      `SELECT DISTINCT payload->>'strategy' AS strategy
       FROM strategy_events
       WHERE event_name = 'StrategyRegistered' AND payload->>'strategy' IS NOT NULL`,
    );
    return new Set(result.rows.map((r) => r.strategy.toLowerCase()));
  }
}
