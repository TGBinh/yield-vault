import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import deployments from "@/lib/deployments.local.json";
import { assertHttpsInProduction } from "@/lib/env-guard";

assertHttpsInProduction("RPC URL", deployments.rpcUrl);

export const hardhatLocal = defineChain({
  id: deployments.chainId,
  name: "Hardhat Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [deployments.rpcUrl] },
  },
  testnet: true,
});

export const wagmiConfig = createConfig({
  chains: [hardhatLocal],
  // Khi máy có nhiều ví extension cùng lúc (vd. Phantom + MetaMask), connector
  // `injected()` chung chung không phân biệt được nên tuỳ trình duyệt/thứ tự cài mà bắt
  // nhầm ví - Phantom hỗ trợ EVM chưa ổn định (đặc biệt với mạng custom như Hardhat local)
  // và có thể throw lỗi mơ hồ ("Unexpected error" tại evmAsk.js selectExtension) thay vì
  // hiện popup kết nối bình thường. Đăng ký RÕ RÀNG connector nhắm đúng MetaMask trước
  // (id "metaMask"), giữ lại `injected()` chung làm phương án dự phòng nếu máy không có
  // MetaMask - xem connect-wallet.tsx ưu tiên chọn connector theo đúng thứ tự này.
  connectors: [injected({ target: "metaMask" }), injected()],
  transports: {
    [hardhatLocal.id]: http(deployments.rpcUrl),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
