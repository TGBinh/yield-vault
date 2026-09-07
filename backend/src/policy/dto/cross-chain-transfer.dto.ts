import { IsBoolean, IsNumber, IsNumberString, IsString } from 'class-validator';

/// GD6 Milestone 6.2 - PLAN.md GD6 §4: "Mở rộng Policy Engine: thêm rule riêng cho
/// cross-chain (giới hạn % TVL được phép chuyển cross-chain/lần, cooldown giữa các lần
/// chuyển)". Đầu vào là output của risk-engine's `POST /cross-chain/evaluate` (đã có sẵn
/// từ GD5 - xem risk-engine/src/risk_engine/cross_chain.py `SwitchRecommendation`), CỘNG
/// với 2 con số StrategyManager/CrossChainTimelock cần để tính % TVL: amount đề xuất
/// chuyển và TVL hiện tại của vault nguồn.
///
/// Dùng string cho mọi số nguyên đơn vị nhỏ nhất (raw units) thay vì `number` - tránh mất
/// độ chính xác của JS number với số lớn (USDC 6 decimals vẫn an toàn ở TVL nhỏ, nhưng
/// nguyên tắc "không tin JS number cho tiền" đã áp dụng nhất quán trong toàn dự án).
export class CrossChainTransferRequestDto {
  @IsNumberString()
  amountRaw!: string;

  @IsNumberString()
  currentVaultTvlRaw!: string;

  @IsBoolean()
  shouldSwitch!: boolean;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  netBenefitUsd!: number;

  @IsString()
  destinationChainSelector!: string;
}

export interface CrossChainExecutionIntent {
  destinationChainSelector: string;
  amountRaw: string;
  approvedAt: string;
  expiresAt: string;
}

export interface CrossChainPolicyVerdict {
  approved: boolean;
  reason: string;
  executionIntent: CrossChainExecutionIntent | null;
}
