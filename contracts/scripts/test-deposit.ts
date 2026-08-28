import { ethers } from "hardhat";

// Ad-hoc script to exercise a real deposit against the already-deployed local
// contracts, so the indexer/backend integration can be verified end-to-end.
async function main() {
  const [deployer] = await ethers.getSigners();

  const usdc = await ethers.getContractAt("MockUSDC", "0x5FbDB2315678afecb367f032d93F642f64180aa3");
  const vault = await ethers.getContractAt("Vault", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");

  const amount = 1_000n * 10n ** 6n;

  await (await usdc.mint(deployer.address, amount)).wait();
  await (await usdc.approve(await vault.getAddress(), amount)).wait();
  const tx = await vault.deposit(amount, deployer.address);
  const receipt = await tx.wait();

  console.log("Deposit tx mined at block:", receipt?.blockNumber);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
