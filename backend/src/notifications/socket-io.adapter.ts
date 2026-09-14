import type { INestApplicationContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

/**
 * Phase 4 (realtime notifications): CORS cho socket.io PHẢI đọc qua ConfigService (sau khi
 * ConfigModule đã nạp .env xong), không đặt tĩnh trong `@WebSocketGateway({ cors: ... })` -
 * decorator của gateway chạy lúc class được require (trước khi ConfigModule.forRoot() thực
 * thi trong app.module.ts), nên process.env lúc đó có thể chưa có CORS_ORIGIN từ file .env.
 * Cùng allowlist với HTTP CORS ở main.ts (KHÔNG dùng wildcard - xem comment ở đó).
 */
export class SocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const corsOrigins = this.configService
      .get<string>('CORS_ORIGIN', DEFAULT_CORS_ORIGIN)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0);

    return super.createIOServer(port, {
      ...options,
      cors: { origin: corsOrigins },
    });
  }
}
