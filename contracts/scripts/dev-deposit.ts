import { ethers } from "hardhat";

/// Script nội bộ chỉ dùng để verify thủ công luồng multichain (GĐ5) - mint mUSDC +
/// approve + deposit 1 lượng cố định vào Vault đã deploy sẵn trên network hiện tại
/// (chạy qua `--network localhost` hoặc `--network localhostSecondary`). KHÔNG dùng cho
/// production.
async function main() {
  const vaultAddress = process.env.DEV_VAULT_ADDRESS;
  const usdcAddress = process.env.DEV_USDC_ADDRESS;
  const amount = BigInt(process.env.DEV_DEPOSIT_AMOUNT ?? "1000000000"); // 1000 USDC mặc định
  if (!vaultAddress || !usdcAddress) {
    throw new Error("Set DEV_VAULT_ADDRESS and DEV_USDC_ADDRESS env vars");
  }

  const [signer] = await ethers.getSigners();
  const usdc = await ethers.getContractAt("MockUSDC", usdcAddress, signer);
  const vault = await ethers.getContractAt("Vault", vaultAddress, signer);

  await (await usdc.mint(signer.address, amount)).wait();
  await (await usdc.approve(vaultAddress, amount)).wait();
  const tx = await vault.deposit(amount, signer.address);
  const receipt = await tx.wait();
  console.log(`Deposited ${amount} to ${vaultAddress} - tx ${receipt?.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
