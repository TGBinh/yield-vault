#!/usr/bin/env bash
# GĐ5 - Multichain: mô phỏng 2 chain hoàn toàn cục bộ (2 Hardhat node độc lập, KHÔNG cần
# RPC/ví testnet thật cho Base Sepolia) để verify đầu-cuối luồng "2 indexer + 1 Postgres +
# backend tổng hợp theo chain_id", kèm kịch bản DoD §7/§9: mô phỏng 1 chain bị lag/mất kết
# nối và xác nhận hệ thống vẫn hoạt động đúng (graceful degradation).
#
# Chạy: bash scripts/verify-multichain-sync.sh (từ thư mục gốc repo)
#
# Dùng đúng 2 network đã khai báo sẵn trong contracts/hardhat.config.ts: "localhost"
# (built-in, cổng 8545) và "localhostSecondary" (cổng 8546, xem comment ở đó) - nếu bạn
# đang chạy `npx hardhat node` thật ở 1 trong 2 cổng này cho việc khác, dừng nó trước.
#
# Cô lập hoàn toàn khỏi Postgres dev thật của bạn bằng docker-compose project name riêng
# (-p) - không đụng tới volume/network "yield-vault" bạn đang dùng hàng ngày. Tự dọn dẹp
# toàn bộ (node process, container) khi script kết thúc (kể cả khi lỗi giữa chừng, qua
# trap EXIT).
#
# Windows/Git Bash only: `npx <cmd> &` chạy qua npx sinh ra 1 child process thật khác PID
# so với PID mà bash's `$!`/job-control nắm được (npx là 1 wrapper) - kill theo `$!` KHÔNG
# dừng được tiến trình con thật (đã tự gặp lỗi này khi viết script). Dùng cách đáng tin cậy
# hơn trên máy Windows: tìm PID đang LISTEN đúng cổng qua `netstat`, dừng bằng
# `taskkill //F //PID`.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_PROJECT="yv-multichain-verify"
CHAIN_A_PORT=8545
CHAIN_B_PORT=8546
INDEXER_A_METRICS_PORT=19464
INDEXER_B_METRICS_PORT=19465
VAULT_ADDR="0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"
USDC_ADDR="0x5FbDB2315678afecb367f032d93F642f64180aa3"
STRATEGY_MANAGER_ADDR="0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"

wait_for_rpc() {
  local port="$1"
  for i in $(seq 1 20); do
    curl -s -m 2 -X POST "http://127.0.0.1:$port" -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' | grep -q result && return 0
    sleep 1
  done
  echo "FAIL: RPC on port $port never became ready"
  exit 1
}

kill_port() {
  local port="$1"
  local pid
  pid=$(netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING | awk '{print $NF}' | head -1) || true
  if [ -n "${pid:-}" ]; then
    taskkill //F //PID "$pid" >/dev/null 2>&1 || true
  fi
  return 0
}

cleanup() {
  echo "--- Cleaning up ---"
  kill_port "$CHAIN_A_PORT" || true
  kill_port "$CHAIN_B_PORT" || true
  kill_port "$INDEXER_A_METRICS_PORT" || true
  kill_port "$INDEXER_B_METRICS_PORT" || true
  docker compose -p "$COMPOSE_PROJECT" -f "$REPO_ROOT/docker-compose.yml" down -v >/dev/null 2>&1 || true
  return 0
}
trap cleanup EXIT

echo "--- Pre-flight: clearing any leftover process from a previous failed run ---"
cleanup || true
sleep 2

export PATH="$PATH:/c/Users/DELL/.local/foundry-bin"
cd "$REPO_ROOT/contracts"

echo "--- Starting 2 isolated Hardhat nodes (chain A: $CHAIN_A_PORT, chain B: $CHAIN_B_PORT) ---"
npx hardhat node --port "$CHAIN_A_PORT" >/tmp/verify-chain-a.log 2>&1 &
npx hardhat node --port "$CHAIN_B_PORT" >/tmp/verify-chain-b.log 2>&1 &
wait_for_rpc "$CHAIN_A_PORT"
wait_for_rpc "$CHAIN_B_PORT"

echo "--- Deploying to chain A (localhost) and chain B (localhostSecondary) ---"
npx hardhat run --network localhost scripts/deploy.ts >/dev/null
npx hardhat run --network localhostSecondary scripts/deploy.ts >/dev/null

echo "--- Starting isolated Postgres (project: $COMPOSE_PROJECT) ---"
POSTGRES_PASSWORD=verify REDIS_PASSWORD=verify GRAFANA_ADMIN_PASSWORD=verify INTERNAL_API_KEY=verify \
  docker compose -p "$COMPOSE_PROJECT" -f "$REPO_ROOT/docker-compose.yml" up -d postgres >/dev/null
for i in $(seq 1 20); do
  docker exec "${COMPOSE_PROJECT}-postgres-1" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done

