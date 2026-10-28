const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("OracleRegistry", function () {
  let AgriToken, CropBatchNFT, OracleRegistry;
  let agriToken, cropBatchNFT, oracleRegistry;
  let admin, oracle1, oracle2, farmer, buyer, unauthorized;

  const minStake = ethers.parseEther("5000"); // 5,000 AGRI
  const initialMint = ethers.parseEther("1000000"); // 1,000,000 AGRI

  beforeEach(async function () {
    [admin, oracle1, oracle2, farmer, buyer, unauthorized] = await ethers.getSigners();

    // Deploy AgriToken
    AgriToken = await ethers.getContractFactory("AgriToken");
    agriToken = await AgriToken.deploy(admin.address, admin.address, initialMint);
    await agriToken.waitForDeployment();

    // Deploy CropBatchNFT
    CropBatchNFT = await ethers.getContractFactory("CropBatchNFT");
    cropBatchNFT = await CropBatchNFT.deploy(admin.address);
    await cropBatchNFT.waitForDeployment();

    // Deploy OracleRegistry
    OracleRegistry = await ethers.getContractFactory("OracleRegistry");
    oracleRegistry = await OracleRegistry.deploy(
      admin.address,
      await agriToken.getAddress(),
      await cropBatchNFT.getAddress()
    );
    await oracleRegistry.waitForDeployment();

    // Grant ORACLE_ROLE in CropBatchNFT to OracleRegistry
    const oracleRole = await cropBatchNFT.ORACLE_ROLE();
    await cropBatchNFT.connect(admin).grantRole(oracleRole, await oracleRegistry.getAddress());

    // Fund oracle1 with AGRI tokens
    await agriToken.connect(admin).mint(oracle1.address, ethers.parseEther("10000"));
  });

  describe("Deployment & Configuration", function () {
    it("Should initialize with correct addresses and constants", async function () {
      expect(await oracleRegistry.agriToken()).to.equal(await agriToken.getAddress());
      expect(await oracleRegistry.cropBatchNFT()).to.equal(await cropBatchNFT.getAddress());
      expect(await oracleRegistry.MINIMUM_ORACLE_STAKE()).to.equal(minStake);
    });
  });

  describe("Whitelisting & Staking Bonds", function () {
    it("Should allow admin to whitelist an oracle candidate", async function () {
      await expect(oracleRegistry.connect(admin).whitelistOracle(oracle1.address))
        .to.emit(oracleRegistry, "OracleWhitelisted")
        .withArgs(oracle1.address);

      const node = await oracleRegistry.oracleNodes(oracle1.address);
      expect(node.isWhitelisted).to.be.true;
      expect(node.isActive).to.be.false;
      expect(await oracleRegistry.totalOracles()).to.equal(1n);
    });

    it("Should prevent duplicate whitelisting", async function () {
      await oracleRegistry.connect(admin).whitelistOracle(oracle1.address);
      await expect(
        oracleRegistry.connect(admin).whitelistOracle(oracle1.address)
      ).to.be.revertedWithCustomError(oracleRegistry, "OracleAlreadyWhitelisted")
        .withArgs(oracle1.address);
    });

    it("Should allow whitelisted oracle to stake bond and become active", async function () {
      await oracleRegistry.connect(admin).whitelistOracle(oracle1.address);

      // Approve registry to pull AGRI
      await agriToken.connect(oracle1).approve(await oracleRegistry.getAddress(), minStake);

      await expect(oracleRegistry.connect(oracle1).stakeBond(minStake))
        .to.emit(oracleRegistry, "OracleStaked")
        .withArgs(oracle1.address, minStake, minStake);

      const node = await oracleRegistry.oracleNodes(oracle1.address);
      expect(node.stakedAmount).to.equal(minStake);
      expect(node.isActive).to.be.true;
      expect(await agriToken.balanceOf(await oracleRegistry.getAddress())).to.equal(minStake);
    });

    it("Should deactivate node if unstaking brings balance below minimum", async function () {
      await oracleRegistry.connect(admin).whitelistOracle(oracle1.address);
      await agriToken.connect(oracle1).approve(await oracleRegistry.getAddress(), minStake);
      await oracleRegistry.connect(oracle1).stakeBond(minStake);

      await expect(oracleRegistry.connect(oracle1).unstakeBond(ethers.parseEther("1000")))
        .to.emit(oracleRegistry, "OracleUnstaked")
        .withArgs(oracle1.address, ethers.parseEther("1000"), ethers.parseEther("4000"));

      const node = await oracleRegistry.oracleNodes(oracle1.address);
      expect(node.isActive).to.be.false;
      expect(node.stakedAmount).to.equal(ethers.parseEther("4000"));
    });
  });

  describe("Cryptographic Verification Submission", function () {
    const reportHash = ethers.keccak256(ethers.toUtf8Bytes("AI Inspection Report Sample"));
    const grade = 1; // Grade A
    const confidence = 9850; // 98.50%
    const tokenId = 1n;

    beforeEach(async function () {
      // Mint batch to farmer
      await cropBatchNFT.connect(admin).mintBatch(
        farmer.address,
        "ipfs://testCID",
        "Wheat",
        1000n,
        "kg",
        1700000000n,
        "Haryana, India",
        "QmImageCID"
      );

      // Whitelist and activate oracle1
      await oracleRegistry.connect(admin).whitelistOracle(oracle1.address);
      await agriToken.connect(oracle1).approve(await oracleRegistry.getAddress(), minStake);
      await oracleRegistry.connect(oracle1).stakeBond(minStake);
    });

    it("Should accept valid cryptographic signature and update CropBatchNFT", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const registryAddress = await oracleRegistry.getAddress();

      // Construct message hash
      const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "uint8", "uint16", "bytes32"],
        [chainId, registryAddress, tokenId, grade, confidence, reportHash]
      );

      // Sign message with oracle1's private key
      const signature = await oracle1.signMessage(ethers.getBytes(messageHash));

      // Submit verification
      await expect(
        oracleRegistry.connect(unauthorized).submitVerification(
          tokenId,
          grade,
          confidence,
          reportHash,
          signature
        )
      ).to.emit(oracleRegistry, "QualityVerified")
        .withArgs(tokenId, oracle1.address, grade, confidence, reportHash);

      // Verify batch state on CropBatchNFT
      const batch = await cropBatchNFT.getBatch(tokenId);
      expect(batch.isVerified).to.be.true;
      expect(batch.qualityGrade).to.equal(grade);
      expect(batch.confidenceScore).to.equal(confidence);
      expect(batch.reportHash).to.equal(reportHash);
    });

    it("Should revert replay attack using same report hash", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const registryAddress = await oracleRegistry.getAddress();

      const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "uint8", "uint16", "bytes32"],
        [chainId, registryAddress, tokenId, grade, confidence, reportHash]
      );
      const signature = await oracle1.signMessage(ethers.getBytes(messageHash));

      await oracleRegistry.submitVerification(tokenId, grade, confidence, reportHash, signature);

      // Second attempt with same report hash should revert
      await expect(
        oracleRegistry.submitVerification(tokenId, grade, confidence, reportHash, signature)
      ).to.be.revertedWithCustomError(oracleRegistry, "ReportAlreadyUsed")
        .withArgs(reportHash);
    });

    it("Should revert if signature is from an unregistered or unbonded signer", async function () {
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const registryAddress = await oracleRegistry.getAddress();

      const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "uint8", "uint16", "bytes32"],
        [chainId, registryAddress, tokenId, grade, confidence, reportHash]
      );
      // Signed by unauthorized user
      const invalidSignature = await unauthorized.signMessage(ethers.getBytes(messageHash));

      await expect(
        oracleRegistry.submitVerification(tokenId, grade, confidence, reportHash, invalidSignature)
      ).to.be.revertedWithCustomError(oracleRegistry, "InactiveOrInsufficientStake")
        .withArgs(unauthorized.address, 0n, minStake);
    });
  });

  describe("Governance Slashing", function () {
    const slashAmount = ethers.parseEther("2000");

    beforeEach(async function () {
      await oracleRegistry.connect(admin).whitelistOracle(oracle1.address);
      await agriToken.connect(oracle1).approve(await oracleRegistry.getAddress(), minStake);
      await oracleRegistry.connect(oracle1).stakeBond(minStake);
    });

    it("Should allow DAO role to slash oracle and transfer bond to victim", async function () {
      const buyerBefore = await agriToken.balanceOf(buyer.address);

      await expect(
        oracleRegistry.connect(admin).slashOracle(oracle1.address, slashAmount, buyer.address, "Faulty quality grading")
      ).to.emit(oracleRegistry, "OracleSlashed")
        .withArgs(oracle1.address, slashAmount, buyer.address, "Faulty quality grading");

      expect(await agriToken.balanceOf(buyer.address)).to.equal(buyerBefore + slashAmount);

      const node = await oracleRegistry.oracleNodes(oracle1.address);
      expect(node.stakedAmount).to.equal(minStake - slashAmount);
      expect(node.slashedCount).to.equal(1n);
      expect(node.isActive).to.be.false; // Below min stake (3000 < 5000)
    });

    it("Should prevent non-DAO role from slashing", async function () {
      const daoRole = await oracleRegistry.DAO_ROLE();
      await expect(
        oracleRegistry.connect(unauthorized).slashOracle(oracle1.address, slashAmount, buyer.address, "Malice")
      ).to.be.revertedWithCustomError(oracleRegistry, "AccessControlUnauthorizedAccount")
        .withArgs(unauthorized.address, daoRole);
    });
  });
});
