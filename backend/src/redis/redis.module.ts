import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER_CLIENT } from './redis.constants';

const logger = new Logger('RedisModule');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        // Vault Security Audit: không còn fallback localhost im lặng - ConfigModule đã
        // validate REDIS_URL bắt buộc ở env.validation.ts, thiếu biến này sẽ crash ngay
        // lúc boot thay vì lặng lẽ nối nhầm Redis local.
        const redisUrl = configService.getOrThrow<string>('REDIS_URL');
        return new Redis(redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: 3,
        });
      },
    },
    {
      // Phase 4 (realtime notifications) - dùng bởi NotificationsGateway để subscribe
      // channel "vault:events" indexer publish vào. `maxRetriesPerRequest: null` (không
      // giới hạn) đúng khuyến nghị của ioredis cho connection ở chế độ subscribe - lệnh
      // subscribe() nên retry vô hạn khi mất kết nối tạm thời thay vì fail hẳn.
      provide: REDIS_SUBSCRIBER_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        const redisUrl = configService.getOrThrow<string>('REDIS_URL');
        const client = new Redis(redisUrl, {
          lazyConnect: false,
          maxRetriesPerRequest: null,
        });
        // Graceful degradation (đúng nguyên tắc đã áp dụng ở indexer/src/redis-publisher.ts):
        // 1 lần Redis rớt kết nối tạm thời không được phép crash toàn bộ backend - EventEmitter
        // của Node throw nếu 'error' bị emit mà không có listener nào.
        client.on('error', (err: Error) => {
          logger.warn(`Redis subscriber connection error: ${err.message}`);
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER_CLIENT],
})
export class RedisModule {}
