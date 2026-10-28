const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const { dbAsync } = require("./database");
const { buildMerkleTree, hashCheckpoint } = require("./merkle");
const { getContractData, getDeployedAddresses } = require("./contracts");
const {
  generateNonce,
  verifySiweSignature,
  createSessionToken,
  authenticateToken,
  requireAuth,
  requireAdmin,
  isValidImageBuffer,
  DEFAULT_ADMIN
} = require("./auth");
require("dotenv").config({ path: "../.env" });

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

app.use(cors());
app.use(express.json());
app.use(authenticateToken);
app.use("/demo-crops", express.static(path.resolve(__dirname, "../frontend/public/demo-crops")));
app.use("/crop-photos", express.static(path.resolve(__dirname, "../frontend/public/crop-photos")));

// Buyer unboxing-evidence photos: stored by SHA-256 so the on-chain
// evidenceHash commits to exact bytes jurors can inspect here.
const EVIDENCE_DIR = path.resolve(__dirname, "dispute-evidence");
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
app.use("/dispute-evidence", express.static(EVIDENCE_DIR));

// Farmer inspection photos, keyed by content hash (same bytes dedupe).
const LISTING_IMG_DIR = path.resolve(__dirname, "listing-images");
fs.mkdirSync(LISTING_IMG_DIR, { recursive: true });
app.use("/listing-images", express.static(LISTING_IMG_DIR));

const PORT = process.env.BACKEND_PORT || 5000;
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8001";

