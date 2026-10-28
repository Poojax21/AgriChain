export const CONTRACT_ADDRESSES = {
  AgriToken: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  CropBatchNFT: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  ReputationSBT: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  OracleRegistry: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  AgriMarketplace: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
  DisputeDAO: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  SupplyChainTracker: "0x0165878A594ca255338adfa4d48449f69242Eb8F"
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
  "function submitVerification(uint256 tokenId, uint8 grade, uint16 confidenceScore, bytes32 reportHash, bytes signature)",
  "event QualityVerified(uint256 indexed tokenId, address indexed oracleNode, uint8 grade, uint16 confidenceScore, bytes32 reportHash)"
];

export const AGRI_MARKETPLACE_ABI = [
  "function platformFeeBps() view returns (uint256)",
  "function listings(uint256) view returns (uint256 listingId, uint256 tokenId, address farmer, uint256 pricePerUnit, uint256 availableQuantity, uint8 minQualityGrade, uint8 status, uint256 createdAt)",
  "function getOrder(uint256 orderId) view returns (tuple(uint256 orderId, uint256 listingId, uint256 tokenId, address buyer, address farmer, uint256 quantity, uint256 totalAmount, uint256 platformFee, uint8 status, uint256 placedAt, uint256 shippedAt, uint256 deliveredAt, bytes32 disputeReasonHash))",
  "function createListing(uint256 tokenId, uint256 pricePerUnit, uint8 minQualityGrade) returns (uint256)",
  "function cancelListing(uint256 listingId)",
  "function placeOrder(uint256 listingId, uint256 quantity) returns (uint256)",
  "function shipOrder(uint256 orderId)",
  "function confirmDelivery(uint256 orderId)",
  "function raiseDispute(uint256 orderId, bytes32 reasonHash)",
  "function autoReleaseAfterTimeout(uint256 orderId)",
  "event ListingCreated(uint256 indexed listingId, uint256 indexed tokenId, address indexed farmer, uint256 pricePerUnit, uint256 quantity, uint8 minGrade)",
  "event OrderPlaced(uint256 indexed orderId, uint256 indexed listingId, uint256 indexed tokenId, address buyer, address farmer, uint256 quantity, uint256 escrowAmount)",
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
  "function orderCheckpointRoots(uint256) view returns (bytes32)",
  "function submitCheckpointRoot(uint256 orderId, bytes32 merkleRoot, string ipfsBatchCID)",
  "function verifyCheckpoint(uint256 orderId, bytes32 leaf, bytes32[] proof) returns (bool)",
  "event CheckpointRootCommitted(uint256 indexed orderId, bytes32 indexed merkleRoot, string ipfsBatchCID, address indexed submittedBy)",
  "event CheckpointVerified(uint256 indexed orderId, bytes32 indexed leaf, bool isValid)"
];
