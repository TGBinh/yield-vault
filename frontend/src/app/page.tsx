import { SiteHeader } from "@/components/site-header";
import { VaultDashboard } from "@/components/vault-dashboard";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Vault</h1>
          <p className="text-sm text-muted">
            Deposit mUSDC into the ERC-4626 vault to earn yield via the connected
            strategy, and redeem anytime — non-custodial, on-chain, no lockups.
          </p>
        </div>
        <VaultDashboard />
      </main>
    </div>
  );
}
