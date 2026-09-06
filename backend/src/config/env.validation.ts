import * as Joi from 'joi';

// Vault Security Audit: DatabaseModule/RedisModule trước đây fallback im lặng về
// localhost khi thiếu env - nghĩa là 1 lỗi cấu hình deploy (quên set POSTGRES_URL/
// REDIS_URL) sẽ không crash mà lặng lẽ nối vào DB/Redis nội bộ sai (hoặc rớt kết nối
// khó hiểu). Fail-fast ngay lúc boot thay vì để lỗi trôi tới runtime.
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(3001),
  CORS_ORIGIN: Joi.string().default('http://localhost:3000'),
  POSTGRES_URL: Joi.string().uri().required(),
  REDIS_URL: Joi.string().uri().required(),
}).unknown(true);
