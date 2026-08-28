import { Body, Controller, Post } from '@nestjs/common';
import { RecommendationDto, PolicyVerdict } from './dto/recommendation.dto';
import { PolicyService } from './policy.service';

@Controller('policy')
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  @Post('evaluate')
  async evaluate(@Body() recommendation: RecommendationDto): Promise<PolicyVerdict> {
    return this.policy.evaluate(recommendation);
  }
}
