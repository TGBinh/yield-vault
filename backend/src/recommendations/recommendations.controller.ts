import { Controller, Get } from '@nestjs/common';
import { RecommendationPipelineResult, RecommendationsService } from './recommendations.service';

@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Get('latest')
  async getLatest(): Promise<RecommendationPipelineResult> {
    return this.recommendations.getLatestRecommendation();
  }
}
