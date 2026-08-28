"""Tests the fallback path fully (no API key needed - this is the path that must always
work per PLAN.md GD4 §4). The real LLM call path is NOT tested here (no API key
available in this environment) - see ai-engine/README.md."""
from ai_engine.models import OptimizationInput, OptimizationInputAllocation
from ai_engine.service import get_recommendation


def _sample_input() -> OptimizationInput:
    return OptimizationInput(
        allocations=[
            OptimizationInputAllocation(
                strategy_id="aave-usdc", target_weight_bps=6000, risk_score=85.0, expected_apy=0.05
            ),
            OptimizationInputAllocation(
                strategy_id="morpho-usdc", target_weight_bps=4000, risk_score=75.0, expected_apy=0.03
            ),
        ]
    )


def test_falls_back_to_deterministic_when_no_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    recommendation = get_recommendation(_sample_input())

    assert recommendation.source == "deterministic"
    assert "ai_unavailable" in recommendation.risk_flags
    assert recommendation.confidence == 1.0


def test_fallback_preserves_the_deterministic_engines_allocations_unmodified(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    optimization_input = _sample_input()

    recommendation = get_recommendation(optimization_input)

    assert len(recommendation.allocations) == len(optimization_input.allocations)
    for original, echoed in zip(optimization_input.allocations, recommendation.allocations):
        assert echoed.strategy_id == original.strategy_id
        assert echoed.target_weight_bps == original.target_weight_bps


def test_fallback_allocations_still_sum_to_10000_bps(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)

    recommendation = get_recommendation(_sample_input())

    assert sum(a.target_weight_bps for a in recommendation.allocations) == 10_000


def test_recommendation_schema_rejects_source_outside_allowed_values():
    import pytest
    from pydantic import ValidationError

    from ai_engine.models import Recommendation

    with pytest.raises(ValidationError):
        Recommendation(
            allocations=[],
            source="not_a_real_source",
            confidence=0.5,
            explanation="x",
            risk_flags=[],
        )
