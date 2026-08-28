import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import {
  DepositEntryDto,
  UserPositionsDto,
  WithdrawalEntryDto,
} from './dto/user-position.dto';

interface DepositRow {
  tx_hash: string;
  log_index: number;
  chain_id: number;
  block_number: string;
  block_timestamp: string;
  vault_address: string;
  assets: string;
  shares: string;
}

interface WithdrawalRow {
  tx_hash: string;
  log_index: number;
  chain_id: number;
  block_number: string;
  block_timestamp: string;
  vault_address: string;
  assets: string;
  shares: string;
}

@Injectable()
export class UserService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getPositions(userAddress: string): Promise<UserPositionsDto> {
    const [depositResult, withdrawalResult] = await Promise.all([
      this.pool.query<DepositRow>(
        `SELECT tx_hash, log_index, chain_id, block_number, block_timestamp,
                vault_address, assets, shares
         FROM deposits
         WHERE owner_address = $1 AND confirmed = true
         ORDER BY block_number DESC, log_index DESC`,
        [userAddress],
      ),
      this.pool.query<WithdrawalRow>(
        `SELECT tx_hash, log_index, chain_id, block_number, block_timestamp,
                vault_address, assets, shares
         FROM withdrawals
         WHERE owner_address = $1 AND confirmed = true
         ORDER BY block_number DESC, log_index DESC`,
        [userAddress],
      ),
    ]);

    const deposits: DepositEntryDto[] = depositResult.rows.map((row) => ({
      txHash: row.tx_hash,
      logIndex: row.log_index,
      chainId: row.chain_id,
      blockNumber: row.block_number.toString(),
      blockTimestamp: row.block_timestamp,
      vaultAddress: row.vault_address,
      assets: row.assets.toString(),
      shares: row.shares.toString(),
    }));

    const withdrawals: WithdrawalEntryDto[] = withdrawalResult.rows.map(
      (row) => ({
        txHash: row.tx_hash,
        logIndex: row.log_index,
        chainId: row.chain_id,
        blockNumber: row.block_number.toString(),
        blockTimestamp: row.block_timestamp,
        vaultAddress: row.vault_address,
        assets: row.assets.toString(),
        shares: row.shares.toString(),
      }),
    );

    const totalDeposited = deposits.reduce(
      (sum, entry) => sum + BigInt(entry.assets),
      0n,
    );
    const totalWithdrawn = withdrawals.reduce(
      (sum, entry) => sum + BigInt(entry.assets),
      0n,
    );
    const depositShares = deposits.reduce(
      (sum, entry) => sum + BigInt(entry.shares),
      0n,
    );
    const withdrawalShares = withdrawals.reduce(
      (sum, entry) => sum + BigInt(entry.shares),
      0n,
    );

    return {
      userAddress,
      totalDeposited: totalDeposited.toString(),
      totalWithdrawn: totalWithdrawn.toString(),
      netAssets: (totalDeposited - totalWithdrawn).toString(),
      netShares: (depositShares - withdrawalShares).toString(),
      deposits,
      withdrawals,
    };
  }
}
