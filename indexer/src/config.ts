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
  CONFIRMATIONS: z.coerce.number().int().nonnegative().default(3),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  METRICS_PORT: z.coerce.number().int().positive().default(9464),
  // Vault Security Audit - Medium: giới hạn block range mỗi lần getLogs() - hầu hết RPC
  // provider thật (Alchemy/Infura) từ chối range quá lớn. Không giới hạn nghĩa là sau 1
  // lần downtime dài, range vượt giới hạn provider -> lỗi RPC lặp lại vĩnh viễn, cursor
  // không bao giờ tiến được (đã xảy ra là 1 finding thật trong Vault Security Audit).
  MAX_BLOCK_RANGE: z.coerce.number().int().positive().default(2000),
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
  confirmations: env.CONFIRMATIONS,
  pollIntervalMs: env.POLL_INTERVAL_MS,
  metricsPort: env.METRICS_PORT,
  maxBlockRange: env.MAX_BLOCK_RANGE,
};

export type Config = typeof config;
