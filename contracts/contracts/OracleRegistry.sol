// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./CropBatchNFT.sol";

/**
 * @title OracleRegistry
 * @author AgriChain Core Engineering Team
 * @notice Decentralized registry and cryptographic verification bridge for off-chain AI crop quality oracles.
 * @dev Enforces economic security via AGRI token staking bonds. Validates ECDSA cryptographic signatures
 *      before updating on-chain CropBatchNFT state. Features governance-triggered slashing for fraudulent or disputed ratings.
 */
contract OracleRegistry is AccessControl, ReentrancyGuard {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    /// @notice Role authorized to slash oracle bonds upon confirmed disputes (DisputeDAO, Governance).
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    /// @notice Minimum AGRI stake bond required to operate an active oracle node (5,000 AGRI).
    uint256 public constant MINIMUM_ORACLE_STAKE = 5_000 * 10 ** 18;

    /// @notice Reference to the AGRI ERC-20 token used for staking and slashing.
    IERC20 public immutable agriToken;

    /// @notice Reference to the CropBatchNFT contract whose verification state is updated.
    CropBatchNFT public immutable cropBatchNFT;

    /// @notice Profile structure for a registered AI oracle node.
    struct OracleNode {
        bool isWhitelisted;
        bool isActive;
        uint256 stakedAmount;
        uint256 verificationsCount;
        uint256 slashedCount;
        uint256 totalSlashedAmount;
        uint256 registeredAt;
    }

    /// @notice Mapping from oracle node address to its profile.
    mapping(address => OracleNode) public oracleNodes;

    /// @notice List of all registered oracle node addresses for enumeration.
    address[] public oracleAddresses;

    /// @notice Tracks used report hashes to prevent replay attacks across batches.
    mapping(bytes32 => bool) public usedReportHashes;

    /// @notice Emitted when a new oracle node is whitelisted by governance.
    event OracleWhitelisted(address indexed oracleNode);

    /// @notice Emitted when an oracle node deposits stake bond and becomes active.
    event OracleStaked(address indexed oracleNode, uint256 amount, uint256 totalStake);

    /// @notice Emitted when an oracle node withdraws stake bond.
    event OracleUnstaked(address indexed oracleNode, uint256 amount, uint256 remainingStake);

    /// @notice Emitted when an AI quality verification is successfully verified and published on-chain.
    event QualityVerified(
        uint256 indexed tokenId,
        address indexed oracleNode,
        CropBatchNFT.QualityGrade grade,
        uint16 confidenceScore,
        bytes32 reportHash
    );

    /// @notice Emitted when an oracle node is penalized and slashed for fraudulent or disputed ratings.
    event OracleSlashed(
        address indexed oracleNode,
        uint256 amount,
        address indexed recipient,
        string reason
    );

    /// @notice Custom error thrown when caller is not an active oracle with sufficient stake.
    error InactiveOrInsufficientStake(address oracleNode, uint256 currentStake, uint256 requiredStake);

    /// @notice Custom error thrown when attempting to register an already whitelisted node.
    error OracleAlreadyWhitelisted(address oracleNode);

    /// @notice Custom error thrown when node is not whitelisted by admin.
    error OracleNotWhitelisted(address oracleNode);

    /// @notice Custom error thrown when report hash was already submitted (replay defense).
    error ReportAlreadyUsed(bytes32 reportHash);

    /// @notice Custom error thrown when signature is invalid or does not match oracle address.
    error InvalidOracleSignature(address recoveredSigner, address expectedOracle);

    /// @notice Custom error thrown when unstaking would breach minimum stake threshold while active.
    error InsufficientFreeStake(uint256 requested, uint256 available);

    /**
     * @notice Initializes the OracleRegistry contract.
     * @param admin Address receiving admin and dao roles.
     * @param _agriToken Address of the AgriToken contract.
     * @param _cropBatchNFT Address of the CropBatchNFT contract.
     */
    constructor(
        address admin,
        address _agriToken,
        address _cropBatchNFT
    ) {
        require(admin != address(0), "Invalid admin address");
        require(_agriToken != address(0), "Invalid token address");
        require(_cropBatchNFT != address(0), "Invalid NFT address");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DAO_ROLE, admin);

        agriToken = IERC20(_agriToken);
        cropBatchNFT = CropBatchNFT(_cropBatchNFT);
    }

    /**
     * @notice Whitelists an authorized oracle node candidate.
     * @dev Restricted to DEFAULT_ADMIN_ROLE.
     * @param oracleNode Address of the oracle node.
     */
    function whitelistOracle(address oracleNode) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(oracleNode != address(0), "Invalid oracle address");
        if (oracleNodes[oracleNode].isWhitelisted) {
            revert OracleAlreadyWhitelisted(oracleNode);
        }

        oracleNodes[oracleNode] = OracleNode({
            isWhitelisted: true,
            isActive: false,
            stakedAmount: 0,
            verificationsCount: 0,
            slashedCount: 0,
            totalSlashedAmount: 0,
            registeredAt: block.timestamp
        });

        oracleAddresses.push(oracleNode);
        emit OracleWhitelisted(oracleNode);
    }

    /**
     * @notice Stakes AGRI tokens to activate an oracle node.
     * @dev The caller must have approved this contract to spend at least `amount` of AGRI.
     * @param amount The quantity of AGRI tokens to deposit as bond.
     */
    function stakeBond(uint256 amount) external nonReentrant {
        OracleNode storage node = oracleNodes[msg.sender];
        if (!node.isWhitelisted) {
            revert OracleNotWhitelisted(msg.sender);
        }

        node.stakedAmount += amount;
        if (node.stakedAmount >= MINIMUM_ORACLE_STAKE) {
            node.isActive = true;
        }

        emit OracleStaked(msg.sender, amount, node.stakedAmount);

        bool success = agriToken.transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");
    }

    /**
     * @notice Unstakes AGRI bond tokens.
     * @param amount The quantity of AGRI tokens to withdraw.
     */
    function unstakeBond(uint256 amount) external nonReentrant {
        OracleNode storage node = oracleNodes[msg.sender];
        if (node.stakedAmount < amount) {
            revert InsufficientFreeStake(amount, node.stakedAmount);
        }

        node.stakedAmount -= amount;
        if (node.stakedAmount < MINIMUM_ORACLE_STAKE) {
            node.isActive = false;
        }

        emit OracleUnstaked(msg.sender, amount, node.stakedAmount);

        bool success = agriToken.transfer(msg.sender, amount);
        require(success, "Token transfer failed");
    }

    /**
     * @notice Submits a cryptographically signed AI quality inspection report on-chain.
     * @dev Recovers the ECDSA signature over the verification tuple. If valid and signed by an active oracle,
     *      it calls CropBatchNFT.setQualityResult to finalize the batch grade.
     * @param tokenId The identifier of the CropBatchNFT.
     * @param grade The quality grade determined by the AI model.
     * @param confidenceScore The model's confidence in basis points (e.g. 9720 = 97.20%).
     * @param reportHash The keccak256 hash of the complete inspection report JSON.
     * @param signature Cryptographic ECDSA signature generated by the oracle's private key.
     */
    function submitVerification(
        uint256 tokenId,
        CropBatchNFT.QualityGrade grade,
        uint16 confidenceScore,
        bytes32 reportHash,
        bytes memory signature
    ) external nonReentrant {
        if (usedReportHashes[reportHash]) {
            revert ReportAlreadyUsed(reportHash);
        }

        // Generate EIP-191 compliant signed message hash
        bytes32 messageHash = keccak256(
            abi.encodePacked(block.chainid, address(this), tokenId, uint8(grade), confidenceScore, reportHash)
        );
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedHash.recover(signature);

        OracleNode storage node = oracleNodes[recoveredSigner];
        if (!node.isWhitelisted || !node.isActive || node.stakedAmount < MINIMUM_ORACLE_STAKE) {
            revert InactiveOrInsufficientStake(recoveredSigner, node.stakedAmount, MINIMUM_ORACLE_STAKE);
        }

        usedReportHashes[reportHash] = true;
        node.verificationsCount += 1;

        // Propagate quality assessment into the NFT
        cropBatchNFT.setQualityResult(tokenId, grade, confidenceScore, reportHash);

        emit QualityVerified(tokenId, recoveredSigner, grade, confidenceScore, reportHash);
    }

    /**
     * @notice Slashes an oracle's staked bond following a successful dispute or proven fraud.
     * @dev Callable by DAO_ROLE or DEFAULT_ADMIN_ROLE. Slashed funds are transferred to the recipient.
     * @param oracleNode The address of the offending oracle node.
     * @param slashAmount Amount of AGRI tokens to seize.
     * @param recipient Address receiving the compensation (e.g., aggrieved buyer).
     * @param reason Description or dispute ID justification.
     */
    function slashOracle(
        address oracleNode,
        uint256 slashAmount,
        address recipient,
        string calldata reason
    ) external onlyRole(DAO_ROLE) nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        OracleNode storage node = oracleNodes[oracleNode];
        if (node.stakedAmount < slashAmount) {
            slashAmount = node.stakedAmount; // Slash up to remaining balance
        }

        node.stakedAmount -= slashAmount;
        node.slashedCount += 1;
        node.totalSlashedAmount += slashAmount;

        if (node.stakedAmount < MINIMUM_ORACLE_STAKE) {
            node.isActive = false;
        }

        emit OracleSlashed(oracleNode, slashAmount, recipient, reason);

        bool success = agriToken.transfer(recipient, slashAmount);
        require(success, "Slashing transfer failed");
    }

    /**
     * @notice Returns total number of registered oracle nodes.
     */
    function totalOracles() external view returns (uint256) {
        return oracleAddresses.length;
    }

    /**
     * @notice Helper to construct the message hash expected for oracle signatures.
     * @param tokenId Batch token ID.
     * @param grade Assigned quality grade.
     * @param confidenceScore Basis points confidence score.
     * @param reportHash Hash of the inspection report.
     * @return 32-byte message hash to sign.
     */
    function getVerificationMessageHash(
        uint256 tokenId,
        CropBatchNFT.QualityGrade grade,
        uint16 confidenceScore,
        bytes32 reportHash
    ) external view returns (bytes32) {
        return keccak256(
            abi.encodePacked(block.chainid, address(this), tokenId, uint8(grade), confidenceScore, reportHash)
        );
    }
}
