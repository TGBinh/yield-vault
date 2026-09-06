import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

const logger = new Logger('Bootstrap');
const DEFAULT_CORS_ORIGIN = 'http://localhost:3000';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Chỉ nhận request có payload đúng schema DTO, loại bỏ field thừa
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use(helmet());

  const configService = app.get(ConfigService);

  // Vault Security Audit: enableCors() không tham số = allow-list mọi origin, cho phép
  // bất kỳ trang web nào gọi API kèm credentials. Đọc whitelist cụ thể từ env thay vì
  // wildcard - default chỉ để local dev chạy được ngay, KHÔNG dùng default này ở production.
  const corsOrigins = configService
    .get<string>('CORS_ORIGIN', DEFAULT_CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  app.enableCors({ origin: corsOrigins });

  const port = configService.get<number>('PORT', 3001);

  await app.listen(port);
  logger.log(`Backend API listening on port ${port}`);
}

bootstrap().catch((err) => {
  logger.error('Fatal error during bootstrap', err);
  process.exit(1);
});
