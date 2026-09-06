"use client";

import { useAccount, useReadContract } from "wagmi";
import { ArrowDownToLine, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTx } from "@/hooks/use-tx";
import { useAmountInput } from "@/hooks/use-amount-input";
import { usdcContract, vaultContract, CONTRACTS } from "@/lib/contracts";
import { formatTokenAmount } from "@/lib/format";
import { applySlippageTolerance, makeDeadline } from "@/lib/slippage";

export function DepositForm({
  usdcDecimals,
  shareDecimals,
  usdcBalance,
  allowance,
  onSuccess,
}: {
  usdcDecimals: number;
  shareDecimals: number;
  usdcBalance: bigint | undefined;
  allowance: bigint | undefined;
  onSuccess: () => void;
}) {
  const { address } = useAccount();
  const { run, isPending } = useTx();
  const { rawAmount, setRawAmount, amount, isValid, exceedsBalance, setMax, reset } =
    useAmountInput(usdcDecimals, usdcBalance);

  const { data: previewShares } = useReadContract({
    ...vaultContract,
    functionName: "convertToShares",
    args: [amount ?? 0n],
    query: { enabled: !!amount && amount > 0n },
  });

  // Vault Security Audit - Critical: Vault đọc `asset()` on-chain và so với địa chỉ
  // USDC đang cấu hình trong deployments - nếu deployments.local.json trỏ nhầm/lệch
  // vault thật sự triển khai (redeploy, copy nhầm file config), user sẽ approve/deposit
  // nhầm token vào 1 vault không quản lý token đó. Disable form thay vì cho qua.
  const { data: vaultAsset } = useReadContract({
    ...vaultContract,
    functionName: "asset",
  });
  const assetMismatch =
    vaultAsset !== undefined &&
    (vaultAsset as string).toLowerCase() !== CONTRACTS.usdc.toLowerCase();

  const needsApproval = isValid && amount !== null && (allowance === undefined || allowance < amount);

  const handleApprove = async () => {
    if (!isValid || assetMismatch) return;
    const receipt = await run("Approve mUSDC", {
      ...usdcContract,
      functionName: "approve",
      args: [CONTRACTS.vault, amount],
    });
    if (receipt) onSuccess();
  };

  const handleDeposit = async () => {
    if (!isValid || !address || assetMismatch) return;
    if (previewShares === undefined) return;

    // Vault Security Audit - High: `depositWithMinShares` tự check minOut/deadline ngay
    // on-chain trong cùng transaction (atomic) - không cần đọc lại giá thủ công ở
    // client nữa như trước, và không có khoảng hở thời gian giữa lần đọc cuối và lúc ký.
    const minShares = applySlippageTolerance(previewShares as bigint);
    const receipt = await run("Deposit", {
      ...vaultContract,
      functionName: "depositWithMinShares",
      args: [amount, address, minShares, makeDeadline()],
    });
    if (receipt) {
      reset();
      onSuccess();
    }
  };

  const disabled = !isValid || exceedsBalance || isPending || assetMismatch;

  return (
    <div className="flex flex-col gap-4">
      {assetMismatch && (
        <div className="flex items-start gap-2 rounded-md border border-negative-soft bg-negative-soft p-3 text-xs text-negative">
          <ShieldAlert className="size-4 shrink-0" />
          <p>
            The vault&apos;s underlying asset does not match the configured mUSDC address. Deposits are
            disabled until this is resolved.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="deposit-amount">Amount (mUSDC)</Label>
          <button
            type="button"
            onClick={setMax}
            className="text-xs font-medium text-accent hover:underline"
          >
            Balance: {formatTokenAmount(usdcBalance, usdcDecimals)} — Max
          </button>
        </div>
        <Input
          id="deposit-amount"
          inputMode="decimal"
          placeholder="0.00"
          value={rawAmount}
          onChange={(e) => setRawAmount(e.target.value)}
        />
        {exceedsBalance && (
          <p className="text-xs text-negative">Exceeds your mUSDC balance.</p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-md bg-surface-2 px-3.5 py-2.5 text-sm">
        <span className="text-muted">You will receive</span>
        <span className="font-mono tabular-nums">
          {isValid && previewShares !== undefined
            ? `${formatTokenAmount(previewShares as bigint, shareDecimals)} yvUSDC`
            : "—"}
        </span>
      </div>

      {needsApproval ? (
        <Button onClick={handleApprove} disabled={disabled}>
          Approve mUSDC
        </Button>
      ) : (
        <Button onClick={handleDeposit} disabled={disabled}>
          <ArrowDownToLine />
          Deposit
        </Button>
      )}
    </div>
  );
}
