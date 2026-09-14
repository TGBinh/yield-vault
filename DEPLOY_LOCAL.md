# Chạy toàn bộ hệ thống local — Hướng dẫn từng bước

Mục tiêu: sau khi làm đúng theo thứ tự dưới đây, bạn có toàn bộ stack chạy trên máy —
contract trên Hardhat node local, indexer + backend + risk-engine + ai-engine qua Docker
Compose, frontend qua `npm run dev` — deposit/withdraw thật qua MetaMask, dashboard hiển
thị dữ liệu thật.

**Thứ tự BẮT BUỘC phải theo đúng** (mỗi bước phụ thuộc bước trước): Hardhat node → deploy
contract → cập nhật địa chỉ → Docker Compose (Postgres/Redis/indexer/backend/risk-engine/
ai-engine) → frontend.

---

## 0. Chuẩn bị 1 lần duy nhất

| Công cụ | Phiên bản | Kiểm tra |
|---|---|---|
| Node.js | 20.x (không dùng 22+, Hardhat 2 pin ở Node 20) | `node --version` |
| Docker Desktop | bất kỳ bản mới | `docker --version`, đảm bảo đang **chạy** |
| Foundry (`forge`) | bất kỳ | `forge --version` |
| Python | >=3.10 (chỉ cần nếu muốn chạy risk-engine/ai-engine KHÔNG qua Docker) | `python --version` |

Nếu chưa có Foundry, cài theo `contracts/README` (project này không dùng `foundryup`
global — xem `PLAN.md` ghi chú GĐ2 nếu cần cài kiểu portable). Mọi lệnh liên quan tới
contract (`hardhat run`, `forge test`...) đều cần `forge` có trong PATH, nếu không sẽ báo
lỗi `'forge' is not recognized...` (PowerShell) hoặc `forge: command not found` (Bash).

**Cách vĩnh viễn (khuyên dùng — chỉ cần làm 1 lần)**: thêm vào PATH của Windows qua
PowerShell, áp dụng cho MỌI cửa sổ terminal mới mở sau đó (Bash lẫn PowerShell):

```powershell
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
[Environment]::SetEnvironmentVariable("PATH", "$currentPath;C:\Users\DELL\.local\foundry-bin", "User")
```

Sau khi chạy lệnh trên, **đóng và mở lại terminal** để PATH mới có hiệu lực.

**Cách tạm thời (chỉ áp dụng cho đúng cửa sổ terminal đang mở, phải làm lại mỗi lần mở
terminal mới)** — nếu không muốn đổi PATH hệ thống:

```bash
# Bash / Git Bash
export PATH="$PATH:/c/Users/DELL/.local/foundry-bin"
```

```powershell
# PowerShell
$env:PATH += ";C:\Users\DELL\.local\foundry-bin"
```

Cài dependency cho toàn bộ monorepo (workspace npm — làm 1 lần ở **thư mục gốc**, không
làm riêng từng thư mục con):

```bash
cd C:\Users\DELL\Desktop\BLC
npm install
```

> **Máy yếu RAM (<8GB free)**: `npm install` cài cả monorepo (contracts + frontend +
> backend + indexer) có thể bị Windows OOM-kill giữa chừng. Nếu gặp lỗi cài dở dang
> (`npm warn reify invalid or damaged lockfile` hoặc thư mục `node_modules/<package>`
> thiếu file), chạy lại với giới hạn bộ nhớ + giảm song song:
> ```bash
> NODE_OPTIONS="--max-old-space-size=2048" npm install --no-audit --no-fund --maxsockets=3
> ```
> rồi kiểm tra `node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol` tồn tại thật
> (không rỗng) trước khi tiếp tục.

Copy toàn bộ file `.env.example` thành `.env` (KHÔNG sửa `.env.example`, chỉ sửa bản
copy):

```bash
cp .env.example .env
cp contracts/.env.example contracts/.env
cp backend/.env.example backend/.env
cp indexer/.env.example indexer/.env
cp frontend/.env.example frontend/.env.local
cp ai-engine/.env.example ai-engine/.env
```

`contracts/.env` và `ai-engine/.env` có thể để trống hoàn toàn cho local (mọi biến đều
tuỳ chọn, deploy script tự dùng giá trị mặc định an toàn cho dev — xem comment trong từng
file). `.env` ở gốc đã có sẵn password mẫu (`postgres`/`redis`/`admin`) — **chỉ an toàn
cho local**, đừng dùng lại khi lên staging/production thật.

---

## 1. Chạy Hardhat node local (giữ terminal này mở suốt)

```bash
cd contracts
npx hardhat node
```

Giữ terminal này chạy — đây là blockchain local (cổng `8545`), mọi tài khoản test (10000
ETH mỗi cái) sẽ in ra màn hình.

---

## 2. Deploy contract (terminal MỚI)

```bash
cd contracts
npx hardhat run scripts/deploy.ts --network localhost
```

Script sẽ deploy `MockUSDC → Vault → StrategyManager → MockStrategy → RebalanceTimelock`
và in ra JSON địa chỉ ở cuối, dạng:

