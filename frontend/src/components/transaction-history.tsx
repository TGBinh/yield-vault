"use client";

import { ArrowDownLeft, ArrowUpRight, History } from "lucide-react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useUserPositionsFromBackend } from "@/hooks/use-backend-positions";
import { formatTokenAmount } from "@/lib/format";

type Row = {
  key: string;
  kind: "deposit" | "withdraw";
  assets: bigint;
  blockTimestamp: string;
  txHash: string;
};

export function TransactionHistory({ usdcDecimals }: { usdcDecimals: number }) {
  const { address } = useAccount();
  const { data, isLoading, isError } = useUserPositionsFromBackend(address);

  const rows: Row[] = data
    ? [
        ...data.deposits.map((d) => ({
          key: `${d.txHash}-${d.logIndex}`,
          kind: "deposit" as const,
          assets: BigInt(d.assets),
          blockTimestamp: d.blockTimestamp,
          txHash: d.txHash,
        })),
        ...data.withdrawals.map((w) => ({
          key: `${w.txHash}-${w.logIndex}`,
          kind: "withdraw" as const,
          assets: BigInt(w.assets),
          blockTimestamp: w.blockTimestamp,
          txHash: w.txHash,
        })),
      ].sort((a, b) => new Date(b.blockTimestamp).getTime() - new Date(a.blockTimestamp).getTime())
    : [];

  return (
    <Card className="animate-fade-up" style={{ animationDelay: "340ms" }}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
          <History className="size-4" />
          Transaction history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!address && (
          <p className="text-sm text-muted">Connect your wallet to see your history.</p>
        )}
        {address && isLoading && (
          <p className="text-sm text-muted">Loading history…</p>
        )}
        {address && isError && (
          <p className="text-sm text-muted">
            Backend API unreachable - indexed history is unavailable right now.
          </p>
        )}
        {address && !isLoading && !isError && rows.length === 0 && (
          <p className="text-sm text-muted">No confirmed deposits or withdrawals yet.</p>
        )}
        {rows.length > 0 && (
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center justify-between gap-3 py-3">
                <div className="flex items-center gap-3">
                  <Badge variant={row.kind === "deposit" ? "positive" : "negative"}>
                    {row.kind === "deposit" ? (
                      <ArrowDownLeft className="size-3" />
                    ) : (
                      <ArrowUpRight className="size-3" />
                    )}
                    {row.kind === "deposit" ? "Deposit" : "Withdraw"}
                  </Badge>
                  <span className="text-xs text-muted">
                    {new Date(row.blockTimestamp).toLocaleString()}
                  </span>
                </div>
                <span className="text-sm font-medium text-foreground">
                  {formatTokenAmount(row.assets, usdcDecimals)} mUSDC
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
