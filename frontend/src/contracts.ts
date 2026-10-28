const env = (import.meta as any).env || {};
const pick = (key: string, fallback: string) => (env[key] as string) || fallback;

export const CONTRACT_ADDRESSES = {
  AgriToken: pick('VITE_AGRI_TOKEN_ADDRESS', "0x5FbDB2315678afecb367f032d93F642f64180aa3"),
  CropBatchNFT: pick('VITE_CROP_BATCH_NFT_ADDRESS', "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512"),
  ReputationSBT: pick('VITE_REPUTATION_SBT_ADDRESS', "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"),
  OracleRegistry: pick('VITE_ORACLE_REGISTRY_ADDRESS', "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9"),
  AgriMarketplace: pick('VITE_AGRI_MARKETPLACE_ADDRESS', "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9"),
  DisputeDAO: pick('VITE_DISPUTE_DAO_ADDRESS', "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707"),
  SupplyChainTracker: pick('VITE_SUPPLY_CHAIN_TRACKER_ADDRESS', "0x0165878A594ca255338adfa4d48449f69242Eb8F")
};

export const AGRI_TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function stakedBalanceOf(address account) view returns (uint256)",
  "function votingPower(address account) view returns (uint256)",
  "function faucet()",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Staked(address indexed user, uint256 amount, uint256 newStakedBalance)",
  "event FaucetDripped(address indexed recipient, uint256 amount, uint256 timestamp)"
];

export const CROP_BATCH_NFT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function totalBatches() view returns (uint256)",
  "function getBatch(uint256 tokenId) view returns (tuple(address farmer, string cropType, uint256 quantity, string unit, uint256 harvestDate, string farmLocation, string imageCID, uint8 qualityGrade, uint16 confidenceScore, bytes32 reportHash, bool isVerified, bytes32 merkleCheckpointRoot))",
  "function mintBatch(address farmer, string uri, string cropType, uint256 quantity, string unit, uint256 harvestDate, string farmLocation, string imageCID) returns (uint256)",
  "function approve(address to, uint256 tokenId)",
  "function safeTransferFrom(address from, address to, uint256 tokenId)",
  "event BatchMinted(uint256 indexed tokenId, address indexed farmer, string cropType, uint256 quantity, string unit, string tokenURI)",
  "event QualityResultUpdated(uint256 indexed tokenId, uint8 grade, uint16 confidenceScore, bytes32 reportHash)"
];

export const REPUTATION_SBT_ABI = [
  "function register() returns (uint256)",
  "function isRegistered(address user) view returns (bool)",
  "function getReputation(address user) view returns (uint256 score, uint256 successfulTrades, uint256 disputesWon, uint256 disputesLost)",
  "event UserRegistered(address indexed user, uint256 indexed tokenId, uint256 initialScore)",
  "event ReputationUpdated(address indexed user, uint256 newScore, int256 delta, string reason)"
];

export const ORACLE_REGISTRY_ABI = [
  "function MINIMUM_ORACLE_STAKE() view returns (uint256)",
  "function oracleNodes(address) view returns (bool isWhitelisted, bool isActive, uint256 stakedAmount, uint256 verificationsCount, uint256 slashedCount, uint256 totalSlashedAmount, uint256 registeredAt)",
  "function whitelistOracle(address oracleNode)",
  "function stakeBond(uint256 amount)",
  "function unstakeBond(uint256 amount)",
  "function submitVerification(uint256 tokenId, uint8 grade, uint16 confidenceScore, bytes32 reportHash, bytes signature)",
  "event QualityVerified(uint256 indexed tokenId, address indexed oracleNode, uint8 grade, uint16 confidenceScore, bytes32 reportHash)"
];

