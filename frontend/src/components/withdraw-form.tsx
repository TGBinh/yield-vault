"use client";

import { useState } from "react";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { readContract } from "wagmi/actions";
import { ArrowUpFromLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTx } from "@/hooks/use-tx";
import { useAmountInput } from "@/hooks/use-amount-input";
import { vaultContract } from "@/lib/contracts";
import { formatTokenAmount } from "@/lib/format";
import { isWithinSlippageTolerance } from "@/lib/slippage";

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
  const config = useConfig();
  const { run, isPending } = useTx();
  const [isCheckingPrice, setIsCheckingPrice] = useState(false);
  const { rawAmount, setRawAmount, amount: shares, isValid, exceedsBalance, setMax, reset } =
    useAmountInput(shareDecimals, shareBalance);

  const { data: previewAssets, refetch: refetchPreviewAssets } = useReadContract({
    ...vaultContract,
    functionName: "convertToAssets",
    args: [shares ?? 0n],
    query: { enabled: !!shares && shares > 0n },
  });

  const handleRedeem = async () => {
    if (!isValid || !address) return;
    if (previewAssets === undefined) return;

    setIsCheckingPrice(true);
    try {
      // Không có minOut ở cấp contract (xem lib/slippage.ts) -> đọc lại convertToAssets
      // ngay trước khi ký để bắt trường hợp share price đã đổi kể từ lúc user xem preview.
      const freshAssets = (await readContract(config, {
        ...vaultContract,
        functionName: "convertToAssets",
        args: [shares],
      })) as bigint;

      if (!isWithinSlippageTolerance(previewAssets as bigint, freshAssets)) {
        toast.error("Share price changed since you last checked", {
          description: "Please review the updated amount below and confirm again.",
        });
        refetchPreviewAssets();
        return;
      }
    } finally {
      setIsCheckingPrice(false);
    }

    const receipt = await run("Withdraw", {
      ...vaultContract,
      functionName: "redeem",
      args: [shares, address, address],
    });
    if (receipt) {
      reset();
      onSuccess();
    }
  };

  const disabled = !isValid || exceedsBalance || isPending || isCheckingPrice;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="withdraw-amount">Amount (yvUSDC shares)</Label>
          <button
            type="button"
            onClick={setMax}
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

      <Button variant="outline" onClick={handleRedeem} disabled={disabled}>
        <ArrowUpFromLine />
        Withdraw
      </Button>
    </div>
  );
}
