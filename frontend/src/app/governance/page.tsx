import { SiteHeader } from "@/components/site-header";
import { GovernancePanel } from "@/components/governance-panel";

export default function GovernancePage() {
  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="mb-8 flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight">Governance</h1>
          <p className="text-sm text-muted">
            Ai đang giữ quyền quản trị Vault, và những thay đổi nào đang chờ hết thời gian
            timelock trước khi có hiệu lực — minh bạch hoàn toàn, đọc trực tiếp on-chain.
          </p>
        </div>
        <GovernancePanel />
      </main>
    </div>
  );
}
