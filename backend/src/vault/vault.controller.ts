import { Controller, Get } from '@nestjs/common';
import { VaultService } from './vault.service';
import { VaultSummaryDto } from './dto/vault-summary.dto';

@Controller('vault')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get('summary')
  async getSummary(): Promise<VaultSummaryDto> {
    return this.vaultService.getSummary();
  }
}
