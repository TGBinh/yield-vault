import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

/// PLAN.md GD3 §7 Observability: Prometheus metrics for TVL/APY/tx failure rate.
/// Gauges are pushed by whoever computes the underlying value (VaultService on every
/// summary recompute) rather than this service polling the DB itself - avoids a second,
/// redundant query path just for metrics.
@Injectable()
export class MetricsService {
  readonly registry: client.Registry;

  readonly vaultTvl: client.Gauge<string>;
  readonly vaultTotalShares: client.Gauge<string>;
  readonly vaultDepositCount: client.Gauge<string>;
  readonly vaultWithdrawalCount: client.Gauge<string>;
  readonly httpRequestDuration: client.Histogram<string>;
  readonly dbQueryErrorsTotal: client.Counter<string>;

  constructor() {
    this.registry = new client.Registry();
    client.collectDefaultMetrics({ register: this.registry });

    this.vaultTvl = new client.Gauge({
      name: 'yield_vault_tvl_base_units',
      help: 'Vault TVL in the underlying asset base units (e.g. USDC 6-decimal units)',
      registers: [this.registry],
    });

    this.vaultTotalShares = new client.Gauge({
      name: 'yield_vault_total_shares',
      help: 'Total outstanding vault shares',
      registers: [this.registry],
    });

    this.vaultDepositCount = new client.Gauge({
      name: 'yield_vault_deposit_count',
      help: 'Total number of confirmed deposits',
      registers: [this.registry],
    });

    this.vaultWithdrawalCount = new client.Gauge({
      name: 'yield_vault_withdrawal_count',
      help: 'Total number of confirmed withdrawals',
      registers: [this.registry],
    });

    this.httpRequestDuration = new client.Histogram({
      name: 'yield_vault_backend_http_request_duration_seconds',
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.dbQueryErrorsTotal = new client.Counter({
      name: 'yield_vault_backend_db_query_errors_total',
      help: 'Total number of failed Postgres queries',
      registers: [this.registry],
    });
  }
}
