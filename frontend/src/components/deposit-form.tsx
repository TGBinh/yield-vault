"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { ArrowDownToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTx } from "@/hooks/use-tx";
import { usdcContract, vaultContract, CONTRACTS } from "@/lib/contracts";
import { formatTokenAmount, parseTokenAmount, toRawAmountString } from "@/lib/format";

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
  const [rawAmount, setRawAmount] = useState("");

  const amount = useMemo(() => {
    try {
      return rawAmount ? parseTokenAmount(rawAmount, usdcDecimals) : 0n;
    } catch {
      return null;
    }
  }, [rawAmount, usdcDecimals]);

  const { data: previewShares } = useReadContract({
    ...vaultContract,
    functionName: "convertToShares",
    args: [amount ?? 0n],
    query: { enabled: !!amount && amount > 0n },
  });

  const isValid = amount !== null && amount > 0n;
  const exceedsBalance = isValid && usdcBalance !== undefined && amount > usdcBalance;
  const needsApproval = isValid && (allowance === undefined || allowance < amount);

  const handleMax = () => {
    if (usdcBalance !== undefined) {
      setRawAmount(toRawAmountString(usdcBalance, usdcDecimals));
    }
  };

  const handleApprove = async () => {
    if (!isValid) return;
    const receipt = await run("Approve mUSDC", {
      ...usdcContract,
      functionName: "approve",
      args: [CONTRACTS.vault, amount],
    });
    if (receipt) onSuccess();
  };

  const handleDeposit = async () => {
    if (!isValid || !address) return;
    const receipt = await run("Deposit", {
      ...vaultContract,
      functionName: "deposit",
      args: [amount, address],
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
          <Label htmlFor="deposit-amount">Amount (mUSDC)</Label>
          <button
            type="button"
            onClick={handleMax}
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
        <Button onClick={handleApprove} disabled={!isValid || exceedsBalance || isPending}>
          Approve mUSDC
        </Button>
      ) : (
        <Button onClick={handleDeposit} disabled={!isValid || exceedsBalance || isPending}>
          <ArrowDownToLine />
          Deposit
        </Button>
      )}
    </div>
  );
}
