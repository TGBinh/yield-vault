"use client";

import { Bot, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLatestRecommendation } from "@/hooks/use-backend-positions";

// Vault Security Audit - Low: explanation/riskFlags là văn bản AI-generated, không có
// giới hạn độ dài (ai-engine lỗi/bị thao túng có thể trả về chuỗi khổng lồ làm phình
// layout) và không có nhãn cảnh báo cho user biết đây không phải dữ liệu đã xác thực
// tuyệt đối - quyết định thật vẫn nằm ở Policy Engine verdict hiển thị riêng bên dưới.
const MAX_AI_TEXT_LENGTH = 500;

function truncateAiText(text: string): string {
  if (text.length <= MAX_AI_TEXT_LENGTH) return text;
  return `${text.slice(0, MAX_AI_TEXT_LENGTH)}...`;
}

/**
 * Phase 4 dashboard panel: shows the full Risk/Optimization Engine -> AI Engine ->
 * Policy Engine chain and its verdict. The `explanation` text is display-only - what
 * actually gates anything is the Policy Engine's structured verdict shown separately,
 * never parsed from this text (see PLAN.md GD4 §3/§9).
 */
export function AiRecommendation() {
  const { data, isLoading, isError, error, refetch, isFetching } = useLatestRecommendation();

  return (
    <Card className="animate-fade-up" style={{ animationDelay: "400ms" }}>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Bot className="size-4" />
          AI Allocation Recommendation
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`size-3.5 ${isFetching ? "animate-spin" : ""}`} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-muted">Running Risk Engine -&gt; AI Engine -&gt; Policy Engine...</p>}

        {isError && (
          <p className="text-sm text-muted">
            Could not fetch a recommendation ({error instanceof Error ? error.message : "unknown error"}). The
            risk-engine/ai-engine services may not be running.
          </p>
        )}

        {data && (
          <>
            <div className="flex items-center gap-2">
              <Badge variant={data.recommendation.source === "ai" ? "accent" : "default"}>
                {data.recommendation.source === "ai" ? "AI-reviewed" : "Deterministic (AI unavailable)"}
              </Badge>
              <Badge variant="default">confidence {(data.recommendation.confidence * 100).toFixed(0)}%</Badge>
            </div>

            <ul className="divide-y divide-border">
              {data.recommendation.allocations.map((allocation) => (
                <li key={allocation.strategyId} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate font-mono text-xs text-muted">{allocation.strategyId}</span>
                  <span className="flex items-center gap-3 text-foreground">
                    <span>{(allocation.targetWeightBps / 100).toFixed(1)}%</span>
                    <span className="text-xs text-muted">risk {allocation.riskScore.toFixed(0)}/100</span>
                    <span className="text-xs text-muted">apy {(allocation.expectedApy * 100).toFixed(2)}%</span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="space-y-1">
              <p className="text-sm text-muted">{truncateAiText(data.recommendation.explanation)}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-muted/70">AI-generated - not verified</p>
            </div>

            {data.recommendation.riskFlags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.recommendation.riskFlags.map((flag) => (
                  <Badge key={flag} variant="negative">
                    {truncateAiText(flag)}
                  </Badge>
                ))}
              </div>
            )}

            <div
              className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                data.policyVerdict.approved
                  ? "border-positive-soft bg-positive-soft text-positive"
                  : "border-negative-soft bg-negative-soft text-negative"
              }`}
            >
              {data.policyVerdict.approved ? (
                <CheckCircle2 className="size-4 shrink-0" />
              ) : (
                <XCircle className="size-4 shrink-0" />
              )}
              <div>
                <p className="font-medium">
                  Policy Engine: {data.policyVerdict.approved ? "APPROVED" : "REJECTED"}
                </p>
                <p className="text-xs opacity-90">{data.policyVerdict.reason}</p>
              </div>
            </div>

            {data.policyVerdict.approved && data.policyVerdict.executionIntent && (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
                <ShieldAlert className="size-4 shrink-0" />
                <p>
                  Execution Intent created, valid until{" "}
                  {new Date(data.policyVerdict.executionIntent.expiresAt).toLocaleTimeString()} - a human still needs
                  to approve this before anything executes on-chain (GD4: no auto-execution yet).
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
