import "dotenv/config";
import { z } from "zod";

// Đọc cấu hình từ biến môi trường, có giá trị mặc định phù hợp cho Hardhat local node.
const envSchema = z.object({
  RPC_URL: z.string().url().default("http://127.0.0.1:8545"),
  CHAIN_ID: z.coerce.number().int().positive().default(31337),
  POSTGRES_URL: z
    .string()
    .min(1)
    .default("postgres://postgres:postgres@localhost:5432/yield_vault"),
  VAULT_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "VAULT_ADDRESS must be a valid 0x-prefixed address"),
  STRATEGY_MANAGER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "STRATEGY_MANAGER_ADDRESS must be a valid 0x-prefixed address"),
  // Phase 3 (Governance page) - optional, đúng pattern indexer-chain-b của GĐ5: không set
  // thì watcher bỏ qua hoàn toàn 2 contract này, không bắt buộc mọi deployment phải có
  // RebalanceTimelock/CrossChainTimelock (vd. testnet chưa deploy tới GĐ6).
  // docker-compose truyền biến không set thành CHUỖI RỖNG "" (không phải unset hẳn) -
  // .optional() của Zod chỉ chấp nhận `undefined`, không chấp nhận "" -> phải tự coi ""
  // là "không set" trước khi validate regex (cùng lớp lỗi ?? vs || đã gặp ở deploy.ts).
  REBALANCE_TIMELOCK_ADDRESS: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(
      z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "REBALANCE_TIMELOCK_ADDRESS must be a valid 0x-prefixed address")
        .optional(),
    ),
  CROSS_CHAIN_TIMELOCK_ADDRESS: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v))
    .pipe(
      z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "CROSS_CHAIN_TIMELOCK_ADDRESS must be a valid 0x-prefixed address")
        .optional(),
    ),
  CONFIRMATIONS: z.coerce.number().int().nonnegative().default(3),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  METRICS_PORT: z.coerce.number().int().positive().default(9464),
  // Vault Security Audit - Medium: giới hạn block range mỗi lần getLogs() - hầu hết RPC
  // provider thật (Alchemy/Infura) từ chối range quá lớn. Không giới hạn nghĩa là sau 1
  // lần downtime dài, range vượt giới hạn provider -> lỗi RPC lặp lại vĩnh viễn, cursor
  // không bao giờ tiến được (đã xảy ra là 1 finding thật trong Vault Security Audit).
  MAX_BLOCK_RANGE: z.coerce.number().int().positive().default(2000),
  // Phase 1 (dashboard performance chart) - khoảng cách tối thiểu giữa 2 lần chụp
  // vault_snapshots. Mặc định 5 phút - đủ mau để chart có hình dạng trong 1 phiên dev
  // ngắn, không tạo quá nhiều row cho testnet/production chạy dài ngày.
  SNAPSHOT_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  // Phase 4 (realtime notifications) - optional, không set thì indexer bỏ qua publish
  // Redis hoàn toàn (xem redis-publisher.ts) - graceful degradation, KHÔNG bắt buộc mọi
  // deployment phải có Redis (ví dụ testnet chưa cần realtime notification).
  REDIS_URL: z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

const env = loadEnv();

export const config = {
  rpcUrl: env.RPC_URL,
  chainId: env.CHAIN_ID,
  postgresUrl: env.POSTGRES_URL,
  vaultAddress: env.VAULT_ADDRESS as `0x${string}`,
  strategyManagerAddress: env.STRATEGY_MANAGER_ADDRESS as `0x${string}`,
  rebalanceTimelockAddress: env.REBALANCE_TIMELOCK_ADDRESS as `0x${string}` | undefined,
  crossChainTimelockAddress: env.CROSS_CHAIN_TIMELOCK_ADDRESS as `0x${string}` | undefined,
  confirmations: env.CONFIRMATIONS,
  pollIntervalMs: env.POLL_INTERVAL_MS,
  metricsPort: env.METRICS_PORT,
  maxBlockRange: env.MAX_BLOCK_RANGE,
  snapshotIntervalMs: env.SNAPSHOT_INTERVAL_MS,
  redisUrl: env.REDIS_URL,
};

export type Config = typeof config;
