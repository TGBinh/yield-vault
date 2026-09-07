import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { StrategiesService } from '../strategies/strategies.service';
import {
  ExecutionIntent,
  PolicyVerdict,
  RecommendationDto,
} from './dto/recommendation.dto';
import {
  CrossChainExecutionIntent,
  CrossChainPolicyVerdict,
  CrossChainTransferRequestDto,
} from './dto/cross-chain-transfer.dto';

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

/// GD6 Milestone 6.2 - PLAN.md GD6 §4: rule riêng cho cross-chain, tách biệt hoàn toàn
/// khỏi rule rebalance nội bộ 1 chain ở trên (limit + cooldown khác nhau, key Redis khác
/// nhau - 1 lần duyệt rebalance nội bộ không được phép "dùng ké" cooldown cross-chain hay
/// ngược lại). Cả 2 con số đều NGHIÊM NGẶT hơn rebalance nội bộ vì rủi ro cao hơn: mất 1
/// chan tin cay bo sung (CCIP) so voi chi rebalance giua cac strategy da whitelist cung 1
/// chain - xem CrossChainTimelock.sol NatSpec vé "diem khong quay dau".
const MAX_CROSSCHAIN_TVL_BPS = 2_000; // toi da 20% TVL nguon / 1 lan chuyen cross-chain
const MIN_CROSSCHAIN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h/lan, dai hon nhieu so voi 1h rebalance noi bo
const CROSSCHAIN_COOLDOWN_KEY = 'policy:last-crosschain-approved-at';
const CROSSCHAIN_EXECUTION_INTENT_TTL_MS = 15 * 60 * 1000;

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
    private readonly strategiesService: StrategiesService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /// Vault Security Audit - Critical C3: `claimSlot` tách rõ "xem trước verdict"
  /// (GET /recommendations/latest, public, KHÔNG được phép tiêu tốn cooldown) khỏi
  /// "duyệt thật" (POST /policy/evaluate, có InternalApiKeyGuard, MỚI được claim slot).
  /// Trước đây cả 2 đường đều claim - nghĩa là mở dashboard cũng vô tình dùng hết
  /// cooldown 1 giờ, và ai cũng gọi được endpoint đó để khoá rebalance vĩnh viễn.
  async evaluate(
    recommendation: RecommendationDto,
    options: { claimSlot: boolean },
  ): Promise<PolicyVerdict> {
    const registeredStrategies = await this.getRegisteredStrategies();

    const rejection = this.checkRules(recommendation, registeredStrategies);
    if (rejection) {
      return { approved: false, reason: rejection, executionIntent: null };
    }

    const cooldownRejection = options.claimSlot
      ? await this.tryClaimRebalanceSlot()
      : await this.peekRebalanceCooldown();
    if (cooldownRejection) {
      return { approved: false, reason: cooldownRejection, executionIntent: null };
    }

    const executionIntent = this.buildExecutionIntent(recommendation);
    return { approved: true, reason: 'All policy checks passed', executionIntent };
  }

  /// Vault Readiness Report - Phase 0: cooldown nằm ở Redis (SET NX PX), không còn
  /// in-memory - sống sót qua restart và đúng ngay cả khi chạy nhiều backend instance
  /// cùng lúc, vì SET NX là 1 lệnh atomic (2 instance không thể cùng "thắng" claim).
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

    return this.formatCooldownRejection(now);
  }

  /// Chỉ ĐỌC trạng thái cooldown, không claim slot - dùng cho đường preview public.
  private async peekRebalanceCooldown(): Promise<string | null> {
    const raw = await this.redis.get(REBALANCE_COOLDOWN_KEY);
    if (raw === null) return null;
    return this.formatCooldownRejection(Date.now(), Number(raw));
  }

  private formatCooldownRejection(now: number, lastApprovedAtMs?: number): string {
    const lastApproved = lastApprovedAtMs ?? now;
    const elapsed = now - lastApproved;
    const waitMinutes = Math.ceil((MIN_REBALANCE_INTERVAL_MS - elapsed) / 60_000);
    return `Rebalance cooldown active - last approval was ${Math.round(elapsed / 60_000)} min ago, must wait ${waitMinutes} more minute(s)`;
  }

  /// GD6 Milestone 6.2 - PLAN.md GD6 §4/§9: gác cổng riêng cho đề xuất chuyển vốn
  /// cross-chain (output của risk-engine's `POST /cross-chain/evaluate` - xem
  /// risk_engine/cross_chain.py `evaluate_switch()`), TRƯỚC khi bất kỳ ai (Keeper/Safe)
  /// được phép `CrossChainTimelock.queueTransfer()`. Không tin risk-engine's `shouldSwitch`
  /// một mình - vẫn tự tính lại % TVL độc lập, cùng nguyên tắc defense-in-depth với
  /// `evaluate()` ở trên.
  async evaluateCrossChainTransfer(
    request: CrossChainTransferRequestDto,
    options: { claimSlot: boolean },
  ): Promise<CrossChainPolicyVerdict> {
    const rejection = this.checkCrossChainRules(request);
    if (rejection) {
      return { approved: false, reason: rejection, executionIntent: null };
    }

    const cooldownRejection = options.claimSlot
      ? await this.tryClaimCrossChainSlot()
      : await this.peekCrossChainCooldown();
    if (cooldownRejection) {
      return { approved: false, reason: cooldownRejection, executionIntent: null };
    }

    const executionIntent = this.buildCrossChainExecutionIntent(request);
    return { approved: true, reason: 'All cross-chain policy checks passed', executionIntent };
  }

  private checkCrossChainRules(request: CrossChainTransferRequestDto): string | null {
    let amount: bigint;
    let tvl: bigint;
    try {
      amount = BigInt(request.amountRaw);
      tvl = BigInt(request.currentVaultTvlRaw);
    } catch {
      return 'amountRaw/currentVaultTvlRaw must be valid integer strings';
    }

    if (amount <= 0n) {
      return `amountRaw must be positive, got ${request.amountRaw}`;
    }
    if (tvl <= 0n) {
      return `currentVaultTvlRaw must be positive, got ${request.currentVaultTvlRaw}`;
    }
    if (amount > tvl) {
      return `amountRaw (${request.amountRaw}) exceeds currentVaultTvlRaw (${request.currentVaultTvlRaw})`;
    }

    // Khong tin risk-engine's shouldSwitch/netBenefitUsd mot minh - day la defense in
    // depth, khong phai lap lai vo nghia: risk-engine co the bi loi/bug, hoac caller goi
    // truc tiep endpoint nay voi payload tu bia.
    if (!request.shouldSwitch) {
      return 'risk-engine did not recommend this cross-chain switch (shouldSwitch=false)';
    }
    if (request.netBenefitUsd <= 0) {
      return `net benefit is not positive (${request.netBenefitUsd} USD) - switching would be a net loss`;
    }

    const bps = (amount * BigInt(BPS_DENOMINATOR)) / tvl;
    if (bps > BigInt(MAX_CROSSCHAIN_TVL_BPS)) {
      return `Transfer requests ${bps} bps of source vault TVL, exceeds max cross-chain cap of ${MAX_CROSSCHAIN_TVL_BPS} bps per transfer`;
    }

    return null;
  }

  private async tryClaimCrossChainSlot(): Promise<string | null> {
    const now = Date.now();
    const claimed = await this.redis.set(
      CROSSCHAIN_COOLDOWN_KEY,
      String(now),
      'PX',
      MIN_CROSSCHAIN_INTERVAL_MS,
      'NX',
    );
    if (claimed === 'OK') return null;

    return this.formatCrossChainCooldownRejection(now);
  }

  private async peekCrossChainCooldown(): Promise<string | null> {
    const raw = await this.redis.get(CROSSCHAIN_COOLDOWN_KEY);
    if (raw === null) return null;
    return this.formatCrossChainCooldownRejection(Date.now(), Number(raw));
  }

  private formatCrossChainCooldownRejection(now: number, lastApprovedAtMs?: number): string {
    const lastApproved = lastApprovedAtMs ?? now;
    const elapsed = now - lastApproved;
    const waitMinutes = Math.ceil((MIN_CROSSCHAIN_INTERVAL_MS - elapsed) / 60_000);
    return `Cross-chain transfer cooldown active - last approval was ${Math.round(elapsed / 60_000)} min ago, must wait ${waitMinutes} more minute(s)`;
  }

  private buildCrossChainExecutionIntent(request: CrossChainTransferRequestDto): CrossChainExecutionIntent {
    const now = new Date();
    return {
      destinationChainSelector: request.destinationChainSelector,
      amountRaw: request.amountRaw,
      approvedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + CROSSCHAIN_EXECUTION_INTENT_TTL_MS).toISOString(),
    };
  }

  /// Vault Security Audit - Critical C2: validate NGHIÊM NGẶT các giá trị số TRƯỚC khi
  /// gộp/so sánh - trước đây NaN/số âm/strategyId trùng đều lọt qua được (mọi so sánh
  /// với NaN trả về false, và chia nhỏ 1 strategy thành nhiều dòng dưới trần riêng lẻ
  /// vẫn cộng lại vượt trần chung). Đã verify: bypass thật, không phải lý thuyết.
  private checkRules(
    recommendation: RecommendationDto,
    registeredStrategies: Set<string>,
  ): string | null {
    if (recommendation.allocations.length === 0) {
      return 'Allocations list is empty';
    }

    for (const allocation of recommendation.allocations) {
      if (!Number.isInteger(allocation.targetWeightBps) || allocation.targetWeightBps < 0) {
        return `Strategy ${allocation.strategyId} has an invalid targetWeightBps: ${allocation.targetWeightBps}`;
      }
    }

    if (!Number.isFinite(recommendation.confidence)) {
      return `Confidence ${recommendation.confidence} is not a finite number`;
    }

    // Gộp theo strategy TRƯỚC khi check tổng/trần - chặn bypass "chia nhỏ cùng 1
    // strategy thành nhiều dòng, mỗi dòng dưới trần riêng lẻ nhưng cộng lại vượt trần".
    const weightByStrategy = new Map<string, number>();
    for (const allocation of recommendation.allocations) {
      const key = allocation.strategyId.toLowerCase();
      weightByStrategy.set(key, (weightByStrategy.get(key) ?? 0) + allocation.targetWeightBps);
    }

    const sum = [...weightByStrategy.values()].reduce((acc, w) => acc + w, 0);
    if (Math.abs(sum - BPS_DENOMINATOR) > BPS_SUM_TOLERANCE) {
      return `Allocations sum to ${sum} bps, expected ${BPS_DENOMINATOR} (+-${BPS_SUM_TOLERANCE})`;
    }

    for (const [strategyId, weight] of weightByStrategy) {
      if (!registeredStrategies.has(strategyId)) {
        return `Strategy ${strategyId} is not a registered strategy (whitelist violation)`;
      }

      if (weight > MAX_SINGLE_STRATEGY_BPS) {
        return `Strategy ${strategyId} requests ${weight} bps combined, exceeds max single-strategy cap of ${MAX_SINGLE_STRATEGY_BPS} bps`;
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

  /// Vault Security Audit - High: thiếu `confirmed = true` từng để lọt 1 cửa sổ vài
  /// block nơi 1 StrategyRegistered nằm trong nhánh reorg vẫn được coi là whitelist hợp
  /// lệ. Điều kiện này giờ nằm trong StrategiesService.getConfirmedStrategyAddresses().
  ///
  /// Vault Security Audit - Medium: PolicyService không còn tự SQL thẳng vào bảng
  /// strategy_events (thuộc StrategiesModule) - đi qua StrategiesService để giữ đúng
  /// module boundary, PolicyService chỉ còn lo policy rules.
  private async getRegisteredStrategies(): Promise<Set<string>> {
    const addresses = await this.strategiesService.getConfirmedStrategyAddresses();
    return new Set(addresses.map((address) => address.toLowerCase()));
  }
}
