import hardhatEthersPlugin from "@nomicfoundation/hardhat-ethers";
import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { configVariable, defineConfig } from "hardhat/config";
import * as fs from "node:fs";
import * as path from "node:path";

// Simple .env loader for Hardhat 3
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach(line => {
    const [key, ...values] = line.split("=");
    if (key && values.length > 0) {
      const value = values.join("=").trim().replace(/^["'](.*)["']$/, "$1");
      process.env[key.trim()] = value;
    }
  });
}

export default defineConfig({
  plugins: [hardhatEthersPlugin, hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
    },
  },
  networks: {
    sepolia: {
      type: "http",
      chainType: "op",
      url: configVariable("BASE_SEPOLIA_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
  },
});
