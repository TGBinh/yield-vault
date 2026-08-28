# backend

REST API đọc dữ liệu vault/strategy từ Postgres (do service `indexer` ghi vào), có cache Redis. Đây là phần Phase 2 (GĐ2) của dự án AI-Powered Cross-Chain Yield Vault — xem `PLAN.md` ở repo root, mục "GIAI ĐOẠN 2".

Backend này **không** gọi blockchain trực tiếp và **không** ghi vào Postgres — nó chỉ đọc (read-only) từ các bảng do `indexer` populate:

- `deposits`
- `withdrawals`
- `strategy_events`

## Chạy local

```bash
# từ thư mục backend/
cp .env.example .env
# chỉnh POSTGRES_URL / REDIS_URL nếu cần

npm install
npm run start:dev
```

Mặc định:
- `PORT=3001`
- `POSTGRES_URL=postgres://postgres:postgres@localhost:5432/yield_vault`
- `REDIS_URL=redis://localhost:6379`

Postgres/Redis được cung cấp qua docker-compose ở repo root (do phần khác của dự án dựng).

## Endpoints

### `GET /vault/summary`

TVL, tổng deposit/withdraw, share price (nếu tính được). Cache Redis TTL 15s vì dashboard poll thường xuyên.

```json
{
  "totalDeposited": "1000000000",
  "totalWithdrawn": "200000000",
  "tvl": "800000000",
  "totalShares": "800000000",
  "sharePrice": "1000000000000000000",
  "depositCount": 12,
  "withdrawalCount": 3
}
```

Các số `assets`/`shares` là chuỗi biểu diễn số nguyên nhỏ nhất (base units), theo decimals của token (MockUSDC/yvUSDC = 6 decimals). `sharePrice` được scale 1e18 (assets per share).

### `GET /user/:address/positions`

Lịch sử deposit/withdraw và vị thế ròng của một địa chỉ ví (lọc theo `owner_address` — địa chỉ sở hữu share theo chuẩn ERC-4626). `:address` phải là địa chỉ EVM hợp lệ (`0x` + 40 ký tự hex), nếu không sẽ trả về `400 Bad Request`.

```json
{
  "userAddress": "0xabc...",
  "totalDeposited": "500000000",
  "totalWithdrawn": "100000000",
  "netAssets": "400000000",
  "netShares": "400000000",
  "deposits": [
    {
      "txHash": "0x...",
      "logIndex": 0,
      "chainId": 11155111,
      "blockNumber": "1234567",
      "blockTimestamp": "2026-08-01T00:00:00.000Z",
      "vaultAddress": "0x...",
      "assets": "500000000",
      "shares": "500000000"
    }
  ],
  "withdrawals": []
}
```

### `GET /strategies`

Danh sách strategy events (đăng ký, đổi active strategy) và chiến lược đang active hiện tại. `strategyAddress` được suy ra từ `payload` JSONB theo tên event (`StrategyRegistered.strategy`, `ActiveStrategyChanged.current`). `activeStrategyAddress` ưu tiên event `ActiveStrategyChanged` mới nhất, fallback về `StrategyRegistered` mới nhất nếu chưa từng đổi.

```json
{
  "events": [
    {
      "txHash": "0x...",
      "logIndex": 0,
      "chainId": 11155111,
      "blockNumber": "1234567",
      "blockTimestamp": "2026-08-01T00:00:00.000Z",
      "contractAddress": "0x...",
      "eventName": "ActiveStrategyChanged",
      "payload": { "previous": "0x...", "current": "0x..." },
      "strategyAddress": "0x..."
    }
  ],
  "activeStrategyAddress": "0x..."
}
```

## Ghi chú

- Tất cả query dùng parameterized SQL (`pg` Pool), không nối chuỗi SQL trực tiếp.
- Validation input dùng `class-validator`/`class-transformer` (global `ValidationPipe`) và custom pipe `EvmAddressPipe` cho param địa chỉ.
- Không dùng ORM nặng — chỉ `pg` Pool với raw SQL, giữ đơn giản theo tinh thần PLAN.md.
