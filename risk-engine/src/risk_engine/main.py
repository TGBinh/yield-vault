"""CLI entrypoint - chạy toàn bộ pipeline Market Data -> RiskEngine -> OptimizationEngine
và in ra JSON "đề xuất phân bổ" (PLAN.md GĐ3 §5: Backend đọc kết quả này để hiển thị,
KHÔNG tự động thực thi - con người vẫn duyệt tay ở giai đoạn này).

Vault Security Audit - organization finding: file này trước đây gánh cả catalog strategy
hardcode và orchestration thật - đã tách sang `strategy_catalog.py`/`pipeline.py`. File
này giờ chỉ còn CLI entrypoint mỏng.

Usage: python -m risk_engine.main
"""
from __future__ import annotations

import json
import logging

from risk_engine.pipeline import run

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("risk_engine")

if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
