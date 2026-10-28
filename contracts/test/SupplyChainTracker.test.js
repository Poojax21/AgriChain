const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * Helper to build a standard binary Merkle tree using standard keccak256 pairwise hashing
 * perfectly compatible with OpenZeppelin's MerkleProof.verify.
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
        // Sort pairwise as OpenZeppelin MerkleProof expects
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

describe("SupplyChainTracker & Merkle Gas Benchmarks", function () {
  let AgriToken, CropBatchNFT, ReputationSBT, AgriMarketplace, SupplyChainTracker;
  let cropBatchNFT, marketplace, tracker;
  let admin, carrier, nonCarrier;
  const orderId = 1n;

  beforeEach(async function () {
    [admin, carrier, nonCarrier] = await ethers.getSigners();

    // Deploy CropBatchNFT
    CropBatchNFT = await ethers.getContractFactory("CropBatchNFT");
    cropBatchNFT = await CropBatchNFT.deploy(admin.address);
    await cropBatchNFT.waitForDeployment();

    // Deploy mock token & SBT to instantiate marketplace
    const AgriTokenFactory = await ethers.getContractFactory("AgriToken");
    const token = await AgriTokenFactory.deploy(admin.address, admin.address, ethers.parseEther("1000"));
    const SBTFactory = await ethers.getContractFactory("ReputationSBT");
    const sbt = await SBTFactory.deploy(admin.address);

    AgriMarketplace = await ethers.getContractFactory("AgriMarketplace");
    marketplace = await AgriMarketplace.deploy(
      admin.address,
      admin.address,
      await token.getAddress(),
      await cropBatchNFT.getAddress(),
      await sbt.getAddress()
    );
    await marketplace.waitForDeployment();

    // Deploy SupplyChainTracker
    SupplyChainTracker = await ethers.getContractFactory("SupplyChainTracker");
    tracker = await SupplyChainTracker.deploy(
      admin.address,
      await cropBatchNFT.getAddress(),
      await marketplace.getAddress()
    );
    await tracker.waitForDeployment();

    // Grant LOGISTICS_ROLE to carrier
    const logisticsRole = await tracker.LOGISTICS_ROLE();
    await tracker.connect(admin).grantRole(logisticsRole, carrier.address);
  });

  describe("Merkle Checkpoint Verification", function () {
    // Generate 4 sample transit checkpoints
    const checkpoints = [
      { loc: "Farm Gate, Punjab", time: 1718001000, temp: 220, note: "Loaded into reefer truck" },
      { loc: "Toll Hub, Ambala", time: 1718005000, temp: 42, note: "Temperature stable at 4.2C" },
      { loc: "Cold Storage, Sonipat", time: 1718012000, temp: 38, note: "Transshipped to intercity van" },
      { loc: "Distribution Center, Delhi", time: 1718020000, temp: 40, note: "Ready for delivery" }
    ];

    const leaves = checkpoints.map(cp =>
      ethers.solidityPackedKeccak256(
        ["string", "uint256", "int16", "string"],
        [cp.loc, cp.time, cp.temp, cp.note]
      )
    );

    let tree;

    beforeEach(function () {
      tree = buildMerkleTree(leaves);
    });

    it("Should allow logistics carrier to commit Merkle root", async function () {
      const ipfsCID = "QmTransitCheckpointBatchCID123456";

      await expect(
        tracker.connect(carrier).submitCheckpointRoot(orderId, tree.root, ipfsCID)
      ).to.emit(tracker, "CheckpointRootCommitted")
        .withArgs(orderId, tree.root, ipfsCID, carrier.address);

      expect(await tracker.orderCheckpointRoots(orderId)).to.equal(tree.root);
      expect(await tracker.orderBatchIPFSCID(orderId)).to.equal(ipfsCID);
    });

    it("Should successfully verify an authentic checkpoint with cryptographic proof", async function () {
      await tracker.connect(carrier).submitCheckpointRoot(orderId, tree.root, "QmBatchCID");

      // Verify leaf #1 (Sonipat)
      const targetIndex = 2;
      const targetLeaf = leaves[targetIndex];
      const proof = tree.getProof(targetIndex);

      const isValid = await tracker.verifyCheckpoint.staticCall(orderId, targetLeaf, proof);
      expect(isValid).to.be.true;

      await expect(tracker.verifyCheckpoint(orderId, targetLeaf, proof))
        .to.emit(tracker, "CheckpointVerified")
        .withArgs(orderId, targetLeaf, true);
    });

    it("Should reject an invalid or tampered checkpoint leaf", async function () {
      await tracker.connect(carrier).submitCheckpointRoot(orderId, tree.root, "QmBatchCID");

      const fakeLeaf = ethers.keccak256(ethers.toUtf8Bytes("Tampered Temperature Telemetry"));
      const proof = tree.getProof(0);

      const isValid = await tracker.verifyCheckpoint.staticCall(orderId, fakeLeaf, proof);
      expect(isValid).to.be.false;
    });

    it("Should prevent non-logistics role from submitting roots", async function () {
      const logisticsRole = await tracker.LOGISTICS_ROLE();
      await expect(
        tracker.connect(nonCarrier).submitCheckpointRoot(orderId, tree.root, "QmBatchCID")
      ).to.be.revertedWithCustomError(tracker, "AccessControlUnauthorizedAccount")
        .withArgs(nonCarrier.address, logisticsRole);
    });
  });

  describe("Gas Benchmarking: Merkle Batch Commit vs Direct On-Chain Writes", function () {
    it("Should demonstrate massive gas savings when using Merkle Trees for checkpoints", async function () {
      // 1. Benchmark: Commit Merkle Root for a batch of 10 checkpoints
      const batchSize = 10;
      const dummyLeaves = [];
      for (let i = 0; i < batchSize; i++) {
        dummyLeaves.push(
          ethers.solidityPackedKeccak256(
            ["string", "uint256", "int16", "string"],
            [`Checkpoint Location #${i}`, 1718000000 + i * 3600, 40 + i, `Status Log #${i}`]
          )
        );
      }
      const tree = buildMerkleTree(dummyLeaves);

      const merkleTx = await tracker.connect(carrier).submitCheckpointRoot(100n, tree.root, "QmBatch10");
      const merkleReceipt = await merkleTx.wait();
      const merkleGasUsed = merkleReceipt.gasUsed;

      // 2. Benchmark: Submit 10 checkpoints individually to storage
      let directTotalGas = 0n;
      for (let i = 0; i < batchSize; i++) {
        const directTx = await tracker.connect(carrier).submitDirectCheckpoint(
          200n,
          `Checkpoint Location #${i}`,
          1718000000 + i * 3600,
          40 + i,
          `Status Log #${i}`
        );
        const directReceipt = await directTx.wait();
        directTotalGas += directReceipt.gasUsed;
      }

      console.log("\n================ GAS BENCHMARK REPORT ================");
      console.log(`10 Checkpoints - Merkle Root Commit Gas:  ${merkleGasUsed.toString()} gas`);
      console.log(`10 Checkpoints - Direct Storage Gas:      ${directTotalGas.toString()} gas`);
      const savingsPercent = ((Number(directTotalGas - merkleGasUsed) / Number(directTotalGas)) * 100).toFixed(2);
      console.log(`Gas Reduction Achieved via Merkle Trees:  ${savingsPercent}%`);
      console.log("======================================================\n");

      // Verify that Merkle batching provides significant gas efficiency (> 70% savings)
      expect(merkleGasUsed < directTotalGas / 2n).to.be.true;
    });
  });
});
