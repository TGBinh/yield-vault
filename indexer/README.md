# indexer

Indexer sự kiện on-chain (viem + Postgres) cho project AI-Powered Cross-Chain Yield Vault, Giai đoạn 2 (xem `PLAN.md` ở root, mục "GIAI ĐOẠN 2" và §2.4/§2.5).

Đây là indexer tự viết (hand-rolled), không dùng The Graph/Ponder, dùng SQL thuần qua `pg` — đúng như quyết định trong PLAN.md (§1.3).

## Kiến trúc ngắn gọn

- `src/config.ts`: đọc cấu hình từ biến môi trường (RPC, chain id, địa chỉ contract, Postgres, số confirmation, poll interval).
- `src/db/schema.sql`: schema Postgres — bảng `deposits`, `withdrawals`, `strategy_events`, `indexer_cursors`. Mỗi bảng event đều có `chain_id` để sẵn sàng multichain sau này, và unique constraint `(chain_id, tx_hash, log_index)` để việc ghi event là idempotent.
- `src/db/client.ts`: pool kết nối Postgres + `runMigrations()` áp schema (dùng `CREATE TABLE IF NOT EXISTS`, chạy lại an toàn).
- `src/watcher.ts`: vòng lặp poll `getLogs` (không dùng `watchContractEvent` để chủ động kiểm soát xác nhận block trên node Hardhat local, vốn không hỗ trợ tốt subscription qua HTTP transport). Theo dõi:
  - `Vault`: `Deposit`, `Withdraw`
  - `StrategyManager`: `StrategyRegistered`, `ActiveStrategyChanged`

  Mỗi vòng poll: quét log mới, ghi (upsert, bỏ qua nếu trùng) vào Postgres với `confirmed = false`, sau đó với các row đã đạt độ sâu `CONFIRMATIONS`, kiểm tra lại transaction receipt — nếu tx không còn tồn tại (do reorg) thì xoá row, ngược lại đánh dấu `confirmed = true`.
- `src/index.ts`: entrypoint — chạy migration, khởi động watcher, log JSON có cấu trúc, tắt an toàn (graceful shutdown) khi nhận `SIGINT`/`SIGTERM`.
- `src/abis/*.json`: chỉ chứa mảng ABI của `Vault` và `StrategyManager`, copy trực tiếp từ `contracts/artifacts/`, không phụ thuộc runtime vào workspace `contracts`.

## Chạy local

1. Chuẩn bị Postgres (ví dụ chạy container tạm):

   ```bash
   docker run --rm -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=yield_vault -p 5432:5432 postgres:16
   ```

2. Copy file env mẫu và điền địa chỉ contract (lấy từ `frontend/src/lib/deployments.local.json` sau khi deploy):

   ```bash
   cp indexer/.env.example indexer/.env
   ```

   Sửa `VAULT_ADDRESS`, `STRATEGY_MANAGER_ADDRESS`, `POSTGRES_URL` cho đúng môi trường của bạn.

3. Đảm bảo Hardhat node local đang chạy và contract đã deploy:

   ```bash
   cd contracts
   npx hardhat node
   # ở terminal khác:
   npx hardhat run scripts/deploy.ts --network localhost
   ```

4. Cài dependency (từ root monorepo, vì đây là npm workspace):

   ```bash
   npm install
   ```

5. Chạy indexer ở chế độ dev (tự reload khi sửa code):

   ```bash
   npm run dev --workspace indexer
   ```

   Hoặc build rồi chạy bản production:

   ```bash
   npm run build --workspace indexer
   npm run start --workspace indexer
   ```

## Kiểm tra nhanh

- `npx tsc --noEmit` (chạy trong thư mục `indexer/`) để type-check.
- Thực hiện một giao dịch `deposit`/`withdraw` qua frontend hoặc script, sau vài block sẽ thấy row tương ứng trong bảng `deposits`/`withdrawals` với `confirmed = true`.

## Lưu ý

- Không có Dockerfile riêng ở đây — `docker-compose.yml` ở root sẽ chạy indexer cùng image Node, inject biến môi trường vào container.
- Địa chỉ contract KHÔNG được hardcode trong code — luôn đọc từ biến môi trường/config.
