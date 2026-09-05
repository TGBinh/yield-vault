"use client";

import { useAccount, useChainId } from "wagmi";
import { Coins, Landmark, PiggyBank, Wallet } from "lucide-react";
import { StatCard } from "@/components/stat-card";
import { FaucetButton } from "@/components/faucet-button";
import { DepositForm } from "@/components/deposit-form";
import { WithdrawForm } from "@/components/withdraw-form";
import { TransactionHistory } from "@/components/transaction-history";
import { AiRecommendation } from "@/components/ai-recommendation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVaultData } from "@/hooks/use-vault-data";
import { formatTokenAmount } from "@/lib/format";
import { EXPECTED_CHAIN_ID } from "@/lib/contracts";

export function VaultDashboard() {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const {
    usdcDecimals,
    shareDecimals,
    usdcBalance,
    shareBalance,
    allowance,
    totalAssets,
    shareValueInAssets,
    refetchAll,
  } = useVaultData();

  const wrongNetwork = isConnected && chainId !== EXPECTED_CHAIN_ID;
  const disabled = !isConnected || wrongNetwork;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vault TVL"
          value={formatTokenAmount(totalAssets, usdcDecimals)}
          suffix="mUSDC"
          icon={<Landmark className="size-4" />}
          accent
          delay={0}
        />
        <StatCard
          label="Your mUSDC balance"
          value={formatTokenAmount(usdcBalance, usdcDecimals)}
          suffix="mUSDC"
          icon={<Wallet className="size-4" />}
          delay={60}
        />
        <StatCard
          label="Your shares"
          value={formatTokenAmount(shareBalance, shareDecimals)}
          suffix="yvUSDC"
          icon={<Coins className="size-4" />}
          delay={120}
        />
        <StatCard
          label="Your position value"
          value={formatTokenAmount(shareValueInAssets, usdcDecimals)}
          suffix="mUSDC"
          icon={<PiggyBank className="size-4" />}
          delay={180}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card className="animate-fade-up" style={{ animationDelay: "220ms" }}>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-foreground">
              Testnet faucet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-muted">
              Mint free mock USDC to try deposits and withdrawals. This faucet only
              exists on the local test network — never available in production.
            </p>
            <fieldset disabled={disabled} className="disabled:opacity-50">
              <FaucetButton usdcDecimals={usdcDecimals} onSuccess={refetchAll} />
            </fieldset>
          </CardContent>
        </Card>

        <Card className="animate-fade-up" style={{ animationDelay: "280ms" }}>
          <CardContent className="pt-5">
            <Tabs defaultValue="deposit">
              <TabsList className="w-full">
                <TabsTrigger value="deposit">Deposit</TabsTrigger>
                <TabsTrigger value="withdraw">Withdraw</TabsTrigger>
              </TabsList>
              <TabsContent value="deposit">
                <fieldset disabled={disabled} className="disabled:opacity-50">
                  <DepositForm
                    usdcDecimals={usdcDecimals}
                    shareDecimals={shareDecimals}
                    usdcBalance={usdcBalance}
                    allowance={allowance}
                    onSuccess={refetchAll}
                  />
                </fieldset>
              </TabsContent>
              <TabsContent value="withdraw">
                <fieldset disabled={disabled} className="disabled:opacity-50">
                  <WithdrawForm
                    usdcDecimals={usdcDecimals}
                    shareDecimals={shareDecimals}
                    shareBalance={shareBalance}
                    onSuccess={refetchAll}
                  />
                </fieldset>
              </TabsContent>
            </Tabs>
            {!isConnected && (
              <p className="mt-4 text-center text-xs text-muted">
                Connect your wallet to deposit or withdraw.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TransactionHistory usdcDecimals={usdcDecimals} />
        <AiRecommendation />
      </div>
    </div>
  );
}
