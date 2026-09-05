"""Data models shared across the risk engine and optimization engine.

Comments in Vietnamese where explaining WHY; all identifiers/strings in English
per the project's code-language convention.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class StrategyMetrics(BaseModel):
    """Raw inputs for scoring a single strategy - pulled from DefiLlama + on-chain reads."""

    strategy_id: str
    protocol_slug: str
    tvl_usd: float = Field(ge=0)
    utilization_rate: float = Field(ge=0, le=1, description="borrowed / supplied, 0-1")
    historical_apy_volatility: float = Field(
        ge=0, description="stddev of daily APY over the trailing window, as a fraction (0.02 = 2%)"
    )
    protocol_age_days: float = Field(ge=0)
    current_apy: float = Field(ge=0, description="current supply APY as a fraction (0.05 = 5%)")


class RiskScore(BaseModel):
    """Composite 0-100 risk score for one strategy - higher is safer."""

    strategy_id: str
    tvl_score: float
    utilization_score: float
    volatility_score: float
    age_score: float
    composite_score: float = Field(ge=0, le=100)


class AllocationSuggestion(BaseModel):
    """One line of the optimizer's output - a suggested target weight for one strategy."""

    strategy_id: str
    target_weight_bps: int = Field(ge=0, le=10_000)
    risk_score: float
    expected_apy: float
    rationale: str


class OptimizationResult(BaseModel):
    """Full output of one optimization run - what the Backend/dashboard reads and
    displays as a human-reviewable proposal (never auto-executed in Phase 3).

    Vault Security Audit - High: trước đây khi DefiLlama/RPC sập, `_safe_call` âm thầm
    dùng giá trị mặc định bảo thủ (TVL=0, volatility=0.20) khiến mọi strategy tụt dưới
    ngưỡng risk score -> allocations=[] - kết quả này KHÔNG PHÂN BIỆT ĐƯỢC với "mọi
    strategy đều thực sự quá rủi ro". `data_quality`/`failed_sources` tách bạch 2 tình
    huống đó ra để tầng hiển thị/Policy Engine không hiểu nhầm 1 sự cố API bên ngoài
    thành 1 khuyến nghị rút hết vốn.
    """

    allocations: list[AllocationSuggestion]
    total_weight_bps: int
    generated_at: str
    data_quality: Literal["complete", "degraded", "unusable"] = "complete"
    failed_sources: list[str] = Field(default_factory=list)