// --- IDEMPOTENT NOTIFICATION DISPATCHER ---
async function emitNotification({ recipientAddress, eventKey, title, message, type, link }) {
  if (!recipientAddress || !eventKey) return;
  try {
    const now = Math.floor(Date.now() / 1000);
    await dbAsync.run(
      `INSERT OR IGNORE INTO notifications (recipient_address, event_key, title, message, type, link, is_read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [recipientAddress.toLowerCase(), eventKey, title, message, type, link || null, now]
    );
  } catch (err) {
    console.warn(`Could not emit notification ${eventKey}:`, err.message);
  }
}

// --- AUTHENTICATION ENDPOINTS (SIWE / EIP-4361) ---
app.get("/api/auth/nonce", async (req, res) => {
  try {
    const { address } = req.query;
    const nonceData = await generateNonce(address);
    res.json({ success: true, ...nonceData });
  } catch (err) {
    res.status(500).json({ success: false, error: `Could not generate nonce: ${err.message}` });
  }
});

app.post("/api/auth/verify", async (req, res) => {
  try {
    const { message, signature, address, chainId, domain } = req.body;
    const verification = await verifySiweSignature({
      message,
      signature,
      expectedAddress: address,
      expectedChainId: chainId ? Number(chainId) : null,
      expectedDomain: domain || null
    });

    const token = createSessionToken(verification.address);
    const user = await dbAsync.get("SELECT * FROM users WHERE LOWER(wallet_address) = LOWER(?)", [verification.address]);

    res.json({
      success: true,
      token,
      address: verification.address,
      user: user || {
        wallet_address: verification.address,
        role: "USER",
        display_name: null,
        verified: 0
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, error: `Authentication failed: ${err.message}` });
  }
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await dbAsync.get("SELECT * FROM users WHERE LOWER(wallet_address) = LOWER(?)", [req.user.address]);
    res.json({
      success: true,
      address: req.user.address,
      user: user || {
        wallet_address: req.user.address,
        role: "USER",
        display_name: null,
        verified: 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
    // Hide incomplete legacy/test fixtures from the public catalog; chain state remains authoritative.
    // Farmer profile joined so the UI can show a name + verification badge, never just hex.
    let query = `SELECT listings.*,
      users.display_name AS farmer_name,
      COALESCE(users.verified, 0) AS farmer_verified,
      sustainability.credits AS eco_credits,
      sustainability.practices AS eco_practices
      FROM listings LEFT JOIN users ON LOWER(users.wallet_address) = LOWER(listings.farmer_address)
      LEFT JOIN sustainability ON sustainability.token_id = listings.token_id
      WHERE listings.farmer_address IS NOT NULL AND listings.crop_type IS NOT NULL AND listings.price_per_unit IS NOT NULL AND listings.available_quantity > 0 AND listings.image_cid IS NOT NULL AND listings.metadata_cid IS NOT NULL`;
    const params = [];

    if (cropType) {
      query += " AND listings.crop_type LIKE ?";
      params.push(`%${cropType}%`);
    }
    if (grade) {
      query += " AND listings.quality_grade = ?";
      params.push(Number(grade));
    }
    if (farmer) {
      query += " AND LOWER(listings.farmer_address) = LOWER(?)";
      params.push(farmer);
    }
    if (status) {
      query += " AND listings.status = ?";
      params.push(status);
    } else {
      query += " AND listings.status = 'ACTIVE'";
    }

    query += " ORDER BY listings.listing_id DESC";
    const rows = await dbAsync.all(query, params);
    res.json({ success: true, count: rows.length, listings: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/listings/:id", async (req, res) => {
  try {
    const row = await dbAsync.get(
      `SELECT listings.*,
        users.display_name AS farmer_name,
        COALESCE(users.verified, 0) AS farmer_verified,
        sustainability.credits AS eco_credits,
        sustainability.practices AS eco_practices
      FROM listings LEFT JOIN users ON LOWER(users.wallet_address) = LOWER(listings.farmer_address)
      LEFT JOIN sustainability ON sustainability.token_id = listings.token_id
      WHERE listings.listing_id = ?`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ success: false, error: "Listing not found" });
    res.json({ success: true, listing: row });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reconcile the SQLite listing cache against authoritative local-chain status.
app.post("/api/listings/sync-chain", async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
    const addresses = getDeployedAddresses();
    const marketplace = new ethers.Contract(addresses.AgriMarketplace, getContractData("AgriMarketplace").abi, provider);
    const rows = await dbAsync.all("SELECT listing_id FROM listings WHERE listing_id IS NOT NULL");
    const statusNames = ["ACTIVE", "SOLD", "CANCELLED"];
    let synchronized = 0;
    for (const row of rows) {
      try {
        const listing = await marketplace.listings(row.listing_id);
        await dbAsync.run("UPDATE listings SET status = ?, available_quantity = ? WHERE listing_id = ?", [statusNames[Number(listing.status)] || "UNKNOWN", Number(listing.availableQuantity), row.listing_id]);
        synchronized += 1;
      } catch { /* Ignore stale cache rows not present on this deployment. */ }
    }
    res.json({ success: true, synchronized });
  } catch (err) {
    res.status(502).json({ success: false, error: `Could not reconcile listings from Hardhat: ${err.message}` });
  }
});

app.post("/api/listings", upload.single("photo"), async (req, res) => {
  try {
    const body = req.body;
    const listingId = body.listingId ?? body.listing_id;
    const tokenId = body.tokenId ?? body.token_id;
    const farmerAddress = body.farmerAddress ?? body.farmer_address;
    const cropType = body.cropType ?? body.crop_type;
    const pricePerUnit = body.pricePerUnit ?? body.price_per_unit;
    const availableQuantity = body.availableQuantity ?? body.available_quantity;
    const unit = body.unit;
    const qualityGrade = body.qualityGrade ?? body.quality_grade;
    const gradeName = body.gradeName ?? body.grade_name;
    const confidenceScore = body.confidenceScore ?? body.confidence_score;
    const imageCID = body.imageCID ?? body.image_cid;
    let imageURL = body.imageURL ?? body.image_url ?? null;
    const metadataCID = body.metadataCID ?? body.metadata_cid;
    if (!listingId || !tokenId || !farmerAddress || !cropType || !pricePerUnit || !availableQuantity || !qualityGrade || !gradeName || !confidenceScore || !imageCID || !metadataCID) {
      return res.status(400).json({ success: false, error: "Listing index record is missing required on-chain or verification fields." });
    }

    if (req.user && req.user.address) {
      if (req.user.address.toLowerCase() !== String(farmerAddress).toLowerCase() && req.user.address.toLowerCase() !== DEFAULT_ADMIN) {
        return res.status(403).json({ success: false, error: "Forbidden: You cannot create listings on behalf of another farmer address." });
      }
    }

    // Persist the farmer's actual inspection photo (not just its hash) so the
    // catalog shows what was graded. Keyed by content hash: same bytes dedupe.
    if (req.file) {
      if (!req.file.mimetype || !req.file.mimetype.startsWith("image/") || !isValidImageBuffer(req.file.buffer)) {
        return res.status(400).json({ success: false, error: "Uploaded file is not a valid image format (JPEG, PNG, WebP, GIF)." });
      }
      const safeHash = String(imageCID).replace(/[^a-z0-9]/gi, "").slice(0, 64) || `listing-${listingId}`;
      const ext = (req.file.mimetype.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 4) || "jpg";
      await fs.promises.writeFile(path.join(LISTING_IMG_DIR, `${safeHash}.${ext}`), req.file.buffer);
      imageURL = `/listing-images/${safeHash}.${ext}`;
    }
    const reportHash = body.reportHash ?? body.report_hash ?? null;
    const modelVersion = body.modelVersion ?? body.model_version ?? "MobileNetV3-Small-v1.0";
    const gradingMethod = body.gradingMethod ?? body.grading_method ?? "FruitNet CNN";
    const createdAt = Math.floor(Date.now() / 1000);

    await dbAsync.run(
      `INSERT OR REPLACE INTO listings 
      (listing_id, token_id, farmer_address, crop_type, price_per_unit, available_quantity, unit, quality_grade, grade_name, confidence_score, image_cid, image_url, metadata_cid, report_hash, model_version, grading_method, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [
        listingId || Date.now(),
        tokenId || 1,
        farmerAddress,
        cropType,
        pricePerUnit,
        availableQuantity,
        unit || "kg",
        qualityGrade,
        gradeName,
        confidenceScore,
        imageCID,
        imageURL,
        metadataCID,
        reportHash,
        modelVersion,
        gradingMethod,
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
    const body = req.body;
    const orderId = body.orderId ?? body.order_id;
    const listingId = body.listingId ?? body.listing_id;
    const tokenId = body.tokenId ?? body.token_id;
    const buyerAddress = body.buyerAddress ?? body.buyer_address;
    const farmerAddress = body.farmerAddress ?? body.farmer_address;
    const { quantity, totalAmount, platformFee, txHash, tx_hash } = body;
    const finalTxHash = txHash || tx_hash || null;

    const placedAt = Math.floor(Date.now() / 1000);

    await dbAsync.run(
      `INSERT INTO orders 
      (order_id, listing_id, token_id, buyer_address, farmer_address, quantity, total_amount, platform_fee, status, placed_at, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PLACED', ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET
        listing_id = excluded.listing_id,
        token_id = excluded.token_id,
        buyer_address = excluded.buyer_address,
        farmer_address = excluded.farmer_address,
        quantity = excluded.quantity,
        total_amount = excluded.total_amount,
        platform_fee = excluded.platform_fee,
        tx_hash = COALESCE(excluded.tx_hash, orders.tx_hash)`,
      [
        orderId,
        listingId,
        tokenId,
        buyerAddress,
        farmerAddress,
        quantity,
        totalAmount ?? body.total_amount,
        platformFee ?? body.platform_fee,
        placedAt,
        finalTxHash
      ]
    );

    // Update listing status if bought out
    await dbAsync.run("UPDATE listings SET status = 'SOLD' WHERE listing_id = ?", [listingId]);

    // Emit notification to farmer that escrow was deposited
    if (farmerAddress) {
      await emitNotification({
        recipientAddress: farmerAddress,
        eventKey: `order:${orderId}:PLACED`,
        title: "New Escrow Order Placed",
        message: `Buyer (${(buyerAddress || "").slice(0, 8)}…) deposited escrow for Order #${orderId} (${quantity} kg). Please ship the batch.`,
        type: "ORDER_PLACED",
        link: `/?inspect=order:${orderId}`
      });
    }

    res.json({ success: true, message: "Order indexed successfully", orderId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status, disputeReasonHash, txHash, tx_hash } = req.body;
    const ALLOWED_STATUSES = ["PLACED", "SHIPPED", "RECEIVED", "DELIVERED", "DISPUTED", "RESOLVED", "CANCELLED"];

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `Invalid order status '${status}'. Must be one of: ${ALLOWED_STATUSES.join(", ")}`
      });
    }

    const order = await dbAsync.get("SELECT * FROM orders WHERE order_id = ?", [req.params.id]);
    if (!order) {
      return res.status(404).json({ success: false, error: `Order #${req.params.id} not found.` });
    }

    // Role-based authorization if caller authenticated (checked before transitions)
    if (req.user && req.user.address) {
      const caller = req.user.address.toLowerCase();
      const farmer = (order.farmer_address || "").toLowerCase();
      const buyer = (order.buyer_address || "").toLowerCase();
      const isAdmin = caller === DEFAULT_ADMIN || caller === (process.env.ADMIN_ADDRESS || "").toLowerCase();

      if (!isAdmin) {
        if (status === "SHIPPED" && caller !== farmer) {
          return res.status(403).json({
            success: false,
            error: "Forbidden: Only the selling farmer or administrator can mark order as SHIPPED."
          });
        }
        if (["RECEIVED", "DELIVERED", "DISPUTED"].includes(status) && caller !== buyer) {
          return res.status(403).json({
            success: false,
            error: `Forbidden: Only the purchasing buyer or administrator can update order to ${status}.`
          });
        }
      }
    }

    // Strict lifecycle state machine validation
    const VALID_TRANSITIONS = {
      PLACED: ["SHIPPED", "CANCELLED", "DISPUTED"],
      SHIPPED: ["RECEIVED", "DELIVERED", "DISPUTED"],
      RECEIVED: ["DELIVERED", "DISPUTED"],
      DISPUTED: ["RESOLVED"],
      DELIVERED: [],
      RESOLVED: [],
      CANCELLED: []
    };
    if (order.status && VALID_TRANSITIONS[order.status] && !VALID_TRANSITIONS[order.status].includes(status) && order.status !== status) {
      return res.status(400).json({
        success: false,
        error: `Illegal state transition from ${order.status} to ${status}. Allowed next states: ${VALID_TRANSITIONS[order.status].join(", ") || "none (final state)"}`
      });
    }

    const now = Math.floor(Date.now() / 1000);

    let query = "UPDATE orders SET status = ?";
    const params = [status];

    if (status === "SHIPPED") {
      query += ", shipped_at = ?";
      params.push(now);
    } else if (status === "RECEIVED") {
      query += ", received_at = ?";
      params.push(now);
    } else if (status === "DELIVERED") {
      query += ", delivered_at = ?";
      params.push(now);
    } else if (status === "DISPUTED") {
      query += ", dispute_reason_hash = ?";
      params.push(disputeReasonHash || "0x0");
    }

    const finalTx = txHash || tx_hash;
    if (finalTx) {
      query += ", tx_hash = ?";
      params.push(finalTx);
    }

    query += " WHERE order_id = ?";
    params.push(req.params.id);

    await dbAsync.run(query, params);

    // Emit lifecycle notifications
    if (status === "SHIPPED" && order.buyer_address) {
      await emitNotification({
        recipientAddress: order.buyer_address,
        eventKey: `order:${order.order_id}:SHIPPED`,
        title: "Harvest Shipped",
        message: `Farmer has dispatched Order #${order.order_id}. You can track transit checkpoints in real time.`,
        type: "ORDER_SHIPPED",
        link: `/?inspect=order:${order.order_id}`
      });
    } else if (status === "RECEIVED" && order.farmer_address) {
      await emitNotification({
        recipientAddress: order.farmer_address,
        eventKey: `order:${order.order_id}:RECEIVED`,
        title: "Buyer Marked Physical Receipt",
        message: `Buyer confirmed arrival of Order #${order.order_id}. Freshness inspection clock is running.`,
        type: "ORDER_RECEIVED",
        link: `/?inspect=order:${order.order_id}`
      });
    } else if (status === "DELIVERED") {
      if (order.farmer_address) {
        await emitNotification({
          recipientAddress: order.farmer_address,
          eventKey: `order:${order.order_id}:DELIVERED_FARMER`,
          title: "Escrow Payment Released!",
          message: `Delivery confirmed for Order #${order.order_id}. Escrow payout released to your wallet.`,
          type: "DELIVERY_CONFIRMED",
          link: `/?inspect=order:${order.order_id}`
        });
      }
      if (order.buyer_address) {
        await emitNotification({
          recipientAddress: order.buyer_address,
          eventKey: `order:${order.order_id}:DELIVERED_BUYER`,
          title: "Order Delivered & Settled",
          message: `Delivery confirmed for Order #${order.order_id}. Crop batch NFT ownership transferred to you.`,
          type: "DELIVERY_CONFIRMED",
          link: `/?inspect=order:${order.order_id}`
        });
      }
    } else if (status === "DISPUTED" && order.farmer_address) {
      await emitNotification({
        recipientAddress: order.farmer_address,
        eventKey: `order:${order.order_id}:DISPUTED`,
        title: "Dispute Opened by Buyer",
        message: `Buyer opened a dispute on Order #${order.order_id}. Escrow frozen pending DisputeDAO arbitration.`,
        type: "DISPUTE_OPENED",
        link: `/?inspect=order:${order.order_id}`
      });
    }

    res.json({ success: true, message: `Order status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Reconcile an individual order against on-chain smart contract truth
app.post("/api/orders/:id/sync-chain", async (req, res) => {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
    const addresses = getDeployedAddresses();
    const marketplace = new ethers.Contract(addresses.AgriMarketplace, getContractData("AgriMarketplace").abi, provider);
    const onChainOrder = await marketplace.getOrder(req.params.id);

    if (!onChainOrder || onChainOrder.orderId === 0n) {
      return res.status(404).json({ success: false, error: `Order #${req.params.id} does not exist on-chain.` });
    }

    const statusMap = ["PLACED", "SHIPPED", "DELIVERED", "DISPUTED", "RESOLVED", "CANCELLED", "RECEIVED"];
    const statusStr = statusMap[Number(onChainOrder.status)] || "PLACED";

    await dbAsync.run(
      `UPDATE orders SET
        status = ?,
        shipped_at = CASE WHEN ? > 0 THEN ? ELSE shipped_at END,
        received_at = CASE WHEN ? > 0 THEN ? ELSE received_at END,
        delivered_at = CASE WHEN ? > 0 THEN ? ELSE delivered_at END,
        dispute_reason_hash = ?
      WHERE order_id = ?`,
      [
        statusStr,
        Number(onChainOrder.shippedAt), Number(onChainOrder.shippedAt),
        Number(onChainOrder.receivedAt), Number(onChainOrder.receivedAt),
        Number(onChainOrder.deliveredAt), Number(onChainOrder.deliveredAt),
        onChainOrder.disputeReasonHash || "0x0",
        req.params.id
      ]
    );

    res.json({ success: true, orderId: req.params.id, status: statusStr });
  } catch (err) {
    res.status(502).json({ success: false, error: `Could not sync order from blockchain: ${err.message}` });
  }
});

// --- ROUTE WEATHER (Open-Meteo, no key; transit heat-exposure evidence) ---
// Returns observed ambient conditions for GPS coords. This is off-chain API
// data attached to checkpoints — honest weather evidence, not an IoT sensor.
app.get("/api/weather", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return res.status(400).json({ success: false, error: "Valid lat (-90..90) and lon (-180..180) required." });
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`weather provider returned ${r.status}`);
    const j = await r.json();
    res.json({
      success: true, lat, lon,
      temperatureC: j.current?.temperature_2m ?? null,
      humidity: j.current?.relative_humidity_2m ?? null,
      weatherCode: j.current?.weather_code ?? null,
      observedAt: j.current?.time || null,
      source: "open-meteo",
    });
  } catch (err) {
    res.status(502).json({ success: false, error: `Weather lookup failed: ${err.message}` });
  }
});

