export class VaultSummaryDto {
  totalDeposited!: string;
  totalWithdrawn!: string;
  tvl!: string;
  totalShares!: string;
  sharePrice!: string | null;
  depositCount!: number;
  withdrawalCount!: number;
}

/// Phase 5 (GD5): mỗi vault instance chạy trên 1 chain riêng (kiến trúc nhân bản theo
/// chain, xem PLAN.md GD5 §5) - đây là TVL của TỪNG chain, không phải tổng gộp giữa các
/// chain (gộp lại là sai vì mỗi chain có 1 Vault/StrategyManager độc lập, không chia sẻ
/// thanh khoản với nhau ở giai đoạn này).
export class ChainVaultSummaryDto {
  chainId!: number;
  tvl!: string;
  totalShares!: string;
  depositCount!: number;
  withdrawalCount!: number;
}
