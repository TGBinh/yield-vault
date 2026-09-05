import type { NextConfig } from "next";
import deployments from "./src/lib/deployments.local.json";

// Vault Security Audit - High: dApp giữ tiền thật qua ví Web3 là mục tiêu số 1 của
// wallet-drainer injection (supply-chain qua npm dep, hoặc XSS bất kỳ đâu). Không CSP
// nghĩa là script lạ được nạp từ domain bất kỳ có thể thay đổi `to`/`data` của 1 giao
// dịch trước khi user ký. connect-src chỉ mở đúng backend + RPC node đang dùng - không
// mở rộng hơn mức cần thiết.
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:3001";
const rpcUrl = deployments.rpcUrl;
const isDev = process.env.NODE_ENV === "development";

// Next.js dev mode cần 'unsafe-eval'/'unsafe-inline' cho webpack HMR và dev overlay -
// áp CSP chặt (không có 2 nhánh này) chỉ ở production build, tránh phá local dev.
const scriptSrc = isDev ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" : "script-src 'self'";

const csp = [
  "default-src 'self'",
  scriptSrc,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  `connect-src 'self' ${backendUrl} ${rpcUrl}`,
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Avoid Next.js auto-generating AGENTS.md/CLAUDE.md in this workspace —
  // CLAUDE.md is reserved for the user's own project instructions.
  agentRules: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
