"""Orchestrates the AI Engine's core behavior: try the LLM, fall back to a deterministic
passthrough of the risk-engine's own proposal if the LLM is unavailable for any reason.

PLAN.md GD4 §4 deliverable: "Cơ chế fallback: nếu AI Engine timeout/lỗi, Optimization
Engine tất định vẫn chạy độc lập và hệ thống vẫn hoạt động bình thường." This fallback
path is fully deterministic and testable without any external API dependency.
"""
from __future__ import annotations

import logging

from ai_engine.llm_client import LlmUnavailableError, generate_recommendation
from ai_engine.models import AllocationSuggestion, OptimizationInput, Recommendation

logger = logging.getLogger("ai_engine")


def get_recommendation(optimization_input: OptimizationInput) -> Recommendation:
    try:
        return generate_recommendation(optimization_input)
    except LlmUnavailableError as exc:
        logger.warning("LLM unavailable, using deterministic fallback: %s", exc)
        return _deterministic_fallback(optimization_input, reason=str(exc))


def _deterministic_fallback(optimization_input: OptimizationInput, reason: str) -> Recommendation:
    return Recommendation(
        allocations=[
            AllocationSuggestion(
                strategy_id=a.strategy_id,
                target_weight_bps=a.target_weight_bps,
                risk_score=a.risk_score,
                expected_apy=a.expected_apy,
            )
            for a in optimization_input.allocations
        ],
        source="deterministic",
        confidence=1.0,
        explanation=(
            "AI Engine unavailable - showing the deterministic Risk/Optimization "
            f"Engine's proposal directly, unmodified. ({reason})"
        ),
        risk_flags=["ai_unavailable"],
    )
