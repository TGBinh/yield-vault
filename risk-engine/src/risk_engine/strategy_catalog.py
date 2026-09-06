"""Catalog hardcode các strategy hiện đang được risk engine chấm điểm (PLAN.md GĐ3).

Vault Security Audit - organization finding: trước đây phần catalog này (slug DefiLlama,
việc dựng `StrategyMetrics` cho từng strategy_id) nằm chung trong `main.py` cùng với
orchestration I/O và CLI entrypoint - 3 mối quan tâm khác nhau trong 1 file khiến việc
thêm/sửa 1 strategy mới phải đọc lẫn lộn cả logic CLI. Tách riêng ra đây để `pipeline.py`
chỉ cần gọi `build_strategy_metrics()` mà không cần biết chi tiết từng protocol.
"""
from __future__ import annotations

import logging

from risk_engine.data_sources import defillama, onchain
from risk_engine.models import StrategyMetrics

logger = logging.getLogger("risk_engine")

# slug DefiLlama chính thức cho từng protocol - tra tại defillama.com, không tự đoán.
AAVE_SLUG = "aave-v3"
MORPHO_SLUG = "morpho-blue"


def _safe_call(fn, default, failures: list[str], source_label: str, *args, **kwargs):
    """Mọi lệnh gọi mạng (DefiLlama/RPC) đều có thể fail (rate limit, RPC down, testnet
    không ổn định) - risk engine không được crash toàn bộ pipeline vì 1 nguồn dữ liệu lỗi,
    dùng giá trị mặc định bảo thủ (an toàn) thay thế và log rõ ràng để không giấu lỗi.

    Vault Security Audit - High: trước đây lỗi chỉ được log rồi NUỐT LUÔN - không có
    cách nào phân biệt "dùng giá trị mặc định vì API sập" với "giá trị thật đúng là
    thấp". `failures` ghi lại source nào đã fail để `pipeline.run()` gắn `data_quality` đúng.
    """
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001 - broad on purpose, see docstring
        logger.warning(
            "Data source call failed (%s), using conservative default %r: %s", source_label, default, exc
        )
        failures.append(source_label)
        return default


def build_strategy_metrics() -> tuple[list[StrategyMetrics], list[str]]:
    """Đọc dữ liệu từ DefiLlama + on-chain cho từng strategy đã biết trong catalog và
    dựng `StrategyMetrics`. Trả về cả danh sách các nguồn dữ liệu đã fail để tầng gọi
    (`pipeline.py`) gắn `data_quality` đúng."""
    failures: list[str] = []

    aave_tvl = _safe_call(defillama.get_current_tvl_usd, 0.0, failures, "defillama:aave-v3:tvl", AAVE_SLUG)
    aave_age = _safe_call(defillama.get_protocol_age_days, 0.0, failures, "defillama:aave-v3:age", AAVE_SLUG)
    aave_volatility = _safe_call(
        defillama.get_tvl_volatility_proxy, 0.20, failures, "defillama:aave-v3:volatility", AAVE_SLUG
    )
    aave_utilization = _safe_call(onchain.get_aave_utilization, 0.0, failures, "onchain:aave-utilization")

    morpho_tvl = _safe_call(defillama.get_current_tvl_usd, 0.0, failures, "defillama:morpho-blue:tvl", MORPHO_SLUG)
    morpho_age = _safe_call(
        defillama.get_protocol_age_days, 0.0, failures, "defillama:morpho-blue:age", MORPHO_SLUG
    )
    morpho_volatility = _safe_call(
        defillama.get_tvl_volatility_proxy, 0.20, failures, "defillama:morpho-blue:volatility", MORPHO_SLUG
    )

    def _build(strategy_id: str, protocol_slug: str, tvl: float, utilization: float, volatility: float,
               age: float, current_apy: float) -> StrategyMetrics:
        # Vault Security Audit - High: giá trị đọc từ nguồn dữ liệu bên ngoài (TVL âm bất
        # thường, listedAt trong tương lai...) có thể lọt qua các lệnh gọi mạng thành công
        # (không raise exception) nhưng vẫn không hợp lệ theo Pydantic khi dựng
        # StrategyMetrics - phải catch ở đây, KHÔNG để ValidationError thoát ra tầng API
        # (500 kèm stack trace ra ngoài). Xử lý giống hệt `_safe_call`: dùng bộ giá trị
        # mặc định bảo thủ cho CHÍNH strategy đó thay vì để lỗi lan ra, và ghi nhận vào
        # `failures` để `pipeline.run()` gắn data_quality="degraded"/"unusable" đúng.
        try:
            return StrategyMetrics(
                strategy_id=strategy_id,
                protocol_slug=protocol_slug,
                tvl_usd=tvl,
                utilization_rate=utilization,
                historical_apy_volatility=volatility,
                protocol_age_days=age,
                current_apy=current_apy,
            )
        except Exception as exc:  # noqa: BLE001 - broad on purpose, see docstring
            logger.warning(
                "Invalid metrics for %s from upstream data, using conservative default: %s", strategy_id, exc
            )
            failures.append(f"validation:{strategy_id}")
            return StrategyMetrics(
                strategy_id=strategy_id,
                protocol_slug=protocol_slug,
                tvl_usd=0.0,
                utilization_rate=0.0,
                historical_apy_volatility=0.20,
                protocol_age_days=0.0,
                current_apy=0.0,
            )

    metrics = [
        _build(
            "aave-usdc", AAVE_SLUG, aave_tvl, aave_utilization, aave_volatility, aave_age,
            current_apy=0.05,  # placeholder xem ghi chú dưới
        ),
        _build(
            "morpho-usdc", MORPHO_SLUG, morpho_tvl,
            0.0,  # market test tự tạo trên Sepolia không có vay thật
            morpho_volatility, morpho_age,
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
    return metrics, failures
