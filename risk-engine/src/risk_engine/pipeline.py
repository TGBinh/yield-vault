"""Orchestration thật của pipeline Market Data -> RiskEngine -> OptimizationEngine
(PLAN.md GĐ3 §5: Backend đọc kết quả này để hiển thị, KHÔNG tự động thực thi - con
người vẫn duyệt tay ở giai đoạn này).

Vault Security Audit - organization finding: trước đây `main.py` gánh cả 3 vai (catalog
strategy hardcode, orchestration I/O, CLI entrypoint) trong khi `api.py` (HTTP layer) lại
import `run()` từ `main.py` - tạo phụ thuộc ngược (HTTP layer phụ thuộc vào CLI module).
File này tách riêng phần orchestration thật (`collect_metrics`/`run`) ra khỏi CLI, catalog
strategy nằm ở `strategy_catalog.py`.
"""
from __future__ import annotations

from risk_engine.models import StrategyMetrics
from risk_engine.optimization import OptimizationConfig, optimize_allocation
from risk_engine.scoring import score_strategies
from risk_engine.strategy_catalog import build_strategy_metrics


def collect_metrics() -> tuple[list[StrategyMetrics], list[str]]:
    """Kết hợp 2 nguồn dữ liệu có chủ đích khác nhau:
    - DefiLlama (TVL, tuổi đời, biến động) phản ánh uy tín protocol ở QUY MÔ TOÀN CẦU
      (mainnet) - đây là thứ nói lên "Aave nói chung có đáng tin không".
    - On-chain read trực tiếp (utilization, APY) phản ánh THỊ TRƯỜNG CỤ THỂ đang dùng
      trên testnet - đây là thứ nói lên "market USDC cụ thể này đang hoạt động ra sao
      ngay bây giờ". Trộn 2 nguồn là chủ đích, không phải nhầm lẫn.
    """
    return build_strategy_metrics()


def run() -> dict:
    metrics_list, failed_sources = collect_metrics()
    metrics_by_id = {m.strategy_id: m for m in metrics_list}

    risk_scores = score_strategies(metrics_list)
    result = optimize_allocation(metrics_by_id, risk_scores, OptimizationConfig())

    # Vault Security Audit - High: gắn data_quality dựa trên failed_sources thay vì để
    # allocations=[] tự nói lên "mọi strategy quá rủi ro" khi thực ra nguyên nhân là 1
    # API bên ngoài sập. "unusable" khi lỗi nguồn khiến kết quả rỗng (không có gì đáng
    # tin để hiển thị); "degraded" khi vẫn còn allocations nhưng dựa một phần trên giá
    # trị mặc định bảo thủ; "complete" khi mọi nguồn đều đọc thành công.
    if failed_sources and not result.allocations:
        data_quality = "unusable"
    elif failed_sources:
        data_quality = "degraded"
    else:
        data_quality = "complete"
    result = result.model_copy(update={"data_quality": data_quality, "failed_sources": failed_sources})

    return {
        "risk_scores": [rs.model_dump() for rs in risk_scores],
        "optimization_result": result.model_dump(),
    }
