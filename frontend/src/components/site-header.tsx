import { ConnectWallet } from "@/components/connect-wallet";
import { ThemeToggle } from "@/components/theme-toggle";

export function SiteHeader() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-accent-soft">
            <span className="font-mono text-sm font-bold text-accent">Y</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold">Yield Vault</span>
            <span className="text-[11px] text-muted">Phase 1 · Local testnet</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
