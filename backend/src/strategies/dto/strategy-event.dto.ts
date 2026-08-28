export class StrategyEventDto {
  txHash!: string;
  logIndex!: number;
  chainId!: number;
  blockNumber!: string;
  blockTimestamp!: string;
  contractAddress!: string;
  eventName!: string;
  payload!: Record<string, unknown>;
  strategyAddress!: string | null;
}

export class StrategiesResponseDto {
  events!: StrategyEventDto[];
  activeStrategyAddress!: string | null;
}
