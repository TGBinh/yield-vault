"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Clock3 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useSafeInfo } from "@/hooks/use-safe-info";
import { useGovernancePending } from "@/hooks/use-backend-positions";
import { formatDuration, shortenAddress } from "@/lib/format";
import type { PendingProposal } from "@/lib/backend";

function kindLabel(kind: PendingProposal["kind"]): string {
  return kind === "rebalance" ? "Rebalance" : "Cross-chain transfer";
}

/** Đếm ngược tới `eta` - tick mỗi giây để cập nhật UI, không tick khi đã qua hạn. */
function useCountdown(etaIso: string): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const etaMs = new Date(etaIso).getTime();
    if (now >= etaMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [etaIso, now]);

  return Math.max(0, (new Date(etaIso).getTime() - now) / 1000);
}

function PendingProposalRow({ proposal }: { proposal: PendingProposal }) {
  const remainingSeconds = useCountdown(proposal.eta);
  const executable = remainingSeconds <= 0;

  return (
    <div className="space-y-1.5 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="flex items-center gap-2 font-medium text-foreground">
          <Clock3 className="size-3.5 text-muted" />
          {kindLabel(proposal.kind)}
        </span>
        {executable ? (
          <Badge variant="positive">Có thể thực thi</Badge>
        ) : (
          <Badge variant="accent">còn {formatDuration(remainingSeconds)}</Badge>
        )}
      </div>
      <p className="truncate font-mono text-xs text-muted">{shortenAddress(proposal.id, 6)}</p>
    </div>
  );
}

/**
 * Phase 3 (Governance page): card "Safe multisig" (đọc trực tiếp on-chain qua useSafeInfo)
 * + card "Đề xuất đang chờ" (từ indexer/backend qua useGovernancePending, vì mapping trên
 * timelock contract không enumerable - phải suy ra từ event log).
 */
export function GovernancePanel() {
  const safe = useSafeInfo();
  const { data: pending, isLoading: pendingLoading, isError: pendingError } = useGovernancePending();

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="animate-fade-up">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
            <ShieldCheck className="size-4" />
            Safe multisig
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!safe.configured && (
            <p className="text-sm text-muted">
              Chưa cấu hình Safe — admin hiện là 1 EOA (chỉ dev/local).
            </p>
          )}
          {safe.configured && safe.isLoading && <p className="text-sm text-muted">Đang tải…</p>}
          {safe.configured && safe.isError && (
            <p className="text-sm text-muted">Không đọc được thông tin Safe.</p>
          )}
          {safe.configured && !safe.isLoading && !safe.isError && safe.owners && safe.threshold !== undefined && (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                Ngưỡng ký:{" "}
                <span className="font-medium">
                  {safe.threshold}/{safe.owners.length}
                </span>
              </p>
              <ul className="space-y-1">
                {safe.owners.map((owner) => (
                  <li key={owner} className="truncate font-mono text-xs text-muted">
                    {shortenAddress(owner, 6)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="animate-fade-up" style={{ animationDelay: "120ms" }}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Clock3 className="size-4" />
            Đề xuất đang chờ
          </CardTitle>
        </CardHeader>
        <CardContent>
          {pendingLoading && <p className="text-sm text-muted">Đang tải…</p>}
          {pendingError && <p className="text-sm text-muted">Không tải được danh sách đề xuất.</p>}
          {pending && pending.proposals.length === 0 && (
            <p className="text-sm text-muted">Không có đề xuất nào đang chờ.</p>
          )}
          {pending && pending.proposals.length > 0 && (
            <div className="space-y-2">
              {pending.proposals.map((proposal) => (
                <PendingProposalRow key={`${proposal.kind}-${proposal.id}`} proposal={proposal} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
