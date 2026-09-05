import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import { RecommendationDto } from '../policy/dto/recommendation.dto';
import { PolicyService } from '../policy/policy.service';
import { PolicyVerdict } from '../policy/dto/recommendation.dto';

interface OptimizationResult {
  risk_scores: unknown;
  optimization_result: {
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
}

export interface RecommendationPipelineResult {
  optimizationResult: OptimizationResult['optimization_result'];
  recommendation: RecommendationDto;
  policyVerdict: PolicyVerdict;
}

/// PLAN.md GD4 §5: orchestrates the full chain "Risk/Optimization Engine -> AI Engine ->
/// Policy Engine -> Execution Intent". This is the ONLY place in the backend that calls
/// the AI Engine, and it always routes the result through PolicyService before
/// returning anything - there is no code path that hands an AI Recommendation to a
/// caller without a Policy verdict attached (GD4 §9 Definition of Done).
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);
  private readonly riskEngineUrl: string;
  private readonly aiEngineUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly policy: PolicyService,
  ) {
    this.riskEngineUrl = this.config.get<string>('RISK_ENGINE_URL', 'http://localhost:8002');
    this.aiEngineUrl = this.config.get<string>('AI_ENGINE_URL', 'http://localhost:8001');
  }

  async getLatestRecommendation(): Promise<RecommendationPipelineResult> {
    const optimizationResult = await this.fetchOptimizationResult();
    const recommendation = await this.fetchAiRecommendation(optimizationResult);
    // Vault Security Audit - Critical C3: đây là route public, chỉ để dashboard xem
    // trước - KHÔNG được phép claim slot cooldown (đó là việc của POST /policy/evaluate,
    // đứng sau InternalApiKeyGuard).
    const policyVerdict = await this.policy.evaluate(recommendation, { claimSlot: false });

    return {
      optimizationResult: optimizationResult.optimization_result,
      recommendation,
      policyVerdict,
    };
  }

  private async fetchOptimizationResult(): Promise<OptimizationResult> {
    const res = await fetch(`${this.riskEngineUrl}/optimize`);
    if (!res.ok) {
      throw new Error(`risk-engine /optimize returned ${res.status}`);
    }
    return (await res.json()) as OptimizationResult;
  }

  private async fetchAiRecommendation(
    optimizationResult: OptimizationResult,
  ): Promise<RecommendationDto> {
    const input = {
      allocations: optimizationResult.optimization_result.allocations,
    };

    try {
      const res = await fetch(`${this.aiEngineUrl}/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        throw new Error(`ai-engine /recommend returned ${res.status}`);
      }
      const body = (await res.json()) as {
        allocations: { strategy_id: string; target_weight_bps: number; risk_score: number; expected_apy: number }[];
        source: 'ai' | 'deterministic';
        confidence: number;
        explanation: string;
        risk_flags: string[];
      };
      return await this.toRecommendationDto(body);
    } catch (err) {
      // PLAN.md GD4 §4: "nếu AI Engine timeout/lỗi, Optimization Engine tất định vẫn
      // chạy độc lập" - the ai-engine service itself already has this fallback
      // internally, but if the ai-engine service is entirely unreachable (not just its
      // LLM call), the backend falls back the same way rather than failing the whole
      // request.
      this.logger.warn(`ai-engine unreachable, using deterministic passthrough: ${String(err)}`);
      return this.deterministicPassthrough(optimizationResult);
    }
  }

  /// Vault Security Audit - Critical C1: trước đây dựng `new RecommendationDto()` rồi
  /// gán field tay - `ValidationPipe` toàn cục chỉ chạy trên request body vào
  /// controller, KHÔNG chạy trên object dựng tay trong service, nên mọi decorator
  /// (@IsInt, @Min, @Max...) trên DTO này là code chết trên đúng đường AI Engine ->
  /// Policy Engine. `validateOrReject` ở đây chạy đúng các decorator đó tường minh; nếu
  /// AI Engine trả dữ liệu sai schema, lỗi ném ra được bắt bởi catch() ở fetchAiRecommendation
  /// và rơi về nhánh fallback tất định - không có đường nào bỏ qua validate.
  private async toRecommendationDto(body: {
    allocations: { strategy_id: string; target_weight_bps: number; risk_score: number; expected_apy: number }[];
    source: 'ai' | 'deterministic';
    confidence: number;
    explanation: string;
    risk_flags: string[];
  }): Promise<RecommendationDto> {
    const dto = plainToInstance(RecommendationDto, {
      allocations: body.allocations.map((a) => ({
        strategyId: a.strategy_id,
        targetWeightBps: a.target_weight_bps,
        riskScore: a.risk_score,
        expectedApy: a.expected_apy,
      })),
      source: body.source,
      confidence: body.confidence,
      explanation: body.explanation,
      riskFlags: body.risk_flags,
    });
    await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
    return dto;
  }

  private async deterministicPassthrough(optimizationResult: OptimizationResult): Promise<RecommendationDto> {
    const dto = plainToInstance(RecommendationDto, {
      allocations: optimizationResult.optimization_result.allocations.map((a) => ({
        strategyId: a.strategy_id,
        targetWeightBps: a.target_weight_bps,
        riskScore: a.risk_score,
        expectedApy: a.expected_apy,
      })),
      source: 'deterministic',
      confidence: 1,
      explanation:
        'AI Engine service unreachable - showing the deterministic Risk/Optimization Engine proposal directly.',
      riskFlags: ['ai_unavailable'],
    });
    // Đây đã là fallback cuối cùng - nếu chính risk-engine trả dữ liệu không hợp lệ
    // (NaN/Infinity...), để lỗi ném ra thành 500 thay vì âm thầm đưa NaN vào Policy
    // Engine (risk-engine tự sửa lỗi nguồn ở đầu vào là đúng chỗ hơn để vá).
    await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true });
    return dto;
  }
}
