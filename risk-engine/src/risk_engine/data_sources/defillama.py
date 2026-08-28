"""Real integration with the public DefiLlama API (api.llama.fi) - PLAN.md GĐ3 yêu cầu
rõ "dữ liệu từ DefiLlama API + on-chain reads", không phải data giả lập.

DefiLlama không có endpoint APY-volatility trực tiếp cho mọi protocol; dùng biến động
TVL ngày-qua-ngày làm proxy tạm cho "độ ổn định" (ghi rõ đây là proxy, không phải biến
động APY thật) - khi indexer tự thu thập đủ lịch sử APY thật của các strategy (GĐ3+),
nên thay proxy này bằng dữ liệu tự có, đáng tin hơn vì đúng với market/strategy cụ thể
đang dùng thay vì trung bình toàn protocol.
"""
from __future__ import annotations

import statistics
from datetime import datetime, timezone

import requests

_BASE_URL = "https://api.llama.fi"
_DEFAULT_TIMEOUT_SECONDS = 10


def get_current_tvl_usd(protocol_slug: str) -> float:
    resp = requests.get(f"{_BASE_URL}/tvl/{protocol_slug}", timeout=_DEFAULT_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return float(resp.json())


def get_protocol_summary(protocol_slug: str) -> dict:
    resp = requests.get(f"{_BASE_URL}/protocol/{protocol_slug}", timeout=_DEFAULT_TIMEOUT_SECONDS)
    resp.raise_for_status()
    return resp.json()


def get_protocol_age_days(protocol_slug: str) -> float:
    """`listedAt` khi DefiLlama có (unix timestamp protocol được list) - fallback về giá
    trị lớn (coi như trưởng thành) nếu thiếu dữ liệu, tránh phạt oan 1 protocol lâu đời
    chỉ vì DefiLlama không ghi ngày."""
    summary = get_protocol_summary(protocol_slug)
    listed_at = summary.get("listedAt")
    if not listed_at:
        return 9999.0
    listed_dt = datetime.fromtimestamp(listed_at, tz=timezone.utc)
    return (datetime.now(timezone.utc) - listed_dt).total_seconds() / 86400.0


def get_tvl_volatility_proxy(protocol_slug: str, trailing_days: int = 30) -> float:
    """Độ lệch chuẩn của % thay đổi TVL ngày-qua-ngày trong `trailing_days` gần nhất,
    dùng làm proxy cho biến động/độ ổn định. Trả 0.0 nếu không đủ dữ liệu (an toàn hơn
    là trả giá trị cao giả tạo khi thiếu data)."""
    summary = get_protocol_summary(protocol_slug)
    tvl_points = summary.get("tvl", [])
    if len(tvl_points) < 3:
        return 0.0

    recent = tvl_points[-trailing_days:]
    daily_returns = []
    for prev, curr in zip(recent, recent[1:]):
        prev_tvl = prev.get("totalLiquidityUSD", 0)
        curr_tvl = curr.get("totalLiquidityUSD", 0)
        if prev_tvl > 0:
            daily_returns.append((curr_tvl - prev_tvl) / prev_tvl)

    if len(daily_returns) < 2:
        return 0.0
    return abs(statistics.pstdev(daily_returns))
