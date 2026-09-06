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
        # Vault Security Audit - High: `exc` có thể chứa chi tiết lỗi thật từ Anthropic
        # API (status code, response body - xem llm_client.generate_recommendation). Log
        # đầy đủ CHỈ ở đây (server-side) - `_deterministic_fallback` không nhận `exc`,
        # đảm bảo caller không xác thực không bao giờ thấy chi tiết nội bộ AI provider.
        logger.warning("LLM unavailable, using deterministic fallback: %s", exc)
        return _deterministic_fallback(optimization_input)


def _deterministic_fallback(optimization_input: OptimizationInput) -> Recommendation:
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
        explanation="AI recommendation unavailable, using deterministic fallback.",
        risk_flags=["ai_unavailable"],
    )
