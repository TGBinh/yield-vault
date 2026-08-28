"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTx } from "@/hooks/use-tx";
import { vaultContract } from "@/lib/contracts";
import { formatTokenAmount, parseTokenAmount } from "@/lib/format";

export function WithdrawForm({
  usdcDecimals,
  shareDecimals,
  shareBalance,
  onSuccess,
}: {
  usdcDecimals: number;
  shareDecimals: number;
  shareBalance: bigint | undefined;
  onSuccess: () => void;
}) {
  const { address } = useAccount();
  const { run, isPending } = useTx();
  const [rawAmount, setRawAmount] = useState("");

  const shares = useMemo(() => {
    try {
      return rawAmount ? parseTokenAmount(rawAmount, shareDecimals) : 0n;
    } catch {
      return null;
    }
  }, [rawAmount, shareDecimals]);

  const { data: previewAssets } = useReadContract({
    ...vaultContract,
    functionName: "convertToAssets",
    args: [shares ?? 0n],
    query: { enabled: !!shares && shares > 0n },
  });

  const isValid = shares !== null && shares > 0n;
  const exceedsBalance = isValid && shareBalance !== undefined && shares > shareBalance;

  const handleMax = () => {
    if (shareBalance !== undefined) {
      setRawAmount(formatTokenAmount(shareBalance, shareDecimals, { maxFractionDigits: shareDecimals }));
    }
  };

  const handleRedeem = async () => {
    if (!isValid || !address) return;
    const receipt = await run("Withdraw", {
      ...vaultContract,
      functionName: "redeem",
      args: [shares, address, address],
    });
    if (receipt) {
      setRawAmount("");
      onSuccess();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="withdraw-amount">Amount (yvUSDC shares)</Label>
          <button
            type="button"
            onClick={handleMax}
            className="text-xs font-medium text-accent hover:underline"
          >
            Balance: {formatTokenAmount(shareBalance, shareDecimals)} — Max
          </button>
        </div>
        <Input
          id="withdraw-amount"
          inputMode="decimal"
          placeholder="0.00"
          value={rawAmount}
          onChange={(e) => setRawAmount(e.target.value)}
        />
        {exceedsBalance && (
          <p className="text-xs text-negative">Exceeds your yvUSDC balance.</p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-md bg-surface-2 px-3.5 py-2.5 text-sm">
        <span className="text-muted">You will receive</span>
        <span className="font-mono tabular-nums">
          {isValid && previewAssets !== undefined
            ? `${formatTokenAmount(previewAssets as bigint, usdcDecimals)} mUSDC`
            : "—"}
        </span>
      </div>

      <Button
        variant="outline"
        onClick={handleRedeem}
        disabled={!isValid || exceedsBalance || isPending}
      >
        <ArrowUpFromLine />
        Withdraw
      </Button>
    </div>
  );
}
