import { config } from "./config";
import { pool } from "./db/client";

// Vault Security Audit - Organization: tách khỏi watcher.ts (God class 326 dòng) - đây là
// toàn bộ logic đọc/ghi con trỏ quét (indexer_cursors), tách riêng để watcher.ts chỉ còn
// là orchestrator mỏng. Hành vi giữ nguyên 100% so với bản gốc trong watcher.ts.

export async function getCursor(address: `0x${string}`, currentBlock: bigint): Promise<bigint> {
  const result = await pool.query<{ last_scanned_block: string }>(
    "SELECT last_scanned_block FROM indexer_cursors WHERE chain_id = $1 AND contract_address = $2",
    [config.chainId, address.toLowerCase()],
  );
  if (result.rows.length > 0) {
    return BigInt(result.rows[0].last_scanned_block);
  }
  // No cursor yet: start scanning from the current block (no historical backfill by default).
  const startBlock = currentBlock > 0n ? currentBlock - 1n : 0n;
  return startBlock;
}

export async function saveCursor(address: `0x${string}`, block: bigint): Promise<void> {
  await pool.query(
    `INSERT INTO indexer_cursors (chain_id, contract_address, last_scanned_block, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (chain_id, contract_address)
     DO UPDATE SET last_scanned_block = EXCLUDED.last_scanned_block, updated_at = now()`,
    [config.chainId, address.toLowerCase(), block.toString()],
  );
}

/// Vault Security Audit - High: trước đây cursor KHÔNG được lùi lại sau khi xoá row do
/// reorg - transaction bị orphan thường được mine lại ở 1 block SAU đó (quay lại
/// mempool), nhưng nếu cursor đã vượt qua block mới đó thì watcher không bao giờ quét
/// lại để tìm thấy nó, và event thật (Deposit của user) biến mất khỏi DB vĩnh viễn dù
/// trên chain vẫn tồn tại. Lùi cursor về ngay trước block bị orphan để buộc rescan.
export async function rewindCursor(address: `0x${string}`, toBlock: bigint): Promise<void> {
  await pool.query(
    `UPDATE indexer_cursors
     SET last_scanned_block = LEAST(last_scanned_block, $3::bigint), updated_at = now()
     WHERE chain_id = $1 AND contract_address = $2`,
    [config.chainId, address.toLowerCase(), toBlock.toString()],
  );
}
