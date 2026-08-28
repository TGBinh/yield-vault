export class DepositEntryDto {
  txHash!: string;
  logIndex!: number;
  chainId!: number;
  blockNumber!: string;
  blockTimestamp!: string;
  vaultAddress!: string;
  assets!: string;
  shares!: string;
}

export class WithdrawalEntryDto {
  txHash!: string;
  logIndex!: number;
  chainId!: number;
  blockNumber!: string;
  blockTimestamp!: string;
  vaultAddress!: string;
  assets!: string;
  shares!: string;
}

export class UserPositionsDto {
  userAddress!: string;
  totalDeposited!: string;
  totalWithdrawn!: string;
  netAssets!: string;
  netShares!: string;
  deposits!: DepositEntryDto[];
  withdrawals!: WithdrawalEntryDto[];
}
