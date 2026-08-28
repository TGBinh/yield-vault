# ai-engine

AI Engine (Phase 4) — sinh `Recommendation` có schema cố định từ đề xuất của risk-engine,
kèm giải thích ngôn ngữ tự nhiên chỉ để hiển thị. **Không có quyền thực thi** — mọi output
đi qua Policy Engine (backend) trước khi con người có thể duyệt. Xem PLAN.md GĐ4.

## Setup

```bash
cd ai-engine
python -m venv .venv
./.venv/Scripts/pip install -e ".[dev]"   # Windows
cp .env.example .env   # điền ANTHROPIC_API_KEY thật nếu muốn AI thật hoạt động
```

## Chạy

```bash
./.venv/Scripts/python.exe -m uvicorn ai_engine.main:app --port 8001
```

- `GET /health`
- `POST /recommend` — nhận `OptimizationInput` (output của risk-engine `/optimize`),
  trả về `Recommendation`.

## Test

```bash
./.venv/Scripts/python.exe -m pytest -v
```

## Giới hạn đã biết

- **Chưa verify được lời gọi LLM thật** — không có `ANTHROPIC_API_KEY` trong môi trường
  lúc build phần này. Đường gọi Anthropic API (`llm_client.py`) viết đúng theo pattern
  tool-use chính thức của Anthropic (structured output bắt buộc qua schema, không parse
  free text), nhưng chưa test end-to-end với API thật.
- **Đường fallback đã verify đầy đủ** (không cần API key): khi thiếu `ANTHROPIC_API_KEY`
  hoặc lời gọi LLM lỗi/timeout, tự động trả về nguyên trạng đề xuất tất định của
  risk-engine (`source: "deterministic"`, `risk_flags: ["ai_unavailable"]`) — đã test qua
  cả unit test lẫn boot thật `uvicorn` + `curl /recommend`.
