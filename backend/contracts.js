const fs = require("fs");
const path = require("path");

function getContractData(contractName) {
  try {
    const artifactPath = path.resolve(
      __dirname,
      `../contracts/artifacts/contracts/${contractName}.sol/${contractName}.json`
    );
    if (fs.existsSync(artifactPath)) {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      return { abi: artifact.abi };
    }
  } catch (err) {
    console.warn(`Could not load artifact for ${contractName}:`, err.message);
  }
  return { abi: [] };
}

function getDeployedAddresses() {
  try {
    const deployPath = path.resolve(__dirname, "../contracts/deployments/hardhat.json");
    if (fs.existsSync(deployPath)) {
      const data = JSON.parse(fs.readFileSync(deployPath, "utf8"));
      return data.contracts;
    }
  } catch (err) {
    console.warn("Could not load hardhat deployment file:", err.message);
  }

  // Standard fallback local addresses
  return {
    AgriToken: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    CropBatchNFT: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    ReputationSBT: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    OracleRegistry: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    AgriMarketplace: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    DisputeDAO: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    SupplyChainTracker: "0x0165878A594ca255338adfa4d48449f69242Eb8F"
  };
}

module.exports = {
  getContractData,
  getDeployedAddresses
};
