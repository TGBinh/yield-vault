from risk_engine.models import StrategyMetrics
from risk_engine.scoring import ScoringWeights, score_strategy


def _metrics(**overrides) -> StrategyMetrics:
    base = dict(
        strategy_id="test-strategy",
        protocol_slug="test-protocol",
        tvl_usd=50_000_000.0,
        utilization_rate=0.5,
        historical_apy_volatility=0.02,
        protocol_age_days=730.0,
        current_apy=0.05,
    )
    base.update(overrides)
    return StrategyMetrics(**base)


def test_composite_score_within_bounds():
    score = score_strategy(_metrics())
    assert 0.0 <= score.composite_score <= 100.0


def test_higher_tvl_scores_higher_all_else_equal():
    low_tvl = score_strategy(_metrics(tvl_usd=200_000.0))
    high_tvl = score_strategy(_metrics(tvl_usd=500_000_000.0))
    assert high_tvl.tvl_score > low_tvl.tvl_score
    assert high_tvl.composite_score > low_tvl.composite_score


def test_higher_volatility_scores_lower():
    stable = score_strategy(_metrics(historical_apy_volatility=0.01))
    volatile = score_strategy(_metrics(historical_apy_volatility=0.15))
    assert stable.volatility_score > volatile.volatility_score


def test_new_protocol_scores_lower_than_mature():
    new = score_strategy(_metrics(protocol_age_days=10.0))
    mature = score_strategy(_metrics(protocol_age_days=1000.0))
    assert mature.age_score > new.age_score


def test_utilization_above_safe_ceiling_is_penalized():
    healthy = score_strategy(_metrics(utilization_rate=0.70))
    stressed = score_strategy(_metrics(utilization_rate=0.98))
    assert healthy.utilization_score > stressed.utilization_score


def test_zero_tvl_scores_zero_tvl_component():
    score = score_strategy(_metrics(tvl_usd=0.0))
    assert score.tvl_score == 0.0


def test_weights_must_sum_to_one():
    import pytest

    with pytest.raises(ValueError):
        ScoringWeights(tvl=0.5, utilization=0.5, volatility=0.5, age=0.5)
