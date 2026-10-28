const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const repoRoot = path.resolve(__dirname, "../..");
const catalogRoot = path.join(repoRoot, "frontend/public/demo-crops");
const assetRoot = path.join(repoRoot, "frontend/public/crop-photos");
const catalog = JSON.parse(fs.readFileSync(path.join(catalogRoot, "catalog.json"), "utf8"));

function parseEvent(contract, receipt, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) return parsed;
    } catch { /* log belongs to a different contract */ }
  }
  return null;
}

function decodeMetadata(uri) {
  try {
    const prefix = "data:application/json;base64,";
    if (!uri.startsWith(prefix)) return null;
    return JSON.parse(Buffer.from(uri.slice(prefix.length), "base64").toString("utf8"));
  } catch { return null; }
}

async function inspectImage(imagePath, tokenId, chainId, registryAddress, cropType) {
  const form = new FormData();
  const imageBytes = fs.readFileSync(imagePath);
  form.append("tokenId", String(tokenId));
  form.append("cropType", cropType);
  form.append("chainId", String(chainId));
  form.append("registryAddress", registryAddress);
  form.append("imageFile", new Blob([imageBytes], { type: "image/png" }), path.basename(imagePath));

  const response = await fetch("http://127.0.0.1:8000/api/verify", { method: "POST", body: form });
  const result = await response.json();
  if (!response.ok || !result.signature || !result.reportHash) {
    throw new Error(`Local AI verification failed for ${cropType}: ${result.detail || result.error || response.statusText}`);
  }
  return result;
}

async function indexListing(listing, batch, metadataURI, product, report = null) {
  const payload = {
    listingId: Number(listing.listingId),
    tokenId: Number(listing.tokenId),
    farmerAddress: listing.farmer,
    cropType: batch.cropType,
    pricePerUnit: listing.pricePerUnit.toString(),
    availableQuantity: Number(listing.availableQuantity),
    unit: product.unit,
    qualityGrade: Number(batch.qualityGrade),
    gradeName: ["NOT_GRADED", "GRADE_A", "GRADE_B", "GRADE_C", "REJECTED"][Number(batch.qualityGrade)],
    confidenceScore: Number(batch.confidenceScore),
    imageCID: batch.imageCID,
    imageURL: `http://127.0.0.1:5000/crop-photos/${product.image}`,
    metadataCID: metadataURI,
  };
  const response = await fetch("http://127.0.0.1:5000/api/listings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(`On-chain listing ${payload.listingId} is live, but backend indexing failed: ${result.error || response.statusText}`);
  }
  console.log(`  Backend indexed listing #${payload.listingId} with local image ${product.image}${report ? ` (${report.gradeName}, rule score ${report.confidencePercent}%)` : ""}`);
}

