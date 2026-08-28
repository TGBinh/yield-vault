# risk-engine

Risk scoring + allocation optimization cho AI-Powered Cross-Chain Yield Vault (Giai đoạn 3).
Thuật toán **tất định, không dùng AI/LLM** — xem PLAN.md GĐ3. AI Engine (Giai đoạn 4) sẽ
tiêu thụ output của engine này, không thay thế nó.

## Setup

```bash
cd risk-engine
python -m venv .venv
./.venv/Scripts/pip install -e ".[dev]"   # Windows
# source .venv/bin/activate && pip install -e ".[dev]"   # macOS/Linux
```

## Chạy pipeline thật

```bash
PYTHONPATH=src ./.venv/Scripts/python.exe -m risk_engine.main
```

In ra JSON gồm `risk_scores` (điểm 0-100 từng strategy) và `optimization_result`
(đề xuất phân bổ theo basis points). Đây chỉ là **đề xuất** — Backend đọc và hiển thị,
KHÔNG có quyền tự động thực thi lên contract (con người vẫn duyệt tay ở GĐ3).

## Test

```bash
./.venv/Scripts/python.exe -m pytest -v
```

## Kiến trúc

- `models.py` — `StrategyMetrics` (input), `RiskScore`/`AllocationSuggestion` (output).
- `scoring.py` — chấm điểm 4 thành phần (TVL, utilization, volatility, tuổi đời protocol),
  gộp thành composite score theo trọng số cấu hình được (`ScoringWeights`).
- `optimization.py` — phân bổ theo weighted scoring (risk_score × APY), có trần %/strategy
  và logic phân phối lại phần vượt trần. Nâng cấp lên linear/quadratic programming để sau
  khi cần (xem docstring).
- `data_sources/defillama.py` — gọi thật API công khai DefiLlama (TVL, tuổi đời, proxy
  biến động).
- `data_sources/onchain.py` — đọc thật on-chain (utilization) từ Aave v3 (Arbitrum Sepolia)
  và Morpho Blue (Ethereum Sepolia), dùng đúng địa chỉ đã verify trong `contracts/`.

## Giới hạn đã biết (xem PLAN.md để chi tiết)

- `current_apy` hiện là placeholder cố định — market test trên Sepolia không có hoạt động
  vay/lãi thật để đọc APY có ý nghĩa. Khi có deployment thật, đọc trực tiếp từ
  `liquidityRate` (Aave)/IRM curve (Morpho).
- PendleStrategy chưa được đưa vào scoring vì chưa fork-test được với hạ tầng Pendle thật.
- Biến động TVL từ DefiLlama là proxy tạm cho biến động APY thật — nên thay bằng dữ liệu
  lịch sử tự thu thập qua indexer khi có đủ.
