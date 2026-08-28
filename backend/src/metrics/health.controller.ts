import { Controller, Get, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { PG_POOL } from '../database/database.constants';
import { REDIS_CLIENT } from '../redis/redis.constants';

/// PLAN.md GD3 §7: /health for every service - used by CI smoke tests and later by
/// production monitoring/alerting alike.
@Controller('health')
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check() {
    const [dbOk, redisOk] = await Promise.all([this.checkDb(), this.checkRedis()]);

    const healthy = dbOk && redisOk;
    const body = {
      status: healthy ? 'ok' : 'degraded',
      checks: {
        postgres: dbOk ? 'ok' : 'unreachable',
        redis: redisOk ? 'ok' : 'unreachable',
      },
    };

    if (!healthy) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return body;
  }

  private async checkDb(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}
