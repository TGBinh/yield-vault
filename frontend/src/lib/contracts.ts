import type { Abi } from "viem";
import deployments from "@/lib/deployments.local.json";
import VaultArtifact from "@/lib/abis/Vault.json";
import MockUSDCArtifact from "@/lib/abis/MockUSDC.json";
import MockStrategyArtifact from "@/lib/abis/MockStrategy.json";
import StrategyManagerArtifact from "@/lib/abis/StrategyManager.json";
import RebalanceTimelockArtifact from "@/lib/abis/RebalanceTimelock.json";
import CrossChainTimelockArtifact from "@/lib/abis/CrossChainTimelock.json";
import SafeMinimalArtifact from "@/lib/abis/SafeMinimal.json";

export const VAULT_ABI = VaultArtifact.abi as Abi;
export const MOCK_USDC_ABI = MockUSDCArtifact.abi as Abi;
export const MOCK_STRATEGY_ABI = MockStrategyArtifact.abi as Abi;
export const STRATEGY_MANAGER_ABI = StrategyManagerArtifact.abi as Abi;
export const REBALANCE_TIMELOCK_ABI = RebalanceTimelockArtifact.abi as Abi;
export const CROSS_CHAIN_TIMELOCK_ABI = CrossChainTimelockArtifact.abi as Abi;
export const SAFE_MINIMAL_ABI = SafeMinimalArtifact.abi as Abi;

// Governance §3: rebalanceTimelock/crossChainTimelock/safe có thể để trống ("") trên
// deployment chưa chạy tới GĐ3/GĐ6 - CONTRACTS chỉ ép kiểu `0x${string}` cho các địa chỉ
// LUÔN tồn tại (usdc/vault/strategyManager/strategy); 3 cái optional giữ nguyên string
// rỗng để component gọi tự kiểm tra thay vì crash lúc import.
export const CONTRACTS = {
  usdc: deployments.contracts.usdc as `0x${string}`,
  vault: deployments.contracts.vault as `0x${string}`,
  strategyManager: deployments.contracts.strategyManager as `0x${string}`,
  strategy: deployments.contracts.strategy as `0x${string}`,
  rebalanceTimelock: (deployments.contracts as { rebalanceTimelock?: string }).rebalanceTimelock ?? "",
  crossChainTimelock: (deployments.contracts as { crossChainTimelock?: string }).crossChainTimelock ?? "",
  safe: (deployments.contracts as { safe?: string }).safe ?? "",
} as const;

export const EXPECTED_CHAIN_ID = deployments.chainId;

export const vaultContract = { address: CONTRACTS.vault, abi: VAULT_ABI } as const;
export const usdcContract = { address: CONTRACTS.usdc, abi: MOCK_USDC_ABI } as const;
export const strategyManagerContract = {
  address: CONTRACTS.strategyManager,
  abi: STRATEGY_MANAGER_ABI,
} as const;
export const rebalanceTimelockContract = {
  address: CONTRACTS.rebalanceTimelock as `0x${string}`,
  abi: REBALANCE_TIMELOCK_ABI,
} as const;
export const crossChainTimelockContract = {
  address: CONTRACTS.crossChainTimelock as `0x${string}`,
  abi: CROSS_CHAIN_TIMELOCK_ABI,
} as const;
export const safeContract = { address: CONTRACTS.safe as `0x${string}`, abi: SAFE_MINIMAL_ABI } as const;
