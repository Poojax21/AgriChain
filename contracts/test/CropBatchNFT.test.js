const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CropBatchNFT (ERC-721)", function () {
  let CropBatchNFT;
  let cropBatchNFT;
  let admin, farmer, oracle, tracker, nonAuthorized;

  const sampleURI = "ipfs://QmSampleMetadataHash123456789";
  const cropType = "Basmati Rice (Pusa-1121)";
  const quantity = 5000n; // 5000 kg
  const unit = "kg";
  const harvestDate = 1718000000n;
  const farmLocation = "Punjab, India (31.1471 N, 75.3412 E)";
  const imageCID = "QmCropImagesBatch987654321";

  beforeEach(async function () {
    [admin, farmer, oracle, tracker, nonAuthorized] = await ethers.getSigners();
    CropBatchNFT = await ethers.getContractFactory("CropBatchNFT");
    cropBatchNFT = await CropBatchNFT.deploy(admin.address);
    await cropBatchNFT.waitForDeployment();

    // Assign ORACLE_ROLE and TRACKER_ROLE
    const oracleRole = await cropBatchNFT.ORACLE_ROLE();
    const trackerRole = await cropBatchNFT.TRACKER_ROLE();

    await cropBatchNFT.connect(admin).grantRole(oracleRole, oracle.address);
    await cropBatchNFT.connect(admin).grantRole(trackerRole, tracker.address);
  });

  describe("Deployment & Roles", function () {
    it("Should initialize with correct name and symbol", async function () {
      expect(await cropBatchNFT.name()).to.equal("AgriChain Crop Batch");
      expect(await cropBatchNFT.symbol()).to.equal("CROP");
    });

    it("Should grant admin and minter roles to deployer", async function () {
      const adminRole = await cropBatchNFT.DEFAULT_ADMIN_ROLE();
      const minterRole = await cropBatchNFT.MINTER_ROLE();
      expect(await cropBatchNFT.hasRole(adminRole, admin.address)).to.be.true;
      expect(await cropBatchNFT.hasRole(minterRole, admin.address)).to.be.true;
    });
  });

  describe("Minting Batch", function () {
    it("Should allow minter to mint a batch to farmer", async function () {
      await expect(
        cropBatchNFT.connect(admin).mintBatch(
          farmer.address,
          sampleURI,
          cropType,
          quantity,
          unit,
          harvestDate,
          farmLocation,
          imageCID
        )
      ).to.emit(cropBatchNFT, "BatchMinted")
        .withArgs(1n, farmer.address, cropType, quantity, unit, sampleURI);

      expect(await cropBatchNFT.ownerOf(1n)).to.equal(farmer.address);
      expect(await cropBatchNFT.tokenURI(1n)).to.equal(sampleURI);
      expect(await cropBatchNFT.totalBatches()).to.equal(1n);

      const batch = await cropBatchNFT.getBatch(1n);
      expect(batch.farmer).to.equal(farmer.address);
      expect(batch.cropType).to.equal(cropType);
      expect(batch.quantity).to.equal(quantity);
      expect(batch.unit).to.equal(unit);
      expect(batch.harvestDate).to.equal(harvestDate);
      expect(batch.farmLocation).to.equal(farmLocation);
      expect(batch.imageCID).to.equal(imageCID);
      expect(batch.isVerified).to.be.false;
      expect(batch.qualityGrade).to.equal(0); // NOT_GRADED
    });

    it("Should revert if non-minter attempts to mint", async function () {
      const minterRole = await cropBatchNFT.MINTER_ROLE();
      await expect(
        cropBatchNFT.connect(farmer).mintBatch(
          farmer.address,
          sampleURI,
          cropType,
          quantity,
          unit,
          harvestDate,
          farmLocation,
          imageCID
        )
      ).to.be.revertedWithCustomError(cropBatchNFT, "AccessControlUnauthorizedAccount")
        .withArgs(farmer.address, minterRole);
    });

    it("Should revert if quantity is zero", async function () {
      await expect(
        cropBatchNFT.connect(admin).mintBatch(
          farmer.address,
          sampleURI,
          cropType,
          0n,
          unit,
          harvestDate,
          farmLocation,
          imageCID
        )
      ).to.be.revertedWithCustomError(cropBatchNFT, "InvalidQuantity");
    });
  });

  describe("Quality Verification Callback", function () {
    const reportHash = ethers.keccak256(ethers.toUtf8Bytes("AI Inspection Report #001"));

    beforeEach(async function () {
      await cropBatchNFT.connect(admin).mintBatch(
        farmer.address,
        sampleURI,
        cropType,
        quantity,
        unit,
        harvestDate,
        farmLocation,
        imageCID
      );
    });

    it("Should allow authorized oracle to record quality results", async function () {
      const gradeA = 1; // GRADE_A
      const confidence = 9650; // 96.50%

      await expect(
        cropBatchNFT.connect(oracle).setQualityResult(1n, gradeA, confidence, reportHash)
      ).to.emit(cropBatchNFT, "QualityResultUpdated")
        .withArgs(1n, gradeA, confidence, reportHash);

      const batch = await cropBatchNFT.getBatch(1n);
      expect(batch.qualityGrade).to.equal(gradeA);
      expect(batch.confidenceScore).to.equal(confidence);
      expect(batch.reportHash).to.equal(reportHash);
      expect(batch.isVerified).to.be.true;
    });

    it("Should make the first oracle quality result immutable", async function () {
      await cropBatchNFT.connect(oracle).setQualityResult(1n, 1, 9500, reportHash);
      await expect(cropBatchNFT.connect(oracle).setQualityResult(
        1n, 4, 9900, ethers.keccak256(ethers.toUtf8Bytes("ReplacementReport"))
      )).to.be.revertedWithCustomError(cropBatchNFT, "VerificationAlreadySubmitted");
      const batch = await cropBatchNFT.getBatch(1n);
      expect(batch.qualityGrade).to.equal(1);
      expect(batch.reportHash).to.equal(reportHash);
    });

    it("Should revert if non-oracle attempts to update quality", async function () {
      const oracleRole = await cropBatchNFT.ORACLE_ROLE();
      await expect(
        cropBatchNFT.connect(nonAuthorized).setQualityResult(1n, 1, 9500, reportHash)
      ).to.be.revertedWithCustomError(cropBatchNFT, "AccessControlUnauthorizedAccount")
        .withArgs(nonAuthorized.address, oracleRole);
    });

    it("Should revert if confidence score exceeds 10,000 basis points", async function () {
      await expect(
        cropBatchNFT.connect(oracle).setQualityResult(1n, 1, 10001, reportHash)
      ).to.be.revertedWithCustomError(cropBatchNFT, "InvalidConfidenceScore")
        .withArgs(10001);
    });

    it("Should revert if batch token does not exist", async function () {
      await expect(
        cropBatchNFT.connect(oracle).setQualityResult(999n, 1, 9500, reportHash)
      ).to.be.revertedWithCustomError(cropBatchNFT, "BatchNotFound")
        .withArgs(999n);
    });
  });

  describe("Supply Chain Transit Checkpoint Root", function () {
    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("CheckpointMerkleRoot123"));

    beforeEach(async function () {
      await cropBatchNFT.connect(admin).mintBatch(
        farmer.address,
        sampleURI,
        cropType,
        quantity,
        unit,
        harvestDate,
        farmLocation,
        imageCID
      );
    });

    it("Should allow tracker role to record checkpoint Merkle root", async function () {
      await expect(
        cropBatchNFT.connect(tracker).setCheckpointRoot(1n, merkleRoot)
      ).to.emit(cropBatchNFT, "CheckpointRootUpdated")
        .withArgs(1n, merkleRoot);

      const batch = await cropBatchNFT.getBatch(1n);
      expect(batch.merkleCheckpointRoot).to.equal(merkleRoot);
    });

    it("Should revert if non-tracker tries to update checkpoint root", async function () {
      const trackerRole = await cropBatchNFT.TRACKER_ROLE();
      await expect(
        cropBatchNFT.connect(nonAuthorized).setCheckpointRoot(1n, merkleRoot)
      ).to.be.revertedWithCustomError(cropBatchNFT, "AccessControlUnauthorizedAccount")
        .withArgs(nonAuthorized.address, trackerRole);
    });
  });
});
