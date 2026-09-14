import { Controller, Get } from '@nestjs/common';
import { StrategiesService } from './strategies.service';
import { ActiveAllocationRiskResponseDto, StrategiesResponseDto } from './dto/strategy-event.dto';

@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategiesService: StrategiesService) {}

  @Get()
  async getStrategies(): Promise<StrategiesResponseDto> {
    return this.strategiesService.getStrategies();
  }

  @Get('active-risk')
  async getActiveAllocationWithRisk(): Promise<ActiveAllocationRiskResponseDto> {
    return this.strategiesService.getActiveAllocationWithRisk();
  }
}
