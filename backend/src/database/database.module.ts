import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from './database.constants';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Pool => {
        // Vault Security Audit: không còn fallback localhost im lặng - ConfigModule đã
        // validate POSTGRES_URL bắt buộc ở env.validation.ts, thiếu biến này sẽ crash
        // ngay lúc boot thay vì lặng lẽ nối nhầm DB local.
        const connectionString = configService.getOrThrow<string>('POSTGRES_URL');
        return new Pool({ connectionString });
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
