import { createPublicClient, decodeEventLog as viemDecodeEventLog, http, type Log, type PublicClient } from "viem";
import { config } from "./config";
import vaultAbiJson from "./abis/Vault.json";
import strategyManagerAbiJson from "./abis/StrategyManager.json";
import {
  blockLag,
  currentBlock as currentBlockGauge,
  eventsProcessedTotal,
  logHandlingErrorsTotal,
  rpcErrorsTotal,
} from "./metrics";
import { getCursor, saveCursor } from "./cursor-store";
import { insertDeposit, insertStrategyEvent, insertWithdrawal } from "./event-repository";
import { confirmPendingRows } from "./reorg-confirmer";

// Vault Security Audit - Organization: watcher.ts từng là 1 God class 326 dòng gộp 5 trách
// nhiệm (RPC client, cursor persistence, ABI decoding, 3 writer Postgres, reorg confirmation).
// Đã tách cursor persistence -> cursor-store.ts, các writer -> event-repository.ts, reorg
// confirmation -> reorg-confirmer.ts. File này giờ chỉ còn là orchestrator mỏng: vòng lặp
// polling RPC, quyết định range block cần quét, decode log, và gọi vào 3 module trên.

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
        rpcUrl: redactUrl(config.rpcUrl),
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
        rpcErrorsTotal.inc();
        console.error(JSON.stringify({ level: "error", msg: "Watcher tick failed", error: String(err) }));
        this.scheduleNextTick();
      });
    }, config.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    this.blockTimestampCache.clear();

    const currentBlock = await this.client.getBlockNumber();
    currentBlockGauge.set(Number(currentBlock));

    let maxLag = 0n;
    for (const contract of watchedContracts) {
      const cursorBefore = await getCursor(contract.address, currentBlock);
      maxLag = maxLag > currentBlock - cursorBefore ? maxLag : currentBlock - cursorBefore;
      await this.scanContract(contract, currentBlock);
    }
    blockLag.set(Number(maxLag));

    await confirmPendingRows(this.client, currentBlock);

    this.scheduleNextTick();
  }

  private async scanContract(contract: WatchedContract, currentBlock: bigint): Promise<void> {
    const fromBlock = (await getCursor(contract.address, currentBlock)) + 1n;
    if (fromBlock > currentBlock) {
      return;
    }

    // Vault Security Audit - Medium: chia nhỏ range - hầu hết RPC provider thật từ chối
    // getLogs() với range quá lớn; không giới hạn nghĩa là sau 1 lần downtime dài, lỗi
    // RPC lặp lại vĩnh viễn vì range luôn vượt giới hạn provider.
    const maxBlockRange = BigInt(config.maxBlockRange);
    const toBlock = fromBlock + maxBlockRange - 1n < currentBlock ? fromBlock + maxBlockRange - 1n : currentBlock;

    const logs = await this.client.getLogs({
      address: contract.address,
      fromBlock,
      toBlock,
    });

    // Vault Security Audit - High: trước đây lỗi ghi Postgres chỉ được log ra rồi bỏ
    // qua, nhưng cursor vẫn tiến tới `toBlock` vô điều kiện - 1 lần Postgres
    // timeout/deadlock thoáng qua trong lúc có Deposit/Withdraw thật là mất event đó
    // VĨNH VIỄN (block không bao giờ được quét lại). Giờ: dừng lại ở log lỗi đầu tiên,
    // lưu cursor NGAY TRƯỚC block đó, và rethrow để tick sau retry đúng chỗ - an toàn
    // để re-xử lý các log đã thành công trong cùng block nhờ ON CONFLICT DO NOTHING.
    for (const log of logs) {
      try {
        await this.handleLog(contract, log);
      } catch (err) {
        logHandlingErrorsTotal.inc({ contract: contract.name });
        console.error(
          JSON.stringify({
            level: "error",
            msg: "Failed to handle log - holding cursor back, will retry from this block",
            contract: contract.name,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            error: String(err),
          }),
        );
        const safeBlock = log.blockNumber !== null && log.blockNumber > fromBlock ? log.blockNumber - 1n : fromBlock - 1n;
        await saveCursor(contract.address, safeBlock);
        throw err;
      }
    }

    await saveCursor(contract.address, toBlock);
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
      await insertDeposit({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockTimestampIso,
        vaultAddress: contract.address,
        args,
      });
      eventsProcessedTotal.inc({ contract: contract.name, event_name: decoded.eventName });
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
      await insertWithdrawal({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockTimestampIso,
        vaultAddress: contract.address,
        args,
      });
      eventsProcessedTotal.inc({ contract: contract.name, event_name: decoded.eventName });
      return;
    }

    if (contract.name === "StrategyManager") {
      const payload = serializeArgs(decoded.args);
      await insertStrategyEvent({
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        blockNumber: log.blockNumber,
        blockTimestampIso,
        contractAddress: contract.address,
        eventName: decoded.eventName,
        payload,
      });
      eventsProcessedTotal.inc({ contract: contract.name, event_name: decoded.eventName });
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

/// Vault Security Audit - High: RPC URL production thật (Alchemy/Infura...) gần như
/// chắc chắn có API key nằm ngay trong path - log nguyên URL nghĩa là key đó lọt vào
/// log aggregator (thường có quyền đọc rộng hơn secret store rất nhiều). Chỉ giữ lại
/// protocol + host, bỏ path/query.
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "<invalid-url>";
  }
}

function serializeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    result[key] = typeof value === "bigint" ? value.toString() : value;
  }
  return result;
}
