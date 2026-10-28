// Exit 0 (prints REUSE) when every address in deployments/localhost.json
// already has contract code on the local node; exit 2 (prints DEPLOY) otherwise.
// Lets start.bat skip redeploys so lots/orders/escrows survive restarts.
const { ethers } = require("C:\\Users\\Hi\\Projects\\Agrichain\\Agrichain\\node_modules\\ethers");
const fs = require("fs");
const path = require("path");

(async () => {
  try {
    const depPath = path.join(__dirname, "..", "deployments", "localhost.json");
    if (!fs.existsSync(depPath)) { console.log("DEPLOY"); process.exit(2); }
    const contracts = JSON.parse(fs.readFileSync(depPath, "utf8")).contracts;
    const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    await provider.getNetwork();
    for (const addr of Object.values(contracts)) {
      const code = await provider.getCode(addr);
      if (!code || code === "0x") { console.log("DEPLOY"); process.exit(2); }
    }
    console.log("REUSE");
    process.exit(0);
  } catch {
    console.log("DEPLOY");
    process.exit(2);
  }
})();
