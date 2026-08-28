import { createPublicClient, decodeEventLog as viemDecodeEventLog, http, type Log, type PublicClient } from "viem";
import { config } from "./config";
import { pool } from "./db/client";
import vaultAbiJson from "./abis/Vault.json";
import strategyManagerAbiJson from "./abis/StrategyManager.json";

const vaultAbi = vaultAbiJson as readonly unknown[];
const strategyManagerAbi = strategyManagerAbiJson as readonly unknown[];

// Chỉ theo dõi đúng các event được yêu cầu: Vault(Deposit, Withdraw), StrategyManager(StrategyRegistered, ActiveStrategyChanged).
const VAULT_EVENT_NAMES = ["Deposit", "Withdraw"] as const;
const STRATEGY_MANAGER_EVENT_NAMES = ["StrategyRegistered", "ActiveStrategyChanged"] as const;

type WatchedContract = {
  name: "Vault" | "StrategyManager";
  address: `0x${string}`;
  abi: readonly unknown[];
  eventNames: readonly string[];
};

const watchedContracts: WatchedContract[] = [
  { name: "Vault", address: config.vaultAddress, abi: vaultAbi, eventNames: VAULT_EVENT_NAMES },
  {
    name: "StrategyManager",
    address: config.strategyManagerAddress,
    abi: strategyManagerAbi,
    eventNames: STRATEGY_MANAGER_EVENT_NAMES,
  },
];

export class Watcher {
  private readonly client: PublicClient;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private blockTimestampCache = new Map<bigint, bigint>();

