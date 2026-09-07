import { PolicyService } from './policy.service';
import { RecommendationDto } from './dto/recommendation.dto';
import { CrossChainTransferRequestDto } from './dto/cross-chain-transfer.dto';

const STRATEGY_A = '0x1111111111111111111111111111111111111a';
const STRATEGY_B = '0x2222222222222222222222222222222222222b';
const UNKNOWN_STRATEGY = '0x9999999999999999999999999999999999999f';

function makeRecommendation(overrides: Partial<RecommendationDto> = {}): RecommendationDto {
  const base: RecommendationDto = {
    allocations: [
      { strategyId: STRATEGY_A, targetWeightBps: 6000, riskScore: 80, expectedApy: 0.05 },
      { strategyId: STRATEGY_B, targetWeightBps: 4000, riskScore: 70, expectedApy: 0.03 },
    ],
    source: 'deterministic',
    confidence: 0.9,
    explanation: 'test recommendation',
    riskFlags: [],
  };
  return { ...base, ...overrides };
}

function makeStrategiesService(registeredStrategies: string[]) {
  return {
    getConfirmedStrategyAddresses: jest.fn().mockResolvedValue(registeredStrategies),
  } as unknown as import('../strategies/strategies.service').StrategiesService;
}

/// Fake ioredis giả lập đúng semantics của SET key value PX ms NX (chỉ set khi key chưa
/// tồn tại, trả về null nếu đã có) - đủ để test PolicyService mà không cần Redis thật.
function makeRedis() {
  const store = new Map<string, string>();
  return {
    set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
  } as unknown as import('ioredis').default;
}

describe('PolicyService (Phase 4 - adversarial tests)', () => {
  it('approves a valid recommendation and produces an ExecutionIntent', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const verdict = await service.evaluate(makeRecommendation(), { claimSlot: true });

    expect(verdict.approved).toBe(true);
    expect(verdict.executionIntent).not.toBeNull();
    expect(verdict.executionIntent!.allocations).toHaveLength(2);
  });

  it('rejects when allocations do not sum to 10000 bps', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const verdict = await service.evaluate(
      makeRecommendation({
        allocations: [
          { strategyId: STRATEGY_A, targetWeightBps: 6000, riskScore: 80, expectedApy: 0.05 },
          { strategyId: STRATEGY_B, targetWeightBps: 3000, riskScore: 70, expectedApy: 0.03 },
        ],
      }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/sum to/);
    expect(verdict.executionIntent).toBeNull();
  });

  it('rejects a strategy that is not registered (whitelist violation)', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A]), makeRedis());

    const verdict = await service.evaluate(
      makeRecommendation({
        allocations: [
          { strategyId: STRATEGY_A, targetWeightBps: 5000, riskScore: 80, expectedApy: 0.05 },
          { strategyId: UNKNOWN_STRATEGY, targetWeightBps: 5000, riskScore: 90, expectedApy: 0.2 },
        ],
      }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/not a registered strategy/);
  });

  it('rejects a single strategy exceeding the 70% concentration cap even if the AI claims high confidence', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const verdict = await service.evaluate(
      makeRecommendation({
        confidence: 0.99,
        allocations: [
          { strategyId: STRATEGY_A, targetWeightBps: 9000, riskScore: 95, expectedApy: 0.5 },
          { strategyId: STRATEGY_B, targetWeightBps: 1000, riskScore: 70, expectedApy: 0.03 },
        ],
      }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/exceeds max single-strategy cap/);
  });

  it('rejects a low-confidence AI recommendation even when numerically valid', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const verdict = await service.evaluate(makeRecommendation({ source: 'ai', confidence: 0.1 }), {
      claimSlot: true,
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/below the minimum threshold/);
  });

  it('enforces a rebalance cooldown after an approval', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const first = await service.evaluate(makeRecommendation(), { claimSlot: true });
    expect(first.approved).toBe(true);

    const second = await service.evaluate(makeRecommendation(), { claimSlot: true });
    expect(second.approved).toBe(false);
    expect(second.reason).toMatch(/cooldown active/);
  });

  it('accepts small rounding drift in the bps sum (within tolerance)', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const verdict = await service.evaluate(
      makeRecommendation({
        allocations: [
          { strategyId: STRATEGY_A, targetWeightBps: 6000, riskScore: 80, expectedApy: 0.05 },
          { strategyId: STRATEGY_B, targetWeightBps: 3997, riskScore: 70, expectedApy: 0.03 },
        ],
      }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(true);
  });

  // Vault Security Audit - Critical C2: verify các payload đã chứng minh bypass được
  // Policy Engine trước khi vá, giờ phải bị reject rõ ràng.
  it('rejects NaN targetWeightBps instead of letting it slip through numeric comparisons', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const verdict = await service.evaluate(
      makeRecommendation({
        allocations: [
          { strategyId: STRATEGY_A, targetWeightBps: Number.NaN, riskScore: 80, expectedApy: 0.05 },
          { strategyId: STRATEGY_B, targetWeightBps: 4000, riskScore: 70, expectedApy: 0.03 },
        ],
      }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/invalid targetWeightBps/);
  });

  it('rejects a negative weight used to disguise over-100%-exposure while the sum still nets to 10000', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B, UNKNOWN_STRATEGY]), makeRedis());

    const verdict = await service.evaluate(
      makeRecommendation({
        allocations: [
          { strategyId: STRATEGY_A, targetWeightBps: 7000, riskScore: 80, expectedApy: 0.05 },
          { strategyId: STRATEGY_B, targetWeightBps: 7000, riskScore: 70, expectedApy: 0.03 },
          { strategyId: UNKNOWN_STRATEGY, targetWeightBps: -4000, riskScore: 10, expectedApy: 0.01 },
        ],
      }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/invalid targetWeightBps/);
  });

  it('rejects the same strategy split across multiple entries to dodge the single-strategy cap', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A]), makeRedis());

    const verdict = await service.evaluate(
      makeRecommendation({
        allocations: [
          { strategyId: STRATEGY_A, targetWeightBps: 7000, riskScore: 80, expectedApy: 0.05 },
          { strategyId: STRATEGY_A.toUpperCase(), targetWeightBps: 3000, riskScore: 80, expectedApy: 0.05 },
        ],
      }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/exceeds max single-strategy cap/);
  });

  it('peeking the verdict (claimSlot: false) never consumes the cooldown slot', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const peek1 = await service.evaluate(makeRecommendation(), { claimSlot: false });
    const peek2 = await service.evaluate(makeRecommendation(), { claimSlot: false });
    expect(peek1.approved).toBe(true);
    expect(peek2.approved).toBe(true);

    const claimed = await service.evaluate(makeRecommendation(), { claimSlot: true });
    expect(claimed.approved).toBe(true);
  });
});

