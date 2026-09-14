"use client";

import { useReadContracts } from "wagmi";
import { safeContract, CONTRACTS } from "@/lib/contracts";

/**
 * Phase 3 (Governance page) - đọc TRỰC TIẾP on-chain (getOwners()/getThreshold()), KHÔNG
 * qua backend/indexer - dữ liệu Safe ít đổi, cùng nguyên tắc "đọc live" đã dùng ở
 * useVaultData. KHÔNG gate theo `!!address` như useVaultData - đây là dữ liệu công khai,
 * xem được cả khi chưa kết nối ví (đúng tinh thần "minh bạch" của trang Governance).
 *
 * `CONTRACTS.safe` rỗng ("") nghĩa là deployment này chưa cấu hình Safe thật (local mặc
 * định GOVERNANCE_MULTISIG_ADDRESS trống -> deployer EOA làm proposer) - hook trả
 * `configured: false` thay vì gọi contract vào địa chỉ rỗng.
 */
export function useSafeInfo() {
  const configured = CONTRACTS.safe.length > 0;

  const { data, isLoading, isError } = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...safeContract, functionName: "getOwners" },
      { ...safeContract, functionName: "getThreshold" },
    ],
    query: {
      enabled: configured,
    },
  });

  const [owners, threshold] = (data ?? []) as [readonly `0x${string}`[] | undefined, bigint | undefined];

  return {
    configured,
    owners,
    threshold: threshold !== undefined ? Number(threshold) : undefined,
    isLoading: configured && isLoading,
    isError,
  };
}