export const AGRI_MARKETPLACE_ABI = [
  "function platformFeeBps() view returns (uint256)",
  "function listings(uint256) view returns (uint256 listingId, uint256 tokenId, address farmer, uint256 pricePerUnit, uint256 availableQuantity, uint8 minQualityGrade, uint8 status, uint256 createdAt)",
  "function getOrder(uint256 orderId) view returns (tuple(uint256 orderId, uint256 listingId, uint256 tokenId, address buyer, address farmer, uint256 quantity, uint256 totalAmount, uint256 platformFee, uint8 status, uint256 placedAt, uint256 shippedAt, uint256 receivedAt, uint256 deliveredAt, bytes32 disputeReasonHash))",
  "function markReceived(uint256 orderId)",
  "function createListing(uint256 tokenId, uint256 pricePerUnit, uint8 minQualityGrade) returns (uint256)",
  "function cancelListing(uint256 listingId)",
  "function placeOrder(uint256 listingId, uint256 quantity) returns (uint256)",
  "function shipOrder(uint256 orderId)",
  "function confirmDelivery(uint256 orderId, bytes32 deliveryLeaf, bytes32[] proof)",
  "function raiseDispute(uint256 orderId, bytes32 reasonHash, address oracleNode)",
  "function autoReleaseAfterTimeout(uint256 orderId, bytes32 deliveryLeaf, bytes32[] proof)",
  "function setDisputeDAO(address dao)",
  "function setSupplyChainTracker(address tracker)",
  "event ListingCreated(uint256 indexed listingId, uint256 indexed tokenId, address indexed farmer, uint256 pricePerUnit, uint256 quantity, uint8 minGrade)",
  "event OrderPlaced(uint256 indexed orderId, uint256 indexed listingId, uint256 indexed tokenId, address buyer, address farmer, uint256 quantity, uint256 escrowAmount)",
  "event OrderReceived(uint256 indexed orderId, uint256 receivedAt)",
  "event OrderDelivered(uint256 indexed orderId, uint256 payoutToFarmer, uint256 platformFee)",
  "event DisputeRaised(uint256 indexed orderId, address indexed raisedBy, bytes32 reasonHash)"
];

export const DISPUTE_DAO_ABI = [
  "function MINIMUM_JUROR_STAKE() view returns (uint256)",
  "function disputes(uint256) view returns (uint256 disputeId, uint256 orderId, address buyer, address farmer, address oracleNode, bytes32 evidenceHash, uint256 totalVotesBuyer, uint256 totalVotesFarmer, uint256 totalVotesSplit, uint256 votingEndsAt, uint8 verdict, bool isResolved)",
  "function createDispute(uint256 orderId, address buyer, address farmer, address oracleNode, bytes32 evidenceHash) returns (uint256)",
  "function vote(uint256 disputeId, uint8 choice)",
  "function resolveDispute(uint256 disputeId)",
  "event DisputeOpened(uint256 indexed disputeId, uint256 indexed orderId, address buyer, address farmer, bytes32 evidenceHash, uint256 votingEndsAt)",
  "event VoteCast(uint256 indexed disputeId, address indexed juror, uint8 choice, uint256 weight)",
  "event DisputeResolved(uint256 indexed disputeId, uint8 finalVerdict, uint256 winningVotes)"
];

export const SUPPLY_CHAIN_TRACKER_ABI = [
  "function LOGISTICS_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
  "function orderCheckpointRoots(uint256) view returns (bytes32)",
  "function deliveryCheckpointLeaves(uint256) view returns (bytes32)",
  "function submitCheckpointRoot(uint256 orderId, bytes32 merkleRoot, string ipfsBatchCID)",
  "function submitDeliveryCheckpoint(uint256 orderId, bytes32 leaf, bytes32[] proof)",
  "function isDeliveryProofValid(uint256 orderId, bytes32 leaf, bytes32[] proof) view returns (bool)",
  "function verifyCheckpoint(uint256 orderId, bytes32 leaf, bytes32[] proof) returns (bool)",
  "function isCheckpointValid(uint256 orderId, bytes32 leaf, bytes32[] proof) view returns (bool)",
  "event CheckpointRootCommitted(uint256 indexed orderId, bytes32 indexed merkleRoot, string ipfsBatchCID, address indexed submittedBy)",
  "event CheckpointVerified(uint256 indexed orderId, bytes32 indexed leaf, bool isValid)"
];

export const SUPPORTED_CHAIN_ID = Number(pick('VITE_CHAIN_ID', '31337'));
export const SUPPORTED_NETWORKS: Record<number, { chainIdHex: string; chainName: string; rpcUrls: string[]; nativeCurrency: { name: string; symbol: string; decimals: number } }> = {
  31337: {
    chainIdHex: '0x7A69',
    chainName: 'Hardhat Local',
    rpcUrls: ['http://127.0.0.1:8545'],
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  80002: {
    chainIdHex: '0x13882',
    chainName: 'Polygon Amoy',
    rpcUrls: ['https://rpc-amoy.polygon.technology'],
    nativeCurrency: { name: 'MATIC', symbol: 'MATIC', decimals: 18 },
  },
};

export const BACKEND_URL = pick('VITE_BACKEND_URL', 'http://localhost:5000');
export const AI_SERVICE_URL = pick('VITE_AI_SERVICE_URL', 'http://127.0.0.1:8001');
export const RPC_URL = pick('VITE_RPC_URL', 'http://127.0.0.1:8545');

export const ERC721_BALANCE_ABI = ["function balanceOf(address owner) view returns (uint256)"];
export const ERC721_APPROVE_ABI = [
  "function approve(address to, uint256 tokenId)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function setApprovalForAll(address operator, bool approved)",
];
export const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
];
export const MINTER_ROLE_HASH = '0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6';
