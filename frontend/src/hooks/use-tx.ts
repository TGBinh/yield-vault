"use client";

import { useCallback, useState } from "react";
import { useConfig, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { toast } from "sonner";
import type { Abi } from "viem";
import { shortenAddress } from "@/lib/format";

type WriteArgs = {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
};

function parseErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const shortMessage = (error as { shortMessage?: string }).shortMessage;
    if (shortMessage) return shortMessage;
    const message = (error as { message?: string }).message;
    if (message) return message.split("\n")[0];
  }
  return "Transaction failed";
}

/**
 * Runs a single on-chain write with explicit pending/success/error toast
 * feedback, and returns the receipt on success (or null on failure/rejection).
 */
export function useTx() {
  const config = useConfig();
  const { writeContractAsync } = useWriteContract();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const run = useCallback(
    async (label: string, write: WriteArgs) => {
      setPendingLabel(label);
      const toastId = toast.loading(`${label} — confirm in wallet…`);
      try {
        const hash = await writeContractAsync(write);
        toast.loading(`${label} — waiting for confirmation`, {
          id: toastId,
          description: shortenAddress(hash, 6),
        });
        const receipt = await waitForTransactionReceipt(config, { hash });
        if (receipt.status === "reverted") {
          toast.error(`${label} reverted`, { id: toastId });
          return null;
        }
        toast.success(`${label} confirmed`, {
          id: toastId,
          description: shortenAddress(hash, 6),
        });
        return receipt;
      } catch (error) {
        toast.error(`${label} failed`, {
          id: toastId,
          description: parseErrorMessage(error),
        });
        return null;
      } finally {
        setPendingLabel(null);
      }
    },
    [config, writeContractAsync],
  );

  return { run, pendingLabel, isPending: pendingLabel !== null };
}
