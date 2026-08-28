import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    const policyVerdict = await this.policy.evaluate(recommendation);

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
      return this.toRecommendationDto(body);
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

  private toRecommendationDto(body: {
    allocations: { strategy_id: string; target_weight_bps: number; risk_score: number; expected_apy: number }[];
    source: 'ai' | 'deterministic';
    confidence: number;
    explanation: string;
    risk_flags: string[];
  }): RecommendationDto {
    const dto = new RecommendationDto();
    dto.allocations = body.allocations.map((a) => ({
      strategyId: a.strategy_id,
      targetWeightBps: a.target_weight_bps,
      riskScore: a.risk_score,
      expectedApy: a.expected_apy,
    }));
    dto.source = body.source;
    dto.confidence = body.confidence;
    dto.explanation = body.explanation;
    dto.riskFlags = body.risk_flags;
    return dto;
  }

  private deterministicPassthrough(optimizationResult: OptimizationResult): RecommendationDto {
    const dto = new RecommendationDto();
    dto.allocations = optimizationResult.optimization_result.allocations.map((a) => ({
      strategyId: a.strategy_id,
      targetWeightBps: a.target_weight_bps,
      riskScore: a.risk_score,
      expectedApy: a.expected_apy,
    }));
    dto.source = 'deterministic';
    dto.confidence = 1;
    dto.explanation =
      'AI Engine service unreachable - showing the deterministic Risk/Optimization Engine proposal directly.';
    dto.riskFlags = ['ai_unavailable'];
    return dto;
  }
}
