/// Phase 3 (Governance page) - RebalanceTimelock/CrossChainTimelock KHÔNG có getter liệt
/// kê "đang chờ gì" (mapping không enumerable) - suy ra từ event log đã index
/// (governance_events), xem GovernanceService.getPending().
export class PendingProposalDto {
  kind!: 'rebalance' | 'cross-chain';
  id!: string;
  /// ISO timestamp - khi nào có thể executeRebalance()/executeTransfer() (permissionless).
  eta!: string;
  queuedAt!: string;
  payload!: Record<string, unknown>;
}

export class GovernancePendingResponseDto {
  proposals!: PendingProposalDto[];
}
