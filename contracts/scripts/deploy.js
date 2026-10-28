const { ethers } = require("hardhat");
const { Wallet } = require("ethers");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("=================================================");
  console.log("     AgriChain Protocol Deployment Initiated     ");
  console.log("=================================================\n");

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`Network:          ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Deployer Address: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deployer Balance: ${ethers.formatEther(balance)} ETH/POL\n`);

  // 1. Deploy AgriToken (10 Million initial supply to deployer)
  console.log("[1/7] Deploying AgriToken (ERC-20)...");
  const AgriToken = await ethers.getContractFactory("AgriToken");
  const initialSupply = ethers.parseEther("10000000"); // 10M AGRI
  const agriToken = await AgriToken.deploy(deployer.address, deployer.address, initialSupply);
  await agriToken.waitForDeployment();
  const agriTokenAddress = await agriToken.getAddress();
  console.log(`      AgriToken deployed to: ${agriTokenAddress}`);

  // 2. Deploy CropBatchNFT
  console.log("[2/7] Deploying CropBatchNFT (ERC-721)...");
  const CropBatchNFT = await ethers.getContractFactory("CropBatchNFT");
  const cropBatchNFT = await CropBatchNFT.deploy(deployer.address);
  await cropBatchNFT.waitForDeployment();
  const cropBatchNFTAddress = await cropBatchNFT.getAddress();
  console.log(`      CropBatchNFT deployed to: ${cropBatchNFTAddress}`);

  // 3. Deploy ReputationSBT
  console.log("[3/7] Deploying ReputationSBT (Soulbound Token)...");
  const ReputationSBT = await ethers.getContractFactory("ReputationSBT");
  const reputationSBT = await ReputationSBT.deploy(deployer.address);
  await reputationSBT.waitForDeployment();
  const reputationSBTAddress = await reputationSBT.getAddress();
  console.log(`      ReputationSBT deployed to: ${reputationSBTAddress}`);

  // 4. Deploy OracleRegistry
  console.log("[4/7] Deploying OracleRegistry...");
  const OracleRegistry = await ethers.getContractFactory("OracleRegistry");
  const oracleRegistry = await OracleRegistry.deploy(
    deployer.address,
    agriTokenAddress,
    cropBatchNFTAddress
  );
  await oracleRegistry.waitForDeployment();
  const oracleRegistryAddress = await oracleRegistry.getAddress();
  console.log(`      OracleRegistry deployed to: ${oracleRegistryAddress}`);

  // 5. Deploy AgriMarketplace
  console.log("[5/7] Deploying AgriMarketplace...");
  const AgriMarketplace = await ethers.getContractFactory("AgriMarketplace");
  const feeRecipient = deployer.address;
  const marketplace = await AgriMarketplace.deploy(
    deployer.address,
    feeRecipient,
    agriTokenAddress,
    cropBatchNFTAddress,
    reputationSBTAddress
  );
  await marketplace.waitForDeployment();
  const marketplaceAddress = await marketplace.getAddress();
  console.log(`      AgriMarketplace deployed to: ${marketplaceAddress}`);

  // 6. Deploy DisputeDAO
  console.log("[6/7] Deploying DisputeDAO...");
  const DisputeDAO = await ethers.getContractFactory("DisputeDAO");
  const disputeDAO = await DisputeDAO.deploy(
    deployer.address,
    agriTokenAddress,
    marketplaceAddress,
    oracleRegistryAddress,
    reputationSBTAddress
  );
  await disputeDAO.waitForDeployment();
  const disputeDAOAddress = await disputeDAO.getAddress();
  console.log(`      DisputeDAO deployed to: ${disputeDAOAddress}`);

  // 7. Deploy SupplyChainTracker
  console.log("[7/7] Deploying SupplyChainTracker...");
  const SupplyChainTracker = await ethers.getContractFactory("SupplyChainTracker");
  const supplyChainTracker = await SupplyChainTracker.deploy(
    deployer.address,
    cropBatchNFTAddress,
    marketplaceAddress
  );
  await supplyChainTracker.waitForDeployment();
  const supplyChainTrackerAddress = await supplyChainTracker.getAddress();
  console.log(`      SupplyChainTracker deployed to: ${supplyChainTrackerAddress}\n`);

  // Marketplace integrations are wired after all contracts exist to avoid a
  // constructor deployment cycle. Disputes and delivery proof are then atomic gates.
  await (await marketplace.setDisputeDAO(disputeDAOAddress)).wait();
  await (await marketplace.setSupplyChainTracker(supplyChainTrackerAddress)).wait();

  // Local-only acceptance-test setup: if the AI signer is configured, whitelist
  // and bond that disposable wallet with TEST AGRI so the signed grade can be
  // accepted without requiring a third MetaMask account or real funds.
  if (Number(network.chainId) === 31337 && process.env.ORACLE_PRIVATE_KEY) {
    const oracleWallet = new Wallet(process.env.ORACLE_PRIVATE_KEY, ethers.provider);
    await (await oracleRegistry.whitelistOracle(oracleWallet.address)).wait();
    const testBond = ethers.parseEther("5000");
    await (await agriToken.mint(oracleWallet.address, testBond)).wait();
    const oracleToken = agriToken.connect(oracleWallet);
    await (await oracleToken.approve(oracleRegistryAddress, testBond)).wait();
    await (await oracleRegistry.connect(oracleWallet).stakeBond(testBond)).wait();
    console.log(`  - Whitelisted and bonded local AI signer ${oracleWallet.address} with 5,000 TEST AGRI`);
  }

  // Wire permissions across contracts
  console.log("Configuring Cross-Contract Access Roles...");

  // Grant ORACLE_ROLE and TRACKER_ROLE on CropBatchNFT
  const oracleRole = await cropBatchNFT.ORACLE_ROLE();
  const trackerRole = await cropBatchNFT.TRACKER_ROLE();
  await (await cropBatchNFT.grantRole(oracleRole, oracleRegistryAddress)).wait();
  await (await cropBatchNFT.grantRole(trackerRole, supplyChainTrackerAddress)).wait();
  console.log("  - Granted ORACLE_ROLE to OracleRegistry on CropBatchNFT");
  console.log("  - Granted TRACKER_ROLE to SupplyChainTracker on CropBatchNFT");

  // Grant OPERATOR_ROLE on ReputationSBT
  const operatorRole = await reputationSBT.OPERATOR_ROLE();
  await (await reputationSBT.grantRole(operatorRole, marketplaceAddress)).wait();
  await (await reputationSBT.grantRole(operatorRole, disputeDAOAddress)).wait();
  console.log("  - Granted OPERATOR_ROLE to Marketplace and DisputeDAO on ReputationSBT");

  // Grant DAO_ROLE on OracleRegistry and Marketplace
  const daoRole = await marketplace.DAO_ROLE();
  await (await marketplace.grantRole(daoRole, disputeDAOAddress)).wait();
  const oracleDaoRole = await oracleRegistry.DAO_ROLE();
  await (await oracleRegistry.grantRole(oracleDaoRole, disputeDAOAddress)).wait();
  console.log("  - Granted DAO_ROLE to DisputeDAO on Marketplace and OracleRegistry");

  // Grant SLASHER_ROLE on AgriToken to OracleRegistry and DisputeDAO
  const slasherRole = await agriToken.SLASHER_ROLE();
  await (await agriToken.grantRole(slasherRole, oracleRegistryAddress)).wait();
  await (await agriToken.grantRole(slasherRole, disputeDAOAddress)).wait();
  console.log("  - Granted SLASHER_ROLE to OracleRegistry and DisputeDAO on AgriToken\n");

  // Assemble deployment configuration
  const deploymentData = {
    network: network.name,
    chainId: Number(network.chainId),
    deployedAt: new Date().toISOString(),
    contracts: {
      AgriToken: agriTokenAddress,
      CropBatchNFT: cropBatchNFTAddress,
      ReputationSBT: reputationSBTAddress,
      OracleRegistry: oracleRegistryAddress,
      AgriMarketplace: marketplaceAddress,
      DisputeDAO: disputeDAOAddress,
      SupplyChainTracker: supplyChainTrackerAddress,
    },
  };

  // Export deployment data
  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  fs.writeFileSync(
    path.join(deploymentsDir, `${network.name || "localhost"}.json`),
    JSON.stringify(deploymentData, null, 2)
  );

  console.log("=================================================");
  console.log("  AgriChain Protocol Deployed Successfully!       ");
  console.log("=================================================\n");
  console.log(JSON.stringify(deploymentData.contracts, null, 2));

  return deploymentData;
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
