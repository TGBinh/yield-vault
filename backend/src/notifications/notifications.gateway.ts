import { Inject, Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type Redis from 'ioredis';
import { REDIS_SUBSCRIBER_CLIENT } from '../redis/redis.constants';

const VAULT_EVENTS_CHANNEL = 'vault:events';

// Indexer publish `type` = tên bảng Postgres (xem indexer/src/redis-publisher.ts) - đổi
// sang tên event ngắn gọn hơn cho phía client, KHÔNG rò rỉ chi tiết schema DB nội bộ ra
// tên event public.
const EVENT_NAME_BY_TABLE: Record<string, string> = {
  deposits: 'deposit',
  withdrawals: 'withdrawal',
  strategy_events: 'strategy-event',
  governance_events: 'governance-event',
};

/**
 * Phase 4 (realtime notifications): relay Redis Pub/Sub -> Socket.IO, không chứa business
 * logic nào khác ngoài relay. Indexer publish ĐÚNG 1 LẦN, tại thời điểm 1 row đạt
 * CONFIRMED (không phải lúc thấy log lần đầu) - tránh push thông báo cho 1 giao dịch sau
 * đó bị reorg loại bỏ. CORS cho namespace socket.io này cấu hình tập trung ở
 * socket-io.adapter.ts (đọc CORS_ORIGIN qua ConfigService, KHÔNG đặt tĩnh trong decorator
 * @WebSocketGateway - decorator chạy trước khi ConfigModule nạp .env xong).
 */
@WebSocketGateway()
export class NotificationsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(@Inject(REDIS_SUBSCRIBER_CLIENT) private readonly subscriber: Redis) {}

  async afterInit(): Promise<void> {
    await this.subscriber.subscribe(VAULT_EVENTS_CHANNEL);
    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel !== VAULT_EVENTS_CHANNEL) return;
      this.relay(message);
    });
    this.logger.log(`Subscribed to Redis channel "${VAULT_EVENTS_CHANNEL}"`);
  }

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  private relay(message: string): void {
    let parsed: { type?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(message) as { type?: string } & Record<string, unknown>;
    } catch {
      this.logger.warn('Received non-JSON message on vault:events channel, ignoring');
      return;
    }

    const table = typeof parsed.type === 'string' ? parsed.type : undefined;
    const eventName = (table && EVENT_NAME_BY_TABLE[table]) ?? 'vault-event';
    this.server.emit(eventName, parsed);
  }
}
