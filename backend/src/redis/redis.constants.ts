export const REDIS_CLIENT = 'REDIS_CLIENT';
// Phase 4 (realtime notifications) - ioredis bắt buộc 1 connection RIÊNG cho chế độ
// subscribe (client sau khi subscribe() không còn dùng được cho lệnh command thường như
// get/set/publish nữa) - KHÔNG dùng chung với REDIS_CLIENT ở trên.
export const REDIS_SUBSCRIBER_CLIENT = 'REDIS_SUBSCRIBER_CLIENT';
