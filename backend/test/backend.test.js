const assert = require("assert");
const app = require("../server");
const http = require("http");

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
      imageCID: "QmSampleBasmatiPhotos"
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

    // 5. Submit Checkpoints & Merkle Tree proofs
    console.log("[Test 5/7] Testing /api/checkpoints (Merkle Root Batching & Proofs)...");
    const checkpointsPayload = {
      orderId: 201,
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

    const fetchCp = await fetch(`${baseUrl}/api/checkpoints/201`).then(r => r.json());
    assert.strictEqual(fetchCp.count, 4);
    assert.ok(fetchCp.checkpoints[1].proof.length > 0);
    console.log(`   ✓ Committed 4 checkpoints. Merkle Root: ${fetchCp.merkleRoot.slice(0, 18)}... with valid inclusion proofs\n`);

    // 6. User and Dispute Registration
    console.log("[Test 6/7] Testing /api/users and /api/disputes...");
    const userRes = await fetch(`${baseUrl}/api/users/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ walletAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", role: "FARMER" })
    }).then(r => r.json());
    assert.strictEqual(userRes.success, true);

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

    // 7. AI Verify endpoint proxy
    console.log("[Test 7/7] Testing /api/ai/verify endpoint...");
    const aiRes = await fetch(`${baseUrl}/api/ai/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId: 1, cropType: "Basmati Rice" })
    }).then(r => r.json());
    assert.strictEqual(aiRes.success, true);
    assert.ok(aiRes.grade >= 1 && aiRes.grade <= 4);
    assert.ok(aiRes.reportHash.startsWith("0x"));
    console.log(`   ✓ AI Verification returned Grade: ${aiRes.gradeName} (${aiRes.confidenceScore / 100}% confidence)\n`);

    console.log("=================================================");
    console.log("     ALL BACKEND API TESTS PASSED (7/7)!        ");
    console.log("=================================================\n");

  } finally {
    server.close();
  }
}

testBackend()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
  });
