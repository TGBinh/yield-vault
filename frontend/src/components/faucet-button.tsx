"use client";

import { useAccount } from "wagmi";
import { Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTx } from "@/hooks/use-tx";
import { usdcContract } from "@/lib/contracts";
import { parseTokenAmount } from "@/lib/format";

const FAUCET_AMOUNT = "1000"; // 1,000 mUSDC per click

export function FaucetButton({
  usdcDecimals,
  onSuccess,
}: {
  usdcDecimals: number;
  onSuccess: () => void;
}) {
  const { address } = useAccount();
  const { run, isPending } = useTx();

  const handleFaucet = async () => {
    if (!address) return;
    const amount = parseTokenAmount(FAUCET_AMOUNT, usdcDecimals);
    const receipt = await run("Faucet mint", {
      ...usdcContract,
      functionName: "mint",
      args: [address, amount],
    });
    if (receipt) onSuccess();
  };

  return (
    <Button variant="subtle" size="sm" onClick={handleFaucet} disabled={!address || isPending}>
      <Droplets />
      Get {FAUCET_AMOUNT} test mUSDC
    </Button>
  );
}
