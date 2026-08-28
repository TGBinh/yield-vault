"""Optimization engine - constrained weighted-scoring allocation (PLAN.md GĐ3: "bắt đầu
greedy/weighted scoring; nâng cấp dần lên linear/quadratic programming nếu cần"). This
is intentionally NOT a full constrained solver yet - upgrade path noted below.

Thuật toán: mỗi strategy có "điểm hấp dẫn" = risk_score * expected_apy (risk-adjusted
return đơn giản - ưu tiên strategy vừa an toàn vừa có yield tốt, không chỉ chọn yield cao
nhất mù quáng). Chuẩn hoá điểm hấp dẫn thành trọng số, áp trần % tối đa/strategy để tránh
tập trung rủi ro quá mức vào 1 nơi, phần vượt trần được phân phối lại cho các strategy
còn room theo đúng tỷ lệ điểm hấp dẫn của chúng.

Nâng cấp tương lai (không làm ở GĐ3): linear/quadratic programming với ràng buộc đa
chiều hơn (thanh khoản khả dụng thật, correlation giữa các protocol, VaR...) - đủ dùng
khi weighted scoring đơn giản này không còn phản ánh đúng bài toán thực tế.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from risk_engine.models import AllocationSuggestion, OptimizationResult, RiskScore, StrategyMetrics

BPS_DENOMINATOR = 10_000


@dataclass(frozen=True)
class OptimizationConfig:
    max_weight_per_strategy_bps: int = 5_000  # không strategy nào được vượt 50% vốn
    min_risk_score_to_include: float = 20.0  # loại thẳng strategy quá rủi ro, không phân bổ dù yield cao


def _attractiveness(risk_score: float, expected_apy: float) -> float:
    return risk_score * expected_apy


def optimize_allocation(
    metrics_by_id: dict[str, StrategyMetrics],
    risk_scores: list[RiskScore],
    config: OptimizationConfig = OptimizationConfig(),
) -> OptimizationResult:
    eligible = [rs for rs in risk_scores if rs.composite_score >= config.min_risk_score_to_include]

    if not eligible:
        return OptimizationResult(allocations=[], total_weight_bps=0, generated_at=_now_iso())

    scores = {
        rs.strategy_id: _attractiveness(rs.composite_score, metrics_by_id[rs.strategy_id].current_apy)
        for rs in eligible
    }
    total_attractiveness = sum(scores.values())

    if total_attractiveness <= 0:
        # Mọi strategy hợp lệ đều có APY=0 hoặc risk_score=0 - chia đều thay vì chia 0.
        equal_weight = BPS_DENOMINATOR // len(eligible)
        raw_weights = {sid: equal_weight for sid in scores}
    else:
        raw_weights = {
            sid: round((score / total_attractiveness) * BPS_DENOMINATOR) for sid, score in scores.items()
        }

    capped_weights = _apply_cap_and_redistribute(raw_weights, config.max_weight_per_strategy_bps)

    allocations = [
        AllocationSuggestion(
            strategy_id=sid,
            target_weight_bps=weight,
            risk_score=next(rs.composite_score for rs in eligible if rs.strategy_id == sid),
            expected_apy=metrics_by_id[sid].current_apy,
            rationale=_rationale(sid, weight, eligible, metrics_by_id),
        )
        for sid, weight in capped_weights.items()
        if weight > 0
    ]

    return OptimizationResult(
        allocations=allocations,
        total_weight_bps=sum(a.target_weight_bps for a in allocations),
        generated_at=_now_iso(),
    )


def _apply_cap_and_redistribute(weights: dict[str, int], cap_bps: int) -> dict[str, int]:
    """Lặp lại việc cắt phần vượt trần và chia lại cho các strategy còn room, tới khi
    không còn strategy nào vượt trần (hoặc mọi strategy đều đã chạm trần)."""
    weights = dict(weights)
    fully_redistributed = True

    for _ in range(len(weights) + 1):  # tối đa N vòng lặp là đủ hội tụ với N strategy
        over_cap = {sid: w for sid, w in weights.items() if w > cap_bps}
        if not over_cap:
            break

        excess = sum(w - cap_bps for w in over_cap.values())
        for sid in over_cap:
            weights[sid] = cap_bps

        under_cap = {sid: w for sid, w in weights.items() if w < cap_bps}
        under_cap_total = sum(under_cap.values())
        if under_cap_total <= 0 or not under_cap:
            # Không còn ai để nhận phần dư (mọi strategy đều đã ở trần, hoặc không còn
            # strategy nào khác) - phần dư này ĐÚNG RA không được phân bổ (vốn còn lại ở
            # idle) chứ không được ép ngược vào strategy đang bị giới hạn trần, nếu không
            # sẽ vô hiệu hoá luôn cái trần.
            fully_redistributed = False
            break

        for sid, w in under_cap.items():
            weights[sid] = w + round(excess * (w / under_cap_total))

    return _fix_rounding_drift(weights, cap_bps, fully_redistributed)


def _fix_rounding_drift(weights: dict[str, int], cap_bps: int, fully_redistributed: bool) -> dict[str, int]:
    """Chỉ sửa sai số làm tròn NHỎ (vài bps, do nhiều lần `round()` cộng dồn) - không bao
    giờ sửa khi tổng thấp hơn 10000 vì lý do hợp lệ (trần % không cho phân bổ hết, xem
    `_apply_cap_and_redistribute`), và không bao giờ đẩy 1 strategy vượt trần khi sửa."""
    if not weights:
        return weights

    total = sum(weights.values())
    drift = BPS_DENOMINATOR - total

    if drift == 0:
        return weights

    # Drift lớn mà không phải do redistribute-hết-mức là phân bổ dưới 100% có chủ đích
    # (vốn còn dư để idle) - giữ nguyên, không ép về 10000.
    is_small_rounding_noise = abs(drift) <= max(5, len(weights))
    if not (fully_redistributed and is_small_rounding_noise):
        return weights

    weights = dict(weights)
    candidates = sorted(weights, key=lambda sid: weights[sid], reverse=True)
    for sid in candidates:
        if weights[sid] + drift <= cap_bps:
            weights[sid] += drift
            return weights

    # Không strategy nào nhận thêm được mà không vượt trần - bỏ qua phần lệch nhỏ này.
    return weights


def _rationale(
    strategy_id: str, weight_bps: int, eligible: list[RiskScore], metrics_by_id: dict[str, StrategyMetrics]
) -> str:
    rs = next(r for r in eligible if r.strategy_id == strategy_id)
    apy = metrics_by_id[strategy_id].current_apy
    return (
        f"risk_score={rs.composite_score:.1f}/100, apy={apy * 100:.2f}%, "
        f"target_weight={weight_bps / 100:.1f}%"
    )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
