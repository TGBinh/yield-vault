export class VaultSummaryDto {
  totalDeposited!: string;
  totalWithdrawn!: string;
  tvl!: string;
  totalShares!: string;
  sharePrice!: string | null;
  depositCount!: number;
  withdrawalCount!: number;
}