/// GD6 Milestone 6.2 - rule cross-chain hoàn toàn tách biệt với rule rebalance nội bộ ở
/// trên (limit/cooldown/Redis key riêng - xem PolicyService.evaluateCrossChainTransfer).
describe('PolicyService.evaluateCrossChainTransfer (GD6 Milestone 6.2)', () => {
  function makeRequest(overrides: Partial<CrossChainTransferRequestDto> = {}): CrossChainTransferRequestDto {
    const base: CrossChainTransferRequestDto = {
      amountRaw: '1000000000', // 1000 USDC (6 decimals)
      currentVaultTvlRaw: '10000000000', // 10000 USDC -> 10% of TVL
      shouldSwitch: true,
      netBenefitUsd: 500,
      destinationChainSelector: '10344971235874465080', // Base Sepolia
    };
    return { ...base, ...overrides };
  }

  it('approves a valid cross-chain transfer request and produces an intent', async () => {
    const service = new PolicyService(makeStrategiesService([]), makeRedis());

    const verdict = await service.evaluateCrossChainTransfer(makeRequest(), { claimSlot: true });

    expect(verdict.approved).toBe(true);
    expect(verdict.executionIntent).not.toBeNull();
    expect(verdict.executionIntent!.amountRaw).toBe('1000000000');
  });

  it('rejects when risk-engine did not recommend the switch', async () => {
    const service = new PolicyService(makeStrategiesService([]), makeRedis());

    const verdict = await service.evaluateCrossChainTransfer(makeRequest({ shouldSwitch: false }), {
      claimSlot: true,
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/did not recommend/);
  });

  it('rejects when net benefit is not positive, even if shouldSwitch claims true', async () => {
    const service = new PolicyService(makeStrategiesService([]), makeRedis());

    const verdict = await service.evaluateCrossChainTransfer(makeRequest({ netBenefitUsd: -1 }), {
      claimSlot: true,
    });

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/net loss/);
  });

  it('rejects a transfer exceeding the 20% TVL-per-transfer cap', async () => {
    const service = new PolicyService(makeStrategiesService([]), makeRedis());

    const verdict = await service.evaluateCrossChainTransfer(
      makeRequest({ amountRaw: '3000000000' }), // 30% of a 10000 USDC TVL
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/exceeds max cross-chain cap/);
  });

  it('rejects amountRaw larger than currentVaultTvlRaw outright', async () => {
    const service = new PolicyService(makeStrategiesService([]), makeRedis());

    const verdict = await service.evaluateCrossChainTransfer(
      makeRequest({ amountRaw: '20000000000' }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/exceeds currentVaultTvlRaw/);
  });

  it('rejects malformed non-integer amount strings instead of letting BigInt() throw uncaught', async () => {
    const service = new PolicyService(makeStrategiesService([]), makeRedis());

    const verdict = await service.evaluateCrossChainTransfer(
      makeRequest({ amountRaw: '1e21' }),
      { claimSlot: true },
    );

    expect(verdict.approved).toBe(false);
    expect(verdict.reason).toMatch(/valid integer strings/);
  });

  it('enforces its own 6h cooldown, independent from the 1h in-chain rebalance cooldown', async () => {
    const service = new PolicyService(makeStrategiesService([STRATEGY_A, STRATEGY_B]), makeRedis());

    const rebalance = await service.evaluate(makeRecommendation(), { claimSlot: true });
    expect(rebalance.approved).toBe(true);

    const firstCrossChain = await service.evaluateCrossChainTransfer(makeRequest(), { claimSlot: true });
    expect(firstCrossChain.approved).toBe(true);

    const secondCrossChain = await service.evaluateCrossChainTransfer(makeRequest(), { claimSlot: true });
    expect(secondCrossChain.approved).toBe(false);
    expect(secondCrossChain.reason).toMatch(/Cross-chain transfer cooldown active/);
  });

  it('peeking (claimSlot: false) never consumes the cross-chain cooldown slot', async () => {
    const service = new PolicyService(makeStrategiesService([]), makeRedis());

    const peek1 = await service.evaluateCrossChainTransfer(makeRequest(), { claimSlot: false });
    const peek2 = await service.evaluateCrossChainTransfer(makeRequest(), { claimSlot: false });
    expect(peek1.approved).toBe(true);
    expect(peek2.approved).toBe(true);

    const claimed = await service.evaluateCrossChainTransfer(makeRequest(), { claimSlot: true });
    expect(claimed.approved).toBe(true);
  });
});