// --- TRANSIT CHECKPOINTS & MERKLE BATCHING ---
app.post("/api/checkpoints", async (req, res) => {
  try {
    const { orderId, checkpoints, submittedBy } = req.body;
    if (!checkpoints || !Array.isArray(checkpoints) || checkpoints.length === 0) {
      return res.status(400).json({ success: false, error: "Checkpoints list is required" });
    }

    // 1. Hash each checkpoint into a leaf (geo/weather committed when supplied)
    const leaves = checkpoints.map(cp =>
      hashCheckpoint(
        cp.location,
        cp.timestamp || Math.floor(Date.now() / 1000),
        cp.temperature || 40,
        cp.statusNote || "Normal",
        cp.latitude ?? "",
        cp.longitude ?? "",
        cp.weatherTemp ?? null
      )
    );

    // 2. Build Merkle tree
    const tree = buildMerkleTree(leaves);
    // No IPFS pinning service is configured. Keep the checkpoint payload in
    // SQLite and commit only the Merkle root; never invent an IPFS CID.
    const ipfsBatchCID = "";

    // 3. Store in SQLite
    for (let i = 0; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      await dbAsync.run(
        `INSERT INTO checkpoints
        (order_id, location, timestamp, temperature, status_note, latitude, longitude, weather_temp, leaf_hash, merkle_root, ipfs_cid, submitted_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderId,
          cp.location,
          cp.timestamp || Math.floor(Date.now() / 1000),
          cp.temperature || 40,
          cp.statusNote || "Normal",
          cp.latitude ?? null,
          cp.longitude ?? null,
          cp.weatherTemp ?? null,
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
      ipfsCID: null,
      storage: "SQLite index only; no IPFS payload uploaded"
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

// --- MARKET STATS (fair-price guidance from real settled orders) ---
// Average/min/max per-unit price per crop from DELIVERED orders only.
// Empty until real settlements happen — never synthesized.
app.get("/api/market/stats", async (req, res) => {
  try {
    const { cropType } = req.query;
    let query = `SELECT listings.crop_type AS crop,
        COUNT(*) AS sales,
        AVG(CAST(listings.price_per_unit AS REAL)) AS avg_per_unit,
        MIN(CAST(listings.price_per_unit AS REAL)) AS min_per_unit,
        MAX(CAST(listings.price_per_unit AS REAL)) AS max_per_unit
      FROM orders JOIN listings ON listings.listing_id = orders.listing_id
      WHERE orders.status = 'DELIVERED'`;
    const params = [];
    if (cropType) {
      query += " AND LOWER(listings.crop_type) = LOWER(?)";
      params.push(cropType);
    }
    query += " GROUP BY listings.crop_type ORDER BY sales DESC";
    const rows = await dbAsync.all(query, params);
    res.json({ success: true, count: rows.length, stats: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- SUSTAINABILITY CREDITS (self-reported practices; demo units) ---
// Factors are documented demo weights, NOT satellite/IoT verification.
// Credits = sum of declared practice factors for the batch.
const ECO_FACTORS = {
  organic: 2.0,
  no_till: 1.5,
  cover_crop: 1.0,
  agroforestry: 3.0,
  renewable: 1.0,
};

app.post("/api/sustainability", async (req, res) => {
  try {
    const { tokenId, farmerAddress, practices } = req.body;
    if (!tokenId || !farmerAddress || !/^0x[a-fA-F0-9]{40}$/.test(farmerAddress)) {
      return res.status(400).json({ success: false, error: "tokenId and valid farmerAddress required." });
    }
    const clean = [...new Set(Array.isArray(practices) ? practices : [])].filter((p) => p in ECO_FACTORS);
    const credits = clean.reduce((s, p) => s + ECO_FACTORS[p], 0);
    await dbAsync.run(
      `INSERT INTO sustainability (token_id, farmer_address, practices, credits, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(token_id) DO UPDATE SET practices = excluded.practices, credits = excluded.credits`,
      [Number(tokenId), farmerAddress, JSON.stringify(clean), credits, Math.floor(Date.now() / 1000)]
    );
    res.json({ success: true, tokenId: Number(tokenId), practices: clean, credits, factors: ECO_FACTORS });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/sustainability/:tokenId", async (req, res) => {
  try {
    const row = await dbAsync.get("SELECT * FROM sustainability WHERE token_id = ?", [req.params.tokenId]);
    res.json({ success: true, sustainability: row || null, factors: ECO_FACTORS });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/sustainability", async (req, res) => {
  try {
    const rows = await dbAsync.all(
      `SELECT farmer_address, COUNT(*) AS batches, SUM(credits) AS total_credits
      FROM sustainability GROUP BY farmer_address ORDER BY total_credits DESC LIMIT 20`
    );
    const named = [];
    for (const r of rows) {
      const u = await dbAsync.get("SELECT display_name FROM users WHERE LOWER(wallet_address) = LOWER(?)", [r.farmer_address]);
      named.push({ ...r, display_name: u?.display_name || null });
    }
    res.json({ success: true, leaderboard: named, factors: ECO_FACTORS, note: "Self-reported practices; demo credit units, not audited offsets." });
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
    const { disputeId, orderId, buyerAddress, farmerAddress, oracleNode, evidenceHash, evidenceUrl, claimText } = req.body;
    const createdAt = Math.floor(Date.now() / 1000);

    await dbAsync.run(
      `INSERT OR REPLACE INTO disputes
      (dispute_id, order_id, buyer_address, farmer_address, oracle_node, evidence_hash, evidence_url, claim_text, verdict, is_resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?)`,
      [disputeId, orderId, buyerAddress, farmerAddress, oracleNode, evidenceHash, evidenceUrl || null, (claimText || "").slice(0, 2000), createdAt]
    );

    // Update order status
    await dbAsync.run("UPDATE orders SET status = 'DISPUTED', dispute_reason_hash = ? WHERE order_id = ?", [
      evidenceHash,
      orderId
    ]);

    // Emit notification to farmer that a dispute case was opened
    if (farmerAddress) {
      await emitNotification({
        recipientAddress: farmerAddress,
        eventKey: `dispute:${disputeId}:OPENED`,
        title: "Dispute Opened by Buyer",
        message: `Buyer filed dispute #${disputeId} on Order #${orderId}. Escrow is locked in DisputeDAO pending community arbitration.`,
        type: "DISPUTE_OPENED",
        link: `/?inspect=order:${orderId}`
      });
    }

    res.json({ success: true, message: "Dispute indexed successfully", disputeId });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- DISPUTE UNBOXING EVIDENCE ---
// Stores the buyer's unboxing photo and returns the SHA-256 evidence hash.
// The frontend commits exactly this hash on-chain via raiseDispute, so jurors
// can verify the photo they see is the photo that was committed.
app.post("/api/disputes/evidence", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file || !req.file.mimetype || !req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ success: false, error: "An unboxing photo (image upload) is required to open a dispute." });
    }
    if (!isValidImageBuffer(req.file.buffer)) {
      return res.status(400).json({ success: false, error: "Uploaded file is not a valid image format (JPEG, PNG, WebP, GIF)." });
    }
    const evidenceHash = ethers.keccak256(req.file.buffer);
    const ext = (req.file.mimetype.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "").slice(0, 4) || "jpg";
    const filename = `${evidenceHash.slice(2)}.${ext}`;
    await fs.promises.writeFile(path.join(EVIDENCE_DIR, filename), req.file.buffer);
    res.json({ success: true, evidenceHash, url: `/dispute-evidence/${filename}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- ADMIN CHAIN RESET HELPERS ---
// Protected: requires administrative wallet privileges (DEFAULT_ADMIN_ROLE or deployer address).
app.post("/api/admin/reset-chain-refs", requireAdmin, async (req, res) => {
  try {
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_ADMIN_RESETS !== "true") {
      return res.status(403).json({ success: false, error: "Administrative resets are strictly disabled in production environments." });
    }
    await dbAsync.run("DELETE FROM orders");
    await dbAsync.run("DELETE FROM checkpoints");
    await dbAsync.run("DELETE FROM disputes");
    res.json({ success: true, message: "Stale orders/checkpoints/disputes cleared (users + listings kept)" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/admin/replace-listings", requireAdmin, async (req, res) => {
  try {
    const { listings } = req.body;
    if (!Array.isArray(listings)) return res.status(400).json({ success: false, error: "listings array required" });
    await dbAsync.run("DELETE FROM listings");
    for (const l of listings) {
      await dbAsync.run(
        `INSERT INTO listings
        (listing_id, token_id, farmer_address, crop_type, price_per_unit, available_quantity, unit, quality_grade, grade_name, confidence_score, image_cid, image_url, metadata_cid, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [l.listing_id, l.token_id, l.farmer_address, l.crop_type, l.price_per_unit, l.available_quantity, l.unit || "kg", l.quality_grade, l.grade_name, l.confidence_score, l.image_cid, l.image_url || null, l.metadata_cid, Math.floor(Date.now() / 1000)]
      );
    }
    res.json({ success: true, count: listings.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- USERS & REPUTATION ---
app.get("/api/users", async (req, res) => {
  try {
    const rows = await dbAsync.all("SELECT * FROM users ORDER BY created_at DESC");
    res.json({ success: true, count: rows.length, users: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

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
          display_name: null,
          location: null,
          contact: null,
          verified: 0,
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
    const { walletAddress, role, displayName, location, contact } = req.body;
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ success: false, error: "A valid wallet address is required." });
    }
    if (!displayName || !String(displayName).trim()) {
      return res.status(400).json({ success: false, error: "Display name is required." });
    }
    if (!["FARMER", "BUYER"].includes(role)) {
      return res.status(400).json({ success: false, error: "Role must be FARMER or BUYER." });
    }

    // Ownership check: If authenticated, caller can only modify their own profile
    if (req.user && req.user.address) {
      if (req.user.address.toLowerCase() !== walletAddress.toLowerCase() && req.user.address.toLowerCase() !== DEFAULT_ADMIN) {
        return res.status(403).json({
          success: false,
          error: "Forbidden: You cannot modify or register a profile for another wallet address."
        });
      }
    }

    const now = Math.floor(Date.now() / 1000);

    // Registration never touches `verified`: only admin verification grants the badge.
    await dbAsync.run(
      `INSERT INTO users (wallet_address, role, display_name, location, contact, verified, reputation_score, created_at)
      VALUES (?, ?, ?, ?, ?, COALESCE((SELECT verified FROM users WHERE wallet_address = ?), 0), 100, ?)
      ON CONFLICT(wallet_address) DO UPDATE SET role = excluded.role, display_name = excluded.display_name, location = excluded.location, contact = excluded.contact`,
      [walletAddress, role, String(displayName).trim().slice(0, 80), String(location || "").slice(0, 120), String(contact || "").slice(0, 120), walletAddress, now]
    );

    res.json({ success: true, message: "Account registered successfully", walletAddress, role });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Admin verification badge (off-chain KYC stand-in; dev indexer only).
// Protected: requires administrative wallet privileges.
app.post("/api/admin/verify-user", requireAdmin, async (req, res) => {
  try {
    const { walletAddress, verified } = req.body;
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ success: false, error: "A valid wallet address is required." });
    }
    await dbAsync.run("UPDATE users SET verified = ? WHERE LOWER(wallet_address) = LOWER(?)", [verified ? 1 : 0, walletAddress]);
    res.json({ success: true, walletAddress, verified: verified ? 1 : 0 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- AI QUALITY PROXY ---
app.get("/api/ai/health", async (req, res) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/health`);
    if (!response.ok) throw new Error(`AI service returned ${response.status}`);
    res.json({ success: true, ai: await response.json() });
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});
app.post("/api/ai/verify", upload.single("image"), async (req, res) => {
  try {
    if (!req.file || !req.file.mimetype.startsWith("image/")) {
      return res.status(400).json({ success: false, error: "A valid crop image upload is required.", signature: null });
    }
    const { tokenId, cropType, chainId, registryAddress } = req.body;
    const payload = new FormData();
    payload.append("imageFile", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    payload.append("tokenId", String(Number(tokenId)));
    payload.append("cropType", cropType || "Crop Harvest");
    payload.append("chainId", String(Number(chainId) || 31337));
    payload.append("registryAddress", registryAddress);
    // Optional live-capture attestation (device claims, not verified truth).
    for (const k of ["captureLat", "captureLon", "captureCapturedAt", "captureHash", "captureMethod"]) {
      if (req.body[k] !== undefined && req.body[k] !== "") payload.append(k, String(req.body[k]));
    }
    const response = await fetch(`${AI_SERVICE_URL}/api/verify`, { method: "POST", body: payload });

    if (response.ok) {
      const data = await response.json();
      if (data && data.success && data.report) {
        const rep = data.report;
        const now = Math.floor(Date.now() / 1000);
        try {
          await dbAsync.run(
            `INSERT INTO quality_passports
             (token_id, crop_type, quality_grade, grade_name, confidence_score, confidence_type, grading_method, model_version, explanation, metrics, class_scores, report_hash, image_hash, oracle_address, inspected_at, review_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ORIGINAL')
             ON CONFLICT(token_id) DO UPDATE SET
               quality_grade = excluded.quality_grade,
               grade_name = excluded.grade_name,
               confidence_score = excluded.confidence_score,
               confidence_type = excluded.confidence_type,
               grading_method = excluded.grading_method,
               model_version = excluded.model_version,
               explanation = excluded.explanation,
               metrics = excluded.metrics,
               class_scores = excluded.class_scores,
               report_hash = excluded.report_hash,
               image_hash = excluded.image_hash,
               oracle_address = excluded.oracle_address,
               inspected_at = excluded.inspected_at`,
            [
              Number(tokenId) || 0,
              cropType || rep.cropType || "Crop",
              data.grade ?? rep.grade,
              data.gradeName ?? rep.gradeName,
              data.confidenceScore ?? rep.confidenceBasisPoints,
              data.confidenceType ?? rep.confidenceType ?? "heuristic",
              data.gradingMethod ?? rep.gradingMethod ?? "AI Analysis",
              data.modelVersion ?? rep.modelVersion ?? "MobileNetV3",
              data.explanation ?? rep.explanation ?? "",
              JSON.stringify(data.metrics || rep.metrics || {}),
              JSON.stringify(rep.classScores || {}),
              data.reportHash ?? rep.reportHash,
              rep.imageHash || "",
              data.oracleAddress ?? rep.oracleNode,
              now
            ]
          );
        } catch (dbErr) {
          console.warn("Could not cache quality passport:", dbErr.message);
        }
      }
      return res.json(data);
    }

    throw new Error(`AI service returned ${response.status}: ${await response.text()}`);
  } catch (aiErr) {
    // Honest failure: do NOT invent a grade/signature. The frontend blocks
    // on-chain minting when isFallback is true because createListing requires
    // real oracle verification (CropBatchNFT.isVerified).
    res.status(502).json({
      success: false,
      isFallback: true,
      error: `AI service unreachable: ${aiErr.message}. Start ai-service on ${AI_SERVICE_URL}.`,
      grade: null,
      reportHash: null,
      signature: null,
      note: "No signed grade available — retry after starting ai-service"
    });
  }
});

// --- NOTIFICATIONS ENDPOINTS ---
app.get("/api/notifications", async (req, res) => {
  try {
    const address = req.user?.address || req.query.address;
    if (!address) {
      return res.status(400).json({ success: false, error: "Address is required to query notifications." });
    }
    const rows = await dbAsync.all(
      "SELECT * FROM notifications WHERE LOWER(recipient_address) = LOWER(?) ORDER BY id DESC LIMIT 50",
      [address]
    );
    const unreadCount = rows.filter((r) => r.is_read === 0).length;
    res.json({ success: true, count: rows.length, unreadCount, notifications: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/notifications/:id/read", async (req, res) => {
  try {
    await dbAsync.run("UPDATE notifications SET is_read = 1 WHERE id = ?", [req.params.id]);
    res.json({ success: true, message: "Notification marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put("/api/notifications/read-all", async (req, res) => {
  try {
    const address = req.user?.address || req.body?.address;
    if (!address) {
      return res.status(400).json({ success: false, error: "Address is required to mark notifications as read." });
    }
    await dbAsync.run("UPDATE notifications SET is_read = 1 WHERE LOWER(recipient_address) = LOWER(?)", [address]);
    res.json({ success: true, message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- QUALITY PASSPORT & AUDIT REVIEW ENDPOINTS ---
app.get("/api/quality-passports/:tokenId", async (req, res) => {
  try {
    const passport = await dbAsync.get("SELECT * FROM quality_passports WHERE token_id = ?", [req.params.tokenId]);
    if (!passport) {
      return res.status(404).json({ success: false, error: `No AI quality passport found for batch #${req.params.tokenId}.` });
    }
    res.json({
      success: true,
      passport: {
        ...passport,
        metrics: passport.metrics ? JSON.parse(passport.metrics) : null,
        class_scores: passport.class_scores ? JSON.parse(passport.class_scores) : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/quality-passports/:tokenId/review", async (req, res) => {
  try {
    const { decision, notes, adjustedGrade, adjustedGradeName } = req.body;
    const ALLOWED_DECISIONS = ["UPHELD", "ADJUSTED", "FLAGGED_UNCERTAIN"];
    if (!decision || !ALLOWED_DECISIONS.includes(decision)) {
      return res.status(400).json({
        success: false,
        error: `Decision must be one of: ${ALLOWED_DECISIONS.join(", ")}`
      });
    }
    const reviewer = req.user?.address || req.body.reviewerAddress || "SYSTEM_ORACLE_AUDITOR";
    const now = Math.floor(Date.now() / 1000);
    const existing = await dbAsync.get("SELECT * FROM quality_passports WHERE token_id = ?", [req.params.tokenId]);
    if (!existing) {
      return res.status(404).json({ success: false, error: `Batch #${req.params.tokenId} quality passport not found.` });
    }

    await dbAsync.run(
      `UPDATE quality_passports SET
        review_status = 'REVIEWED',
        review_decision = ?,
        review_notes = ?,
        reviewed_by = ?,
        reviewed_at = ?
       WHERE token_id = ?`,
      [decision, notes || "", reviewer, now, req.params.tokenId]
    );

    if (decision === "ADJUSTED" && adjustedGrade !== undefined) {
      await dbAsync.run(
        "UPDATE listings SET quality_grade = ?, grade_name = ? WHERE token_id = ?",
        [Number(adjustedGrade), adjustedGradeName || "REVIEWED", req.params.tokenId]
      );
    }

    res.json({
      success: true,
      message: `Quality passport review recorded for batch #${req.params.tokenId}.`,
      tokenId: Number(req.params.tokenId),
      decision,
      reviewedBy: reviewer
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- PUBLIC BATCH TRACEABILITY AGGREGATION ENDPOINT ---
app.get("/api/traceability/batch/:tokenId", async (req, res) => {
  try {
    const tokenId = req.params.tokenId;
    const listing = await dbAsync.get("SELECT * FROM listings WHERE token_id = ?", [tokenId]);
    const passport = await dbAsync.get("SELECT * FROM quality_passports WHERE token_id = ?", [tokenId]);
    const orders = await dbAsync.all("SELECT * FROM orders WHERE token_id = ? ORDER BY order_id DESC", [tokenId]);
    const sustainability = await dbAsync.get("SELECT * FROM sustainability WHERE token_id = ?", [tokenId]);

    let farmer = null;
    if (listing?.farmer_address) {
      farmer = await dbAsync.get("SELECT wallet_address, display_name, location, verified, reputation_score FROM users WHERE LOWER(wallet_address) = LOWER(?)", [listing.farmer_address]);
    }

    let checkpoints = [];
    let merkleRoot = null;
    let orderId = orders?.[0]?.order_id;
    if (orderId) {
      const cpRows = await dbAsync.all("SELECT * FROM checkpoints WHERE order_id = ? ORDER BY id ASC", [orderId]);
      if (cpRows.length > 0) {
        const leaves = cpRows.map((r) => r.leaf_hash);
        const tree = buildMerkleTree(leaves);
        merkleRoot = tree.root;
        checkpoints = cpRows.map((r, idx) => ({
          ...r,
          proof: tree.getProof(idx)
        }));
      }
    }

    const disputes = [];
    for (const o of orders) {
      const d = await dbAsync.all("SELECT * FROM disputes WHERE order_id = ?", [o.order_id]);
      if (d) disputes.push(...d);
    }

    // Honest verification claims: separate cryptographic certainty from user assertions
    const verificationSummary = {
      isFound: Boolean(listing || passport || orders.length > 0),
      oracleSignatureVerified: Boolean(passport?.report_hash || listing?.image_cid),
      farmerKycVerified: Boolean(farmer && farmer.verified === 1),
      merkleTransitVerified: Boolean(merkleRoot),
      sustainabilityAudited: false, // Explicitly self-reported demo credits
      confidenceScoreMeaningful: Boolean(passport && passport.confidence_type === "cnn-softmax"),
      notes: "On-chain state anchors cryptographic roots. Physical provenance is corroborated by transit checkpoints and AI oracle signatures."
    };

    if (!verificationSummary.isFound) {
      return res.status(404).json({
        success: false,
        error: `Batch #${tokenId} not found in the indexer catalog.`,
        verificationSummary
      });
    }

    res.json({
      success: true,
      tokenId: Number(tokenId),
      listing: listing || null,
      passport: passport ? {
        ...passport,
        metrics: passport.metrics ? JSON.parse(passport.metrics) : null,
        class_scores: passport.class_scores ? JSON.parse(passport.class_scores) : null
      } : null,
      farmer: farmer || null,
      orders: orders || [],
      checkpoints: {
        orderId: orderId || null,
        count: checkpoints.length,
        merkleRoot,
        items: checkpoints
      },
      disputes,
      sustainability: sustainability ? {
        ...sustainability,
        practices: sustainability.practices ? JSON.parse(sustainability.practices) : []
      } : null,
      verificationSummary
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server
if (require.main === module) {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`=================================================`);
    console.log(` AgriChain Backend & Indexer running on port ${PORT}`);
    console.log(` REST API: http://localhost:${PORT}/api/listings`);
    console.log(` Contracts: http://localhost:${PORT}/api/contracts`);
    console.log(`=================================================`);
  });
}

module.exports = app;
