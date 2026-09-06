import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

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
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
