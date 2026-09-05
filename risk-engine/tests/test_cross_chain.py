"""PLAN.md GD5 §9 Definition of Done: "Optimization Engine đưa ra khuyến nghị đúng logic
kiểm chứng được qua test cho ít nhất 5 kịch bản chi phí-lợi ích khác nhau" - this file
covers exactly that, plus the specific edge case DoD calls out: "lợi ích rất nhỏ -> phải
khuyến nghị không chuyển"."""
from risk_engine.cross_chain import ChainOpportunity, SwitchCostEstimate, evaluate_switch

ARBITRUM = ChainOpportunity(chain_id=421614, chain_name="Arbitrum Sepolia", strategy_id="aave-usdc", expected_apy=0.05, risk_score=90)


def _costs(**overrides) -> SwitchCostEstimate:
    base = dict(gas_cost_usd=5.0, bridge_fee_usd=10.0, slippage_usd=2.0, execution_cost_usd=3.0, risk_premium_usd=5.0)
    base.update(overrides)
    return SwitchCostEstimate(**base)


# Scenario 1: large yield improvement on a large position, low costs -> SWITCH.
def test_large_improvement_large_position_recommends_switch():
    candidate = ChainOpportunity(chain_id=84532, chain_name="Base Sepolia", strategy_id="aave-usdc", expected_apy=0.15, risk_score=88)

    result = evaluate_switch(ARBITRUM, candidate, position_size_usd=100_000, costs=_costs())

    assert result.should_switch is True
    assert result.net_benefit_usd > 0
    assert result.payback_days is not None and result.payback_days < 30


# Scenario 2 (DoD-mandated edge case): tiny yield improvement -> must recommend NOT switching,
# even though the candidate's APY is technically higher.
def test_tiny_improvement_recommends_against_switching():
    candidate = ChainOpportunity(chain_id=84532, chain_name="Base Sepolia", strategy_id="aave-usdc", expected_apy=0.051, risk_score=88)

    result = evaluate_switch(ARBITRUM, candidate, position_size_usd=1_000, costs=_costs())

    assert result.should_switch is False
    assert result.net_benefit_usd < 0


# Scenario 3: candidate has LOWER apy than current -> never switch, regardless of costs.
def test_worse_apy_never_recommends_switching_even_with_zero_costs():
    candidate = ChainOpportunity(chain_id=84532, chain_name="Base Sepolia", strategy_id="aave-usdc", expected_apy=0.02, risk_score=95)

    result = evaluate_switch(ARBITRUM, candidate, position_size_usd=1_000_000, costs=_costs(
        gas_cost_usd=0, bridge_fee_usd=0, slippage_usd=0, execution_cost_usd=0, risk_premium_usd=0
    ))

    assert result.should_switch is False
    assert "not better" in result.reasoning.lower()


# Scenario 4: same apy (no improvement) -> never switch (paying cost for zero gain).
def test_equal_apy_recommends_against_switching():
    candidate = ChainOpportunity(chain_id=84532, chain_name="Base Sepolia", strategy_id="aave-usdc", expected_apy=0.05, risk_score=95)

    result = evaluate_switch(ARBITRUM, candidate, position_size_usd=500_000, costs=_costs())

    assert result.should_switch is False


# Scenario 5: exactly at break-even (net_benefit == 0) -> conservative default is DON'T switch
# (ties should not trigger action - intangible risks of switching aren't priced into costs).
def test_exact_breakeven_does_not_recommend_switching():
    # annualized_improvement = position * apy_delta = 1000 * 0.05 = 50; costs sum to exactly 50.
    candidate = ChainOpportunity(chain_id=84532, chain_name="Base Sepolia", strategy_id="aave-usdc", expected_apy=0.10, risk_score=88)
    costs = SwitchCostEstimate(gas_cost_usd=50.0, bridge_fee_usd=0, slippage_usd=0, execution_cost_usd=0, risk_premium_usd=0)

    result = evaluate_switch(ARBITRUM, candidate, position_size_usd=1_000, costs=costs)

    assert result.net_benefit_usd == 0
    assert result.should_switch is False


# Scenario 6: zero/negative position size is a degenerate input, must not crash or divide by zero.
def test_zero_position_size_is_handled_gracefully():
    candidate = ChainOpportunity(chain_id=84532, chain_name="Base Sepolia", strategy_id="aave-usdc", expected_apy=0.20, risk_score=88)

    result = evaluate_switch(ARBITRUM, candidate, position_size_usd=0, costs=_costs())

    assert result.should_switch is False
    assert result.annualized_yield_improvement_usd == 0.0


# Scenario 7: very high risk premium (candidate chain/bridge considered risky) can flip an
# otherwise-profitable switch into a rejection - risk premium must actually matter.
def test_high_risk_premium_can_override_an_otherwise_profitable_switch():
    candidate = ChainOpportunity(chain_id=84532, chain_name="Base Sepolia", strategy_id="new-strategy", expected_apy=0.08, risk_score=40)

    cheap_costs = _costs(risk_premium_usd=1.0)
    risky_costs = _costs(risk_premium_usd=500.0)

    cheap_result = evaluate_switch(ARBITRUM, candidate, position_size_usd=5_000, costs=cheap_costs)
    risky_result = evaluate_switch(ARBITRUM, candidate, position_size_usd=5_000, costs=risky_costs)

    assert cheap_result.should_switch is True
    assert risky_result.should_switch is False


def test_payback_days_is_none_when_no_positive_improvement():
    candidate = ChainOpportunity(chain_id=84532, chain_name="Base Sepolia", strategy_id="aave-usdc", expected_apy=0.01, risk_score=88)

    result = evaluate_switch(ARBITRUM, candidate, position_size_usd=10_000, costs=_costs())

    assert result.payback_days is None