async function main() {
  const network = await ethers.provider.getNetwork();
  if (Number(network.chainId) !== 31337) {
    throw new Error(`Demo seeding is local-only. Refusing chain ${network.chainId}.`);
  }

  const deploymentsPath = path.join(__dirname, "../deployments/localhost.json");
  if (!fs.existsSync(deploymentsPath)) throw new Error("Missing contracts/deployments/localhost.json; deploy to the local node first.");
  const deployment = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  if (Number(deployment.chainId) !== 31337) throw new Error("Saved deployment is not for Hardhat Local.");

  const [admin, oracleSigner] = await ethers.getSigners();
  if (!admin || !oracleSigner) throw new Error("Hardhat did not expose local unlocked accounts.");

  const nft = await ethers.getContractAt("CropBatchNFT", deployment.contracts.CropBatchNFT, admin);
  const oracle = await ethers.getContractAt("OracleRegistry", deployment.contracts.OracleRegistry, admin);
  const marketplace = await ethers.getContractAt("AgriMarketplace", deployment.contracts.AgriMarketplace, admin);

  const minterRole = await nft.MINTER_ROLE();
  if (!(await nft.hasRole(minterRole, admin.address))) throw new Error("Account #0 is not an NFT minter; refusing to grant roles automatically.");
  const oracleNode = await oracle.oracleNodes(oracleSigner.address);
  if (!oracleNode.isActive || Number(oracleNode.stakedAmount) < Number(ethers.parseEther("5000"))) {
    throw new Error("Hardhat Account #1 is not an active 5,000 AGRI oracle; refusing to fake verification.");
  }

  console.log(`Seeding ${catalog.items.length} FruitNet photo listings on chain 31337.`);
  console.log(`Admin/minter: ${admin.address}; active oracle: ${oracleSigner.address}`);

  const mintedEvents = await nft.queryFilter(nft.filters.BatchMinted());
  const listingEvents = await marketplace.queryFilter(marketplace.filters.ListingCreated());
  const orderEvents = await marketplace.queryFilter(marketplace.filters.OrderPlaced());

  // Retire the six old illustrative listings on the same local chain. Preserve
  // chain history and abort if a buyer has already placed an order against one.
  for (const event of listingEvents) {
    const existing = await marketplace.listings(event.args.listingId);
    if (Number(existing.status) !== 0) continue;
    const metadata = decodeMetadata(await nft.tokenURI(existing.tokenId));
    if (!metadata?.image?.startsWith("/demo-crops/")) continue;
    if (orderEvents.some((order) => BigInt(order.args.listingId) === BigInt(existing.listingId))) {
      throw new Error(`Cannot retire illustrative listing #${existing.listingId}: it already has an on-chain order.`);
    }
    if (existing.farmer.toLowerCase() !== admin.address.toLowerCase()) {
      throw new Error(`Cannot retire old illustration listing #${existing.listingId}: connected deployer does not own it.`);
    }
    await (await marketplace.cancelListing(existing.listingId)).wait();
    console.log(`  Retired old illustrative listing #${existing.listingId}; NFT returned to its farmer, chain history preserved.`);
  }

  for (const product of catalog.items) {
    const imagePath = path.join(assetRoot, product.image);
    if (!fs.existsSync(imagePath)) throw new Error(`Missing FruitNet photo. Run model training/export first: ${imagePath}`);
    const imageHash = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(imagePath)).digest("hex")}`;

    let tokenId = null;
    let batch = null;
    for (const event of mintedEvents) {
      const candidateId = BigInt(event.args.tokenId);
      const candidate = await nft.getBatch(candidateId);
      if (candidate.imageCID === imageHash) { tokenId = candidateId; batch = candidate; break; }
    }

    let report = null;
    if (tokenId === null) {
      tokenId = BigInt(await nft.totalBatches()) + 1n;
      report = await inspectImage(imagePath, tokenId, Number(network.chainId), deployment.contracts.OracleRegistry, product.cropType);
      if (Number(report.grade) >= 4) throw new Error(`${product.cropType} was graded Rejected by the real local image heuristic; it was not minted or listed.`);

      const metadata = {
        name: `${product.cropType} · AgriChain local demo lot`,
        description: `${product.description} ${catalog.notice}`,
        image: `/crop-photos/${product.image}`,
        imageCaption: "Real FruitNet sample photo. Exact photo bytes are identified by the SHA-256 digest below.",
        dataset: catalog.dataset,
        datasetURL: catalog.datasetURL,
        datasetLicense: catalog.mirrorLicense,
        sourceQualityLabel: product.sourceQualityLabel,
        imageHash: report.report.imageHash,
        qualityGrade: report.gradeName,
        confidenceScore: report.confidenceScore,
        reportHash: report.reportHash,
        farmer: admin.address,
        cropType: product.cropType,
        variety: product.variety,
        quantity: product.quantity,
        unit: product.unit,
        farmLocation: product.farmLocation,
      };
      const metadataURI = `data:application/json;base64,${Buffer.from(JSON.stringify(metadata), "utf8").toString("base64")}`;
      const mintReceipt = await (await nft.mintBatch(
        admin.address,
        metadataURI,
        product.cropType,
        BigInt(product.quantity),
        product.unit,
        BigInt(Math.floor(Date.now() / 1000) - 86400 * 3),
        product.farmLocation,
        imageHash
      )).wait();
      const minted = parseEvent(nft, mintReceipt, "BatchMinted");
      if (!minted) throw new Error(`Mint receipt for ${product.cropType} did not contain BatchMinted.`);
      tokenId = BigInt(minted.args.tokenId);
      if (tokenId !== BigInt(report.tokenId)) throw new Error(`AI report token ${report.tokenId} does not match minted token ${tokenId}.`);

      await (await oracle.submitVerification(tokenId, Number(report.grade), Number(report.confidenceScore), report.reportHash, report.signature)).wait();
      batch = await nft.getBatch(tokenId);
      if (!batch.isVerified || Number(batch.qualityGrade) !== Number(report.grade)) {
        throw new Error(`On-chain oracle verification did not match the AI result for ${product.cropType}.`);
      }
      console.log(`  Verified batch #${tokenId}: ${product.cropType}, ${report.gradeName}, rule score ${report.confidencePercent}%`);
    }

    const prior = listingEvents.find((event) => BigInt(event.args.tokenId) === tokenId);
    if (prior) {
      const existing = await marketplace.listings(prior.args.listingId);
      if (Number(existing.status) === 0) {
        const metadataURI = await nft.tokenURI(tokenId);
        await indexListing(existing, batch, metadataURI, product, report);
        console.log(`  Already active: listing #${existing.listingId} · ${product.cropType}`);
        continue;
      }
    }

    const metadataURI = await nft.tokenURI(tokenId);
    await (await nft.approve(deployment.contracts.AgriMarketplace, tokenId)).wait();
    const listReceipt = await (await marketplace.createListing(
      tokenId,
      ethers.parseEther(product.pricePerUnitAGRI),
      Number(batch.qualityGrade)
    )).wait();
    const created = parseEvent(marketplace, listReceipt, "ListingCreated");
    if (!created) throw new Error(`Listing receipt for ${product.cropType} did not contain ListingCreated.`);

    const liveListing = await marketplace.listings(created.args.listingId);
    const owner = await nft.ownerOf(tokenId);
    if (Number(liveListing.status) !== 0 || owner.toLowerCase() !== deployment.contracts.AgriMarketplace.toLowerCase()) {
      throw new Error(`Listing ${created.args.listingId} did not reach active NFT-custody state.`);
    }
    await indexListing(liveListing, batch, metadataURI, product, report);
    console.log(`  Listed on-chain: #${liveListing.listingId} · ${product.quantity} ${product.unit} · ${product.pricePerUnitAGRI} AGRI/${product.unit}`);
  }

  const syncResponse = await fetch("http://127.0.0.1:5000/api/listings/sync-chain", { method: "POST" });
  const syncResult = await syncResponse.json();
  if (!syncResponse.ok || !syncResult.success) throw new Error(`Could not sync backend listing statuses from chain: ${syncResult.error || syncResponse.statusText}`);
  console.log(`  Backend chain-status sync completed (${syncResult.synchronized} cached rows).`);

  console.log("FruitNet sample-photo catalog seeded and verified from chain state.");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = main;
