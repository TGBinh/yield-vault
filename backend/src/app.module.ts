import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { VaultModule } from './vault/vault.module';
import { UserModule } from './user/user.module';
import { StrategiesModule } from './strategies/strategies.module';
import { MetricsModule } from './metrics/metrics.module';
import { PolicyModule } from './policy/policy.module';
import { RecommendationsModule } from './recommendations/recommendations.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    DatabaseModule,
    RedisModule,
    MetricsModule,
    VaultModule,
    UserModule,
    StrategiesModule,
    PolicyModule,
    RecommendationsModule,
  ],
})
export class AppModule {}
