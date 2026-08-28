import type { Abi } from "viem";
import deployments from "@/lib/deployments.local.json";
import VaultArtifact from "@/lib/abis/Vault.json";
import MockUSDCArtifact from "@/lib/abis/MockUSDC.json";
import MockStrategyArtifact from "@/lib/abis/MockStrategy.json";

export const VAULT_ABI = VaultArtifact.abi as Abi;
export const MOCK_USDC_ABI = MockUSDCArtifact.abi as Abi;
export const MOCK_STRATEGY_ABI = MockStrategyArtifact.abi as Abi;

export const CONTRACTS = {
  usdc: deployments.contracts.usdc as `0x${string}`,
  vault: deployments.contracts.vault as `0x${string}`,
  strategy: deployments.contracts.strategy as `0x${string}`,
} as const;

export const EXPECTED_CHAIN_ID = deployments.chainId;

export const vaultContract = { address: CONTRACTS.vault, abi: VAULT_ABI } as const;
export const usdcContract = { address: CONTRACTS.usdc, abi: MOCK_USDC_ABI } as const;