  constructor() {
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    }) as PublicClient;
  }

  async start(): Promise<void> {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "Starting watcher",
        rpcUrl: config.rpcUrl,
        chainId: config.chainId,
        confirmations: config.confirmations,
        pollIntervalMs: config.pollIntervalMs,
      }),
    );
    await this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextTick(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.tick().catch((err) => {
        console.error(JSON.stringify({ level: "error", msg: "Watcher tick failed", error: String(err) }));
        this.scheduleNextTick();
      });
    }, config.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    this.blockTimestampCache.clear();

    const currentBlock = await this.client.getBlockNumber();

    for (const contract of watchedContracts) {
      await this.scanContract(contract, currentBlock);
    }

    await this.confirmPendingRows(currentBlock);

    this.scheduleNextTick();
  }

  private async getCursor(address: `0x${string}`, currentBlock: bigint): Promise<bigint> {
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

  private async saveCursor(address: `0x${string}`, block: bigint): Promise<void> {
    await pool.query(
      `INSERT INTO indexer_cursors (chain_id, contract_address, last_scanned_block, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (chain_id, contract_address)
       DO UPDATE SET last_scanned_block = EXCLUDED.last_scanned_block, updated_at = now()`,
      [config.chainId, address.toLowerCase(), block.toString()],
    );
  }

  private async scanContract(contract: WatchedContract, currentBlock: bigint): Promise<void> {
    const fromBlock = (await this.getCursor(contract.address, currentBlock)) + 1n;
    if (fromBlock > currentBlock) {
      return;
    }

    const logs = await this.client.getLogs({
      address: contract.address,
      fromBlock,
      toBlock: currentBlock,
    });

    for (const log of logs) {
      try {
        await this.handleLog(contract, log);
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            msg: "Failed to handle log",
            contract: contract.name,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            error: String(err),
          }),
        );
      }
    }

    await this.saveCursor(contract.address, currentBlock);
  }

  private async getBlockTimestamp(blockNumber: bigint): Promise<bigint> {
    const cached = this.blockTimestampCache.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await this.client.getBlock({ blockNumber });
    this.blockTimestampCache.set(blockNumber, block.timestamp);
    return block.timestamp;
  }

  private async handleLog(contract: WatchedContract, log: Log): Promise<void> {
    if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) {
      return;
    }

    const decoded = decodeEventLog(contract, log);
    if (!decoded || !contract.eventNames.includes(decoded.eventName)) {
      return;
    }

    const blockTimestamp = await this.getBlockTimestamp(log.blockNumber);
    const blockTimestampIso = new Date(Number(blockTimestamp) * 1000).toISOString();

    if (contract.name === "Vault" && decoded.eventName === "Deposit") {
      const args = decoded.args as { sender: string; owner: string; assets: bigint; shares: bigint };
      await pool.query(
        `INSERT INTO deposits
           (chain_id, tx_hash, log_index, block_number, block_timestamp, vault_address, sender_address, owner_address, assets, shares, confirmed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE)
         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
        [
          config.chainId,
          log.transactionHash,
          log.logIndex,
          log.blockNumber.toString(),
          blockTimestampIso,
          contract.address.toLowerCase(),
          args.sender.toLowerCase(),
          args.owner.toLowerCase(),
          args.assets.toString(),
          args.shares.toString(),
        ],
      );
      return;
    }

    if (contract.name === "Vault" && decoded.eventName === "Withdraw") {
      const args = decoded.args as {
        sender: string;
        receiver: string;
        owner: string;
        assets: bigint;
        shares: bigint;
      };
      await pool.query(
        `INSERT INTO withdrawals
           (chain_id, tx_hash, log_index, block_number, block_timestamp, vault_address, sender_address, receiver_address, owner_address, assets, shares, confirmed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, FALSE)
         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
        [
          config.chainId,
          log.transactionHash,
          log.logIndex,
          log.blockNumber.toString(),
          blockTimestampIso,
          contract.address.toLowerCase(),
          args.sender.toLowerCase(),
          args.receiver.toLowerCase(),
          args.owner.toLowerCase(),
          args.assets.toString(),
          args.shares.toString(),
        ],
      );
      return;
    }

    if (contract.name === "StrategyManager") {
      const payload = serializeArgs(decoded.args);
      await pool.query(
        `INSERT INTO strategy_events
           (chain_id, tx_hash, log_index, block_number, block_timestamp, contract_address, event_name, payload, confirmed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
         ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
        [
          config.chainId,
          log.transactionHash,
          log.logIndex,
          log.blockNumber.toString(),
          blockTimestampIso,
          contract.address.toLowerCase(),
          decoded.eventName,
          JSON.stringify(payload),
        ],
      );
    }
  }

  /**
   * Re-verify unconfirmed rows once they reach the confirmation depth. If the transaction
   * that produced the row can no longer be found on-chain (reorg orphaned it), delete the row;
   * otherwise mark it confirmed.
   */
  private async confirmPendingRows(currentBlock: bigint): Promise<void> {
    const confirmationThreshold = currentBlock - BigInt(config.confirmations);
    if (confirmationThreshold < 0n) return;

    for (const table of ["deposits", "withdrawals", "strategy_events"] as const) {
      const pending = await pool.query<{ id: number; tx_hash: string; block_number: string }>(
        `SELECT id, tx_hash, block_number FROM ${table}
         WHERE chain_id = $1 AND confirmed = FALSE AND block_number <= $2`,
        [config.chainId, confirmationThreshold.toString()],
      );

      for (const row of pending.rows) {
        const stillOnChain = await this.transactionStillOnChain(row.tx_hash as `0x${string}`, BigInt(row.block_number));
        if (stillOnChain) {
          await pool.query(`UPDATE ${table} SET confirmed = TRUE WHERE id = $1`, [row.id]);
        } else {
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
        }
      }
    }
  }

  private async transactionStillOnChain(txHash: `0x${string}`, expectedBlockNumber: bigint): Promise<boolean> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash: txHash });
      return receipt.blockNumber === expectedBlockNumber;
    } catch {
      return false;
    }
  }
}

function decodeEventLog(
  contract: WatchedContract,
  log: Log,
): { eventName: string; args: Record<string, unknown> } | null {
  try {
    const decoded = viemDecodeEventLog({
      abi: contract.abi as never,
      data: log.data,
      topics: log.topics,
    });
    return decoded as unknown as { eventName: string; args: Record<string, unknown> };
  } catch {
    // Log doesn't match any event in this ABI (e.g. Transfer/Approval on the Vault) - skip silently.
    return null;
  }
}

function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = typeof value === "bigint" ? value.toString() : value;
  }
  return result;
}
