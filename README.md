# AgriChain: Blockchain-Based Smart Agriculture Marketplace with AI-Based Fruit Quality Verification

[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-v5.0-4E5EE4?logo=openzeppelin)](https://openzeppelin.com/)
[![Polygon](https://img.shields.io/badge/Polygon-Amoy%20L2-8247E5?logo=polygon)](https://polygon.technology/)
[![FastAPI](https://img.shields.io/badge/FastAPI-v0.128-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
[![Tests](https://img.shields.io/badge/Smart%20Contract%20Tests-85%20passing-10B981)](#smart-contract-test-results)

AgriChain is a local development prototype for agricultural trade using an ERC-20 test token, crop batch NFTs, oracle-signed image screening, and smart-contract escrow. Its produce-quality model is MobileNetV3-Small fine-tuned on the attributed FruitNet dataset plus a CC0 fresh/rotten fruit & vegetable set. It is not production-ready: uploaded image/report bytes are not pinned to IPFS, the CNN covers thirteen trained crops (other crops get a labelled rule-based screening, never a model grade), and shipping checkpoints are not proof of physical delivery.

**Fruit quality classification — locally trained model.** The model classifies Apple, Banana, Guava, Lime, Orange, Pomegranate, Mango, Tomato, Potato, Strawberry, Bellpepper, Cucumber, and Carrot photos as Good, Mixed, or Bad. Its score is an uncalibrated softmax score, not food-safety certification or a probability. Any other crop (grains, vegetables, …) is graded by a transparent rule-based screening — defect ratio plus unevenness, capped confidence, explicitly labelled `heuristic-screening` in the signed report — never presented as a model grade.

**Marketplace intelligence (all computed from real local data, never synthesized).** Settled-order price statistics guide farmer pricing and flag >30% outliers; QR codes on lots and shipping boxes deep-link to the read-only audit explorer; self-reported sustainability practices earn labelled demo eco-credits with a leaderboard; browser voice input can fill the listing form.

**Trust upgrades.** Every grade ships a server-side visual explanation (defect-pixel overlay from the same masks as the safety floor — consistent with the signed verdict by construction). Live photo capture binds camera image + device GPS + time into the signed report as tamper-evident attestation (raises the stock-photo bar; cannot prove physical presence). Transit checkpoints carry phone GPS plus real Open-Meteo route weather, with heat-exposure flags for buyers and jurors. The frontend is an installable offline-capable PWA: drafts and the catalog survive dead connections, indexer writes retry on reconnect — on-chain transactions are never queued (nonces forbid it) and the UI says so. Local marketplace entries are dataset-photo demonstrations with sample quantities/prices, not live farm inventory. Dataset attribution and preview-photo terms are in [`DATASET_ATTRIBUTION.md`](DATASET_ATTRIBUTION.md); training and held-out metrics are documented in [`ai-service/README.md`](ai-service/README.md). A report hash and grade can be bridged on-chain by a bonded oracle into `CropBatchNFT`.

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                       │
│    (Farmer, Buyer, AI Oracle, Juror, & Admin Views)     │
└──────────────┬────────────────────────────┬─────────────┘
               │ Ethers.js / Wagmi          │ REST API / JSON
               ▼                            ▼
┌─────────────────────────────┐  ┌─────────────────────────────┐
│  Polygon Amoy L2 / Hardhat  │  │   Node.js Express Backend   │
│  ┌───────────────────────┐  │  │   (SQLite Indexer, Merkle   │
│  │ AgriToken (ERC-20)    │  │  │    Checkpoints, Auth Cache) │
│  ├───────────────────────┤  │  └──────────────┬──────────────┘
│  │ CropBatchNFT (ERC-721)│  │                 │
│  ├───────────────────────┤  │                 ▼
│  │ ReputationSBT (SBT)   │  │  ┌─────────────────────────────┐
│  ├───────────────────────┤  │  │  Python AI Oracle Service   │
│  │ OracleRegistry        │◄─┼──┤  (FruitNet classifier,      │
│  ├───────────────────────┤  │  │   EIP-191 Cryptographic Sig)│
│  │ AgriMarketplace Escrow│  │  └─────────────────────────────┘
│  ├───────────────────────┤  │
│  │ DisputeDAO Governance │  │
│  ├───────────────────────┤  │
│  │ SupplyChainTracker    │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

---

## 2. Blockchain Concepts Coverage Matrix

Designed specifically to meet and exceed academic requirements for blockchain technology evaluation:

| # | Concept | Where Implemented |
|---|---|---|
| 1 | **Smart Contracts** | Full Solidity ^0.8.24 contracts with NatSpec documentation |
| 2 | **Fungible Tokens (ERC-20)** | `AgriToken.sol` (market settlement, staking collateral, voting weight) |
| 3 | **NFT Provenance (ERC-721)** | `CropBatchNFT.sol` (unique harvest lots with on-chain metadata) |
| 4 | **Soulbound Tokens (SBT)** | `ReputationSBT.sol` (non-transferable trust scores for participants) |
| 5 | **Decentralized Oracles** | `OracleRegistry.sol` (EIP-191 cryptographic ECDSA signature verification) |
| 6 | **Decentralized Storage** | Not configured; report/image digests are recorded, but bytes are not pinned |
| 7 | **Escrow & Safe Settlements** | `AgriMarketplace.sol` (non-reentrant multi-party escrow with 2% fee) |
| 8 | **DAO Governance & Staking** | `DisputeDAO.sol` (stake-weighted juror arbitration & majority verdicts) |
| 9 | **Merkle Tree Proofs** | `SupplyChainTracker.sol` (batched transit commits saving >91% gas) |
| 10 | **Economic Slashing** | Slashes 1,000 AGRI from fraudulent oracles/bad actors to compensate victims |
| 11 | **Layer-2 Scaling** | Configured for low-cost Polygon Amoy testnet deployment |

---

## 3. Monorepo Directory Structure

```
Agrichain/
├── contracts/               # Hardhat smart contract development workspace
│   ├── contracts/
│   │   ├── AgriToken.sol            # ERC-20 token with staking & faucet
│   │   ├── CropBatchNFT.sol         # ERC-721 crop batch token with AI grade storage
│   │   ├── ReputationSBT.sol        # Soulbound non-transferable trust score token
│   │   ├── OracleRegistry.sol       # Bonded AI oracle whitelist & signature bridge
│   │   ├── AgriMarketplace.sol      # Escrowed direct marketplace & delivery release
│   │   ├── DisputeDAO.sol           # Stake-weighted dispute resolution & slashing
│   │   └── SupplyChainTracker.sol   # Merkle tree transit checkpoints & proof verifier
│   ├── scripts/
│   │   └── deploy.js                # Full protocol deployment & RBAC wiring script
│   └── test/
│       ├── AgriToken.test.js        # 23 tests: Faucet, staking, slashing, voting
│       ├── CropBatchNFT.test.js     # 11 tests: Minting, provenance, oracle callbacks
│       ├── ReputationSBT.test.js    # 12 tests: Registration, non-transferability, score updates
│       ├── OracleRegistry.test.js   # 10 tests: Bonds, signatures, replay defense
│       ├── AgriMarketplace.test.js  # 10 tests: Escrow, delivery release, timeouts, DAO bridge
│       ├── DisputeDAO.test.js       # 7 tests: Voting weight, resolution, slashing
│       ├── SupplyChainTracker.test.js # 5 tests: Merkle proofs, gas benchmarks (91.6% savings)
│       └── AgriChain.e2e.test.js    # 2 full end-to-end user journeys (Happy path + Dispute)
├── backend/                 # Node.js + Express API & SQLite indexer
│   ├── database.js          # SQLite schema for listings, orders, checkpoints, disputes
│   ├── merkle.js            # Off-chain Merkle tree generator & proof builder
│   ├── server.js            # REST API endpoints & smart contract event listener
│   └── test/backend.test.js # 7 integration tests for backend endpoints
├── ai-service/              # Python FastAPI AI Quality Verification microservice
│   ├── model.py             # FruitNet-trained MobileNetV3-Small inference
│   ├── oracle_signer.py     # EIP-191 ECDSA signer using Oracle private key
│   ├── main.py              # FastAPI server with /api/verify endpoints
│   └── test_ai_service.py   # Unit tests for image analysis, report hashing, & signing
├── frontend/                # React + TypeScript + Vite web dashboard
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.tsx           # Role switcher, live balances, wallet connector
│   │   │   ├── MarketplaceView.tsx  # Buyer catalog, grade filtering, escrow checkout
│   │   │   ├── FarmerDashboard.tsx  # Minting form, AI inspection trigger, shipments
│   │   │   ├── OracleDashboard.tsx  # Node bond staking and image inspection preview
│   │   │   ├── JurorDashboard.tsx   # DAO arbitration court, voting controls, verdict execution
│   │   │   ├── AdminDashboard.tsx   # Oracle whitelisting, parameters, contract registry
│   │   │   └── TransitModal.tsx     # Merkle checkpoint inspector with cryptographic proof
│   │   ├── contracts.ts     # Deployed addresses and ABIs
│   │   ├── index.css        # Bespoke glassmorphism design system & color tokens
│   │   └── App.tsx          # Main Web3 state orchestration
└── package.json             # Root npm workspaces configuration
```

---

## 4. Setup & Installation Instructions

### Prerequisites
- **Node.js**: `v18.x` or higher (tested on `v22.19.0`)
- **Python**: `3.12` or later (Windows demo configured for `Python 3.14`)
- **Git**

### 1. Clone & Install Dependencies
```bash
# Clone the repository
git clone https://github.com/your-username/Agrichain.git
cd Agrichain

# Install root & workspace dependencies
npm install --workspace=contracts
npm install --workspace=backend
npm install --workspace=frontend

# Install Python AI microservice dependencies
cd ai-service
pip install -r requirements.txt
cd ..
```

---

## 5. Running the Test Suites

Every tier includes an automated test suite.

### 5.1 Smart Contract Test Suite (85 passing)
```bash
cd contracts
npx hardhat test
```
*Executes all unit tests and the 2 comprehensive end-to-end user journeys (Happy Path with Merkle proofs + Defective delivery dispute with oracle slashing).*

### 5.2 Gas Benchmarking
```bash
cd contracts
npx hardhat test test/SupplyChainTracker.test.js
```
**Output Report**:
```
================ GAS BENCHMARK REPORT ================
10 Checkpoints - Merkle Root Commit Gas:    105,239 gas
10 Checkpoints - Direct Storage Gas:      1,256,508 gas
Gas Reduction Achieved via Merkle Trees:         91.62%
======================================================
```

### 5.3 Backend REST API Test Suite (7/7 Tests Passing)
```bash
cd backend
npm test
```

### 5.4 AI Verification Microservice Tests (6/6 Passing)
```bash
cd ai-service
python -m unittest test_ai_service.py
```

---

## 6. Running the Full Stack Locally (Hardhat + MetaMask)

To run all services simultaneously for live demo and evaluation:

Use separate PowerShell terminals from the repository root (`Agrichain`). The Hardhat node terminal must remain running. Its generated accounts and test ETH exist only on this local chain.

Before the first run, install the AI packages and download/train the FruitNet model once:

```powershell
& "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" -m pip install -r ai-service/requirements.txt
& "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" ai-service/download_fruitnet.py
& "$env:LOCALAPPDATA\Programs\Python\Python314\python.exe" ai-service/train_fruitnet.py
```

The dataset archive and extracted photos are kept under the ignored `ai-service/data/` directory. The trained weights and held-out report are stored in `ai-service/models/`. Training can take time on CPU-only systems.

### Step 1: Start Hardhat Local
Terminal 1 (from repository root):
```bash
npm run chain:local
```

### Step 2: Deploy Contracts
Terminal 2 (from repository root):
```bash
npm run contracts:deploy:local
```
This writes fresh addresses to `contracts/deployments/localhost.json`. On chain 31337, if `ORACLE_PRIVATE_KEY` is configured, the deploy script whitelists and bonds that local AI signer with 5,000 TEST AGRI so the signed verification is accepted. The frontend's default local addresses are deterministic for a fresh Hardhat node; restart the node and redeploy together if addresses ever differ.

### Step 3: Start AI Verification Service
Terminal 3:
```bash
cd ai-service
python -m pip install -r requirements.txt
python -m uvicorn main:app --port 8001 --host 127.0.0.1
```
*API docs available at `http://localhost:8001/docs`.*

### Step 4: Start Node.js Backend & Indexer
Terminal 4:
```bash
cd backend
npm start
```
*API live at `http://localhost:5000/api/listings`.*

### Step 5: Start Frontend Application
Terminal 5:
```bash
cd frontend
npm run dev -- --host 127.0.0.1
```
*Open `http://127.0.0.1:3000`.*

### Step 6: Add Hardhat Local to MetaMask

In MetaMask Extension, open the top-right menu, choose **Networks**, then **Add a custom network**. Enter:

| Setting | Value |
|---|---|
| Network name | Hardhat Local |
| RPC URL | `http://127.0.0.1:8545` |
| Chain ID | `31337` |
| Currency symbol | `ETH` |

If the custom-network form is not visible, use the top-right menu → **Networks** → **Add a custom network** (Extension), or in Mobile use the network selector → **Custom** → **Add a custom network**. Do not select Ethereum Mainnet. See [MetaMask's current custom-network steps](https://support.metamask.io/configure/networks/how-to-add-a-custom-network-rpc).

### Step 7: Import local test accounts and assign roles

In Terminal 1, Hardhat prints disposable account addresses and private keys. In MetaMask, use **Add account or hardware wallet** → **Import account**, then copy the selected key directly from your own local Hardhat terminal into MetaMask. Never paste or send these keys to anyone, and never use these accounts on a public chain. Your original MetaMask Account 1 can remain unused.

| MetaMask label | Hardhat account | Actual local permissions / setup |
|---|---:|---|
| Hardhat Admin | Account #0 | Deployer; default admin, NFT minter, and logistics role on a fresh deployment |
| Hardhat Oracle | Account #1 | Configured local oracle with a 5,000 AGRI bond on the current deployment; admin must grant `MINTER_ROLE` before this account can mint as a farmer |
| Hardhat Buyer | Account #2 | Claim TEST AGRI from the on-chain faucet before approving and buying |
| Hardhat Logistics | Account #3 | Admin grants `LOGISTICS_ROLE` on SupplyChainTracker before submitting checkpoints |
| Hardhat Arbitrator | Account #4 | Claim TEST AGRI, then stake at least 1,000 AGRI to qualify for DAO voting; there is no separate arbitrator role |

Select the corresponding imported account in MetaMask when testing each step. Account #0 is the only one with default admin privileges on a fresh deployment. Use the existing Admin dashboard to grant farmer/logistics roles, and report success only after the transaction is confirmed and contract state is read back. To disconnect or change accounts, use MetaMask's account selector or the wallet profile controls; the frontend listens for account and chain changes.

The checkpoint payload is off-chain in the local SQLite backend; its Merkle root is committed on-chain. Escrow checks proof inclusion and that a logistics-role account designated that leaf as the delivery checkpoint. This verifies the carrier's committed assertion, not physical delivery independently. The three-day inactivity timeout also requires the same designated delivery proof and therefore cannot release escrow without it.

---

## 7. Verified Deployed Contract Addresses (Local Hardhat / Amoy)

| Contract | Address |
|---|---|
| **AgriToken (ERC-20)** | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| **CropBatchNFT (ERC-721)** | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| **ReputationSBT (Soulbound)** | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| **OracleRegistry** | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| **AgriMarketplace** | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |
| **DisputeDAO** | `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707` |
| **SupplyChainTracker** | `0x0165878A594ca255338adfa4d48449f69242Eb8F` |

---

## 8. Known Limitations & Future Scope

1. **Hardware IoT Integration**: Ambient temperature and GPS telemetry are cryptographically committed as Merkle roots. Physical hardware devices (e.g., Raspberry Pi/ESP32 temperature sensors with crypto coprocessors) can be integrated as future work.
2. **On-Chain Randomness**: Juror selection currently relies on block hash and stake weights. For production, Chainlink VRF (Verifiable Random Function) should be incorporated to guarantee tamper-proof juror lottery draws.
3. **Cross-Chain Interoperability**: Currently optimized for Polygon Amoy L2. Future versions can utilize Chainlink CCIP for multi-chain settlement across Ethereum, Arbitrum, and Avalanche.
4. **Juror incentives**: voting weight is stake-based, but there are no majority-reward payouts and minority voters are not slashed (`jurorSlashingBps` is declared, not enforced).

---

## 9. Roles: people/services vs. contract permissions

User-facing responsibilities and Solidity permissions are deliberately different things:

| Human / service role | Responsibility | On-chain permission |
|---|---|---|
| Farmer / Seller | Registers identity, mints and lists batches, ships | `MINTER_ROLE`, optionally `TRACKER_ROLE` |
| Buyer | Inspects, buys, receives, confirms, disputes with photo evidence | None (permissionless buyer functions) |
| Platform Admin | Verifies identities, whitelists oracles, grants roles, config | `DEFAULT_ADMIN_ROLE` (+ DAO admin) |
| AI Oracle (service) | Grades photos, signs reports with a bonded key | `ORACLE_ROLE` (via OracleRegistry) |
| Logistics / Carrier | Commits checkpoint roots, designates delivery leaves | `TRACKER_ROLE` |
| DAO Juror | Stakes AGRI, votes Refund / Pay / Split | None (stake-weighted voting, no privileged role) |
| DAO / Dispute Manager | Executes verdicts on escrow | `DAO_ROLE` |
| Auditor / Observer | Inspects batches, orders, proofs, disputes, votes | Read-only (Audit tab) |
| Platform Operator | Runs indexer, AI service, reconciliation, health | `OPERATOR_ROLE` on ReputationSBT; holds no keys, signs nothing |

Notes that matter under questioning: the oracle never mints, never touches escrow, never votes; logistics cannot change grades, release funds, or move NFTs; the admin cannot take escrow, regrade crops, override DAO verdicts, or rewrite history; the backend signs nothing by architecture. There is no oracle "pending images" queue — grading is farmer-initiated and relayed, which is why none is shown.

---

## 9. Academic Course Project Credentials
- **Course**: Blockchain Technology & Decentralized Applications Capstone
- **Engineering Quality**: Contracts use OpenZeppelin protections and automated local tests; this prototype has not had an independent security audit and is not production-ready.

---

## 10. Acceptance-test notes

Follow Section 6 for the exact clean-terminal and MetaMask setup. The local hardhat tests exercise contract journeys; they do not substitute for the browser/MetaMask flow. A normal development Python installation needs the dependencies in `ai-service/requirements.txt` installed before running the AI unit tests. The browser AI upload also needs the AI signer configured through the local environment; do not commit private keys.

The database stores checkpoint detail and dispute indexing data off-chain. The root and designated delivery leaf are on-chain. The carrier's designation is an attestation; this prototype has no independent physical-delivery oracle. Dispute claim text is hashed on-chain while shared evidence files remain off-chain; the UI does not claim files are blockchain-stored.
