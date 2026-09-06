import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-foundry";
import { HardhatUserConfig } from "hardhat/config";
import * as dotenv from "dotenv";

dotenv.config();

const ARBITRUM_SEPOLIA_RPC_URL =
  process.env.ARBITRUM_SEPOLIA_RPC_URL ?? "";
// GĐ5 - Multichain: chain thứ 2 theo đề xuất của PLAN.md (Base Sepolia) - deploy lại
// đúng bộ contract (Vault/StrategyManager/Strategy) không đổi gì, chỉ khác network.
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL ?? "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    arbitrumSepolia: {
      url: ARBITRUM_SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 421614,
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 84532,
    },
    // GĐ5 - Multichain: dùng để MÔ PHỎNG chain thứ 2 hoàn toàn cục bộ khi chưa có
    // RPC/ví testnet thật cho Base Sepolia - chạy `npx hardhat node --port 8546` song
    // song với node mặc định ở 8545 (`localhost` built-in), deploy vào đây, rồi trỏ 1
    // indexer instance riêng với CHAIN_ID giả lập khác (indexer không verify CHAIN_ID
    // khớp thật với RPC - đây là nhãn ứng dụng, xem watcher.ts) để test luồng đa chain
    // đầu-cuối (2 indexer + Postgres dùng chung + backend tổng hợp theo chain_id) mà
    // không cần chờ ví/RPC thật. KHÔNG set chainId ở đây (để tự nhận diện từ node, luôn
    // là 31337 giống mọi Hardhat Network) - tránh ethers báo lệch chainId khi gửi tx.
    localhostSecondary: {
      url: "http://127.0.0.1:8546",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
