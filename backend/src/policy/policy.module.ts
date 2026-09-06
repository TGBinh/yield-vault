import { Module } from '@nestjs/common';
import { StrategiesModule } from '../strategies/strategies.module';
import { PolicyController } from './policy.controller';
import { PolicyService } from './policy.service';

@Module({
  imports: [StrategiesModule],
  controllers: [PolicyController],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
