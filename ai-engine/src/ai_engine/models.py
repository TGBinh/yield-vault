"""Structured I/O schemas for the AI Engine.

PLAN.md GD4 §4: "AI Engine (FastAPI): nhận input từ Risk/Optimization Engine, sinh ra
Recommendation object có schema cố định (không phải free text) + đoạn giải thích ngôn
ngữ tự nhiên đi kèm (chỉ để hiển thị, không dùng để parse quyết định)."

The `explanation` field is DISPLAY ONLY. Nothing downstream (the Policy Engine, or any
future Keeper Bot) ever parses it to make a decision - only the structured fields do.
"""
from __future__ import annotations

from pydantic import BaseModel, Field


class OptimizationInputAllocation(BaseModel):
    """One line of the risk-engine's deterministic optimizer output - what the AI Engine
    receives as input (see risk-engine/src/risk_engine/models.py AllocationSuggestion,
    same shape kept in sync manually since these are two separate services)."""

    strategy_id: str
    target_weight_bps: int = Field(ge=0, le=10_000)
    risk_score: float
    expected_apy: float
    rationale: str = ""


class OptimizationInput(BaseModel):
    """Request body for POST /recommend - the risk-engine's OptimizationResult."""

    allocations: list[OptimizationInputAllocation]


class AllocationSuggestion(BaseModel):
    strategy_id: str
    target_weight_bps: int = Field(ge=0, le=10_000)
    risk_score: float
    expected_apy: float


class Recommendation(BaseModel):
    """The AI Engine's structured output - matches backend's RecommendationDto exactly
    (backend/src/policy/dto/recommendation.dto.ts) since the Policy Engine consumes this
    directly. Kept in sync manually across the Python/TypeScript boundary."""

    allocations: list[AllocationSuggestion]
    source: str = Field(pattern="^(ai|deterministic)$")
    confidence: float = Field(ge=0, le=1)
    explanation: str
    risk_flags: list[str] = Field(default_factory=list)
