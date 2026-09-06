"""Sinh chuỗi mô tả hiển thị (display string) cho kết quả optimize.

Vault Security Audit - organization finding: `_rationale()` trước đây nằm trong
`optimization.py`, trộn logic thuật toán phân bổ với việc sinh chuỗi hiển thị. Chuỗi này
sau đó được AI Engine đưa vào prompt LLM (xem ai-engine `llm_client._build_prompt` -
finding Nghiêm trọng về prompt injection ở lớp đó) - tách riêng ra đây để mặt hiển thị
(string formatting) độc lập với thuật toán tối ưu, dễ audit/thay đổi format mà không đụng
tới logic tính toán.
"""
from __future__ import annotations

from risk_engine.models import RiskScore, StrategyMetrics


def rationale(
    strategy_id: str, weight_bps: int, eligible: list[RiskScore], metrics_by_id: dict[str, StrategyMetrics]
) -> str:
    rs = next(r for r in eligible if r.strategy_id == strategy_id)
    apy = metrics_by_id[strategy_id].current_apy
    return (
        f"risk_score={rs.composite_score:.1f}/100, apy={apy * 100:.2f}%, "
        f"target_weight={weight_bps / 100:.1f}%"
    )
