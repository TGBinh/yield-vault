import http from "node:http";
import client from "prom-client";
import { config } from "./config";

/// PLAN.md GD3 §7: block lag (chỉ số quan trọng nhất cho indexer - nếu tăng liên tục
/// nghĩa là indexer đang tụt lại phía sau chain thật, ví dụ RPC lỗi/chậm) + số event đã
/// xử lý + số lỗi RPC. Chỉ dùng module `http` built-in, không thêm framework HTTP nặng
/// cho 2 endpoint đơn giản này.
export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const currentBlock = new client.Gauge({
  name: "yield_vault_indexer_current_block",
  help: "Latest block number observed on the watched chain",
  registers: [registry],
});

export const blockLag = new client.Gauge({
  name: "yield_vault_indexer_block_lag",
  help: "Blocks between chain head and the indexer's last scanned block (per contract, minimum reported)",
  registers: [registry],
});

export const eventsProcessedTotal = new client.Counter({
  name: "yield_vault_indexer_events_processed_total",
  help: "Total number of on-chain events successfully written to Postgres",
  labelNames: ["contract", "event_name"],
  registers: [registry],
});

export const rpcErrorsTotal = new client.Counter({
  name: "yield_vault_indexer_rpc_errors_total",
  help: "Total number of RPC call failures encountered while watching for events",
  registers: [registry],
});

export const reorgsDetectedTotal = new client.Counter({
  name: "yield_vault_indexer_reorgs_detected_total",
  help: "Total number of rows orphaned because their transaction was no longer found on-chain (reorg)",
  registers: [registry],
});

export function startMetricsServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === "/metrics") {
      registry
        .metrics()
        .then((body) => {
          res.writeHead(200, { "Content-Type": registry.contentType });
          res.end(body);
        })
        .catch((err: unknown) => {
          res.writeHead(500);
          res.end(String(err));
        });
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(config.metricsPort, () => {
    console.log(
      JSON.stringify({ level: "info", msg: "Metrics server listening", port: config.metricsPort }),
    );
  });

  return server;
}
