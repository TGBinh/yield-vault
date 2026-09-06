import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { config } from "../config";

// Pool duy nhất dùng chung cho toàn bộ ứng dụng.
export const pool = new Pool({
  connectionString: config.postgresUrl,
});

pool.on("error", (err) => {
  console.error(JSON.stringify({ level: "error", msg: "Unexpected Postgres pool error", error: String(err) }));
});

// GĐ5 - Multichain: khoá tuỳ ý (arbitrary) dùng riêng cho việc serialize migration -
// không liên quan tới dữ liệu nghiệp vụ, chỉ cần 1 số int8 cố định, duy nhất trong phạm
// vi ứng dụng này.
const MIGRATION_LOCK_KEY = 727271;

/**
 * Apply schema.sql against the configured database.
 * The SQL file only uses CREATE TABLE/INDEX IF NOT EXISTS - an idempotent statement khi
 * chạy TUẦN TỰ, nhưng KHÔNG an toàn khi 2+ process chạy ĐỒNG THỜI trên 1 database HOÀN
 * TOÀN MỚI: PostgreSQL không tự khoá chống race cho DDL "IF NOT EXISTS" (giới hạn đã
 * biết của chính Postgres), nên 2 lệnh CREATE TABLE cùng lúc vẫn có thể đụng độ
 * ("duplicate key value violates unique constraint... pg_class_relname_nsp_index").
 * Đây là kịch bản THẬT: GĐ5 chạy nhiều indexer instance (1 per chain) cùng trỏ vào 1
 * Postgres và tất cả đều tự migrate lúc boot (xem docker-compose.yml service
 * `indexer-chain-b`, cùng phụ thuộc `postgres: condition: service_healthy` nên khởi
 * động gần như đồng thời) - phát hiện được khi viết
 * scripts/verify-multichain-sync.sh. Dùng advisory lock để chỉ 1 instance thực sự chạy
 * migration tại 1 thời điểm, các instance khác chờ rồi tiếp tục bình thường (schema đã
 * tồn tại, migration của chúng trở thành no-op an toàn).
 */
export async function runMigrations(): Promise<void> {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await client.query(sql);
      console.log(JSON.stringify({ level: "info", msg: "Database migrations applied", schemaPath }));
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
