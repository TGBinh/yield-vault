import { Controller, Get } from '@nestjs/common';
import { StrategiesService } from './strategies.service';
import { StrategiesResponseDto } from './dto/strategy-event.dto';

@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategiesService: StrategiesService) {}

  @Get()
  async getStrategies(): Promise<StrategiesResponseDto> {
    return this.strategiesService.getStrategies();
  }
}
