const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Off-chain Merkle tree generator for supply chain checkpoints
 */
function buildMerkleTree(leaves) {
  let sortedLeaves = leaves.map(l => ethers.getBytes(l));
  let layers = [sortedLeaves];

  while (layers[layers.length - 1].length > 1) {
    const currentLayer = layers[layers.length - 1];
    const nextLayer = [];

    for (let i = 0; i < currentLayer.length; i += 2) {
      if (i + 1 < currentLayer.length) {
        const left = currentLayer[i];
        const right = currentLayer[i + 1];
        const combined = ethers.getBytes(
          ethers.solidityPackedKeccak256(
            ["bytes32", "bytes32"],
            ethers.hexlify(left) < ethers.hexlify(right) ? [left, right] : [right, left]
          )
        );
        nextLayer.push(combined);
      } else {
        nextLayer.push(currentLayer[i]);
      }
    }
    layers.push(nextLayer);
  }

  const root = ethers.hexlify(layers[layers.length - 1][0]);

  function getProof(index) {
    const proof = [];
    let currentIndex = index;

    for (let i = 0; i < layers.length - 1; i++) {
      const layer = layers[i];
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;

      if (siblingIndex < layer.length) {
        proof.push(ethers.hexlify(layer[siblingIndex]));
      }
      currentIndex = Math.floor(currentIndex / 2);
    }
    return proof;
  }

  return { root, getProof };
}

