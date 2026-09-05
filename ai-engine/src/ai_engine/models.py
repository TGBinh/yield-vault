"""Structured I/O schemas for the AI Engine.

PLAN.md GD4 §4: "AI Engine (FastAPI): nhận input từ Risk/Optimization Engine, sinh ra
Recommendation object có schema cố định (không phải free text) + đoạn giải thích ngôn
ngữ tự nhiên đi kèm (chỉ để hiển thị, không dùng để parse quyết định)."

The `explanation` field is DISPLAY ONLY. Nothing downstream (the Policy Engine, or any
future Keeper Bot) ever parses it to make a decision - only the structured fields do.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

# Vault Security Audit - Critical: strategy_id/rationale trước đây không giới hạn độ
# dài/định dạng - đi thẳng vào prompt gửi Claude (xem llm_client._build_prompt), tạo bề
# mặt prompt injection thật. risk_score/expected_apy trước đây không có bound, chấp nhận
# NaN/Infinity làm hỏng JSON response phía sau (FastAPI serialize thành token
# NaN/Infinity không hợp lệ theo chuẩn JSON).
_STRATEGY_ID_PATTERN = r"^[a-z0-9][a-z0-9\-]{0,63}$"


class OptimizationInputAllocation(BaseModel):
    """One line of the risk-engine's deterministic optimizer output - what the AI Engine
    receives as input (see risk-engine/src/risk_engine/models.py AllocationSuggestion,
    same shape kept in sync manually since these are two separate services)."""

    model_config = ConfigDict(extra="forbid")

    strategy_id: str = Field(pattern=_STRATEGY_ID_PATTERN)
    target_weight_bps: int = Field(ge=0, le=10_000)
    risk_score: float = Field(ge=0, le=100)
    expected_apy: float = Field(ge=0, le=10)
    rationale: str = Field(default="", max_length=256)


class OptimizationInput(BaseModel):
    """Request body for POST /recommend - the risk-engine's OptimizationResult."""

    allocations: list[OptimizationInputAllocation] = Field(min_length=1, max_length=50)


class AllocationSuggestion(BaseModel):
    strategy_id: str = Field(pattern=_STRATEGY_ID_PATTERN)
    target_weight_bps: int = Field(ge=0, le=10_000)
    risk_score: float = Field(ge=0, le=100)
    expected_apy: float = Field(ge=0, le=10)


class Recommendation(BaseModel):
    """The AI Engine's structured output - matches backend's RecommendationDto exactly
    (backend/src/policy/dto/recommendation.dto.ts) since the Policy Engine consumes this
    directly. Kept in sync manually across the Python/TypeScript boundary."""

    allocations: list[AllocationSuggestion] = Field(min_length=1, max_length=50)
    source: str = Field(pattern="^(ai|deterministic)$")
    confidence: float = Field(ge=0, le=1)
    explanation: str = Field(max_length=2000)
    risk_flags: list[str] = Field(default_factory=list, max_length=20)
