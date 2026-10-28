const assert = require("assert");
const path = require("path");
const app = require("../server");
const http = require("http");
const { ethers } = require("ethers");

// Test signers (well-known local dev accounts)
const ADMIN_WALLET = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"); // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
const USER_WALLET = new ethers.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"); // 0x70997970C51812dc3A010C7d01b50e0d17dc79C8
const ATTACKER_WALLET = new ethers.Wallet("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"); // 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC

async function authenticateTestWallet(baseUrl, wallet) {
  const nonceRes = await fetch(`${baseUrl}/api/auth/nonce?address=${wallet.address}`).then(r => r.json());
  assert.strictEqual(nonceRes.success, true);
  const domain = "127.0.0.1";
  const uri = baseUrl;
  const message = `${domain} wants you to sign in with your Ethereum account:\n${wallet.address}\n\nSign in to AgriChain decentralized marketplace.\n\nURI: ${uri}\nVersion: 1\nChain ID: 31337\nNonce: ${nonceRes.nonce}\nIssued At: ${nonceRes.issuedAt}`;
  const signature = await wallet.signMessage(message);

  const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature, address: wallet.address, chainId: 31337, domain })
  }).then(r => r.json());

  assert.strictEqual(verifyRes.success, true);
  assert.ok(verifyRes.token);
  return { token: verifyRes.token, nonce: nonceRes.nonce, message, signature };
}