```json
{
  "usdc": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "vault": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "strategyManager": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "strategy": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  ...
}
```

> Nếu chạy `npx hardhat node` lần đầu và deploy ngay theo đúng thứ tự này (không có giao
> dịch nào khác chen vào trước), địa chỉ luôn RA GIỐNG HỆT ở trên (Hardhat account đầu
> tiên + nonce tất định) — file `frontend/src/lib/deployments.local.json` đã có sẵn đúng
> các địa chỉ này, có thể không cần sửa gì. Nhưng **mỗi lần bạn restart `npx hardhat
> node`**, làm lại bước 3 bên dưới để chắc chắn.

**KHÔNG deploy CrossChainExecutor/CrossChainTimelock ở bước này** — 2 contract đó chỉ
được tạo khi có `CCIP_ROUTER_ADDRESS` trong `contracts/.env` (dành cho GĐ6, testnet
thật), để trống là đúng cho local.

---

## 3. Cập nhật địa chỉ contract cho frontend + indexer

### 3a. Frontend — sửa `frontend/src/lib/deployments.local.json`

Copy đúng 4 địa chỉ (`usdc`, `vault`, `strategyManager` → field `strategy` trong JSON này
thực ra lưu địa chỉ `MockStrategy` để hiển thị, không phải `strategyManager`) từ output
bước 2 vào:

```json
{
  "chainId": 31337,
  "network": "hardhat-localhost",
  "rpcUrl": "http://127.0.0.1:8545",
  "contracts": {
    "usdc": "<usdc address>",
    "vault": "<vault address>",
    "strategyManager": "<strategyManager address>",
    "strategy": "<strategy address>"
  }
}
```

### 3b. Indexer — sửa `indexer/.env`

```
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
POSTGRES_URL=postgres://postgres:postgres@localhost:5433/yield_vault
VAULT_ADDRESS=<vault address>
STRATEGY_MANAGER_ADDRESS=<strategyManager address>
```

> Lưu ý cổng Postgres: khi Postgres chạy qua `docker compose` ở bước 4, nó bind ra
> **`127.0.0.1:5433`** (không phải 5432 mặc định) — xem `docker-compose.yml`. Nếu bạn
> chạy indexer trực tiếp bằng `npm run dev` (không qua Docker), nhớ dùng đúng cổng 5433 ở
> đây.

### 3c. Root `.env` — cho indexer chạy TRONG Docker Compose (khuyên dùng)

Nếu bạn để indexer chạy qua `docker compose up` (không chạy tay `npm run dev`), sửa
`.env` ở **thư mục gốc** thay vì `indexer/.env` (docker-compose đọc file này):

```
RPC_URL=http://host.docker.internal:8545
CHAIN_ID=31337
VAULT_ADDRESS=<vault address>
STRATEGY_MANAGER_ADDRESS=<strategyManager address>
```

`host.docker.internal` là cách container Docker Desktop (Windows/Mac) gọi ra máy host —
đã cấu hình sẵn, không cần đổi.

---

## 4. Khởi động hạ tầng qua Docker Compose

```bash
cd C:\Users\DELL\Desktop\BLC
docker compose up -d postgres redis indexer risk-engine ai-engine backend
```

Chạy riêng `-d postgres redis indexer risk-engine ai-engine backend` (bỏ qua
`prometheus`/`alertmanager`/`grafana` ở lượt đầu) để khởi động nhanh hơn — thêm sau nếu
cần xem dashboard giám sát:

```bash
docker compose up -d prometheus alertmanager grafana
```

Theo dõi log để chắc chắn indexer bắt được block thật:

```bash
docker compose logs -f indexer
```

---

## 5. Chạy frontend

```bash
cd frontend
npm run dev
```

Mở `http://localhost:3000`. Kết nối MetaMask vào mạng **Hardhat Localhost**
(chainId `31337`, RPC `http://127.0.0.1:8545`) — nếu MetaMask chưa có mạng này, thêm mạng
thủ công với đúng 2 thông số trên. Import 1 private key bất kỳ in ra ở bước 1 (terminal
Hardhat node) để có sẵn 10000 ETH + có thể mint mUSDC qua nút Faucet (đã bật sẵn qua
`NEXT_PUBLIC_ENABLE_FAUCET=true`).

---

## 6. Verify toàn bộ chuỗi hoạt động thật (không chỉ "chạy không lỗi")

| Việc kiểm tra | Lệnh / cách xem | Kỳ vọng |
|---|---|---|
| Backend sống | `curl http://localhost:3001/health` | `{"status":"ok",...}` |
| Indexer sống | `curl http://localhost:9464/health` | `{"status":"ok",...}` |
| Indexer bắt kịp block | `curl http://localhost:9464/metrics \| grep block_lag` | số nhỏ, không tăng dần |
| Deposit thật | Deposit qua UI (frontend) → đợi vài giây | Postgres có row mới trong bảng `deposits` |
| Backend đọc đúng | `curl http://localhost:3001/vault/summary` | `tvl` khớp số đã deposit |
| Risk/AI Engine | `docker compose exec risk-engine curl http://localhost:8002/health` | (không publish ra host, phải exec vào container) |
| Grafana (nếu bật) | `http://localhost:3002` (đăng nhập admin / giá trị `GRAFANA_ADMIN_PASSWORD` trong `.env`) | Dashboard TVL/block lag có dữ liệu |

