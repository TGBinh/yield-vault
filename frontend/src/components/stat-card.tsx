import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  suffix,
  icon,
  accent = false,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  suffix?: string;
  icon?: ReactNode;
  accent?: boolean;
  delay?: number;
}) {
  return (
    <Card
      className="animate-fade-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <CardContent className="pt-4 sm:pt-5">
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted sm:text-xs">
            {label}
          </span>
          {icon && (
            <span className={cn("text-muted", accent && "text-accent")}>{icon}</span>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span
            className={cn(
              "font-mono text-xl font-semibold tabular-nums tracking-tight sm:text-2xl",
              accent && "text-accent",
            )}
          >
            {value}
          </span>
          {suffix && <span className="text-xs font-medium text-muted sm:text-sm">{suffix}</span>}
        </div>
      </CardContent>
    </Card>
  );
}
