import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { PG_POOL } from '../database/database.constants';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { VaultSummaryDto } from './dto/vault-summary.dto';
import { MetricsService } from '../metrics/metrics.service';

const VAULT_SUMMARY_CACHE_KEY = 'vault:summary';
const VAULT_SUMMARY_CACHE_TTL_SECONDS = 15;

interface DepositAggregateRow {
  total_assets: string | null;
  total_shares: string | null;
  deposit_count: string;
}

interface WithdrawalAggregateRow {
  total_assets: string | null;
  total_shares: string | null;
  withdrawal_count: string;
}

@Injectable()
export class VaultService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly metrics: MetricsService,
  ) {}

  async getSummary(): Promise<VaultSummaryDto> {
    const cached = await this.redis.get(VAULT_SUMMARY_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached) as VaultSummaryDto;
    }

    const summary = await this.computeSummary();

    await this.redis.set(
      VAULT_SUMMARY_CACHE_KEY,
      JSON.stringify(summary),
      'EX',
      VAULT_SUMMARY_CACHE_TTL_SECONDS,
    );

    return summary;
  }

  private async computeSummary(): Promise<VaultSummaryDto> {
    const [depositResult, withdrawalResult] = await Promise.all([
      this.pool.query<DepositAggregateRow>(
        `SELECT
           COALESCE(SUM(assets), 0)::text AS total_assets,
           COALESCE(SUM(shares), 0)::text AS total_shares,
           COUNT(*)::text AS deposit_count
         FROM deposits
         WHERE confirmed = true`,
      ),
      this.pool.query<WithdrawalAggregateRow>(
        `SELECT
           COALESCE(SUM(assets), 0)::text AS total_assets,
           COALESCE(SUM(shares), 0)::text AS total_shares,
           COUNT(*)::text AS withdrawal_count
         FROM withdrawals
         WHERE confirmed = true`,
      ),
    ]);

    const totalDeposited = BigInt(depositResult.rows[0]?.total_assets ?? '0');
    const totalWithdrawn = BigInt(
      withdrawalResult.rows[0]?.total_assets ?? '0',
    );
    const depositShares = BigInt(depositResult.rows[0]?.total_shares ?? '0');
    const withdrawalShares = BigInt(
      withdrawalResult.rows[0]?.total_shares ?? '0',
    );

    const tvl = totalDeposited - totalWithdrawn;
    const totalShares = depositShares - withdrawalShares;

    const sharePrice =
      totalShares > 0n
        ? ((tvl * 10n ** 18n) / totalShares).toString()
        : null;

    const depositCount = Number(depositResult.rows[0]?.deposit_count ?? 0);
    const withdrawalCount = Number(
      withdrawalResult.rows[0]?.withdrawal_count ?? 0,
    );

    // Push straight from here (not a separate polling loop in MetricsService) - this is
    // the one place that already computes these values, no reason for a second query path.
    this.metrics.vaultTvl.set(Number(tvl));
    this.metrics.vaultTotalShares.set(Number(totalShares));
    this.metrics.vaultDepositCount.set(depositCount);
    this.metrics.vaultWithdrawalCount.set(withdrawalCount);

    return {
      totalDeposited: totalDeposited.toString(),
      totalWithdrawn: totalWithdrawn.toString(),
      tvl: tvl.toString(),
      totalShares: totalShares.toString(),
      sharePrice,
      depositCount,
      withdrawalCount,
    };
  }
}
