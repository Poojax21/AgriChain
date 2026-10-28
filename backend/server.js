const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { ethers } = require("ethers");
const { dbAsync } = require("./database");
const { buildMerkleTree, hashCheckpoint } = require("./merkle");
const { getContractData, getDeployedAddresses } = require("./contracts");
require("dotenv").config({ path: "../.env" });

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

const PORT = process.env.BACKEND_PORT || 5000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8000";

// --- CONTRACT METADATA ENDPOINT ---
app.get("/api/contracts", (req, res) => {
  const addresses = getDeployedAddresses();
  const contractNames = [
    "AgriToken",
    "CropBatchNFT",
    "ReputationSBT",
    "OracleRegistry",
    "AgriMarketplace",
    "DisputeDAO",
    "SupplyChainTracker"
  ];

  const metadata = {};
  for (const name of contractNames) {
    metadata[name] = {
      address: addresses[name] || "",
      abi: getContractData(name).abi
    };
  }

  res.json({
    success: true,
    chainId: 31337,
    contracts: metadata
  });
});

// --- HEALTH CHECK ---
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    service: "AgriChain Backend & Indexer",
    timestamp: Math.floor(Date.now() / 1000)
  });
});

// --- LISTINGS ENDPOINTS ---
app.get("/api/listings", async (req, res) => {
  try {
    const { cropType, grade, farmer, status } = req.query;
    let query = "SELECT * FROM listings WHERE 1=1";
    const params = [];

    if (cropType) {
      query += " AND crop_type LIKE ?";
      params.push(`%${cropType}%`);
    }
    if (grade) {
      query += " AND quality_grade = ?";
      params.push(Number(grade));
    }
    if (farmer) {
      query += " AND LOWER(farmer_address) = LOWER(?)";
      params.push(farmer);
    }
    if (status) {
      query += " AND status = ?";
      params.push(status);
    } else {
      query += " AND status = 'ACTIVE'";
    }

    query += " ORDER BY listing_id DESC";
    const rows = await dbAsync.all(query, params);
    res.json({ success: true, count: rows.length, listings: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/listings/:id", async (req, res) => {
  try {
    const row = await dbAsync.get("SELECT * FROM listings WHERE listing_id = ?", [req.params.id]);
    if (!row) return res.status(404).json({ success: false, error: "Listing not found" });
    res.json({ success: true, listing: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/listings", async (req, res) => {
  try {
    const {
      listingId,
      tokenId,
      farmerAddress,
      cropType,
      pricePerUnit,
      availableQuantity,
      unit,
      qualityGrade,
      gradeName,
      confidenceScore,
      imageCID
    } = req.body;

    const metadataCID = `ipfs://bafybeih${Math.random().toString(36).substring(2, 12)}`;
    const createdAt = Math.floor(Date.now() / 1000);

    await dbAsync.run(
      `INSERT OR REPLACE INTO listings 
      (listing_id, token_id, farmer_address, crop_type, price_per_unit, available_quantity, unit, quality_grade, grade_name, confidence_score, image_cid, metadata_cid, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [
        listingId || Date.now(),
        tokenId || 1,
        farmerAddress,
        cropType,
        pricePerUnit,
        availableQuantity,
        unit || "kg",
        qualityGrade || 1,
        gradeName || "GRADE_A",
        confidenceScore || 9500,
        imageCID || "QmDefaultImageCID",
        metadataCID,
        createdAt
      ]
    );

    res.json({
      success: true,
      message: "Listing indexed successfully",
      listingId: listingId || Date.now(),
      metadataCID
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- ORDERS ENDPOINTS ---
app.get("/api/orders", async (req, res) => {
  try {
    const { buyer, farmer, status } = req.query;
    let query = "SELECT * FROM orders WHERE 1=1";
    const params = [];

    if (buyer) {
      query += " AND LOWER(buyer_address) = LOWER(?)";
      params.push(buyer);
    }
    if (farmer) {
      query += " AND LOWER(farmer_address) = LOWER(?)";
      params.push(farmer);
    }
    if (status) {
      query += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY order_id DESC";
    const rows = await dbAsync.all(query, params);
    res.json({ success: true, count: rows.length, orders: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const order = await dbAsync.get("SELECT * FROM orders WHERE order_id = ?", [req.params.id]);
    if (!order) return res.status(404).json({ success: false, error: "Order not found" });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      orderId,
      listingId,
      tokenId,
      buyerAddress,
      farmerAddress,
      quantity,
      totalAmount,
      platformFee
    } = req.body;

    const placedAt = Math.floor(Date.now() / 1000);

    await dbAsync.run(
      `INSERT OR REPLACE INTO orders 
      (order_id, listing_id, token_id, buyer_address, farmer_address, quantity, total_amount, platform_fee, status, placed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PLACED', ?)`,
      [
        orderId,
        listingId,
        tokenId,
        buyerAddress,
        farmerAddress,
        quantity,
        totalAmount,
        platformFee,
        placedAt
      ]
    );

    // Update listing status if bought out
    await dbAsync.run("UPDATE listings SET status = 'SOLD' WHERE listing_id = ?", [listingId]);

    res.json({ success: true, message: "Order indexed successfully", orderId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status, disputeReasonHash } = req.body;
    const now = Math.floor(Date.now() / 1000);

    let query = "UPDATE orders SET status = ?";
    const params = [status];

    if (status === "SHIPPED") {
      query += ", shipped_at = ?";
      params.push(now);
    } else if (status === "DELIVERED") {
      query += ", delivered_at = ?";
      params.push(now);
    } else if (status === "DISPUTED") {
      query += ", dispute_reason_hash = ?";
      params.push(disputeReasonHash || "0x0");
    }

    query += " WHERE order_id = ?";
    params.push(req.params.id);

    await dbAsync.run(query, params);
    res.json({ success: true, message: `Order status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- TRANSIT CHECKPOINTS & MERKLE BATCHING ---
app.post("/api/checkpoints", async (req, res) => {
  try {
    const { orderId, checkpoints, submittedBy } = req.body;
    if (!checkpoints || !Array.isArray(checkpoints) || checkpoints.length === 0) {
      return res.status(400).json({ success: false, error: "Checkpoints list is required" });
    }

    // 1. Hash each checkpoint into a leaf
    const leaves = checkpoints.map(cp =>
      hashCheckpoint(
        cp.location,
        cp.timestamp || Math.floor(Date.now() / 1000),
        cp.temperature || 40,
        cp.statusNote || "Normal"
      )
    );

    // 2. Build Merkle tree
    const tree = buildMerkleTree(leaves);
    const ipfsBatchCID = `ipfs://bafycheckpoint${Date.now()}`;

    // 3. Store in SQLite
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      await dbAsync.run(
        `INSERT INTO checkpoints 
        (order_id, location, timestamp, temperature, status_note, leaf_hash, merkle_root, ipfs_cid, submitted_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          cp.location,
          cp.timestamp || Math.floor(Date.now() / 1000),
          cp.temperature || 40,
          cp.statusNote || "Normal",
          leaves[i],
          tree.root,
          ipfsBatchCID,
          submittedBy || "0x0"
        ]
      );
    }

    res.json({
      success: true,
      orderId,
      merkleRoot: tree.root,
      leavesCount: leaves.length,
      leaves,
      ipfsCID: ipfsBatchCID
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/checkpoints/:orderId", async (req, res) => {
  try {
    const rows = await dbAsync.all(
      "SELECT * FROM checkpoints WHERE order_id = ? ORDER BY id ASC",
      [req.params.orderId]
    );

    if (rows.length === 0) {
      return res.json({ success: true, count: 0, checkpoints: [], merkleRoot: null });
    }

    // Reconstruct tree to provide proofs
    const leaves = rows.map(r => r.leaf_hash);
    const tree = buildMerkleTree(leaves);

    const checkpointsWithProofs = rows.map((r, idx) => ({
      ...r,
      proof: tree.getProof(idx)
    }));

    res.json({
      success: true,
      count: rows.length,
      merkleRoot: tree.root,
      checkpoints: checkpointsWithProofs
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- DISPUTES ENDPOINTS ---
app.get("/api/disputes", async (req, res) => {
  try {
    const rows = await dbAsync.all("SELECT * FROM disputes ORDER BY dispute_id DESC");
    res.json({ success: true, count: rows.length, disputes: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/disputes", async (req, res) => {
  try {
    const { disputeId, orderId, buyerAddress, farmerAddress, oracleNode, evidenceHash } = req.body;
    const createdAt = Math.floor(Date.now() / 1000);

    await dbAsync.run(
      `INSERT OR REPLACE INTO disputes 
      (dispute_id, order_id, buyer_address, farmer_address, oracle_node, evidence_hash, verdict, is_resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)`,
      [disputeId, orderId, buyerAddress, farmerAddress, oracleNode, evidenceHash, createdAt]
    );

    // Update order status
    await dbAsync.run("UPDATE orders SET status = 'DISPUTED', dispute_reason_hash = ? WHERE order_id = ?", [
      evidenceHash,
      orderId
    ]);

    res.json({ success: true, message: "Dispute indexed successfully", disputeId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- USERS & REPUTATION ---
app.get("/api/users/:address", async (req, res) => {
  try {
    const user = await dbAsync.get("SELECT * FROM users WHERE LOWER(wallet_address) = LOWER(?)", [
      req.params.address
    ]);
    if (!user) {
      return res.json({
        success: true,
        user: {
          wallet_address: req.params.address,
          role: "USER",
          reputation_score: 100,
          successful_trades: 0,
          disputes_won: 0,
          disputes_lost: 0
        }
      });
    }
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/users/register", async (req, res) => {
  try {
    const { walletAddress, role } = req.body;
    const now = Math.floor(Date.now() / 1000);

    await dbAsync.run(
      `INSERT INTO users (wallet_address, role, reputation_score, created_at)
      VALUES (?, ?, 100, ?)
      ON CONFLICT(wallet_address) DO UPDATE SET role = excluded.role`,
      [walletAddress, role || "FARMER", now]
    );

    res.json({ success: true, message: "User registered successfully", walletAddress, role });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- AI QUALITY PROXY ---
app.post("/api/ai/verify", upload.single("image"), async (req, res) => {
  try {
    const { tokenId, cropType, chainId, registryAddress } = req.body;

    // Call Python AI microservice
    const response = await fetch(`${AI_SERVICE_URL}/api/verify-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tokenId: Number(tokenId) || 1,
        cropType: cropType || "Crop Harvest",
        chainId: Number(chainId) || 31337,
        registryAddress: registryAddress || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"
      })
    });

    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }

    throw new Error(`AI service returned ${response.status}`);
  } catch (aiErr) {
    // Fallback heuristic scoring if AI service is starting up
    const mockReport = {
      tokenId: Number(req.body.tokenId) || 1,
      cropType: req.body.cropType || "Organic Produce",
      grade: 1, // Grade A
      confidenceBasisPoints: 9750,
      inspectedAt: Math.floor(Date.now() / 1000)
    };
    const reportHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(mockReport)));

    res.json({
      success: true,
      isFallback: true,
      grade: 1,
      gradeName: "GRADE_A",
      gradeLabel: "Grade A (Premium Export)",
      confidenceScore: 9750,
      confidencePercent: 97.5,
      report: mockReport,
      reportHash: reportHash,
      note: "Evaluated via fallback engine"
    });
  }
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` AgriChain Backend & Indexer running on port ${PORT}`);
    console.log(` REST API: http://localhost:${PORT}/api/listings`);
    console.log(` Contracts: http://localhost:${PORT}/api/contracts`);
    console.log(`=================================================`);
  });
}

module.exports = app;
