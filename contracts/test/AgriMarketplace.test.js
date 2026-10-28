const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("AgriMarketplace", function () {
  let AgriToken, CropBatchNFT, ReputationSBT, AgriMarketplace;
  let agriToken, cropBatchNFT, reputationSBT, marketplace;
  let admin, feeRecipient, farmer, buyer, dao, unauthorized;

  const initialSupply = ethers.parseEther("1000000");
  const pricePerUnit = ethers.parseEther("2"); // 2 AGRI per kg
  const batchQuantity = 1000n; // 1000 kg -> total 2000 AGRI
  let tokenId;

  beforeEach(async function () {
    [admin, feeRecipient, farmer, buyer, dao, unauthorized] = await ethers.getSigners();

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

    // Grant DAO_ROLE to dao signer
    const daoRole = await marketplace.DAO_ROLE();
    await marketplace.connect(admin).grantRole(daoRole, dao.address);

    // Grant OPERATOR_ROLE in ReputationSBT to marketplace
    const operatorRole = await reputationSBT.OPERATOR_ROLE();
    await reputationSBT.connect(admin).grantRole(operatorRole, await marketplace.getAddress());

    // Mint crop batch to farmer
    await cropBatchNFT.connect(admin).mintBatch(
      farmer.address,
      "ipfs://batch1",
      "Organic Apples",
      batchQuantity,
      "kg",
      1710000000n,
      "Himachal Pradesh, India",
      "QmImageApple"
    );
    tokenId = 1n;

    // Grant oracle role to admin to simulate verification
    const oracleRole = await cropBatchNFT.ORACLE_ROLE();
    await cropBatchNFT.connect(admin).grantRole(oracleRole, admin.address);
    await cropBatchNFT.connect(admin).setQualityResult(
      tokenId,
      1, // GRADE_A
      9800,
      ethers.keccak256(ethers.toUtf8Bytes("ReportApple"))
    );

    // Fund buyer with AGRI tokens
    await agriToken.connect(admin).mint(buyer.address, ethers.parseEther("50000"));
  });

  describe("Listing Management", function () {
    it("Should allow farmer to list verified crop batch", async function () {
      // Approve marketplace for NFT
      await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), tokenId);

      await expect(
        marketplace.connect(farmer).createListing(tokenId, pricePerUnit, 1) // Min Grade A
      ).to.emit(marketplace, "ListingCreated")
        .withArgs(1n, tokenId, farmer.address, pricePerUnit, batchQuantity, 1);

      expect(await cropBatchNFT.ownerOf(tokenId)).to.equal(await marketplace.getAddress());

      const listing = await marketplace.listings(1n);
      expect(listing.farmer).to.equal(farmer.address);
      expect(listing.pricePerUnit).to.equal(pricePerUnit);
      expect(listing.availableQuantity).to.equal(batchQuantity);
      expect(listing.status).to.equal(0); // ACTIVE
    });

    it("Should revert if crop batch is unverified", async function () {
      // Mint unverified batch
      await cropBatchNFT.connect(admin).mintBatch(
        farmer.address,
        "ipfs://batch2",
        "Pears",
        500n,
        "kg",
        1710000000n,
        "Kashmir",
        "QmImagePear"
      );
      const unverifiedTokenId = 2n;
      await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), unverifiedTokenId);

      await expect(
        marketplace.connect(farmer).createListing(unverifiedTokenId, pricePerUnit, 1)
      ).to.be.revertedWithCustomError(marketplace, "CropNotVerified")
        .withArgs(unverifiedTokenId);
    });

    it("Should allow farmer to cancel listing and reclaim NFT", async function () {
      await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(farmer).createListing(tokenId, pricePerUnit, 1);

      await expect(marketplace.connect(farmer).cancelListing(1n))
        .to.emit(marketplace, "ListingCancelled")
        .withArgs(1n, tokenId, farmer.address);

      expect(await cropBatchNFT.ownerOf(tokenId)).to.equal(farmer.address);
      const listing = await marketplace.listings(1n);
      expect(listing.status).to.equal(2); // CANCELLED
    });
  });

  describe("Escrow Order Placement", function () {
    beforeEach(async function () {
      await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(farmer).createListing(tokenId, pricePerUnit, 1);
    });

    it("Should lock AGRI tokens in escrow upon order placement", async function () {
      const totalCost = pricePerUnit * batchQuantity; // 2000 AGRI
      await agriToken.connect(buyer).approve(await marketplace.getAddress(), totalCost);

      await expect(marketplace.connect(buyer).placeOrder(1n, batchQuantity))
        .to.emit(marketplace, "OrderPlaced")
        .withArgs(1n, 1n, tokenId, buyer.address, farmer.address, batchQuantity, totalCost);

      expect(await agriToken.balanceOf(await marketplace.getAddress())).to.equal(totalCost);

      const order = await marketplace.getOrder(1n);
      expect(order.buyer).to.equal(buyer.address);
      expect(order.farmer).to.equal(farmer.address);
      expect(order.totalAmount).to.equal(totalCost);
      expect(order.platformFee).to.equal((totalCost * 200n) / 10000n); // 40 AGRI (2%)
      expect(order.status).to.equal(0); // PLACED
    });
  });

  describe("Order Shipping & Delivery Lifecycle", function () {
    const totalCost = pricePerUnit * batchQuantity; // 2000 AGRI
    const expectedFee = (totalCost * 200n) / 10000n; // 40 AGRI
    const expectedPayout = totalCost - expectedFee; // 1960 AGRI

    beforeEach(async function () {
      await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(farmer).createListing(tokenId, pricePerUnit, 1);
      await agriToken.connect(buyer).approve(await marketplace.getAddress(), totalCost);
      await marketplace.connect(buyer).placeOrder(1n, batchQuantity);
    });

    it("Should allow farmer to ship order", async function () {
      await expect(marketplace.connect(farmer).shipOrder(1n))
        .to.emit(marketplace, "OrderShipped");

      const order = await marketplace.getOrder(1n);
      expect(order.status).to.equal(1); // SHIPPED
    });

    it("Should release escrow and transfer NFT upon buyer delivery confirmation", async function () {
      await marketplace.connect(farmer).shipOrder(1n);

      const farmerBalanceBefore = await agriToken.balanceOf(farmer.address);
      const feeRecipientBefore = await agriToken.balanceOf(feeRecipient.address);

      await expect(marketplace.connect(buyer).confirmDelivery(1n))
        .to.emit(marketplace, "OrderDelivered")
        .withArgs(1n, expectedPayout, expectedFee);

      // Verify token balances
      expect(await agriToken.balanceOf(farmer.address)).to.equal(farmerBalanceBefore + expectedPayout);
      expect(await agriToken.balanceOf(feeRecipient.address)).to.equal(feeRecipientBefore + expectedFee);

      // Verify NFT ownership transferred to buyer
      expect(await cropBatchNFT.ownerOf(tokenId)).to.equal(buyer.address);

      // Verify reputation boost
      const [farmerScore, farmerTrades] = await reputationSBT.getReputation(farmer.address);
      expect(farmerScore).to.equal(110n);
      expect(farmerTrades).to.equal(1n);
    });

    it("Should allow auto-release of funds to farmer after timeout", async function () {
      await marketplace.connect(farmer).shipOrder(1n);

      // Advance time past 3-day timeout
      await time.increase(3 * 24 * 3600 + 10);

      await expect(marketplace.autoReleaseAfterTimeout(1n))
        .to.emit(marketplace, "AutoReleased")
        .withArgs(1n, expectedPayout);

      expect(await cropBatchNFT.ownerOf(tokenId)).to.equal(buyer.address);
      const order = await marketplace.getOrder(1n);
      expect(order.status).to.equal(2); // DELIVERED
    });

    it("Should revert auto-release if timeout has not elapsed", async function () {
      await marketplace.connect(farmer).shipOrder(1n);
      await expect(
        marketplace.autoReleaseAfterTimeout(1n)
      ).to.be.revertedWithCustomError(marketplace, "TimeoutNotElapsed");
    });
  });

  describe("Disputes & DAO Resolution Bridge", function () {
    const totalCost = pricePerUnit * batchQuantity;
    const reasonHash = ethers.keccak256(ethers.toUtf8Bytes("Damaged on arrival"));

    beforeEach(async function () {
      await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), tokenId);
      await marketplace.connect(farmer).createListing(tokenId, pricePerUnit, 1);
      await agriToken.connect(buyer).approve(await marketplace.getAddress(), totalCost);
      await marketplace.connect(buyer).placeOrder(1n, batchQuantity);
      await marketplace.connect(farmer).shipOrder(1n);
    });

    it("Should freeze escrow when buyer raises dispute", async function () {
      await expect(marketplace.connect(buyer).raiseDispute(1n, reasonHash))
        .to.emit(marketplace, "DisputeRaised")
        .withArgs(1n, buyer.address, reasonHash);

      const order = await marketplace.getOrder(1n);
      expect(order.status).to.equal(3); // DISPUTED
    });

    it("Should execute DAO verdict refunding buyer and returning NFT to farmer", async function () {
      await marketplace.connect(buyer).raiseDispute(1n, reasonHash);

      const buyerBalanceBefore = await agriToken.balanceOf(buyer.address);

      await expect(
        marketplace.connect(dao).resolveDisputeFromDAO(
          1n,
          totalCost, // Full refund
          0n,
          true,      // Return NFT to farmer
          "REFUND_BUYER"
        )
      ).to.emit(marketplace, "DisputeSettled")
        .withArgs(1n, totalCost, 0n, "REFUND_BUYER");

      expect(await agriToken.balanceOf(buyer.address)).to.equal(buyerBalanceBefore + totalCost);
      expect(await cropBatchNFT.ownerOf(tokenId)).to.equal(farmer.address);

      const order = await marketplace.getOrder(1n);
      expect(order.status).to.equal(4); // RESOLVED
    });
  });
});
