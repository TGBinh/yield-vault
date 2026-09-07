import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { RecommendationDto, PolicyVerdict } from './dto/recommendation.dto';
import { CrossChainTransferRequestDto, CrossChainPolicyVerdict } from './dto/cross-chain-transfer.dto';
import { PolicyService } from './policy.service';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';

@Controller('policy')
export class PolicyController {
  constructor(private readonly policy: PolicyService) {}

  /// Vault Security Audit - Critical C3: đây là route DUY NHẤT thực sự "chiếm" slot
  /// cooldown rebalance (claimSlot: true) - phải khoá bằng InternalApiKeyGuard, khác với
  /// GET /recommendations/latest vốn chỉ xem trước (không claim gì cả).
  @Post('evaluate')
  @UseGuards(InternalApiKeyGuard)
  async evaluate(@Body() recommendation: RecommendationDto): Promise<PolicyVerdict> {
    return this.policy.evaluate(recommendation, { claimSlot: true });
  }

  /// GD6 Milestone 6.2 - cùng nguyên tắc claimSlot: true với /evaluate ở trên, nhưng
  /// dùng cooldown/limit riêng cho cross-chain (xem PolicyService.evaluateCrossChainTransfer).
  /// Đây là bước duy nhất Keeper/Safe được phép gọi TRƯỚC khi
  /// CrossChainTimelock.queueTransfer() trên-chain.
  @Post('evaluate-cross-chain')
  @UseGuards(InternalApiKeyGuard)
  async evaluateCrossChain(
    @Body() request: CrossChainTransferRequestDto,
  ): Promise<CrossChainPolicyVerdict> {
    return this.policy.evaluateCrossChainTransfer(request, { claimSlot: true });
  }
}
