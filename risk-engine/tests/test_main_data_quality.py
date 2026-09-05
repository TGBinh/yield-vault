"""Vault Security Audit - High: verify that a failing data source (DefiLlama/RPC) is
reported via data_quality/failed_sources instead of silently producing a result that
looks identical to "every strategy is genuinely too risky"."""
from unittest.mock import patch

from risk_engine.main import run


def test_all_sources_healthy_reports_complete_data_quality():
    with (
        patch("risk_engine.data_sources.defillama.get_current_tvl_usd", return_value=5_000_000_000.0),
        patch("risk_engine.data_sources.defillama.get_protocol_age_days", return_value=1000.0),
        patch("risk_engine.data_sources.defillama.get_tvl_volatility_proxy", return_value=0.02),
        patch("risk_engine.data_sources.onchain.get_aave_utilization", return_value=0.5),
    ):
        result = run()

    assert result["optimization_result"]["data_quality"] == "complete"
    assert result["optimization_result"]["failed_sources"] == []


def test_a_failing_source_is_reported_as_degraded_not_silently_swallowed():
    with (
        patch("risk_engine.data_sources.defillama.get_current_tvl_usd", return_value=5_000_000_000.0),
        patch("risk_engine.data_sources.defillama.get_protocol_age_days", return_value=1000.0),
        patch("risk_engine.data_sources.defillama.get_tvl_volatility_proxy", return_value=0.02),
        patch("risk_engine.data_sources.onchain.get_aave_utilization", side_effect=ConnectionError("RPC down")),
    ):
        result = run()

    opt = result["optimization_result"]
    assert opt["data_quality"] == "degraded"
    assert "onchain:aave-utilization" in opt["failed_sources"]
    # Vẫn còn allocations thật (không phải empty) - đây chính là ca cần phân biệt với
    # "unusable": có kết quả để hiển thị, nhưng phải gắn cờ cho biết 1 phần dữ liệu là
    # giá trị mặc định bảo thủ, không phải số đọc được thật.
    assert len(opt["allocations"]) > 0


def test_every_source_failing_is_reported_as_unusable_not_a_real_zero_allocation():
    with (
        patch("risk_engine.data_sources.defillama.get_current_tvl_usd", side_effect=ConnectionError("down")),
        patch("risk_engine.data_sources.defillama.get_protocol_age_days", side_effect=ConnectionError("down")),
        patch("risk_engine.data_sources.defillama.get_tvl_volatility_proxy", side_effect=ConnectionError("down")),
        patch("risk_engine.data_sources.onchain.get_aave_utilization", side_effect=ConnectionError("down")),
    ):
        result = run()

    opt = result["optimization_result"]
    # tvl_usd=0.0 mặc định -> composite_score tụt dưới min_risk_score_to_include -> rỗng,
    # nhưng "unusable" phải nói rõ đây là do lỗi nguồn dữ liệu, không phải rủi ro thật.
    assert opt["allocations"] == []
    assert opt["data_quality"] == "unusable"
    assert len(opt["failed_sources"]) >= 4