describe("AgriChain Full End-to-End User Journeys", function () {
  let agriToken, cropBatchNFT, reputationSBT, oracleRegistry, marketplace, disputeDAO, tracker;
  let admin, feeRecipient, farmer, buyer, oracleNode, carrier, juror1, juror2;

  beforeEach(async function () {
    [admin, feeRecipient, farmer, buyer, oracleNode, carrier, juror1, juror2] = await ethers.getSigners();

    // 1. Deploy AgriToken
    const AgriTokenFactory = await ethers.getContractFactory("AgriToken");
    agriToken = await AgriTokenFactory.deploy(admin.address, admin.address, ethers.parseEther("10000000"));
    await agriToken.waitForDeployment();

    // 2. Deploy CropBatchNFT
    const CropBatchNFTFactory = await ethers.getContractFactory("CropBatchNFT");
    cropBatchNFT = await CropBatchNFTFactory.deploy(admin.address);
    await cropBatchNFT.waitForDeployment();

    // 3. Deploy ReputationSBT
    const ReputationSBTFactory = await ethers.getContractFactory("ReputationSBT");
    reputationSBT = await ReputationSBTFactory.deploy(admin.address);
    await reputationSBT.waitForDeployment();

    // 4. Deploy OracleRegistry
    const OracleRegistryFactory = await ethers.getContractFactory("OracleRegistry");
    oracleRegistry = await OracleRegistryFactory.deploy(
      admin.address,
      await agriToken.getAddress(),
      await cropBatchNFT.getAddress()
    );
    await oracleRegistry.waitForDeployment();

    // 5. Deploy AgriMarketplace
    const AgriMarketplaceFactory = await ethers.getContractFactory("AgriMarketplace");
    marketplace = await AgriMarketplaceFactory.deploy(
      admin.address,
      feeRecipient.address,
      await agriToken.getAddress(),
      await cropBatchNFT.getAddress(),
      await reputationSBT.getAddress()
    );
    await marketplace.waitForDeployment();

    // 6. Deploy DisputeDAO
    const DisputeDAOFactory = await ethers.getContractFactory("DisputeDAO");
    disputeDAO = await DisputeDAOFactory.deploy(
      admin.address,
      await agriToken.getAddress(),
      await marketplace.getAddress(),
      await oracleRegistry.getAddress(),
      await reputationSBT.getAddress()
    );
    await disputeDAO.waitForDeployment();

    // 7. Deploy SupplyChainTracker
    const SupplyChainTrackerFactory = await ethers.getContractFactory("SupplyChainTracker");
    tracker = await SupplyChainTrackerFactory.deploy(
      admin.address,
      await cropBatchNFT.getAddress(),
      await marketplace.getAddress()
    );
    await tracker.waitForDeployment();

    // Configure Permissions
    await (await cropBatchNFT.grantRole(await cropBatchNFT.ORACLE_ROLE(), await oracleRegistry.getAddress())).wait();
    await (await cropBatchNFT.grantRole(await cropBatchNFT.TRACKER_ROLE(), await tracker.getAddress())).wait();
    await (await cropBatchNFT.grantRole(await cropBatchNFT.MINTER_ROLE(), farmer.address)).wait();

    await (await reputationSBT.grantRole(await reputationSBT.OPERATOR_ROLE(), await marketplace.getAddress())).wait();
    await (await reputationSBT.grantRole(await reputationSBT.OPERATOR_ROLE(), await disputeDAO.getAddress())).wait();

    await (await marketplace.grantRole(await marketplace.DAO_ROLE(), await disputeDAO.getAddress())).wait();
    await (await oracleRegistry.grantRole(await oracleRegistry.DAO_ROLE(), await disputeDAO.getAddress())).wait();

    await (await agriToken.grantRole(await agriToken.SLASHER_ROLE(), await oracleRegistry.getAddress())).wait();
    await (await agriToken.grantRole(await agriToken.SLASHER_ROLE(), await disputeDAO.getAddress())).wait();

    await (await tracker.grantRole(await tracker.LOGISTICS_ROLE(), carrier.address)).wait();

    // Whitelist and activate Oracle node with 5,000 AGRI bond
    await oracleRegistry.connect(admin).whitelistOracle(oracleNode.address);
    await agriToken.connect(admin).mint(oracleNode.address, ethers.parseEther("10000"));
    await agriToken.connect(oracleNode).approve(await oracleRegistry.getAddress(), ethers.parseEther("5000"));
    await oracleRegistry.connect(oracleNode).stakeBond(ethers.parseEther("5000"));
  });

  it("Full Journey A: Harvest -> AI Grading -> Listing -> Escrow -> Merkle Transit Proof -> Delivery -> Payment Release", async function () {
    console.log("\n  >>> STARTING JOURNEY A: SUCCESSFUL PURCHASE WITH MERKLE TRANSIT & ESCROW RELEASE <<<");

    // 1. Farmer onboards & registers SBT
    await reputationSBT.connect(farmer).register();
    const [farmerInitialRep] = await reputationSBT.getReputation(farmer.address);
    expect(farmerInitialRep).to.equal(100n);
    console.log(`  [Step 1] Farmer registered with baseline reputation: ${farmerInitialRep}`);

    // 2. Buyer gets AGRI tokens from faucet
    await agriToken.connect(buyer).faucet();
    console.log(`  [Step 2] Buyer claimed faucet: ${ethers.formatEther(await agriToken.balanceOf(buyer.address))} AGRI`);

    // Fund buyer with extra tokens for wholesale purchase
    await agriToken.connect(admin).mint(buyer.address, ethers.parseEther("20000"));

    // 3. Farmer mints CropBatchNFT
    const harvestQuantity = 5000n; // 5000 kg
    const mintTx = await cropBatchNFT.connect(farmer).mintBatch(
      farmer.address,
      "ipfs://QmBasmatiRiceBatch001Metadata",
      "Basmati Rice Superfine",
      harvestQuantity,
      "kg",
      1718000000n,
      "Karnal, Haryana, India",
      "QmImageBasmatiCropPhotos"
    );
    await mintTx.wait();
    const tokenId = 1n;
    console.log(`  [Step 3] Farmer minted CropBatchNFT (Token ID: ${tokenId}) for ${harvestQuantity} kg Basmati Rice`);

    // 4. AI Oracle evaluates images and signs verification
    const grade = 1; // Grade A
    const confidenceScore = 9750; // 97.50%
    const reportHash = ethers.keccak256(ethers.toUtf8Bytes("Basmati Rice Grade A Inspection Report JSON"));

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const registryAddress = await oracleRegistry.getAddress();
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "uint8", "uint16", "bytes32"],
      [chainId, registryAddress, tokenId, grade, confidenceScore, reportHash]
    );
    const signature = await oracleNode.signMessage(ethers.getBytes(messageHash));

    // 5. Submit verification on-chain
    await oracleRegistry.submitVerification(tokenId, grade, confidenceScore, reportHash, signature);
    const batch = await cropBatchNFT.getBatch(tokenId);
    expect(batch.isVerified).to.be.true;
    expect(batch.qualityGrade).to.equal(1);
    console.log(`  [Step 4 & 5] AI Oracle verified Batch: Grade A (Confidence: 97.50%). Status verified on-chain!`);

    // 6. Farmer creates listing
    const pricePerKg = ethers.parseEther("2"); // 2 AGRI / kg
    await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), tokenId);
    await marketplace.connect(farmer).createListing(tokenId, pricePerKg, 1);
    console.log(`  [Step 6] Batch listed on marketplace at 2 AGRI/kg. NFT placed into custodial escrow.`);

    // 7. Buyer places order with escrow deposit (10,000 AGRI)
    const totalCost = pricePerKg * harvestQuantity; // 10,000 AGRI
    await agriToken.connect(buyer).approve(await marketplace.getAddress(), totalCost);
    await marketplace.connect(buyer).placeOrder(1n, harvestQuantity);
    const orderId = 1n;
    console.log(`  [Step 7] Buyer deposited 10,000 AGRI into escrow. Order #${orderId} created!`);

    // 8. Farmer ships order
    await marketplace.connect(farmer).shipOrder(orderId);
    console.log(`  [Step 8] Farmer marked Order #${orderId} as SHIPPED.`);

    // 9. Logistics carrier records checkpoints via Merkle Root
    const checkpoints = [
      { loc: "Karnal Farm Gate", time: 1718001000, temp: 220, note: "Loaded" },
      { loc: "Delhi NCR Hub", time: 1718005000, temp: 45, note: "Cold chain active" },
      { loc: "Jaipur Logistics Center", time: 1718012000, temp: 40, note: "In transit" },
      { loc: "Mumbai Port Terminal", time: 1718020000, temp: 42, note: "Delivered to dock" }
    ];
    const leaves = checkpoints.map(cp =>
      ethers.solidityPackedKeccak256(["string", "uint256", "int16", "string"], [cp.loc, cp.time, cp.temp, cp.note])
    );
    const tree = buildMerkleTree(leaves);
    await tracker.connect(carrier).submitCheckpointRoot(orderId, tree.root, "QmTransitBatchLogs");
    console.log(`  [Step 9] Carrier committed 4 transit checkpoints as Merkle Root: ${tree.root.slice(0, 18)}...`);

    // 10. Buyer independently verifies cold chain checkpoint with cryptographic proof
    const sampleProof = tree.getProof(1); // Delhi NCR checkpoint
    const isProven = await tracker.verifyCheckpoint.staticCall(orderId, leaves[1], sampleProof);
    expect(isProven).to.be.true;
    console.log(`  [Step 10] Cryptographic Merkle inclusion proof verified for cold-chain checkpoint!`);

    // 11. Buyer confirms delivery -> funds release
    const farmerBalanceBefore = await agriToken.balanceOf(farmer.address);
    const feeRecipientBefore = await agriToken.balanceOf(feeRecipient.address);

    await marketplace.connect(buyer).confirmDelivery(orderId);

    const expectedFee = (totalCost * 200n) / 10000n; // 2% = 200 AGRI
    const expectedPayout = totalCost - expectedFee; // 9,800 AGRI

    expect(await agriToken.balanceOf(farmer.address)).to.equal(farmerBalanceBefore + expectedPayout);
    expect(await agriToken.balanceOf(feeRecipient.address)).to.equal(feeRecipientBefore + expectedFee);
    expect(await cropBatchNFT.ownerOf(tokenId)).to.equal(buyer.address);

    const [farmerFinalRep] = await reputationSBT.getReputation(farmer.address);
    const [buyerFinalRep] = await reputationSBT.getReputation(buyer.address);
    expect(farmerFinalRep).to.equal(110n); // 100 + 10
    expect(buyerFinalRep).to.equal(110n);

    console.log(`  [Step 11 & 12] Delivery confirmed:`);
    console.log(`     - Farmer Payout:        ${ethers.formatEther(expectedPayout)} AGRI`);
    console.log(`     - Platform Fee (2%):    ${ethers.formatEther(expectedFee)} AGRI`);
    console.log(`     - CropBatchNFT Owner:   Transferred to Buyer (${buyer.address.slice(0, 10)}...)`);
    console.log(`     - Farmer Trust Score:   Boosted to ${farmerFinalRep}`);
    console.log(`     - Buyer Trust Score:    Boosted to ${buyerFinalRep}`);
    console.log(`  >>> JOURNEY A COMPLETED WITH 100% VERIFICATION! <<<\n`);
  });

  it("Full Journey B: Defective Delivery -> Dispute Raised -> Juror Voting -> Oracle Slashing & Full Buyer Refund", async function () {
    console.log("\n  >>> STARTING JOURNEY B: DEFECT DISPUTE, DAO VOTING & ORACLE SLASHING <<<");

    // Mint and verify a second batch
    await cropBatchNFT.connect(farmer).mintBatch(
      farmer.address,
      "ipfs://batchB",
      "Tomatoes",
      1000n,
      "kg",
      1718000000n,
      "Nashik, Maharashtra",
      "QmTomatoPhotos"
    );
    const tokenId = 1n;

    // Oracle erroneously graded as Grade A
    const messageHash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "uint256", "uint8", "uint16", "bytes32"],
      [(await ethers.provider.getNetwork()).chainId, await oracleRegistry.getAddress(), tokenId, 1, 9500, ethers.keccak256(ethers.toUtf8Bytes("TomatoReport"))]
    );
    const sig = await oracleNode.signMessage(ethers.getBytes(messageHash));
    await oracleRegistry.submitVerification(tokenId, 1, 9500, ethers.keccak256(ethers.toUtf8Bytes("TomatoReport")), sig);

    // List and order
    await cropBatchNFT.connect(farmer).approve(await marketplace.getAddress(), tokenId);
    await marketplace.connect(farmer).createListing(tokenId, ethers.parseEther("1"), 1); // 1 AGRI/kg -> 1000 AGRI total

    await agriToken.connect(admin).mint(buyer.address, ethers.parseEther("5000"));
    await agriToken.connect(buyer).approve(await marketplace.getAddress(), ethers.parseEther("1000"));
    await marketplace.connect(buyer).placeOrder(1n, 1000n);
    const orderId = 1n;
    await marketplace.connect(farmer).shipOrder(orderId);

    // Buyer receives spoiled produce -> raises dispute
    const disputeEvidenceHash = ethers.keccak256(ethers.toUtf8Bytes("Photos of rotten tomatoes on arrival"));
    await marketplace.connect(buyer).raiseDispute(orderId, disputeEvidenceHash);
    console.log(`  [Dispute] Buyer raised dispute on Order #${orderId} with photographic evidence hash.`);

    // Open dispute in DAO
    await disputeDAO.createDispute(orderId, buyer.address, farmer.address, oracleNode.address, disputeEvidenceHash);
    const disputeId = 1n;
    console.log(`  [Dispute] Case registered in DisputeDAO (Dispute ID: ${disputeId}).`);

    // Stake jurors
    await agriToken.connect(admin).mint(juror1.address, ethers.parseEther("4000"));
    await agriToken.connect(juror1).stake(ethers.parseEther("4000"));
    await agriToken.connect(admin).mint(juror2.address, ethers.parseEther("2000"));
    await agriToken.connect(juror2).stake(ethers.parseEther("2000"));

    // Juror1 votes REFUND_BUYER (4000 weight)
    await disputeDAO.connect(juror1).vote(disputeId, 1);
    // Juror2 votes PAY_FARMER (2000 weight)
    await disputeDAO.connect(juror2).vote(disputeId, 2);
    console.log(`  [Dispute] Jurors cast stake-weighted votes: 4,000 for REFUND_BUYER vs 2,000 for PAY_FARMER.`);

    // Advance past voting period
    await time.increase(2 * 24 * 3600 + 10);

    // Execute verdict
    const buyerBalanceBefore = await agriToken.balanceOf(buyer.address);
    await disputeDAO.resolveDispute(disputeId);

    // Verify buyer received full escrow refund + slashed oracle bond
    const orderEscrow = ethers.parseEther("1000");
    const oracleSlashPenalty = ethers.parseEther("1000");
    expect(await agriToken.balanceOf(buyer.address)).to.equal(buyerBalanceBefore + orderEscrow + oracleSlashPenalty);

    // Verify NFT returned to farmer
    expect(await cropBatchNFT.ownerOf(tokenId)).to.equal(farmer.address);

    // Verify oracle stake slashed
    const oracleProfile = await oracleRegistry.oracleNodes(oracleNode.address);
    expect(oracleProfile.slashedCount).to.equal(1n);

    console.log(`  [Dispute Settled]:`);
    console.log(`     - Verdict:              REFUND_BUYER (Majority: 4,000 votes)`);
    console.log(`     - Escrow Refund:        1,000 AGRI returned to Buyer`);
    console.log(`     - Oracle Slashed:       1,000 AGRI seized from Oracle Bond & paid to Buyer`);
    console.log(`     - NFT Custody:          Returned to Farmer`);
    console.log(`  >>> JOURNEY B COMPLETED WITH 100% VERIFICATION! <<<\n`);
  });
});
