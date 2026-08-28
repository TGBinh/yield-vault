from risk_engine.models import RiskScore, StrategyMetrics
from risk_engine.optimization import OptimizationConfig, optimize_allocation


def _metrics(strategy_id: str, apy: float) -> StrategyMetrics:
    return StrategyMetrics(
        strategy_id=strategy_id,
        protocol_slug=strategy_id,
        tvl_usd=100_000_000.0,
        utilization_rate=0.5,
        historical_apy_volatility=0.02,
        protocol_age_days=730.0,
        current_apy=apy,
    )


def _score(strategy_id: str, composite: float) -> RiskScore:
    return RiskScore(
        strategy_id=strategy_id,
        tvl_score=composite,
        utilization_score=composite,
        volatility_score=composite,
        age_score=composite,
        composite_score=composite,
    )


def test_allocations_sum_to_10000_bps():
    metrics = {"a": _metrics("a", 0.05), "b": _metrics("b", 0.03), "c": _metrics("c", 0.08)}
    scores = [_score("a", 80.0), _score("b", 60.0), _score("c", 40.0)]

    result = optimize_allocation(metrics, scores)

    assert result.total_weight_bps == 10_000
    assert sum(a.target_weight_bps for a in result.allocations) == 10_000


def test_higher_risk_adjusted_return_gets_more_weight():
    metrics = {"safe_high_yield": _metrics("safe_high_yield", 0.10), "risky_low_yield": _metrics("risky_low_yield", 0.02)}
    scores = [_score("safe_high_yield", 90.0), _score("risky_low_yield", 30.0)]

    # cap=100%: with only 2 strategies, a 50% cap would mathematically force an exact
    # 50/50 tie regardless of attractiveness (both must be <=50% and sum to 100%) - use
    # an unconstrained cap here so the underlying weighting ratio is actually observable.
    result = optimize_allocation(metrics, scores, OptimizationConfig(max_weight_per_strategy_bps=10_000))
    by_id = {a.strategy_id: a for a in result.allocations}

    assert by_id["safe_high_yield"].target_weight_bps > by_id["risky_low_yield"].target_weight_bps


def test_no_strategy_exceeds_cap():
    # One strategy massively more attractive than the other two - without a cap it would
    # dominate the allocation; the 50% cap must hold regardless.
    metrics = {"dominant": _metrics("dominant", 0.50), "b": _metrics("b", 0.01), "c": _metrics("c", 0.01)}
    scores = [_score("dominant", 100.0), _score("b", 10.0), _score("c", 10.0)]

    result = optimize_allocation(metrics, scores, OptimizationConfig(max_weight_per_strategy_bps=5_000))

    for allocation in result.allocations:
        assert allocation.target_weight_bps <= 5_000


def test_strategies_below_min_risk_score_are_excluded():
    metrics = {"safe": _metrics("safe", 0.05), "too_risky": _metrics("too_risky", 0.50)}
    scores = [_score("safe", 80.0), _score("too_risky", 5.0)]

    result = optimize_allocation(metrics, scores, OptimizationConfig(min_risk_score_to_include=20.0))

    strategy_ids = {a.strategy_id for a in result.allocations}
    assert strategy_ids == {"safe"}


def test_empty_input_returns_empty_result():
    result = optimize_allocation({}, [])
    assert result.allocations == []
    assert result.total_weight_bps == 0


def test_excess_over_cap_redistributes_to_eligible_strategies():
    # "dominant" would take ~91% uncapped; with a 50% cap, the other 2 eligible
    # strategies must absorb the excess so the total still reaches 10000 bps.
    metrics = {"dominant": _metrics("dominant", 0.50), "b": _metrics("b", 0.05), "c": _metrics("c", 0.05)}
    scores = [_score("dominant", 100.0), _score("b", 50.0), _score("c", 50.0)]

    result = optimize_allocation(metrics, scores, OptimizationConfig(max_weight_per_strategy_bps=5_000))
    by_id = {a.strategy_id: a for a in result.allocations}

    # +-5 bps tolerance: integer round() in the proportional split can drift a couple of
    # bps out of 10000, which is negligible and not something worth "fixing" away (see
    # _fix_rounding_drift's own is_small_rounding_noise threshold).
    assert abs(by_id["dominant"].target_weight_bps - 5_000) <= 5
    assert abs(by_id["b"].target_weight_bps - by_id["c"].target_weight_bps) <= 5
    assert result.total_weight_bps == 10_000


def test_all_strategies_below_threshold_returns_empty():
    metrics = {"a": _metrics("a", 0.05)}
    scores = [_score("a", 5.0)]

    result = optimize_allocation(metrics, scores, OptimizationConfig(min_risk_score_to_include=20.0))

    assert result.allocations == []
