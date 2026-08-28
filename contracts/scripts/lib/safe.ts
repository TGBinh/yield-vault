import { ethers } from "hardhat";
import SafeArtifact from "@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json";
import SafeProxyFactoryArtifact from "@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json";

/// Helper để deploy 1 Safe{Wallet} thật (không phải mock) bằng đúng bytecode/ABI đã
/// compile sẵn từ package chính thức `@safe-global/safe-contracts` - không tự viết lại
/// logic multisig, dùng nguyên hạ tầng Safe thật.
export async function deploySafeInfra() {
  const [deployer] = await ethers.getSigners();

  const SafeFactory = new ethers.ContractFactory(SafeArtifact.abi, SafeArtifact.bytecode, deployer);
  const safeSingleton = await SafeFactory.deploy();
  await safeSingleton.waitForDeployment();

  const ProxyFactoryFactory = new ethers.ContractFactory(
    SafeProxyFactoryArtifact.abi,
    SafeProxyFactoryArtifact.bytecode,
    deployer
  );
  const proxyFactory = await ProxyFactoryFactory.deploy();
  await proxyFactory.waitForDeployment();

  return { safeSingleton, proxyFactory };
}

/// Tạo 1 Safe proxy thật với `owners`/`threshold` cho trước, trả về contract Safe đã
/// gắn đúng ABI để gọi execTransaction/approveHash sau này.
export async function createSafe(
  safeSingleton: any,
  proxyFactory: any,
  owners: string[],
  threshold: number,
  saltNonce = 0n
) {
  const setupData = safeSingleton.interface.encodeFunctionData("setup", [
    owners,
    threshold,
    ethers.ZeroAddress, // to (no delegatecall on setup)
    "0x", // data
    ethers.ZeroAddress, // fallbackHandler
    ethers.ZeroAddress, // paymentToken
    0, // payment
    ethers.ZeroAddress, // paymentReceiver
  ]);

  const singletonAddress = await safeSingleton.getAddress();
  const tx = await proxyFactory.createProxyWithNonce(singletonAddress, setupData, saltNonce);
  const receipt = await tx.wait();

  const event = receipt!.logs
    .map((log: any) => {
      try {
        return proxyFactory.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed: any) => parsed?.name === "ProxyCreation");

  const safeAddress = event!.args.proxy as string;
  const [signer] = await ethers.getSigners();
  return new ethers.Contract(safeAddress, SafeArtifact.abi, signer);
}

/// Xây packed signatures kiểu "pre-approved hash" (Safe contract signature encoding
/// v=1) cho các owner đã gọi `approveHash(txHash)` on-chain - tương đương chữ ký thật
/// về mặt xác thực on-chain, tránh phải mô phỏng EIP-712 off-chain signing trong test.
/// Safe yêu cầu chữ ký được sắp theo thứ tự địa chỉ owner tăng dần.
export function buildApprovedHashSignatures(signerAddresses: string[]): string {
  const sorted = [...signerAddresses].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  let packed = "0x";
  for (const addr of sorted) {
    const r = ethers.zeroPadValue(addr, 32).slice(2);
    const s = "0".repeat(64);
    const v = "01";
    packed += r + s + v;
  }
  return packed;
}

export async function execSafeTransaction(
  safe: any,
  to: string,
  data: string,
  approvingOwners: string[]
) {
  const nonce = await safe.nonce();
  const txHash: string = await safe.getTransactionHash(
    to,
    0,
    data,
    0, // Call
    0,
    0,
    0,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    nonce
  );

  for (const ownerAddress of approvingOwners) {
    const signer = await ethers.getSigner(ownerAddress);
    await (safe.connect(signer) as any).approveHash(txHash);
  }

  const signatures = buildApprovedHashSignatures(approvingOwners);

  return safe.execTransaction(
    to,
    0,
    data,
    0,
    0,
    0,
    0,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    signatures
  );
}
