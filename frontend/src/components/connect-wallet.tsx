"use client";

import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { AlertTriangle, Wallet, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { shortenAddress } from "@/lib/format";
import { EXPECTED_CHAIN_ID } from "@/lib/contracts";
import { hardhatLocal } from "@/lib/wagmi";

export function ConnectWallet() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const injectedConnector = connectors.find((c) => c.id === "injected") ?? connectors[0];
  const wrongNetwork = isConnected && chainId !== EXPECTED_CHAIN_ID;

  if (!isConnected) {
    return (
      <Button
        onClick={() => injectedConnector && connect({ connector: injectedConnector })}
        disabled={isPending || !injectedConnector}
      >
        <Wallet />
        {isPending ? "Connecting…" : "Connect Wallet"}
      </Button>
    );
  }

  if (wrongNetwork) {
    return (
      <Button
        variant="destructive"
        className="animate-pulse-ring"
        onClick={() => switchChain({ chainId: hardhatLocal.id })}
        disabled={isSwitching}
      >
        <AlertTriangle />
        {isSwitching ? "Switching…" : "Wrong network — switch to Localhost 31337"}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge variant="positive" className="hidden sm:inline-flex">
        <span className="size-1.5 rounded-full bg-positive" />
        Localhost 31337
      </Badge>
      <Button variant="outline" onClick={() => disconnect()} className="font-mono">
        {shortenAddress(address)}
        <LogOut className="opacity-50" />
      </Button>
    </div>
  );
}
