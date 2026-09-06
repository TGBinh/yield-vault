import type { PublicClient } from "viem";
import { config } from "./config";
import { pool } from "./db/client";
import { reorgsDetectedTotal } from "./metrics";
import { rewindCursor } from "./cursor-store";
import { ALLOWED_TABLES, assertAllowedTable, type AllowedTable } from "./event-repository";

// Vault Security Audit - Organization: tách khỏi watcher.ts (God class 326 dòng) - đây là
// toàn bộ logic re-verify các row chưa confirm sau khi đạt độ sâu confirmation, hành vi
// giữ nguyên 100% so với bản gốc trong watcher.ts.

/// Vault Security Audit - High: mỗi bảng dùng tên cột địa chỉ contract khác nhau
/// (deposits/withdrawals: vault_address, strategy_events: contract_address) - cần biết
/// đúng cột để lùi cursor khi 1 row bị xoá do reorg.
const REORG_TABLE_ADDRESS_COLUMN: Record<AllowedTable, string> = {
  deposits: "vault_address",
  withdrawals: "vault_address",
  strategy_events: "contract_address",
};

/**
 * Re-verify unconfirmed rows once they reach the confirmation depth. If the transaction
 * that produced the row can no longer be found on-chain (reorg orphaned it), delete the row;
 * otherwise mark it confirmed.
 */
export async function confirmPendingRows(client: PublicClient, currentBlock: bigint): Promise<void> {
  const confirmationThreshold = currentBlock - BigInt(config.confirmations);
  if (confirmationThreshold < 0n) return;

  for (const table of ALLOWED_TABLES) {
    // Vault Security Audit - Medium: tên bảng dưới đây bị nội suy trực tiếp vào SQL (Postgres
    // không cho phép bind tên bảng bằng $n) - đây là pattern SQLi duy nhất trong repo. `table`
    // luôn đến từ ALLOWED_TABLES ở trên nên vốn đã an toàn, nhưng assert tường minh ở đây là
    // hàng rào phòng thủ: nếu code sau này đổi nguồn của `table`, injection bị chặn ngay thay
    // vì âm thầm chạy SQL không mong muốn.
    assertAllowedTable(table);
    const addressColumn = REORG_TABLE_ADDRESS_COLUMN[table];
    const pending = await pool.query<{ id: number; tx_hash: string; block_number: string; contract_address: string }>(
      `SELECT id, tx_hash, block_number, ${addressColumn} AS contract_address FROM ${table}
       WHERE chain_id = $1 AND confirmed = FALSE AND block_number <= $2`,
      [config.chainId, confirmationThreshold.toString()],
    );

    for (const row of pending.rows) {
      const stillOnChain = await transactionStillOnChain(client, row.tx_hash as `0x${string}`, BigInt(row.block_number));
      if (stillOnChain) {
        await pool.query(`UPDATE ${table} SET confirmed = TRUE WHERE id = $1`, [row.id]);
      } else {
        reorgsDetectedTotal.inc();
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "Reorg detected, orphaning row",
            table,
            txHash: row.tx_hash,
            blockNumber: row.block_number,
          }),
        );
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [row.id]);

        // Vault Security Audit - High: trước đây cursor KHÔNG được lùi lại sau khi xoá
        // row do reorg - transaction bị orphan thường được mine lại ở 1 block SAU đó
        // (quay lại mempool), nhưng nếu cursor đã vượt qua block mới đó thì watcher
        // không bao giờ quét lại để tìm thấy nó, và event thật (Deposit của user) biến
        // mất khỏi DB vĩnh viễn dù trên chain vẫn tồn tại. Lùi cursor về ngay trước
        // block bị orphan để buộc rescan.
        await rewindCursor(row.contract_address as `0x${string}`, BigInt(row.block_number) - 1n);
      }
    }
  }
}

async function transactionStillOnChain(
  client: PublicClient,
  txHash: `0x${string}`,
  expectedBlockNumber: bigint,
): Promise<boolean> {
  try {
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    return receipt.blockNumber === expectedBlockNumber;
  } catch {
    return false;
  }
}
