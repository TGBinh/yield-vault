import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [MetricsController, HealthController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
