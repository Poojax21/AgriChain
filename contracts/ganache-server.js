// Persistent local chain for AgriChain dev: same test accounts as Hardhat
// (same default mnemonic => same addresses), chain 31337, state on disk so
// lots/orders/escrows survive restarts. Not for production.
const ganache = require("ganache");
const path = require("path");

const server = ganache.server({
  database: { dbPath: path.join(__dirname, ".ganache-db") },
  wallet: { mnemonic: "test test test test test test test test test test test junk" },
  chain: { chainId: 31337, networkId: 31337, allowUnlimitedContractSize: true },
  logging: { quiet: false },
});

server.listen(8545, "127.0.0.1").then(() => console.log("ganache persistent chain on 127.0.0.1:8545")).catch((e) => { console.error(e); process.exit(1); });
