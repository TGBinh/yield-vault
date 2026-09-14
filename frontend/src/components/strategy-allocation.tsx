"use client";

import { PieChart } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useActiveAllocationRisk } from "@/hooks/use-backend-positions";
import { shortenAddress } from "@/lib/format";

/// Ngưỡng hiển thị màu risk score (0-100, cao hơn = an toàn hơn - xem
/// risk_engine/models.py RiskScore.composite_score). Chỉ là ngưỡng HIỂN THỊ, không phải
/// rule chặn giao dịch nào - Policy Engine mới là nơi gác cổng thật.
function riskBadgeVariant(score: number): "positive" | "accent" | "negative" {
  if (score >= 70) return "positive";
  if (score >= 40) return "accent";
  return "negative";
}

/**
 * Phase 2 dashboard panel: phân bổ THẬT đang chạy on-chain (không phải đề xuất - xem
 * AiRecommendation cho phần đề xuất) kèm điểm rủi ro risk-engine chấm. `riskScore`/
 * `expectedApy` có thể null trên deployment thật (xem comment ở
 * backend/src/strategies/strategies.service.ts getActiveAllocationWithRisk) - hiển thị
 * "—" thay vì giả vờ có số.
 */
export function StrategyAllocation() {
  const { data, isLoading, isError } = useActiveAllocationRisk();

  return (
    <Card className="animate-fade-up" style={{ animationDelay: "340ms" }}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
          <PieChart className="size-4" />
          Phân bổ chiến lược đang chạy
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-muted">Đang tải…</p>}
        {isError && <p className="text-sm text-muted">Không tải được phân bổ chiến lược.</p>}
        {data && data.strategies.length === 0 && (
          <p className="text-sm text-muted">Chưa có lần rebalance nào được ghi nhận.</p>
        )}

        {data && data.strategies.length > 0 && (
          <div className="space-y-3">
            {data.strategies.map((s) => {
              const percent = (s.weightBps / 100).toFixed(1);
              return (
                <div key={s.strategyId} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate font-mono text-xs text-muted">
                      {shortenAddress(s.strategyId, 6)}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {s.riskScore !== null ? (
                        <Badge variant={riskBadgeVariant(s.riskScore)}>risk {s.riskScore.toFixed(0)}/100</Badge>
                      ) : (
                        <Badge variant="default">risk —</Badge>
                      )}
                      <span className="tabular-nums font-medium text-foreground">{percent}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {data.asOf && (
              <p className="pt-1 text-[11px] text-muted">
                Cập nhật từ lần rebalance lúc {new Date(data.asOf).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