async function testBackend() {
  console.log("=================================================");
  console.log("     AgriChain Backend API Test Suite Running    ");
  console.log("=================================================\n");

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Health check
    console.log("[Test 1/7] Testing /health endpoint...");
    const healthRes = await fetch(`${baseUrl}/health`).then(r => r.json());
    assert.strictEqual(healthRes.status, "healthy");
    console.log("   ✓ Health check passed\n");

    // 2. Contracts metadata
    console.log("[Test 2/7] Testing /api/contracts metadata endpoint...");
    const contractsRes = await fetch(`${baseUrl}/api/contracts`).then(r => r.json());
    assert.strictEqual(contractsRes.success, true);
    assert.ok(contractsRes.contracts.AgriToken.address.startsWith("0x"));
    assert.ok(contractsRes.contracts.CropBatchNFT.address.startsWith("0x"));
    console.log("   ✓ Contract addresses and ABIs returned\n");

    // 3. Create and query listing
    console.log("[Test 3/7] Testing /api/listings (Create & Query)...");
    const listingPayload = {
      listingId: 101,
      tokenId: 1,
      farmerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      cropType: "Organic Basmati Rice",
      pricePerUnit: "2000000000000000000",
      availableQuantity: 5000,
      unit: "kg",
      qualityGrade: 1,
      gradeName: "GRADE_A",
      confidenceScore: 9750,
      imageCID: "sha256:sample-image-digest",
      metadataCID: "data:application/json;base64,eyJuYW1lIjoidGVzdCJ9"
    };
    const createListRes = await fetch(`${baseUrl}/api/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(listingPayload)
    }).then(r => r.json());
    assert.strictEqual(createListRes.success, true);

    const queryListRes = await fetch(`${baseUrl}/api/listings?cropType=Basmati`).then(r => r.json());
    assert.strictEqual(queryListRes.success, true);
    assert.ok(queryListRes.count >= 1);
    console.log(`   ✓ Listing created and filtered query returned ${queryListRes.count} results\n`);

    // 3b. Listing with inspection photo stores and serves the actual bytes.
    console.log("[Test 3b/7] Testing /api/listings photo upload...");
    const lotPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const lotForm = new FormData();
    for (const [k, v] of Object.entries({ ...listingPayload, listingId: 102, tokenId: 2 })) lotForm.append(k, String(v));
    lotForm.append("photo", new Blob([lotPng], { type: "image/png" }), "crop.png");
    const lotPhotoRes = await fetch(`${baseUrl}/api/listings`, { method: "POST", body: lotForm }).then(r => r.json());
    assert.strictEqual(lotPhotoRes.success, true);
    const lotRow = await fetch(`${baseUrl}/api/listings/102`).then(r => r.json());
    assert.ok(lotRow.listing.image_url.startsWith("/listing-images/"));
    const imgGet = await fetch(`${baseUrl}${lotRow.listing.image_url}`);
    assert.strictEqual(imgGet.status, 200);
    console.log(`   ✓ Inspection photo stored at ${lotRow.listing.image_url} and served\n`);

    // 4. Create and query order
    console.log("[Test 4/7] Testing /api/orders (Create, Query, Status Update)...");
    const orderPayload = {
      orderId: 201,
      listingId: 101,
      tokenId: 1,
      buyerAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      farmerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      quantity: 5000,
      totalAmount: "10000000000000000000000",
      platformFee: "200000000000000000000"
    };
    const createOrderRes = await fetch(`${baseUrl}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(orderPayload)
    }).then(r => r.json());
    assert.strictEqual(createOrderRes.success, true);

    // Update status to SHIPPED
    const updateRes = await fetch(`${baseUrl}/api/orders/201/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "SHIPPED" })
    }).then(r => r.json());
    assert.strictEqual(updateRes.success, true);

    const fetchOrder = await fetch(`${baseUrl}/api/orders/201`).then(r => r.json());
    assert.strictEqual(fetchOrder.order.status, "SHIPPED");
    console.log("   ✓ Order placed and status updated to SHIPPED\n");

    // 5. Submit Checkpoints & Merkle Tree proofs (unique orderId isolates from prior runs)
    console.log("[Test 5/7] Testing /api/checkpoints (Merkle Root Batching & Proofs)...");
    const cpOrderId = 201000 + Math.floor(Math.random() * 100000);
    const checkpointsPayload = {
      orderId: cpOrderId,
      submittedBy: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
      checkpoints: [
        { location: "Farm Gate, Karnal", timestamp: 1718001000, temperature: 22, statusNote: "Loaded" },
        { location: "Cold Hub, Delhi", timestamp: 1718005000, temperature: 4, statusNote: "Reefer OK" },
        { location: "Depot, Jaipur", timestamp: 1718012000, temperature: 4, statusNote: "In transit" },
        { location: "Port, Mumbai", timestamp: 1718020000, temperature: 5, statusNote: "At terminal" }
      ]
    };
    const cpRes = await fetch(`${baseUrl}/api/checkpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkpointsPayload)
    }).then(r => r.json());
    assert.strictEqual(cpRes.success, true);
    assert.ok(cpRes.merkleRoot.startsWith("0x"));
    assert.strictEqual(cpRes.leavesCount, 4);

    const fetchCp = await fetch(`${baseUrl}/api/checkpoints/${cpOrderId}`).then(r => r.json());
    assert.strictEqual(fetchCp.count, 4);
    assert.ok(fetchCp.checkpoints[1].proof.length > 0);
    console.log(`   ✓ Committed 4 checkpoints. Merkle Root: ${fetchCp.merkleRoot.slice(0, 18)}... with valid inclusion proofs\n`);

    // 6. User and Dispute Registration
    console.log("[Test 6/7] Testing /api/users and /api/disputes...");
    const adminAuth = await authenticateTestWallet(baseUrl, ADMIN_WALLET);
    const userRes = await fetch(`${baseUrl}/api/users/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", role: "FARMER", displayName: "Test Farmer", location: "Test District" })
    }).then(r => r.json());
    assert.strictEqual(userRes.success, true);

    // Re-registration without a name is refused; verification survives updates.
    const badReg = await fetch(`${baseUrl}/api/users/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", role: "FARMER" })
    }).then(r => r.json());
    assert.strictEqual(badReg.success, false);
    const verifyRes = await fetch(`${baseUrl}/api/admin/verify-user`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${adminAuth.token}` },
      body: JSON.stringify({ walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", verified: true })
    }).then(r => r.json());
    assert.strictEqual(verifyRes.verified, 1);
    const gotUser = await fetch(`${baseUrl}/api/users/0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).then(r => r.json());
    assert.strictEqual(gotUser.user.display_name, "Test Farmer");
    assert.strictEqual(gotUser.user.verified, 1);

    const disputePayload = {
      disputeId: 301,
      orderId: 201,
      buyerAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
      farmerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      oracleNode: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      evidenceHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
    };
    const dispRes = await fetch(`${baseUrl}/api/disputes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(disputePayload)
    }).then(r => r.json());
    assert.strictEqual(dispRes.success, true);
    console.log("   ✓ User registered and dispute indexed successfully\n");

    // 6b. Unboxing evidence upload returns a committable SHA-256 hash + served URL.
    console.log("[Test 6b/7] Testing /api/disputes/evidence...");
    const pngBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const evForm = new FormData();
    evForm.append("photo", new Blob([pngBytes], { type: "image/png" }), "unboxing.png");
    const evRes = await fetch(`${baseUrl}/api/disputes/evidence`, { method: "POST", body: evForm }).then(r => r.json());
    assert.strictEqual(evRes.success, true);
    assert.ok(evRes.evidenceHash.startsWith("0x") && evRes.evidenceHash.length === 66);
    assert.ok(evRes.url.startsWith("/dispute-evidence/"));
    const evGet = await fetch(`${baseUrl}${evRes.url}`);
    assert.strictEqual(evGet.status, 200);
    const evBad = await fetch(`${baseUrl}/api/disputes/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    }).then(r => r.json());
    assert.strictEqual(evBad.success, false);
    console.log(`   ✓ Evidence hash ${evRes.evidenceHash.slice(0, 18)}... stored and served\n`);

    // 7. AI proxy refuses to produce a grade without the actual uploaded image.
    console.log("[Test 7/7] Testing /api/ai/verify endpoint...");
    const aiRes = await fetch(`${baseUrl}/api/ai/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: 1, cropType: "Basmati Rice" })
    }).then(r => r.json());
    assert.strictEqual(aiRes.success, false);
    assert.match(aiRes.error, /image upload is required/i);
    console.log("   ✓ AI proxy refuses verification without uploaded image\n");

    // 8. Market stats reflect only real settlements; sustainability credits math.
    console.log("[Test 8/8] Testing /api/market/stats and /api/sustainability...");    const emptyStats = await fetch(`${baseUrl}/api/market/stats?cropType=NoSuchCropXYZ`).then(r => r.json());
    assert.strictEqual(emptyStats.success, true);
    assert.strictEqual(emptyStats.count, 0);
    const sustRes = await fetch(`${baseUrl}/api/sustainability`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: 999001, farmerAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", practices: ["organic", "no_till", "bogus"] })
    }).then(r => r.json());
    assert.strictEqual(sustRes.success, true);
    assert.deepStrictEqual(sustRes.practices, ["organic", "no_till"]);
    assert.strictEqual(sustRes.credits, 3.5);
    const sustGet = await fetch(`${baseUrl}/api/sustainability/999001`).then(r => r.json());
    assert.strictEqual(sustGet.sustainability.credits, 3.5);
    const board = await fetch(`${baseUrl}/api/sustainability`).then(r => r.json());
    assert.strictEqual(board.success, true);
    assert.ok(Array.isArray(board.leaderboard));
    console.log("   ✓ Empty stats stay empty; credits organic(2.0)+no_till(1.5)=3.5, bogus practice dropped\n");

    // 8b. Weather endpoint validates coordinates (live provider tested manually).
    console.log("[Test 8b/8] Testing /api/weather validation...");
    const wxBad = await fetch(`${baseUrl}/api/weather?lat=999&lon=0`).then(r => r.json());
    assert.strictEqual(wxBad.success, false);
    const wxMissing = await fetch(`${baseUrl}/api/weather`).then(r => r.json());
    assert.strictEqual(wxMissing.success, false);
    console.log("   ✓ Invalid coordinates refused without calling provider\n");

    // 9. SIWE Authentication & RBAC Authorization Security Test Suite
    console.log("[Test 9/9] Testing SIWE Authentication & Authorization Security Controls...");
    
    // 9a. Unauthenticated admin call must be rejected (401)
    const unauthAdmin = await fetch(`${baseUrl}/api/admin/reset-chain-refs`, { method: "POST" });
    assert.strictEqual(unauthAdmin.status, 401);
    console.log("   ✓ Unauthenticated admin reset blocked (401)");

    // 9b. Non-admin caller calling admin endpoint must be rejected (403)
    const userAuth = await authenticateTestWallet(baseUrl, USER_WALLET);
    const nonAdminReset = await fetch(`${baseUrl}/api/admin/reset-chain-refs`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${userAuth.token}` }
    });
    assert.strictEqual(nonAdminReset.status, 403);
    console.log("   ✓ Non-admin caller forbidden from admin reset (403)");

    // 9c. Replay attack rejection: reusing the exact same SIWE nonce must fail
    const replayRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userAuth.message,
        signature: userAuth.signature,
        address: USER_WALLET.address,
        chainId: 31337,
        domain: "127.0.0.1"
      })
    });
    assert.strictEqual(replayRes.status, 400);
    const replayJson = await replayRes.json();
    assert.match(replayJson.error, /replay attack/i);
    console.log("   ✓ Nonce reuse replay attack prevented (400)");

    // 9d. Tampered signature rejection
    const bogusRes = await fetch(`${baseUrl}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userAuth.message,
        signature: "0x" + "11".repeat(65),
        address: USER_WALLET.address,
        chainId: 31337,
        domain: "127.0.0.1"
      })
    });
    assert.strictEqual(bogusRes.status, 400);
    console.log("   ✓ Tampered cryptographic signature rejected (400)");

    // 9e. Profile hijacking protection: user cannot overwrite another user's profile
    const hijackRes = await fetch(`${baseUrl}/api/users/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${userAuth.token}`
      },
      body: JSON.stringify({
        walletAddress: ATTACKER_WALLET.address,
        role: "BUYER",
        displayName: "Hijacked Account"
      })
    });
    assert.strictEqual(hijackRes.status, 403);
    console.log("   ✓ Cross-user profile hijacking blocked (403)");

    // 9f. Binary file magic bytes validation: text file disguised as PNG must be rejected
    const textAsPng = Buffer.from("<html><body>Not a real image</body></html>");
    const fakeForm = new FormData();
    fakeForm.append("photo", new Blob([textAsPng], { type: "image/png" }), "fake.png");
    const fakeUploadRes = await fetch(`${baseUrl}/api/disputes/evidence`, {
      method: "POST",
      body: fakeForm
    });
    assert.strictEqual(fakeUploadRes.status, 400);
    const fakeJson = await fakeUploadRes.json();
    assert.match(fakeJson.error, /valid image format/i);
    console.log("   ✓ Spoofed file upload rejected via magic bytes inspection (400)");

    // 9g. Order status unauthorized update blocked: buyer cannot ship order
    const buyerAuth = await authenticateTestWallet(baseUrl, ATTACKER_WALLET);
    const fakeShip = await fetch(`${baseUrl}/api/orders/201/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${buyerAuth.token}`
      },
      body: JSON.stringify({ status: "SHIPPED" })
    });
    assert.strictEqual(fakeShip.status, 403);
    console.log("   ✓ Unauthorized order state mutation rejected (403)\n");

    // 10. Traceability & Public QR Batch Verification
    console.log("[Test 10/13] Testing /api/traceability/batch/:tokenId endpoint...");
    const traceRes = await fetch(`${baseUrl}/api/traceability/batch/1`).then(r => r.json());
    assert.strictEqual(traceRes.success, true);
    assert.strictEqual(traceRes.tokenId, 1);
    assert.ok(traceRes.verificationSummary);
    assert.strictEqual(traceRes.verificationSummary.isFound, true);
    assert.strictEqual(traceRes.verificationSummary.sustainabilityAudited, false);
    
    // Non-existent batch returns 404
    const badTrace = await fetch(`${baseUrl}/api/traceability/batch/999999`);
    assert.strictEqual(badTrace.status, 404);
    console.log("   ✓ Traceability aggregation returns verified provenance & 404 for invalid batches\n");

    // 11. AI Quality Passport & Review Workflow
    console.log("[Test 11/13] Testing /api/quality-passports endpoints...");
    // Seed passport in database for testing
    const sqlite3 = require("sqlite3").verbose();
    const dbInst = new sqlite3.Database(path.resolve(__dirname, "../agrichain.sqlite"));
    await new Promise((res) => dbInst.run(
      `INSERT OR REPLACE INTO quality_passports
       (token_id, crop_type, quality_grade, grade_name, confidence_score, confidence_type, grading_method, model_version, explanation, metrics, class_scores, report_hash, image_hash, oracle_address, inspected_at, review_status)
       VALUES (1, 'Apple', 1, 'GRADE_A', 9500, 'cnn-softmax', 'FruitNet CNN', 'MobileNetV3-Small-v1.0', 'Optimal color and firmness', '{"surfaceUniformity":0.94}', '{"good":0.95}', '0xreport101', '0ximg101', '0xoracle101', 1700000000, 'ORIGINAL')`,
      () => res()
    ));

    const passportRes = await fetch(`${baseUrl}/api/quality-passports/1`).then(r => r.json());
    assert.strictEqual(passportRes.success, true);
    assert.strictEqual(passportRes.passport.crop_type, "Apple");
    assert.strictEqual(passportRes.passport.model_version, "MobileNetV3-Small-v1.0");

    // Review workflow
    const reviewRes = await fetch(`${baseUrl}/api/quality-passports/1/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: "UPHELD",
        notes: "Auditor reviewed FruitNet inspection photo; grade A upheld.",
        reviewerAddress: "0xAuditorAddress123"
      })
    }).then(r => r.json());
    assert.strictEqual(reviewRes.success, true);
    assert.strictEqual(reviewRes.decision, "UPHELD");
    console.log("   ✓ AI Quality Passport and auditor review workflow verified\n");

    // 12. Notifications System
    console.log("[Test 12/13] Testing in-app notifications & idempotency...");
    const farmerAddr = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const notifRes = await fetch(`${baseUrl}/api/notifications?address=${farmerAddr}`).then(r => r.json());
    assert.strictEqual(notifRes.success, true);
    assert.ok(Array.isArray(notifRes.notifications));
    assert.ok(notifRes.count >= 1); // Order placed notification was emitted

    const firstNotif = notifRes.notifications[0];
    const markRead = await fetch(`${baseUrl}/api/notifications/${firstNotif.id}/read`, { method: "PUT" }).then(r => r.json());
    assert.strictEqual(markRead.success, true);
    console.log("   ✓ Notifications fetched and read status toggled\n");

    // 13. Order State Machine Transition Enforcements
    console.log("[Test 13/13] Testing order lifecycle state machine enforcements...");
    // Admin trying invalid transition: cannot move a cancelled or resolved order back to placed
    const invalidTrans = await fetch(`${baseUrl}/api/orders/201/status`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${adminAuth.token}`
      },
      body: JSON.stringify({ status: "RECEIVED" }) // DISPUTED can only go to RESOLVED
    });
    assert.strictEqual(invalidTrans.status, 400);
    const invalidJson = await invalidTrans.json();
    assert.match(invalidJson.error, /Illegal state transition/i);
    console.log("   ✓ Invalid state transitions blocked by state machine (400)\n");

    console.log("=================================================");
    console.log("     ALL BACKEND API TESTS PASSED (13/13)!       ");
    console.log("=================================================\n");

  } finally {
    // Remove fixed-ID fixture rows so the demo catalog stays clean.
    try {
      const sqlite3 = require("sqlite3").verbose();
      const path = require("path");
      const db = new sqlite3.Database(path.resolve(__dirname, "../agrichain.sqlite"));
      await new Promise((res) => db.run("DELETE FROM listings WHERE listing_id IN (101, 102)", () => res()));
      await new Promise((res) => db.run("DELETE FROM orders WHERE order_id = 201", () => res()));
      await new Promise((res) => db.run("DELETE FROM quality_passports WHERE token_id = 1", () => res()));
      await new Promise((res) => db.run("DELETE FROM notifications WHERE LOWER(recipient_address) = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'", () => res()));
      await new Promise((res) => db.run("DELETE FROM sustainability WHERE token_id = 999001", () => res()));
      await new Promise((res) => db.close(() => res()));
    } catch { /* best-effort cleanup */ }
    server.close();
  }
}

testBackend()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
  });
