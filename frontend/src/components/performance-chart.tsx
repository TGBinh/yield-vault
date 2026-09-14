"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LineChart as LineChartIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useVaultHistory } from "@/hooks/use-backend-positions";
import { formatTokenAmount, formatRelativeTime } from "@/lib/format";
import { EXPECTED_CHAIN_ID } from "@/lib/contracts";

type Metric = "tvl" | "sharePrice";

/**
 * Phase 1 (dashboard performance chart) - vẽ chuỗi thời gian từ `vault_snapshots` (ghi
 * định kỳ bởi indexer, xem indexer/src/snapshot-writer.ts). KHÔNG vẽ được gì trước khi có
 * ít nhất 2 snapshot - trên deployment mới/local vừa deploy, danh sách rỗng là trạng thái
 * BÌNH THƯỜNG (chưa đủ thời gian), không phải lỗi - hiển thị đúng thông báo đó thay vì
 * chart trống gây hiểu nhầm.
 */
export function PerformanceChart({ usdcDecimals }: { usdcDecimals: number }) {
  const { data, isLoading, isError } = useVaultHistory(EXPECTED_CHAIN_ID);
  const [metric, setMetric] = useState<Metric>("tvl");

  const points = useMemo(() => {
    if (!data) return [];
    return data.map((point) => ({
      timestampMs: new Date(point.timestamp).getTime(),
      tvl: Number(formatTokenAmount(BigInt(point.tvl), usdcDecimals, { maxFractionDigits: 2 }).replace(/,/g, "")),
      sharePrice: point.sharePrice ? Number(point.sharePrice) / 1e18 : null,
    }));
  }, [data, usdcDecimals]);

  return (
    <Card className="animate-fade-up" style={{ animationDelay: "160ms" }}>
      <CardHeader className="flex-col items-start gap-2 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
          <LineChartIcon className="size-4" />
          Hiệu suất theo thời gian
        </CardTitle>
        <div className="flex gap-1">
          <Button
            variant={metric === "tvl" ? "subtle" : "ghost"}
            size="sm"
            onClick={() => setMetric("tvl")}
          >
            TVL
          </Button>
          <Button
            variant={metric === "sharePrice" ? "subtle" : "ghost"}
            size="sm"
            onClick={() => setMetric("sharePrice")}
          >
            Giá share
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted">Đang tải…</p>}
        {isError && <p className="text-sm text-muted">Không tải được lịch sử hiệu suất.</p>}
        {data && points.length < 2 && (
          <p className="text-sm text-muted">
            Chưa đủ dữ liệu để vẽ biểu đồ — indexer chụp 1 mẫu mỗi{" "}
            <code className="font-mono text-xs">SNAPSHOT_INTERVAL_MS</code>, quay lại sau.
          </p>
        )}
        {points.length >= 2 && (
          <div className="h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="timestampMs"
                  tickFormatter={(v: number) => formatRelativeTime(v)}
                  tick={{ fontSize: 11, fill: "var(--color-muted)" }}
                  axisLine={{ stroke: "var(--color-border)" }}
                  tickLine={false}
                  minTickGap={40}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--color-muted)" }}
                  axisLine={false}
                  tickLine={false}
                  width={48}
                  domain={["auto", "auto"]}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  labelFormatter={(v) => (typeof v === "number" ? new Date(v).toLocaleString() : "")}
                  formatter={(value) => {
                    const n = typeof value === "number" ? value : Number(value);
                    return [
                      metric === "tvl" ? `${n.toLocaleString()} mUSDC` : n.toFixed(4),
                      metric === "tvl" ? "TVL" : "Giá share",
                    ] as [string, string];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey={metric}
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  fill="url(#perf-fill)"
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
