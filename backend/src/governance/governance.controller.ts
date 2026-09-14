import { Controller, Get } from '@nestjs/common';
import { GovernanceService } from './governance.service';
import { GovernancePendingResponseDto } from './dto/governance.dto';

@Controller('governance')
export class GovernanceController {
  constructor(private readonly governanceService: GovernanceService) {}

  @Get('pending')
  async getPending(): Promise<GovernancePendingResponseDto> {
    return this.governanceService.getPending();
  }
}
