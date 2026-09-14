import { pool } from "./db/client";
import { config } from "./config";

// Phase 1 (dashboard performance chart) - tách riêng khỏi event-repository.ts vì đây
// không phải ghi 1 event log (không có tx_hash/log_index, không cần ON CONFLICT) mà là
// ghi 1 điểm mẫu định kỳ - schema và ngữ nghĩa khác hẳn insertDeposit/insertWithdrawal/
// insertStrategyEvent, gộp chung sẽ làm mất rõ ràng.

export async function getLastSnapshotTimestampMs(contractAddress: `0x${string}`): Promise<number | null> {
  const result = await pool.query<{ block_timestamp: Date }>(
    `SELECT block_timestamp FROM vault_snapshots
     WHERE chain_id = $1 AND contract_address = $2
     ORDER BY block_timestamp DESC LIMIT 1`,
    [config.chainId, contractAddress.toLowerCase()],
  );
  if (result.rows.length === 0) return null;
  return new Date(result.rows[0].block_timestamp).getTime();
}

export async function insertVaultSnapshot(params: {
  contractAddress: `0x${string}`;
  blockNumber: bigint;
  blockTimestampIso: string;
  tvl: bigint;
  totalShares: bigint;
}): Promise<void> {
  const { contractAddress, blockNumber, blockTimestampIso, tvl, totalShares } = params;
  await pool.query(
    `INSERT INTO vault_snapshots (chain_id, contract_address, block_number, block_timestamp, tvl, total_shares)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      config.chainId,
      contractAddress.toLowerCase(),
      blockNumber.toString(),
      blockTimestampIso,
      tvl.toString(),
      totalShares.toString(),
    ],
  );
}
