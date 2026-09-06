"use client";

import { useAccount, useReadContract } from "wagmi";
import { ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTx } from "@/hooks/use-tx";
import { useAmountInput } from "@/hooks/use-amount-input";
import { vaultContract } from "@/lib/contracts";
import { formatTokenAmount } from "@/lib/format";
import { applySlippageTolerance, makeDeadline } from "@/lib/slippage";

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
  const { rawAmount, setRawAmount, amount: shares, isValid, exceedsBalance, setMax, reset } =
    useAmountInput(shareDecimals, shareBalance);

  const { data: previewAssets } = useReadContract({
    ...vaultContract,
    functionName: "convertToAssets",
    args: [shares ?? 0n],
    query: { enabled: !!shares && shares > 0n },
  });

  const handleRedeem = async () => {
    if (!isValid || !address) return;
    if (previewAssets === undefined) return;

    // Vault Security Audit - High: `redeemWithMinAssets` tự check minOut/deadline ngay
    // on-chain trong cùng transaction (atomic) - không cần đọc lại giá thủ công ở
    // client nữa như trước, và không có khoảng hở thời gian giữa lần đọc cuối và lúc ký.
    const minAssets = applySlippageTolerance(previewAssets as bigint);
    const receipt = await run("Withdraw", {
      ...vaultContract,
      functionName: "redeemWithMinAssets",
      args: [shares, address, address, minAssets, makeDeadline()],
    });
    if (receipt) {
      reset();
      onSuccess();
    }
  };

  const disabled = !isValid || exceedsBalance || isPending;

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
