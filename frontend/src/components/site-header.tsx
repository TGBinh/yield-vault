"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { ConnectWallet } from "@/components/connect-wallet";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/governance", label: "Governance" },
];

function NavLinks({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex items-center gap-1", className)}>
      {NAV_LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteHeader() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          {/* Hamburger chỉ hiện dưới md - trên md trở lên nav chính hiển thị ngay cạnh logo. */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Mở menu điều hướng">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle>Điều hướng</SheetTitle>
              <NavLinks onNavigate={() => setMobileNavOpen(false)} className="flex-col items-stretch gap-1" />
            </SheetContent>
          </Sheet>

          <div className="flex size-8 items-center justify-center rounded-md bg-accent-soft">
            <span className="font-mono text-sm font-bold text-accent">Y</span>
          </div>
          <div className="hidden flex-col leading-none sm:flex">
            <span className="text-sm font-semibold">Yield Vault</span>
            <span className="text-[11px] text-muted">Phase 1 · Local testnet</span>
          </div>

          <NavLinks className="ml-2 hidden md:flex" />
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <ThemeToggle />
          <ConnectWallet />
        </div>
      </div>
    </header>
  );
}
