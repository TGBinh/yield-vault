"""CLI entrypoint - chạy toàn bộ pipeline Market Data -> RiskEngine -> OptimizationEngine
và in ra JSON "đề xuất phân bổ" (PLAN.md GĐ3 §5: Backend đọc kết quả này để hiển thị,
KHÔNG tự động thực thi - con người vẫn duyệt tay ở giai đoạn này).

Kết hợp 2 nguồn dữ liệu có chủ đích khác nhau:
- DefiLlama (TVL, tuổi đời, biến động) phản ánh uy tín protocol ở QUY MÔ TOÀN CẦU
  (mainnet) - đây là thứ nói lên "Aave nói chung có đáng tin không".
- On-chain read trực tiếp (utilization, APY) phản ánh THỊ TRƯỜNG CỤ THỂ đang dùng trên
  testnet - đây là thứ nói lên "market USDC cụ thể này đang hoạt động ra sao ngay bây
  giờ". Trộn 2 nguồn là chủ đích, không phải nhầm lẫn.

Usage: python -m risk_engine.main
"""
from __future__ import annotations

import json
import logging

from risk_engine.data_sources import defillama, onchain
from risk_engine.models import StrategyMetrics
from risk_engine.optimization import OptimizationConfig, optimize_allocation
from risk_engine.scoring import score_strategies

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("risk_engine")

# slug DefiLlama chính thức cho từng protocol - tra tại defillama.com, không tự đoán.
_AAVE_SLUG = "aave-v3"
_MORPHO_SLUG = "morpho-blue"


def _safe_call(fn, default, *args, **kwargs):
    """Mọi lệnh gọi mạng (DefiLlama/RPC) đều có thể fail (rate limit, RPC down, testnet
    không ổn định) - risk engine không được crash toàn bộ pipeline vì 1 nguồn dữ liệu lỗi,
    dùng giá trị mặc định bảo thủ (an toàn) thay thế và log rõ ràng để không giấu lỗi."""
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001 - broad on purpose, see docstring
        logger.warning("Data source call failed (%s), using conservative default %r: %s", fn.__name__, default, exc)
        return default


def collect_metrics() -> list[StrategyMetrics]:
    aave_tvl = _safe_call(defillama.get_current_tvl_usd, 0.0, _AAVE_SLUG)
    aave_age = _safe_call(defillama.get_protocol_age_days, 0.0, _AAVE_SLUG)
    aave_volatility = _safe_call(defillama.get_tvl_volatility_proxy, 0.20, _AAVE_SLUG)
    aave_utilization = _safe_call(onchain.get_aave_utilization, 0.0)

    morpho_tvl = _safe_call(defillama.get_current_tvl_usd, 0.0, _MORPHO_SLUG)
    morpho_age = _safe_call(defillama.get_protocol_age_days, 0.0, _MORPHO_SLUG)
    morpho_volatility = _safe_call(defillama.get_tvl_volatility_proxy, 0.20, _MORPHO_SLUG)

    return [
        StrategyMetrics(
            strategy_id="aave-usdc",
            protocol_slug=_AAVE_SLUG,
            tvl_usd=aave_tvl,
            utilization_rate=aave_utilization,
            historical_apy_volatility=aave_volatility,
            protocol_age_days=aave_age,
            current_apy=0.05,  # placeholder xem ghi chú dưới
        ),
        StrategyMetrics(
            strategy_id="morpho-usdc",
            protocol_slug=_MORPHO_SLUG,
            tvl_usd=morpho_tvl,
            utilization_rate=0.0,  # market test tự tạo trên Sepolia không có vay thật
            historical_apy_volatility=morpho_volatility,
            protocol_age_days=morpho_age,
            current_apy=0.03,  # placeholder xem ghi chú dưới
        ),
        # PendleStrategy CHƯA đưa vào đây - PLAN.md GĐ3 đã ghi rõ chưa fork-test được
        # với hạ tầng Pendle thật, nên chưa có dữ liệu on-chain đáng tin để chấm điểm.
    ]

    # Ghi chú: `current_apy` đang là placeholder cố định vì market test trên Sepolia
    # không có hoạt động vay/lãi thật để đọc APY có ý nghĩa (utilization ~0%). Khi deploy
    # thật (GĐ3 tiếp theo, mainnet hoặc testnet có hoạt động thật), thay bằng đọc
    # `liquidityRate` (Aave, đơn vị RAY 1e27) / tính từ IRM curve (Morpho) trực tiếp
    # on-chain thay vì hardcode.


def run() -> dict:
    metrics_list = collect_metrics()
    metrics_by_id = {m.strategy_id: m for m in metrics_list}

    risk_scores = score_strategies(metrics_list)
    result = optimize_allocation(metrics_by_id, risk_scores, OptimizationConfig())

    return {
        "risk_scores": [rs.model_dump() for rs in risk_scores],
        "optimization_result": result.model_dump(),
    }


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
