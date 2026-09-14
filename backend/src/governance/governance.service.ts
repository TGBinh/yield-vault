import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import { GovernancePendingResponseDto, PendingProposalDto } from './dto/governance.dto';

interface GovernanceEventRow {
  event_name: string;
  payload: Record<string, unknown>;
  block_timestamp: string;
}

/// 1 "họ" event: tên event lúc queue (mang eta trong payload), và tên 2 event kết thúc
/// (executed/canceled - id đó không còn "đang chờ" nữa). Timelock nào cũng theo đúng 3
/// event này (RebalanceTimelock.sol/CrossChainTimelock.sol) nên dùng chung 1 hàm truy vấn.
interface ProposalEventFamily {
  kind: PendingProposalDto['kind'];
  queuedEvent: string;
  resolvedEvents: string[];
}

const REBALANCE_FAMILY: ProposalEventFamily = {
  kind: 'rebalance',
  queuedEvent: 'RebalanceQueued',
  resolvedEvents: ['RebalanceExecuted', 'RebalanceCanceled'],
};

const CROSS_CHAIN_FAMILY: ProposalEventFamily = {
  kind: 'cross-chain',
  queuedEvent: 'TransferQueued',
  resolvedEvents: ['TransferExecuted', 'TransferCanceled'],
};

@Injectable()
export class GovernanceService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /// Phase 3 (Governance page) - RebalanceTimelock.queuedRebalances/CrossChainTimelock.
  /// queuedTransfers là mapping KHÔNG enumerable (không có getter liệt kê mọi id đang
  /// chờ) - suy ra "đang chờ gì" bằng cách lấy mọi *Queued đã confirmed mà CHƯA có
  /// *Executed/*Canceled tương ứng cùng `id` (payload.id, do contract tự tính
  /// keccak256 - xem RebalanceTimelock.sol/CrossChainTimelock.sol `_transferId`/
  /// `_rebalanceId`).
  async getPending(): Promise<GovernancePendingResponseDto> {
    const [rebalance, crossChain] = await Promise.all([
      this.getPendingForFamily(REBALANCE_FAMILY),
      this.getPendingForFamily(CROSS_CHAIN_FAMILY),
    ]);
    return { proposals: [...rebalance, ...crossChain] };
  }

  private async getPendingForFamily(family: ProposalEventFamily): Promise<PendingProposalDto[]> {
    const result = await this.pool.query<GovernanceEventRow>(
      `SELECT event_name, payload, block_timestamp
       FROM governance_events
       WHERE confirmed = true AND event_name = $1
         AND payload->>'id' NOT IN (
           SELECT payload->>'id' FROM governance_events
           WHERE confirmed = true AND event_name = ANY($2)
         )
       ORDER BY block_number DESC`,
      [family.queuedEvent, family.resolvedEvents],
    );

    return result.rows.map((row) => ({
      kind: family.kind,
      id: (row.payload.id as string) ?? '',
      eta: etaToIso(row.payload.eta),
      queuedAt: row.block_timestamp,
      payload: row.payload,
    }));
  }
}

function etaToIso(eta: unknown): string {
  // Event args số nguyên đã được serialize thành string thập phân lúc index (xem
  // indexer/src/watcher.ts serializeValue) - eta là giây Unix (Solidity uint256).
  const seconds = Number(eta);
  return new Date(seconds * 1000).toISOString();
}
