import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { VaultModule } from './vault/vault.module';
import { UserModule } from './user/user.module';
import { StrategiesModule } from './strategies/strategies.module';
import { MetricsModule } from './metrics/metrics.module';
import { PolicyModule } from './policy/policy.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { GovernanceModule } from './governance/governance.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    DatabaseModule,
    RedisModule,
    MetricsModule,
    VaultModule,
    UserModule,
    StrategiesModule,
    PolicyModule,
    RecommendationsModule,
    GovernanceModule,
    NotificationsModule,
  ],
})
export class AppModule {}
