import hre from "hardhat";

async function main() {
  const connection = await hre.network.connect();
  const { ethers } = connection;

  // USDC address on Base Sepolia testnet (Official Circle USDC)
  const usdcAddress = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

  console.log("Deploying BaseRevenueOS...");
  const BaseRevenue = await ethers.getContractFactory("BaseRevenueOS");
  const baseRevenue = await BaseRevenue.deploy(usdcAddress);

  await baseRevenue.waitForDeployment();

  const deployedAddress = await baseRevenue.getAddress();
  console.log("BaseRevenueOS deployed to:", deployedAddress);
  console.log("USDC address:", usdcAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
