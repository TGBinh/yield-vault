"""Deterministic risk scoring - NO machine learning / LLM here on purpose (see
PLAN.md GĐ3: "RiskEngine + OptimizationEngine tất định (không AI)"). The AI Engine in
Phase 4 consumes this engine's output; it never replaces it.

Mỗi thành phần điểm được chuẩn hoá về [0, 100], điểm càng cao càng an toàn. Composite
score là trung bình có trọng số của 4 thành phần - trọng số có thể chỉnh qua
`ScoringWeights` mà không cần sửa logic tính.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from risk_engine.models import RiskScore, StrategyMetrics

# TVL trên/dưới các ngưỡng này coi như đã bão hoà điểm - tránh 1 protocol siêu lớn
# (vd. Aave mainnet) làm lệch thang điểm so với các protocol nhỏ hơn nhưng vẫn an toàn.
_TVL_FLOOR_USD = 100_000.0
_TVL_CEILING_USD = 1_000_000_000.0

# Utilization quá cao (gần 100%) nghĩa là rút tiền có thể bị nghẽn thanh khoản tạm thời -
# đây là rủi ro thật (đã thấy trong thực tế Aave/Compound khi utilization áp trần).
_UTILIZATION_SAFE_CEILING = 0.80

# 2 năm hoạt động không bị exploit coi là "trưởng thành" - chuẩn hoá tuổi đời quanh mốc này.
_PROTOCOL_AGE_MATURE_DAYS = 730.0


@dataclass(frozen=True)
class ScoringWeights:
    tvl: float = 0.30
    utilization: float = 0.20
    volatility: float = 0.30
    age: float = 0.20

    def __post_init__(self) -> None:
        total = self.tvl + self.utilization + self.volatility + self.age
        if abs(total - 1.0) > 1e-9:
            raise ValueError(f"ScoringWeights must sum to 1.0, got {total}")


def _score_tvl(tvl_usd: float) -> float:
    """Log-scaled: mỗi bậc 10x TVL đóng góp như nhau, tránh chênh lệch tuyến tính quá lớn
    giữa 1 protocol có TVL $10M và $10B khi cả hai đều đã "đủ lớn" để an toàn."""
    if tvl_usd <= _TVL_FLOOR_USD:
        return 0.0
    if tvl_usd >= _TVL_CEILING_USD:
        return 100.0
    log_ratio = math.log10(tvl_usd / _TVL_FLOOR_USD)
    log_range = math.log10(_TVL_CEILING_USD / _TVL_FLOOR_USD)
    return max(0.0, min(100.0, (log_ratio / log_range) * 100.0))


def _score_utilization(utilization_rate: float) -> float:
    """Điểm cao nhất ở utilization vừa phải (có nhu cầu vay thật, không nhàn rỗi), giảm
    dần tuyến tính khi vượt ngưỡng an toàn (rủi ro nghẽn rút tiền)."""
    if utilization_rate <= _UTILIZATION_SAFE_CEILING:
        # 0% utilization vẫn được điểm dương (không rủi ro thanh khoản) nhưng thấp hơn
        # mức "có nhu cầu vay thật" một chút, phản ánh yield thực tế cũng thấp hơn.
        return 60.0 + (utilization_rate / _UTILIZATION_SAFE_CEILING) * 40.0
    # Trên ngưỡng an toàn: giảm tuyến tính về 0 tại 100% utilization.
    overshoot = (utilization_rate - _UTILIZATION_SAFE_CEILING) / (1.0 - _UTILIZATION_SAFE_CEILING)
    return max(0.0, 100.0 * (1.0 - overshoot))


def _score_volatility(historical_apy_volatility: float) -> float:
    """Tuyến tính nghịch - biến động APY càng thấp càng an toàn (yield ổn định, dễ dự
    đoán). Volatility >= 20% (0.2) coi như điểm 0 - đây là mức biến động rất cao cho
    lending APY (không phải giá token)."""
    capped = min(historical_apy_volatility, 0.20)
    return max(0.0, 100.0 * (1.0 - capped / 0.20))


def _score_age(protocol_age_days: float) -> float:
    """Log-scaled tương tự TVL - 1 protocol mới ra mắt 30 ngày rủi ro rất khác so với
    6 tháng, nhưng khác biệt giữa 3 năm và 5 năm không đáng kể bằng."""
    if protocol_age_days <= 0:
        return 0.0
    log_ratio = math.log10(1 + protocol_age_days)
    log_mature = math.log10(1 + _PROTOCOL_AGE_MATURE_DAYS)
    return max(0.0, min(100.0, (log_ratio / log_mature) * 100.0))


def score_strategy(metrics: StrategyMetrics, weights: ScoringWeights = ScoringWeights()) -> RiskScore:
    tvl_score = _score_tvl(metrics.tvl_usd)
    utilization_score = _score_utilization(metrics.utilization_rate)
    volatility_score = _score_volatility(metrics.historical_apy_volatility)
    age_score = _score_age(metrics.protocol_age_days)

    composite = (
        tvl_score * weights.tvl
        + utilization_score * weights.utilization
        + volatility_score * weights.volatility
        + age_score * weights.age
    )

    return RiskScore(
        strategy_id=metrics.strategy_id,
        tvl_score=round(tvl_score, 2),
        utilization_score=round(utilization_score, 2),
        volatility_score=round(volatility_score, 2),
        age_score=round(age_score, 2),
        composite_score=round(composite, 2),
    )


def score_strategies(
    metrics_list: list[StrategyMetrics], weights: ScoringWeights = ScoringWeights()
) -> list[RiskScore]:
    return [score_strategy(m, weights) for m in metrics_list]
