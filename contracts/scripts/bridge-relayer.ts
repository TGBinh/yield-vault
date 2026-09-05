import { ethers } from "ethers";

/// GD6 Milestone 6.1: relayer off-chain don gian cho SimpleBridge - CHI DE HOC, khong
/// dung cho von that (xem PLAN.md GD6 muc 4). Poll-based (giong indexer o GD2 - de doan
/// hanh vi va debug hon subscribe qua WebSocket), khong dung ky thuat mat ma nao de xac
/// minh message, chi tin tuong 1 private key duy nhat da duoc cap RELAYER_ROLE tren ca
/// 2 chain. Day chinh la gia dinh tin cay can thay the boi CCIP/LayerZore o Milestone 6.2.
///
/// Gioi han da biet (chua xu ly o ban nay): cursor block chi luu trong bo nho (mat khi
/// restart, se quet lai tu BRIDGE_START_BLOCK), chua co retry/backoff rieng cho tung
/// message loi, chua co canh bao (alerting) khi relayer dung hoat dong.

const BRIDGE_ABI = [
  "event Locked(uint256 indexed nonce, address indexed sender, address recipient, uint256 amount, uint256 destinationChainId)",
  "event Burned(uint256 indexed nonce, address indexed sender, address recipient, uint256 amount, uint256 destinationChainId)",
  "function mint(uint256 sourceChainId, uint256 sourceNonce, address recipient, uint256 amount) external",
  "function unlock(uint256 sourceChainId, uint256 sourceNonce, address recipient, uint256 amount) external",
  "function inboundProcessed(bytes32 key) view returns (bool)",
];

interface ChainSide {
  name: string;
  chainId: number;
  provider: ethers.providers.JsonRpcProvider;
  bridge: ethers.Contract;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`bridge-relayer: missing required env var ${name}`);
  return value;
}

function messageKey(sourceChainId: number, sourceNonce: ethers.BigNumber): string {
  return ethers.utils.solidityKeccak256(["uint256", "uint256"], [sourceChainId, sourceNonce]);
}

async function relayLockEvents(from: ChainSide, to: ChainSide, fromBlock: number, toBlock: number): Promise<void> {
  const events = await from.bridge.queryFilter(from.bridge.filters.Locked(), fromBlock, toBlock);
  for (const event of events) {
    if (!event.args) continue;
    const { nonce, recipient, amount } = event.args;
    const key = messageKey(from.chainId, nonce);
    if (await to.bridge.inboundProcessed(key)) {
      console.log(`[relayer] Locked nonce=${nonce} from ${from.name} already minted on ${to.name}, skipping`);
      continue;
    }
    console.log(`[relayer] relaying Locked nonce=${nonce} ${from.name} -> mint on ${to.name} (${amount} to ${recipient})`);
    const tx = await to.bridge.mint(from.chainId, nonce, recipient, amount);
    await tx.wait();
    console.log(`[relayer] mint confirmed: ${tx.hash}`);
  }
}

async function relayBurnEvents(from: ChainSide, to: ChainSide, fromBlock: number, toBlock: number): Promise<void> {
  const events = await from.bridge.queryFilter(from.bridge.filters.Burned(), fromBlock, toBlock);
  for (const event of events) {
    if (!event.args) continue;
    const { nonce, recipient, amount } = event.args;
    const key = messageKey(from.chainId, nonce);
    if (await to.bridge.inboundProcessed(key)) {
      console.log(`[relayer] Burned nonce=${nonce} from ${from.name} already unlocked on ${to.name}, skipping`);
      continue;
    }
    console.log(`[relayer] relaying Burned nonce=${nonce} ${from.name} -> unlock on ${to.name} (${amount} to ${recipient})`);
    const tx = await to.bridge.unlock(from.chainId, nonce, recipient, amount);
    await tx.wait();
    console.log(`[relayer] unlock confirmed: ${tx.hash}`);
  }
}

async function main(): Promise<void> {
  const relayerKey = requireEnv("RELAYER_PRIVATE_KEY");
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? "5000");

  const homeProvider = new ethers.providers.JsonRpcProvider(requireEnv("HOME_RPC_URL"));
  const remoteProvider = new ethers.providers.JsonRpcProvider(requireEnv("REMOTE_RPC_URL"));
  const homeWallet = new ethers.Wallet(relayerKey, homeProvider);
  const remoteWallet = new ethers.Wallet(relayerKey, remoteProvider);

  const home: ChainSide = {
    name: "home",
    chainId: Number(requireEnv("HOME_CHAIN_ID")),
    provider: homeProvider,
    bridge: new ethers.Contract(requireEnv("HOME_BRIDGE_ADDRESS"), BRIDGE_ABI, homeWallet),
  };
  const remote: ChainSide = {
    name: "remote",
    chainId: Number(requireEnv("REMOTE_CHAIN_ID")),
    provider: remoteProvider,
    bridge: new ethers.Contract(requireEnv("REMOTE_BRIDGE_ADDRESS"), BRIDGE_ABI, remoteWallet),
  };

  let homeCursor = Number(process.env.BRIDGE_START_BLOCK_HOME ?? (await homeProvider.getBlockNumber()));
  let remoteCursor = Number(process.env.BRIDGE_START_BLOCK_REMOTE ?? (await remoteProvider.getBlockNumber()));

  console.log(`[relayer] starting, home chainId=${home.chainId} cursor=${homeCursor}, remote chainId=${remote.chainId} cursor=${remoteCursor}`);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const homeLatest = await homeProvider.getBlockNumber();
      const remoteLatest = await remoteProvider.getBlockNumber();

      if (homeLatest >= homeCursor) {
        await relayLockEvents(home, remote, homeCursor, homeLatest);
        homeCursor = homeLatest + 1;
      }
      if (remoteLatest >= remoteCursor) {
        await relayBurnEvents(remote, home, remoteCursor, remoteLatest);
        remoteCursor = remoteLatest + 1;
      }
    } catch (error) {
      console.error("[relayer] tick failed", error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
