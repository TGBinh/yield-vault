import { config } from "./config";
import { closePool, runMigrations } from "./db/client";
import { Watcher } from "./watcher";
import { startMetricsServer } from "./metrics";

function log(msg: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: "info", msg, ...extra }));
}

async function main(): Promise<void> {
  log("Indexer starting", {
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    vaultAddress: config.vaultAddress,
    strategyManagerAddress: config.strategyManagerAddress,
  });

  await runMigrations();

  const metricsServer = startMetricsServer();

  const watcher = new Watcher();
  await watcher.start();

  const shutdown = async (signal: string): Promise<void> => {
    log("Shutdown signal received", { signal });
    watcher.stop();
    metricsServer.close();
    await closePool();
    log("Indexer stopped gracefully");
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((err) => {
  console.error(JSON.stringify({ level: "error", msg: "Indexer failed to start", error: String(err) }));
  process.exit(1);
});
