# AgriChain: Blockchain-Based Smart Agriculture Marketplace with AI-Based Crop Quality Verification

[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![OpenZeppelin](https://img.shields.io/badge/OpenZeppelin-v5.0-4E5EE4?logo=openzeppelin)](https://openzeppelin.com/)
[![Polygon](https://img.shields.io/badge/Polygon-Amoy%20L2-8247E5?logo=polygon)](https://polygon.technology/)
[![FastAPI](https://img.shields.io/badge/FastAPI-v0.128-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
[![Tests](https://img.shields.io/badge/Smart%20Contract%20Tests-80%2F80%20Passing-10B981)](#smart-contract-test-results)

AgriChain is a production-grade decentralized marketplace that directly connects farmers with wholesale buyers, exporters, and retailers, eliminating predatory middlemen from the agricultural supply chain. 

Every harvest lot listed on the platform undergoes objective quality inspection via a computer-vision CNN model (MobileNetV2 + HSV defect segmentation). Inspection reports are cryptographically signed and bridged on-chain by bonded oracle nodes into an immutable ERC-721 token (`CropBatchNFT`). The protocol features non-reentrant smart-contract escrow, Soulbound reputation tracking (`ReputationSBT`), Merkle-tree batched transit checkpoints, and a stake-weighted DAO dispute resolution court (`DisputeDAO`).

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
│  │ OracleRegistry        │◄─┼──┤  (MobileNetV2 CNN, OpenCV,  │
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
| 6 | **Decentralized Storage** | IPFS URI schema (`ipfs://`) for harvest imagery and inspection reports |
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
│   ├── model.py             # MobileNetV2 CNN classifier + HSV defect segmentation
│   ├── oracle_signer.py     # EIP-191 ECDSA signer using Oracle private key
│   ├── main.py              # FastAPI server with /api/verify endpoints
│   └── test_ai_service.py   # Unit tests for image analysis, report hashing, & signing
├── frontend/                # React + TypeScript + Vite web dashboard
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.tsx           # Role switcher, live balances, wallet connector
│   │   │   ├── MarketplaceView.tsx  # Buyer catalog, grade filtering, escrow checkout
│   │   │   ├── FarmerDashboard.tsx  # Minting form, AI inspection trigger, shipments
│   │   │   ├── OracleDashboard.tsx  # Node bond staking, real-time CNN inspection studio
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
- **Python**: `3.10` to `3.12` (tested on `Python 3.12.4`)
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

### 5.1 Smart Contract Test Suite (80/80 Tests Passing)
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

### 5.4 AI Verification Microservice Tests (5/5 Passing)
```bash
cd ai-service
python -m unittest test_ai_service.py
```

---

## 6. Running the Full Stack Locally

To run all services simultaneously for live demo and evaluation:

### Step 1: Deploy Smart Contracts
In terminal 1:
```bash
cd contracts
# Start local Hardhat node
npx hardhat node

# In a separate terminal or once started, deploy contracts
npx hardhat run scripts/deploy.js --network localhost
```

### Step 2: Start AI Verification Service
In terminal 2:
```bash
cd ai-service
python -m uvicorn main:app --port 8000 --host 127.0.0.1
```
*API docs available at `http://localhost:8000/docs`.*

### Step 3: Start Node.js Backend & Indexer
In terminal 3:
```bash
cd backend
npm start
```
*API live at `http://localhost:5000/api/listings`.*

### Step 4: Start Frontend Application
In terminal 4:
```bash
cd frontend
npm run dev
```
*Open `http://localhost:3000` in your browser.*

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

---

## 9. Academic Course Project Credentials
- **Course**: Blockchain Technology & Decentralized Applications Capstone
- **Engineering Quality**: Full checks-effects-interactions, OpenZeppelin v5 primitives, NatSpec documentation, automated test suite with 100% pass rate.
