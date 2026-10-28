// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title CropBatchNFT
 * @author AgriChain Core Engineering Team
 * @notice ERC-721 Non-Fungible Token representing a unique harvest batch in the AgriChain marketplace.
 * @dev Stores immutable harvest provenance data, verified AI quality grades, and Merkle checkpoint roots.
 *      Ownership represents legal/physical custody of the harvest batch and transfers upon sale completion.
 */
contract CropBatchNFT is ERC721URIStorage, AccessControl {
    /// @notice Role authorized to submit AI quality verification results.
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    /// @notice Role authorized to mint new crop batches (farmers, marketplace contracts).
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Role authorized to update transit Merkle checkpoint roots (e.g., SupplyChainTracker).
    bytes32 public constant TRACKER_ROLE = keccak256("TRACKER_ROLE");

    /// @notice Standardized quality grades assigned by the AI inspection engine.
    enum QualityGrade {
        NOT_GRADED, // 0: Pending verification
        GRADE_A,    // 1: Premium export quality (high size, zero blemishes)
        GRADE_B,    // 2: Standard commercial grade (minor cosmetic variances)
        GRADE_C,    // 3: Processing/industrial grade (edible, suitable for pulp/feed)
        REJECTED    // 4: Failed inspection (rot, mold, contamination)
    }

    /// @notice On-chain provenance and verification attributes of a crop batch.
    struct BatchMetadata {
        address farmer;
        string cropType;
        uint256 quantity; // In specified unit (e.g. kg)
        string unit;      // "kg", "quintal", "ton"
        uint256 harvestDate;
        string farmLocation;
        string imageCID;
        QualityGrade qualityGrade;
        uint16 confidenceScore; // Basis points: 0-10000 (e.g. 9650 = 96.50%)
        bytes32 reportHash;    // keccak256 of AI inspection report JSON
        bool isVerified;
        bytes32 merkleCheckpointRoot;
    }

    /// @notice Auto-incrementing token identifier counter.
    uint256 private _nextTokenId;

    /// @notice Mapping from token ID to on-chain batch metadata.
    mapping(uint256 => BatchMetadata) private _batches;

    /// @notice Emitted when a new crop batch NFT is minted.
    event BatchMinted(
        uint256 indexed tokenId,
        address indexed farmer,
        string cropType,
        uint256 quantity,
        string unit,
        string tokenURI
    );

    /// @notice Emitted when an authorized Oracle records verified AI quality metrics.
    event QualityResultUpdated(
        uint256 indexed tokenId,
        QualityGrade grade,
        uint16 confidenceScore,
        bytes32 reportHash
    );

    /// @notice Emitted when transit checkpoints are committed as a Merkle root.
    event CheckpointRootUpdated(uint256 indexed tokenId, bytes32 merkleRoot);

    /// @notice Error thrown when querying or updating a non-existent token.
    error BatchNotFound(uint256 tokenId);

    /// @notice Error thrown when quantity is zero.
    error InvalidQuantity();

    /// @notice Error thrown when confidence score exceeds 10,000 basis points.
    error InvalidConfidenceScore(uint16 confidenceScore);

    /**
     * @notice Initializes the CropBatchNFT contract with roles.
     * @param admin Address granted default admin and minter roles.
     */
    constructor(address admin) ERC721("AgriChain Crop Batch", "CROP") {
        require(admin != address(0), "Invalid admin address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    /**
     * @notice Mints a new CropBatchNFT representing a harvested lot.
     * @param farmer Address of the producing farmer.
     * @param uri IPFS URI pointing to decentralized metadata JSON.
     * @param cropType Agricultural crop designation (e.g. "Basmati Rice", "Organic Tomato").
     * @param quantity Harvested quantity.
     * @param unit Measurement unit (e.g. "kg", "quintal").
     * @param harvestDate Epoch timestamp when the crop was harvested.
     * @param farmLocation Geographical provenance description or coordinates.
     * @param imageCID IPFS Content Identifier of crop inspection photographs.
     * @return tokenId The newly minted token ID.
     */
    function mintBatch(
        address farmer,
        string memory uri,
        string memory cropType,
        uint256 quantity,
        string memory unit,
        uint256 harvestDate,
        string memory farmLocation,
        string memory imageCID
    ) external onlyRole(MINTER_ROLE) returns (uint256) {
        if (quantity == 0) {
            revert InvalidQuantity();
        }
        require(farmer != address(0), "Invalid farmer address");

        uint256 tokenId = ++_nextTokenId;

        _batches[tokenId] = BatchMetadata({
            farmer: farmer,
            cropType: cropType,
            quantity: quantity,
            unit: unit,
            harvestDate: harvestDate,
            farmLocation: farmLocation,
            imageCID: imageCID,
            qualityGrade: QualityGrade.NOT_GRADED,
            confidenceScore: 0,
            reportHash: bytes32(0),
            isVerified: false,
            merkleCheckpointRoot: bytes32(0)
        });

        _safeMint(farmer, tokenId);
        _setTokenURI(tokenId, uri);

        emit BatchMinted(tokenId, farmer, cropType, quantity, unit, uri);

        return tokenId;
    }

    /**
     * @notice Records AI quality verification results onto the crop batch.
     * @dev Restricted to addresses with ORACLE_ROLE.
     * @param tokenId The identifier of the batch being graded.
     * @param grade The quality grade assigned by the AI model.
     * @param confidenceScore Model confidence in basis points (e.g., 9500 = 95.00%).
     * @param reportHash keccak256 cryptographic digest of the complete AI inspection report.
     */
    function setQualityResult(
        uint256 tokenId,
        QualityGrade grade,
        uint16 confidenceScore,
        bytes32 reportHash
    ) external onlyRole(ORACLE_ROLE) {
        if (_ownerOf(tokenId) == address(0)) {
            revert BatchNotFound(tokenId);
        }
        if (confidenceScore > 10000) {
            revert InvalidConfidenceScore(confidenceScore);
        }

        BatchMetadata storage batch = _batches[tokenId];
        batch.qualityGrade = grade;
        batch.confidenceScore = confidenceScore;
        batch.reportHash = reportHash;
        batch.isVerified = true;

        emit QualityResultUpdated(tokenId, grade, confidenceScore, reportHash);
    }

    /**
     * @notice Updates the Merkle root of shipment transit checkpoints.
     * @dev Restricted to addresses with TRACKER_ROLE (e.g., SupplyChainTracker contract).
     * @param tokenId The identifier of the batch in transit.
     * @param merkleRoot The root hash of all checkpoint events recorded off-chain.
     */
    function setCheckpointRoot(
        uint256 tokenId,
        bytes32 merkleRoot
    ) external onlyRole(TRACKER_ROLE) {
        if (_ownerOf(tokenId) == address(0)) {
            revert BatchNotFound(tokenId);
        }

        _batches[tokenId].merkleCheckpointRoot = merkleRoot;

        emit CheckpointRootUpdated(tokenId, merkleRoot);
    }

    /**
     * @notice Returns comprehensive on-chain metadata for a crop batch.
     * @param tokenId The identifier of the batch.
     * @return BatchMetadata struct containing all batch details.
     */
    function getBatch(uint256 tokenId) external view returns (BatchMetadata memory) {
        if (_ownerOf(tokenId) == address(0)) {
            revert BatchNotFound(tokenId);
        }
        return _batches[tokenId];
    }

    /**
     * @notice Returns the total number of batches minted to date.
     * @return Current highest token ID minted.
     */
    function totalBatches() external view returns (uint256) {
        return _nextTokenId;
    }

    /**
     * @notice Overridden supportInterface to combine ERC721URIStorage and AccessControl.
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721URIStorage, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
