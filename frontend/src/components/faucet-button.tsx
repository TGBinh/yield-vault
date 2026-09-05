"use client";

import { useAccount } from "wagmi";
import { Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTx } from "@/hooks/use-tx";
import { usdcContract } from "@/lib/contracts";
import { parseTokenAmount } from "@/lib/format";

const FAUCET_AMOUNT = "1000"; // 1,000 mUSDC per click

// Vault Security Audit - Medium: trước đây chỉ có 1 dòng chữ mô tả "never available in
// production" - không có gì trong CODE ngăn component này render nếu lỡ deploy lên
// mainnet. Gate bằng env var tường minh (do vận hành set lúc build cho từng môi trường)
// thay vì suy luận từ chainId - MockUSDC vẫn được deploy ở MỌI testnet (kể cả khi dùng
// AaveStrategy/MorphoStrategy thật cho phần strategy, xem contracts/scripts/deploy.ts),
// không riêng gì local Hardhat, nên không thể gate cứng theo 1 chainId cụ thể.
const FAUCET_ENABLED = process.env.NEXT_PUBLIC_ENABLE_FAUCET === "true";

export function FaucetButton({
  usdcDecimals,
  onSuccess,
}: {
  usdcDecimals: number;
  onSuccess: () => void;
}) {
  const { address } = useAccount();
  const { run, isPending } = useTx();

  if (!FAUCET_ENABLED) {
    return null;
  }

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
