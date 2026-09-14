import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { VaultService } from './vault.service';
import {
  ChainVaultSummaryDto,
  VaultHistoryPointDto,
  VaultSummaryDto,
} from './dto/vault-summary.dto';

@Controller('vault')
export class VaultController {
  constructor(private readonly vaultService: VaultService) {}

  @Get('summary')
  async getSummary(): Promise<VaultSummaryDto> {
    return this.vaultService.getSummary();
  }

  @Get('summary-by-chain')
  async getSummaryByChain(): Promise<ChainVaultSummaryDto[]> {
    return this.vaultService.getSummaryByChain();
  }

  /// Phase 1 (dashboard performance chart). `from`/`to` là epoch millisecond, tuỳ chọn -
  /// không truyền thì trả toàn bộ lịch sử đã có.
  @Get('history')
  async getHistory(
    @Query('chainId') chainIdRaw: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ): Promise<VaultHistoryPointDto[]> {
    const chainId = Number(chainIdRaw);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new BadRequestException('chainId must be a positive integer');
    }

    const from = fromRaw !== undefined ? Number(fromRaw) : undefined;
    if (from !== undefined && !Number.isFinite(from)) {
      throw new BadRequestException('from must be a valid epoch millisecond number');
    }
    const to = toRaw !== undefined ? Number(toRaw) : undefined;
    if (to !== undefined && !Number.isFinite(to)) {
      throw new BadRequestException('to must be a valid epoch millisecond number');
    }

    return this.vaultService.getHistory(chainId, from, to);
  }
}
