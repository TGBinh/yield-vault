import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { PG_POOL } from '../database/database.constants';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ChainVaultSummaryDto, VaultSummaryDto } from './dto/vault-summary.dto';
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

interface ChainAggregateRow {
  chain_id: number;
  deposit_assets: string | null;
  deposit_shares: string | null;
  deposit_count: string;
  withdrawal_assets: string | null;
  withdrawal_shares: string | null;
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

  /// Phase 5 (GD5): TVL theo TỪNG chain riêng biệt - phục vụ dashboard "≥2 chain đồng
  /// thời" (PLAN.md GD5 §6). FULL OUTER JOIN vì 1 chain có thể chỉ có deposit chưa có
  /// withdraw nào (hoặc ngược lại) - INNER JOIN sẽ bỏ sót chain đó.
  async getSummaryByChain(): Promise<ChainVaultSummaryDto[]> {
    const result = await this.pool.query<ChainAggregateRow>(
      `WITH deposit_agg AS (
         SELECT chain_id, SUM(assets) AS deposit_assets, SUM(shares) AS deposit_shares, COUNT(*) AS deposit_count
         FROM deposits WHERE confirmed = true GROUP BY chain_id
       ),
       withdrawal_agg AS (
         SELECT chain_id, SUM(assets) AS withdrawal_assets, SUM(shares) AS withdrawal_shares, COUNT(*) AS withdrawal_count
         FROM withdrawals WHERE confirmed = true GROUP BY chain_id
       )
       SELECT
         COALESCE(d.chain_id, w.chain_id) AS chain_id,
         COALESCE(d.deposit_assets, 0)::text AS deposit_assets,
         COALESCE(d.deposit_shares, 0)::text AS deposit_shares,
         COALESCE(d.deposit_count, 0)::text AS deposit_count,
         COALESCE(w.withdrawal_assets, 0)::text AS withdrawal_assets,
         COALESCE(w.withdrawal_shares, 0)::text AS withdrawal_shares,
         COALESCE(w.withdrawal_count, 0)::text AS withdrawal_count
       FROM deposit_agg d
       FULL OUTER JOIN withdrawal_agg w ON d.chain_id = w.chain_id
       ORDER BY chain_id`,
    );

    return result.rows.map((row) => {
      const tvl = BigInt(row.deposit_assets ?? '0') - BigInt(row.withdrawal_assets ?? '0');
      const totalShares = BigInt(row.deposit_shares ?? '0') - BigInt(row.withdrawal_shares ?? '0');
      return {
        chainId: row.chain_id,
        tvl: tvl.toString(),
        totalShares: totalShares.toString(),
        depositCount: Number(row.deposit_count),
        withdrawalCount: Number(row.withdrawal_count),
      };
    });
  }
}
