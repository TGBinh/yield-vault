import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/// PLAN.md GD4 §4: "Recommendation object có schema cố định (không phải free text)".
/// This is the contract the AI Engine (or the deterministic risk-engine fallback) must
/// produce, and what the Policy Engine validates - the natural-language `explanation`
/// field is display-only and is NEVER parsed to make a decision.
export class AllocationSuggestionDto {
  @IsString()
  strategyId!: string;

  @IsInt()
  @Min(0)
  @Max(10_000)
  targetWeightBps!: number;

  @IsNumber()
  riskScore!: number;

  @IsNumber()
  expectedApy!: number;
}

export class RecommendationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AllocationSuggestionDto)
  allocations!: AllocationSuggestionDto[];

  @IsIn(['ai', 'deterministic'])
  source!: 'ai' | 'deterministic';

  @IsNumber()
  @Min(0)
  @Max(1)
  confidence!: number;

  @IsString()
  explanation!: string;

  @IsArray()
  @IsString({ each: true })
  riskFlags!: string[];
}

export interface ExecutionIntent {
  allocations: { strategyId: string; targetWeightBps: number }[];
  approvedAt: string;
  expiresAt: string;
}

export interface PolicyVerdict {
  approved: boolean;
  reason: string;
  executionIntent: ExecutionIntent | null;
}
