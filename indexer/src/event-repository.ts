import { pool } from "./db/client";
import { config } from "./config";

// Vault Security Audit - Organization: tách khỏi watcher.ts (God class 326 dòng) - đây là
// 3 hàm insert cho deposits/withdrawals/strategy_events. Giữ 3 hàm riêng thay vì gộp
// chung 1 helper (table, columns, values) vì mỗi loại event có schema khác nhau
// (deposits/withdrawals có sender/owner/receiver/assets/shares riêng biệt, strategy_events
// có event_name/payload dạng JSON) - gộp chung sẽ làm mất type-safety của args và khó đọc
// hơn là lợi ích DRY mang lại.

// Vault Security Audit - Medium: tên bảng SQL trong repo này luôn là literal cố định (xem
// bên dưới và reorg-confirmer.ts), nhưng đó là pattern SQL injection duy nhất trong toàn
// bộ codebase (reorg-confirmer.ts nội suy tên bảng vào query text). Chốt 1 allowlist tường
// minh làm hàng rào phòng thủ - nếu sau này ai đó lỡ truyền 1 string tuỳ ý vào chỗ tên
// bảng, code sẽ throw ngay thay vì âm thầm chạy SQL không mong muốn.
export const ALLOWED_TABLES = ["deposits", "withdrawals", "strategy_events"] as const;
export type AllowedTable = (typeof ALLOWED_TABLES)[number];

export function assertAllowedTable(table: string): asserts table is AllowedTable {
  if (!(ALLOWED_TABLES as readonly string[]).includes(table)) {
    throw new Error(`Refusing to build query: table "${table}" is not in the indexer allowlist`);
  }
}

export type DepositArgs = { sender: string; owner: string; assets: bigint; shares: bigint };
export type WithdrawArgs = {
  sender: string;
  receiver: string;
  owner: string;
  assets: bigint;
  shares: bigint;
};

export async function insertDeposit(params: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTimestampIso: string;
  vaultAddress: `0x${string}`;
  args: DepositArgs;
}): Promise<void> {
  const { txHash, logIndex, blockNumber, blockTimestampIso, vaultAddress, args } = params;
  await pool.query(
    `INSERT INTO deposits
       (chain_id, tx_hash, log_index, block_number, block_timestamp, vault_address, sender_address, owner_address, assets, shares, confirmed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE)
     ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
    [
      config.chainId,
      txHash,
      logIndex,
      blockNumber.toString(),
      blockTimestampIso,
      vaultAddress.toLowerCase(),
      args.sender.toLowerCase(),
      args.owner.toLowerCase(),
      args.assets.toString(),
      args.shares.toString(),
    ],
  );
}

export async function insertWithdrawal(params: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTimestampIso: string;
  vaultAddress: `0x${string}`;
  args: WithdrawArgs;
}): Promise<void> {
  const { txHash, logIndex, blockNumber, blockTimestampIso, vaultAddress, args } = params;
  await pool.query(
    `INSERT INTO withdrawals
       (chain_id, tx_hash, log_index, block_number, block_timestamp, vault_address, sender_address, receiver_address, owner_address, assets, shares, confirmed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE)
     ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
    [
      config.chainId,
      txHash,
      logIndex,
      blockNumber.toString(),
      blockTimestampIso,
      vaultAddress.toLowerCase(),
      args.sender.toLowerCase(),
      args.receiver.toLowerCase(),
      args.owner.toLowerCase(),
      args.assets.toString(),
      args.shares.toString(),
    ],
  );
}

export async function insertStrategyEvent(params: {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTimestampIso: string;
  contractAddress: `0x${string}`;
  eventName: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { txHash, logIndex, blockNumber, blockTimestampIso, contractAddress, eventName, payload } = params;
  await pool.query(
    `INSERT INTO strategy_events
       (chain_id, tx_hash, log_index, block_number, block_timestamp, contract_address, event_name, payload, confirmed)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
     ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
    [
      config.chainId,
      txHash,
      logIndex,
      blockNumber.toString(),
      blockTimestampIso,
      contractAddress.toLowerCase(),
      eventName,
      JSON.stringify(payload),
    ],
  );
}
