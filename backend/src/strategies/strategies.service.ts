import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../database/database.constants';
import {
  StrategiesResponseDto,
  StrategyEventDto,
} from './dto/strategy-event.dto';

interface StrategyEventRow {
  tx_hash: string;
  log_index: number;
  chain_id: number;
  block_number: string;
  block_timestamp: string;
  contract_address: string;
  event_name: string;
  payload: Record<string, unknown>;
}

const STRATEGY_REGISTERED_EVENT = 'StrategyRegistered';
const ACTIVE_STRATEGY_CHANGED_EVENT = 'ActiveStrategyChanged';

/**
 * Suy ra địa chỉ strategy liên quan từ payload JSONB, tuỳ theo tên event
 * (ABI arg names khác nhau giữa các loại event).
 */
function extractStrategyAddress(
  eventName: string,
  payload: Record<string, unknown>,
): string | null {
  if (eventName === STRATEGY_REGISTERED_EVENT) {
    return (payload?.strategy as string) ?? null;
  }
  if (eventName === ACTIVE_STRATEGY_CHANGED_EVENT) {
    return (payload?.current as string) ?? null;
  }
  return null;
}

@Injectable()
export class StrategiesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getStrategies(): Promise<StrategiesResponseDto> {
    const result = await this.pool.query<StrategyEventRow>(
      `SELECT tx_hash, log_index, chain_id, block_number, block_timestamp,
              contract_address, event_name, payload
       FROM strategy_events
       WHERE confirmed = true
       ORDER BY block_number DESC, log_index DESC`,
    );

    const events: StrategyEventDto[] = result.rows.map((row) => ({
      txHash: row.tx_hash,
      logIndex: row.log_index,
      chainId: row.chain_id,
      blockNumber: row.block_number.toString(),
      blockTimestamp: row.block_timestamp,
      contractAddress: row.contract_address,
      eventName: row.event_name,
      payload: row.payload,
      strategyAddress: extractStrategyAddress(row.event_name, row.payload),
    }));

    // Chiến lược đang active: ưu tiên event ActiveStrategyChanged mới nhất
    // (payload.current), nếu chưa từng đổi thì lấy strategy được register mới nhất.
    const latestActiveChange = events.find(
      (event) => event.eventName === ACTIVE_STRATEGY_CHANGED_EVENT,
    );
    const latestRegistered = events.find(
      (event) => event.eventName === STRATEGY_REGISTERED_EVENT,
    );

    const activeStrategyAddress =
      latestActiveChange?.strategyAddress ??
      latestRegistered?.strategyAddress ??
      null;

    return {
      events,
      activeStrategyAddress,
    };
  }
}
