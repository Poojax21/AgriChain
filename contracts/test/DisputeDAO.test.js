const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("DisputeDAO", function () {
  let AgriToken, CropBatchNFT, ReputationSBT, OracleRegistry, AgriMarketplace, DisputeDAO;
  let agriToken, cropBatchNFT, reputationSBT, oracleRegistry, marketplace, disputeDAO;
  let admin, feeRecipient, farmer, buyer, oracleNode, juror1, juror2, juror3, nonJuror;

  const initialSupply = ethers.parseEther("1000000");
  const pricePerUnit = ethers.parseEther("1");
  const quantity = 1000n; // 1000 AGRI total
  const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("EvidenceOfDamagedCrop"));
  let tokenId, orderId;

  beforeEach(async function () {
    [admin, feeRecipient, farmer, buyer, oracleNode, juror1, juror2, juror3, nonJuror] = await ethers.getSigners();

    // Deploy AgriToken
    AgriToken = await ethers.getContractFactory("AgriToken");
    agriToken = await AgriToken.deploy(admin.address, admin.address, initialSupply);
    await agriToken.waitForDeployment();

    // Deploy CropBatchNFT
    CropBatchNFT = await ethers.getContractFactory("CropBatchNFT");
    cropBatchNFT = await CropBatchNFT.deploy(admin.address);
    await cropBatchNFT.waitForDeployment();

    // Deploy ReputationSBT
    ReputationSBT = await ethers.getContractFactory("ReputationSBT");
    reputationSBT = await ReputationSBT.deploy(admin.address);
    await reputationSBT.waitForDeployment();

    // Deploy OracleRegistry
    OracleRegistry = await ethers.getContractFactory("OracleRegistry");
    oracleRegistry = await OracleRegistry.deploy(
      admin.address,
      await agriToken.getAddress(),
      await cropBatchNFT.getAddress()
    );
    await oracleRegistry.waitForDeployment();

    // Deploy AgriMarketplace
    AgriMarketplace = await ethers.getContractFactory("AgriMarketplace");
    marketplace = await AgriMarketplace.deploy(
      admin.address,
      feeRecipient.address,
      await agriToken.getAddress(),
      await cropBatchNFT.getAddress(),
      await reputationSBT.getAddress()
    );
    await marketplace.waitForDeployment();

    // Deploy DisputeDAO
    DisputeDAO = await ethers.getContractFactory("DisputeDAO");
    disputeDAO = await DisputeDAO.deploy(
      admin.address,
      await agriToken.getAddress(),
      await marketplace.getAddress(),
      await oracleRegistry.getAddress(),
      await reputationSBT.getAddress()
    );
    await disputeDAO.waitForDeployment();
    await marketplace.connect(admin).setDisputeDAO(await disputeDAO.getAddress());

    // Wire permissions:
    // Marketplace grants DAO_ROLE to DisputeDAO
    const daoRole = await marketplace.DAO_ROLE();
    await marketplace.connect(admin).grantRole(daoRole, await disputeDAO.getAddress());

    // OracleRegistry grants DAO_ROLE to DisputeDAO
    const oracleDaoRole = await oracleRegistry.DAO_ROLE();
    await oracleRegistry.connect(admin).grantRole(oracleDaoRole, await disputeDAO.getAddress());

    // ReputationSBT grants OPERATOR_ROLE to DisputeDAO and Marketplace
    const opRole = await reputationSBT.OPERATOR_ROLE();
    await reputationSBT.connect(admin).grantRole(opRole, await disputeDAO.getAddress());
    await reputationSBT.connect(admin).grantRole(opRole, await marketplace.getAddress());

    // Setup Oracle node
    await oracleRegistry.connect(admin).whitelistOracle(oracleNode.address);
    await agriToken.connect(admin).mint(oracleNode.address, ethers.parseEther("10000"));
    await agriToken.connect(oracleNode).approve(await oracleRegistry.getAddress(), ethers.parseEther("5000"));
    await oracleRegistry.connect(oracleNode).stakeBond(ethers.parseEther("5000"));

    // Mint crop batch, verify it, list it, order it, and dispute it
    await cropBatchNFT.connect(admin).mintBatch(
      farmer.address,
      "ipfs://batchDAO",
      "Soybeans",
      quantity,
      "kg",
      1710000000n,
      "Madhya Pradesh",
      "QmImageSoy"
    );
    tokenId = 1n;

    const oracleRole = await cropBatchNFT.ORACLE_ROLE();
    await cropBatchNFT.connect(admin).grantRole(oracleRole, admin.address);
    await cropBatchNFT.connect(admin).setQualityResult(
      tokenId,
      1, // Grade A
      9900,
      ethers.keccak256(ethers.toUtf8Bytes("SoyReport"))
    );

    // List and order
    await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), tokenId);
    await marketplace.connect(farmer).createListing(tokenId, pricePerUnit, 1);

    await agriToken.connect(admin).mint(buyer.address, ethers.parseEther("5000"));
    await agriToken.connect(buyer).approve(await marketplace.getAddress(), ethers.parseEther("1000"));
    await marketplace.connect(buyer).placeOrder(1n, quantity);
    orderId = 1n;

    // Buyer raises dispute in marketplace
      await marketplace.connect(buyer).raiseDispute(orderId, evidenceHash, oracleNode.address);

    // Fund and stake jurors
    // Juror1: 5,000 AGRI, Juror2: 3,000 AGRI, Juror3: 1,500 AGRI
    for (const [juror, amt] of [[juror1, "5000"], [juror2, "3000"], [juror3, "1500"]]) {
      await agriToken.connect(admin).mint(juror.address, ethers.parseEther(amt));
      await agriToken.connect(juror).stake(ethers.parseEther(amt));
    }
  });

  describe("Dispute Opening", function () {
    it("Should open a new dispute case", async function () {
      const dispute = await disputeDAO.disputes(1n);
      expect(dispute.buyer).to.equal(buyer.address);
      expect(dispute.farmer).to.equal(farmer.address);
      expect(dispute.oracleNode).to.equal(oracleNode.address);
      expect(dispute.isResolved).to.be.false;
      expect(dispute.votingEndsAt).to.be.gt(0n);
    });

    it("Should prevent duplicate dispute creation for same order", async function () {
      await expect(disputeDAO.createDispute(orderId, buyer.address, farmer.address, oracleNode.address, evidenceHash))
        .to.be.revertedWithCustomError(disputeDAO, "OnlyMarketplace");
    });
  });

  describe("Juror Voting", function () {
    beforeEach(async function () {
    });

    it("Should allow staked juror to cast vote with their stake weight", async function () {
      const weight1 = ethers.parseEther("5000");

      await expect(disputeDAO.connect(juror1).vote(1n, 1)) // 1: REFUND_BUYER
        .to.emit(disputeDAO, "VoteCast")
        .withArgs(1n, juror1.address, 1, weight1);

      const dispute = await disputeDAO.disputes(1n);
      expect(dispute.totalVotesBuyer).to.equal(weight1);
    });

    it("Should revert if non-staked user attempts to vote", async function () {
      await expect(
        disputeDAO.connect(nonJuror).vote(1n, 1)
      ).to.be.revertedWithCustomError(disputeDAO, "InsufficientJurorStake")
        .withArgs(nonJuror.address, 0n, ethers.parseEther("1000"));
    });

    it("Should revert if juror tries to vote twice on same dispute", async function () {
      await disputeDAO.connect(juror1).vote(1n, 1);
      await expect(
        disputeDAO.connect(juror1).vote(1n, 1)
      ).to.be.revertedWithCustomError(disputeDAO, "AlreadyVoted")
        .withArgs(1n, juror1.address);
    });
  });

  describe("Dispute Resolution & Execution", function () {
    beforeEach(async function () {
      // Juror1 (5000 AGRI) votes REFUND_BUYER
      await disputeDAO.connect(juror1).vote(1n, 1);
      // Juror2 (3000 AGRI) votes PAY_FARMER
      await disputeDAO.connect(juror2).vote(1n, 2);
    });

    it("Should revert resolution if voting period is still active", async function () {
      await expect(
        disputeDAO.resolveDispute(1n)
      ).to.be.revertedWithCustomError(disputeDAO, "VotingPeriodActive");
    });

    it("Should execute REFUND_BUYER verdict, slash oracle, and return NFT to farmer", async function () {
      const buyerBefore = await agriToken.balanceOf(buyer.address);
      const totalOrderEscrow = ethers.parseEther("1000");

      // Advance time past 2-day voting duration
      await time.increase(2 * 24 * 3600 + 10);

      await expect(disputeDAO.resolveDispute(1n))
        .to.emit(disputeDAO, "DisputeResolved")
        .withArgs(1n, 1, ethers.parseEther("5000"));

      // Buyer received full refund (1000 AGRI) + slashed oracle bond compensation (1000 AGRI)
      const oracleCompensation = ethers.parseEther("1000");
      expect(await agriToken.balanceOf(buyer.address)).to.equal(buyerBefore + totalOrderEscrow + oracleCompensation);

      // NFT returned to farmer
      expect(await cropBatchNFT.ownerOf(tokenId)).to.equal(farmer.address);

      // Oracle slashed for bad grading
      const oracleInfo = await oracleRegistry.oracleNodes(oracleNode.address);
      expect(oracleInfo.slashedCount).to.equal(1n);

      const dispute = await disputeDAO.disputes(1n);
      expect(dispute.isResolved).to.be.true;
      expect(dispute.verdict).to.equal(1); // REFUND_BUYER
    });
  });
});
