// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./CropBatchNFT.sol";
import "./AgriMarketplace.sol";

/**
 * @title SupplyChainTracker
 * @author AgriChain Core Engineering Team
 * @notice Cryptographic supply chain tracking contract utilizing Merkle trees for gas-optimized transit checkpoint verification.
 * @dev Enables logistics carriers to commit batch roots representing hundreds of transit checkpoints
 *      (timestamps, GPS coordinates, temperature telemetry) in a single O(1) storage write.
 *      Includes direct storage benchmark function for comparative gas evaluation in academic reports.
 */
contract SupplyChainTracker is AccessControl {
    /// @notice Role authorized to submit logistics checkpoint data (verified carriers, farmers).
    bytes32 public constant LOGISTICS_ROLE = keccak256("LOGISTICS_ROLE");

    /// @notice Reference to CropBatchNFT contract.
    CropBatchNFT public immutable cropBatchNFT;

    /// @notice Reference to AgriMarketplace contract.
    AgriMarketplace public immutable marketplace;

    /// @notice Unbatched direct checkpoint structure used for gas benchmarking.
    struct DirectCheckpoint {
        string location;
        uint256 timestamp;
        int16 temperatureCelsius; // Stored in tenths of a degree (e.g., 45 = 4.5 C)
        string statusNote;
    }

    /// @notice Mapping from order ID to committed Merkle root of batched checkpoints.
    mapping(uint256 => bytes32) public orderCheckpointRoots;

    /// @notice Mapping from order ID to IPFS CID storing the complete checkpoint leaf dataset.
    mapping(uint256 => string) public orderBatchIPFSCID;

    /// @notice Mapping from order ID to array of directly recorded checkpoints (for benchmarking).
    mapping(uint256 => DirectCheckpoint[]) public directCheckpoints;

    /// @notice Emitted when a new transit Merkle root is committed on-chain.
    event CheckpointRootCommitted(
        uint256 indexed orderId,
        bytes32 indexed merkleRoot,
        string ipfsBatchCID,
        address indexed submittedBy
    );

    /// @notice Emitted when a direct checkpoint is stored (naive on-chain benchmark).
    event DirectCheckpointLogged(
        uint256 indexed orderId,
        string location,
        uint256 timestamp,
        int16 temperatureCelsius,
        address indexed submittedBy
    );

    /// @notice Emitted when a checkpoint leaf is verified against a committed Merkle root.
    event CheckpointVerified(
        uint256 indexed orderId,
        bytes32 indexed leaf,
        bool isValid
    );

    /// @notice Custom error thrown when Merkle root is zero.
    error InvalidMerkleRoot();

    /// @notice Custom error thrown when proof verification fails.
    error CheckpointProofInvalid(uint256 orderId, bytes32 leaf);

    /**
     * @notice Initializes the SupplyChainTracker contract.
     * @param admin Governance admin.
     * @param _cropBatchNFT Address of CropBatchNFT.
     * @param _marketplace Address of AgriMarketplace.
     */
    constructor(
        address admin,
        address _cropBatchNFT,
        address _marketplace
    ) {
        require(admin != address(0), "Invalid admin");
        require(_cropBatchNFT != address(0), "Invalid NFT");
        require(_marketplace != address(0), "Invalid marketplace");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(LOGISTICS_ROLE, admin);

        cropBatchNFT = CropBatchNFT(_cropBatchNFT);
        marketplace = AgriMarketplace(_marketplace);
    }

    /**
     * @notice Commits an immutable Merkle root representing a batch of transit checkpoints.
     * @dev Restricts gas consumption to a single 32-byte storage slot, regardless of whether
     *      10 or 1,000 checkpoints were recorded during transit.
     * @param orderId Identifier of the order.
     * @param merkleRoot Cryptographic root of the Merkle tree constructed from checkpoint hashes.
     * @param ipfsBatchCID Decentralized IPFS URI containing raw checkpoint telemetry JSON.
     */
    function submitCheckpointRoot(
        uint256 orderId,
        bytes32 merkleRoot,
        string calldata ipfsBatchCID
    ) external onlyRole(LOGISTICS_ROLE) {
        if (merkleRoot == bytes32(0)) {
            revert InvalidMerkleRoot();
        }

        orderCheckpointRoots[orderId] = merkleRoot;
        orderBatchIPFSCID[orderId] = ipfsBatchCID;

        // Propagate root to NFT if linked
        try marketplace.getOrder(orderId) returns (AgriMarketplace.Order memory order) {
            if (order.tokenId > 0) {
                try cropBatchNFT.setCheckpointRoot(order.tokenId, merkleRoot) {} catch {}
            }
        } catch {}

        emit CheckpointRootCommitted(orderId, merkleRoot, ipfsBatchCID, msg.sender);
    }

    /**
     * @notice Cryptographically verifies that an individual checkpoint belongs to the committed Merkle root.
     * @dev Anyone (buyer, auditor, insurer) can independently verify a checkpoint without trusting an intermediary.
     * @param orderId Identifier of the order.
     * @param leaf The cryptographic hash of the specific checkpoint event.
     * @param proof Merkle inclusion proof (array of sibling hashes).
     * @return isValid True if the checkpoint is proven part of the immutable batch.
     */
    function verifyCheckpoint(
        uint256 orderId,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external returns (bool isValid) {
        bytes32 root = orderCheckpointRoots[orderId];
        if (root == bytes32(0)) {
            return false;
        }

        isValid = MerkleProof.verify(proof, root, leaf);
        emit CheckpointVerified(orderId, leaf, isValid);
        return isValid;
    }

    /**
     * @notice Naive direct on-chain checkpoint submission for gas benchmarking.
     * @dev Used in academic testing to demonstrate gas cost inflation when avoiding Merkle trees.
     * @param orderId Identifier of the order.
     * @param location GPS coordinates or facility name.
     * @param timestamp Unix epoch time.
     * @param temperatureCelsius Ambient temperature telemetry in tenths of degree C.
     * @param statusNote Brief transit observation (e.g. "Cold chain maintained").
     */
    function submitDirectCheckpoint(
        uint256 orderId,
        string calldata location,
        uint256 timestamp,
        int16 temperatureCelsius,
        string calldata statusNote
    ) external onlyRole(LOGISTICS_ROLE) {
        directCheckpoints[orderId].push(DirectCheckpoint({
            location: location,
            timestamp: timestamp,
            temperatureCelsius: temperatureCelsius,
            statusNote: statusNote
        }));

        emit DirectCheckpointLogged(orderId, location, timestamp, temperatureCelsius, msg.sender);
    }

    /**
     * @notice Returns count of direct checkpoints stored for an order.
     * @param orderId Identifier of the order.
     */
    function getDirectCheckpointsCount(uint256 orderId) external view returns (uint256) {
        return directCheckpoints[orderId].length;
    }
}
