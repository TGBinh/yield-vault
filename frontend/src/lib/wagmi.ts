import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain } from "viem";
import deployments from "@/lib/deployments.local.json";

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
  connectors: [injected()],
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
