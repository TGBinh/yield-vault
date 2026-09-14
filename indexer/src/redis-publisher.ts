import Redis from "ioredis";
import { config } from "./config";

// Phase 4 (realtime notifications) - publish channel mà backend's NotificationsGateway
// subscribe. `REDIS_URL` optional (xem config.ts) - không set thì client luôn null, mọi
// lời gọi publishConfirmedEvent() no-op. Publish LÚC CONFIRM (không phải lúc thấy log lần
// đầu) để tránh false-positive do reorg - xem chỗ gọi duy nhất trong reorg-confirmer.ts.
export const NOTIFICATIONS_CHANNEL = "vault:events";

const client = config.redisUrl
  ? new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 1 })
  : null;

client?.on("error", (err) => {
  // Vault Security Audit graceful-degradation pattern: log và nuốt lỗi, KHÔNG để 1 lần
  // Redis rớt kết nối làm crash toàn bộ indexer - việc index event on-chain (nhiệm vụ
  // chính) không phụ thuộc vào Redis còn sống hay không.
  console.warn(JSON.stringify({ level: "warn", msg: "Redis publish client error", error: (err as Error).message }));
});

export async function publishConfirmedEvent(table: string, row: Record<string, unknown>): Promise<void> {
  if (!client) return;
  try {
    await client.publish(NOTIFICATIONS_CHANNEL, JSON.stringify({ type: table, chainId: config.chainId, ...row }));
  } catch (err) {
    console.warn(
      JSON.stringify({ level: "warn", msg: "Redis publish failed", table, error: (err as Error).message }),
    );
  }
}
