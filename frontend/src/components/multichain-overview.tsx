"use client";

import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVaultSummaryByChain } from "@/hooks/use-backend-positions";
import { formatTokenAmount } from "@/lib/format";

/**
 * GĐ5 - Multichain (read-only, chưa di chuyển vốn - xem PLAN.md GĐ5): mỗi chain chạy 1
 * Vault/StrategyManager độc lập, TVL hiển thị riêng từng chain, KHÔNG cộng gộp (không
 * chia sẻ thanh khoản). Chỉ hiện các chain mà indexer/backend thực sự đã ghi được dữ
 * liệu - chưa deploy lên chain nào khác thì panel này chỉ hiện đúng 1 dòng, không phải
 * lỗi hay dữ liệu thiếu.
 */
export function MultichainOverview({ usdcDecimals }: { usdcDecimals: number }) {
  const { data, isLoading, isError } = useVaultSummaryByChain();

  return (
    <Card className="animate-fade-up" style={{ animationDelay: "340ms" }}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Network className="size-4" />
          TVL by chain
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted">Loading...</p>}
        {isError && <p className="text-sm text-muted">Could not fetch per-chain summary.</p>}

        {data && data.length === 0 && (
          <p className="text-sm text-muted">No chain has indexed data yet.</p>
        )}

        {data && data.length > 0 && (
          <ul className="divide-y divide-border">
            {data.map((chain) => (
              <li key={chain.chainId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-mono text-xs text-muted">chainId {chain.chainId}</span>
                <span className="flex items-center gap-3 text-foreground">
                  <span>{formatTokenAmount(BigInt(chain.tvl), usdcDecimals)} mUSDC</span>
                  <span className="text-xs text-muted">
                    {chain.depositCount} deposits / {chain.withdrawalCount} withdrawals
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