---

## 7. Dừng / khởi động lại từ đầu

```bash
docker compose down          # dừng infra, GIỮ LẠI dữ liệu Postgres (volume)
docker compose down -v       # dừng infra, XOÁ SẠCH dữ liệu (deposits/withdrawals trong Postgres)
```

Khi bạn **restart `npx hardhat node`** (Ctrl+C rồi chạy lại), toàn bộ state on-chain mất
sạch (kể cả contract đã deploy) — bắt buộc phải làm lại từ **bước 2** (deploy lại) và
**bước 3** (cập nhật địa chỉ mới). Nếu không, frontend/indexer sẽ gọi vào địa chỉ contract
không còn tồn tại và báo lỗi khó hiểu (`call revert exception` hoặc timeout).

Nếu chỉ muốn xoá dữ liệu indexer để bắt đầu index lại từ đầu mà KHÔNG deploy lại contract,
xoá riêng volume Postgres:

```bash
docker compose down
docker volume rm yield-vault_postgres-data
docker compose up -d postgres redis indexer risk-engine ai-engine backend
```

---

## 8. Sự cố thường gặp trên Windows (đã tự gặp và xử lý trong quá trình phát triển)

- **`forge: command not found`** (Bash) / **`'forge' is not recognized as an internal or
  external command`** (PowerShell) — bao gồm cả khi lỗi hiện ra từ chính hardhat-foundry
  plugin lúc chạy `npx hardhat run`/`npx hardhat test`: PATH chưa có Foundry. Dùng cách
  vĩnh viễn ở bước 0 (thêm vào PATH hệ thống qua PowerShell, nhớ mở terminal MỚI sau đó) —
  cách tạm thời (`export`/`$env:PATH +=`) chỉ có tác dụng cho đúng cửa sổ terminal đang
  gõ lệnh, KHÔNG áp dụng cho terminal khác đang mở hay terminal mới mở sau đó.
- **`npm install` báo lỗi/treo giữa chừng, sau đó thiếu file trong `node_modules`**: máy
  hết RAM giữa lúc cài — xem cảnh báo ở bước 0, dùng `NODE_OPTIONS=--max-old-space-size`.
- **Lỗi import `@openzeppelin/contracts/...` "File not found" khi `forge build`**: junction
  `contracts/node_modules/@openzeppelin` bị thiếu (npm workspace hoist lên gốc, một số
  công cụ Foundry cần link cục bộ). Chạy lại `node contracts/scripts/link-oz-local.js`
  hoặc tạo junction thủ công qua PowerShell:
  ```powershell
  New-Item -ItemType Junction -Path "contracts\node_modules\@openzeppelin" -Target "node_modules\@openzeppelin" -Force
  ```
- **`NotImplementedError: Method 'HardhatEthersProvider.resolveName' is not implemented`**
  khi chạy `hardhat run scripts/deploy.ts`: một địa chỉ bạn tự gõ trong `.env` (ví dụ
  `GOVERNANCE_MULTISIG_ADDRESS`) bị sai độ dài/format — ethers không nhận ra là địa chỉ
  hợp lệ nên thử phân giải như tên ENS, và mạng Hardhat local không hỗ trợ ENS. Kiểm tra
  lại đúng 40 ký tự hex sau `0x` (42 ký tự tổng cộng).
- **Indexer báo `ECONNREFUSED 127.0.0.1:5432`**: nhầm cổng Postgres — cổng thật là
  **5433** khi chạy qua `docker-compose.yml` (xem bước 3b).
- **Deposit qua UI báo lỗi "wrong network" hoặc gọi vào contract không tồn tại**: Hardhat
  node đã bị restart nhưng `deployments.local.json`/`indexer/.env`/`.env` gốc chưa cập
  nhật địa chỉ mới — làm lại bước 2 và 3.
- **`docker compose up` báo thiếu biến bắt buộc** (`POSTGRES_PASSWORD`/`INTERNAL_API_KEY`
  /...): quên copy `.env.example` → `.env` ở bước 0, hoặc đang chạy lệnh không phải từ
  thư mục gốc repo (docker compose chỉ đọc `.env` ở đúng thư mục chứa `docker-compose.yml`).

---

## 9. Chạy test để xác nhận code đang đúng trước khi deploy (khuyên làm trước bước 1)

```bash
cd contracts
forge test                                    # 48 test Foundry (unit + fuzz + fork + CCIP simulator)
npx hardhat test                              # 33 test Hardhat (Vault/StrategyManager/Safe governance)
slither . --exclude-dependencies --filter-paths "test-helpers" --fail-medium   # static analysis, phải exit 0

cd ../backend
npx jest                                      # test Policy Engine

cd ../indexer
npx tsc --noEmit                              # typecheck

cd ../frontend
npm run build                                 # build production, bắt lỗi TypeScript/env-guard sớm
```
