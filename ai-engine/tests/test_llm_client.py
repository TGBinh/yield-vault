"""Vault Security Audit - Critical: verify the business-invariant guard that runs after
a real (or simulated) tool-use response from Claude, before AI Engine trusts it. This
guard is the fix for the exact bypass the audit demonstrated: a syntactically valid
Recommendation whose allocations sum past 10000 bps, reference an unknown strategy_id,
or duplicate one - none of which Pydantic's per-field checks alone catch."""
import pytest

from ai_engine.llm_client import LlmUnavailableError, _validate_business_invariants
from ai_engine.models import AllocationSuggestion, OptimizationInput, OptimizationInputAllocation, Recommendation


def _optimization_input() -> OptimizationInput:
    return OptimizationInput(
        allocations=[
            OptimizationInputAllocation(strategy_id="aave-usdc", target_weight_bps=6000, risk_score=85.0, expected_apy=0.05),
            OptimizationInputAllocation(strategy_id="morpho-usdc", target_weight_bps=4000, risk_score=75.0, expected_apy=0.03),
        ]
    )


def _recommendation(allocations: list[AllocationSuggestion]) -> Recommendation:
    return Recommendation(
        allocations=allocations,
        source="ai",
        confidence=0.9,
        explanation="test",
        risk_flags=[],
    )


def test_accepts_a_recommendation_that_matches_the_input_strategies():
    rec = _recommendation(
        [
            AllocationSuggestion(strategy_id="aave-usdc", target_weight_bps=7000, risk_score=90, expected_apy=0.06),
            AllocationSuggestion(strategy_id="morpho-usdc", target_weight_bps=3000, risk_score=80, expected_apy=0.04),
        ]
    )

    _validate_business_invariants(rec, _optimization_input())  # must not raise


def test_rejects_total_weight_exceeding_10000_bps():
    rec = _recommendation(
        [
            AllocationSuggestion(strategy_id="aave-usdc", target_weight_bps=10_000, risk_score=90, expected_apy=0.06),
            AllocationSuggestion(strategy_id="morpho-usdc", target_weight_bps=10_000, risk_score=80, expected_apy=0.04),
        ]
    )

    with pytest.raises(LlmUnavailableError, match="exceeds 10000"):
        _validate_business_invariants(rec, _optimization_input())


def test_rejects_a_strategy_id_not_present_in_the_original_input():
    rec = _recommendation(
        [AllocationSuggestion(strategy_id="made-up-strategy", target_weight_bps=10_000, risk_score=99, expected_apy=0.9)]
    )

    with pytest.raises(LlmUnavailableError, match="unknown strategy_id"):
        _validate_business_invariants(rec, _optimization_input())


def test_rejects_a_duplicated_strategy_id_split_across_two_entries():
    rec = _recommendation(
        [
            AllocationSuggestion(strategy_id="aave-usdc", target_weight_bps=5000, risk_score=90, expected_apy=0.06),
            AllocationSuggestion(strategy_id="aave-usdc", target_weight_bps=5000, risk_score=90, expected_apy=0.06),
        ]
    )

    with pytest.raises(LlmUnavailableError, match="duplicate strategy_id"):
        _validate_business_invariants(rec, _optimization_input())