cd "$REPO_ROOT/indexer"
echo "--- Starting indexer A (chainId 31337) ---"
RPC_URL="http://127.0.0.1:$CHAIN_A_PORT" CHAIN_ID=31337 \
  POSTGRES_URL="postgres://postgres:verify@127.0.0.1:5433/yield_vault" \
  VAULT_ADDRESS="$VAULT_ADDR" STRATEGY_MANAGER_ADDRESS="$STRATEGY_MANAGER_ADDR" \
  CONFIRMATIONS=1 POLL_INTERVAL_MS=1000 METRICS_PORT="$INDEXER_A_METRICS_PORT" \
  npx tsx src/index.ts >/tmp/verify-indexer-a.log 2>&1 &

echo "--- Starting indexer B (chainId 84532 - simulated Base Sepolia) ---"
RPC_URL="http://127.0.0.1:$CHAIN_B_PORT" CHAIN_ID=84532 \
  POSTGRES_URL="postgres://postgres:verify@127.0.0.1:5433/yield_vault" \
  VAULT_ADDRESS="$VAULT_ADDR" STRATEGY_MANAGER_ADDRESS="$STRATEGY_MANAGER_ADDR" \
  CONFIRMATIONS=1 POLL_INTERVAL_MS=1000 METRICS_PORT="$INDEXER_B_METRICS_PORT" \
  npx tsx src/index.ts >/tmp/verify-indexer-b.log 2>&1 &
sleep 8

cd "$REPO_ROOT/contracts"
echo "--- Depositing 1000 USDC on chain A, 500 USDC on chain B ---"
DEV_VAULT_ADDRESS="$VAULT_ADDR" DEV_USDC_ADDRESS="$USDC_ADDR" DEV_DEPOSIT_AMOUNT=1000000000 \
  npx hardhat run --network localhost scripts/dev-deposit.ts >/dev/null
DEV_VAULT_ADDRESS="$VAULT_ADDR" DEV_USDC_ADDRESS="$USDC_ADDR" DEV_DEPOSIT_AMOUNT=500000000 \
  npx hardhat run --network localhostSecondary scripts/dev-deposit.ts >/dev/null

# Mine 1 extra block on each chain past CONFIRMATIONS=1 so the rows flip to confirmed.
curl -s -X POST "http://127.0.0.1:$CHAIN_A_PORT" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":1}' >/dev/null
curl -s -X POST "http://127.0.0.1:$CHAIN_B_PORT" -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"evm_mine","params":[],"id":1}' >/dev/null
sleep 6

echo "--- Verifying both chains landed in Postgres with correct amounts ---"
ROWS=$(docker exec "${COMPOSE_PROJECT}-postgres-1" psql -U postgres -d yield_vault -t -A -F',' \
  -c "SELECT chain_id, sum(assets::numeric) FROM deposits WHERE confirmed = true GROUP BY chain_id ORDER BY chain_id;")
echo "$ROWS"
echo "$ROWS" | grep -q "^31337,1000000000$" || { echo "FAIL: chain A deposit not indexed correctly"; exit 1; }
echo "$ROWS" | grep -q "^84532,500000000$" || { echo "FAIL: chain B deposit not indexed correctly"; exit 1; }
echo "PASS: both chains indexed independently with the correct chain_id tagging."

echo "--- Simulating chain B going down (kill its node) and checking graceful degradation ---"
kill_port "$CHAIN_B_PORT"
sleep 1
if curl -s -m 2 -X POST "http://127.0.0.1:$CHAIN_B_PORT" -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null 2>&1; then
  echo "FAIL: chain B's node is still responding - kill_port did not actually stop it"
  exit 1
fi
echo "Confirmed: chain B's RPC is now unreachable."

ERRORS_BEFORE=$(curl -s "http://127.0.0.1:$INDEXER_B_METRICS_PORT/metrics" | awk '/^yield_vault_indexer_rpc_errors_total /{print $2}')
sleep 6
ERRORS_AFTER=$(curl -s "http://127.0.0.1:$INDEXER_B_METRICS_PORT/metrics" | awk '/^yield_vault_indexer_rpc_errors_total /{print $2}')
if [ -z "$ERRORS_AFTER" ] || [ "$ERRORS_AFTER" -le "${ERRORS_BEFORE:-0}" ]; then
  echo "FAIL: indexer B did not report increasing rpc_errors_total after its chain went down (or crashed instead of retrying)"
  exit 1
fi
echo "PASS: indexer B keeps retrying (rpc_errors_total $ERRORS_BEFORE -> $ERRORS_AFTER), did not crash."

ROWS_AFTER=$(docker exec "${COMPOSE_PROJECT}-postgres-1" psql -U postgres -d yield_vault -t -A -F',' \
  -c "SELECT chain_id, sum(assets::numeric) FROM deposits WHERE confirmed = true GROUP BY chain_id ORDER BY chain_id;")
echo "$ROWS_AFTER" | grep -q "^31337,1000000000$" || { echo "FAIL: chain A data got affected by chain B's outage"; exit 1; }
echo "PASS: chain A's indexed data is completely unaffected by chain B's outage."

echo ""
echo "=== ALL CHECKS PASSED - GĐ5 DoD §7/§9 verified: dual-chain sync + graceful degradation on chain lag ==="
