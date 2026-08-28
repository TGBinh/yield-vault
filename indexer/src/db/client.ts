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

/**
 * Apply schema.sql against the configured database.
 * The SQL file only uses CREATE TABLE/INDEX IF NOT EXISTS, so this is safe to run on every startup.
 */
export async function runMigrations(): Promise<void> {
  const schemaPath = path.join(__dirname, "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log(JSON.stringify({ level: "info", msg: "Database migrations applied", schemaPath }));
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
