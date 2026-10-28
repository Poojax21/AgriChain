// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title ReputationSBT
 * @author AgriChain Core Engineering Team
 * @notice Soulbound Token (SBT) tracking decentralized trust and transaction reliability scores
 *         for farmers, buyers, and marketplace actors.
 * @dev Implements a non-transferable ERC-721 token bound irrevocably to a user's address.
 *      Scores are automatically updated upon successful trade completions, dispute resolutions,
 *      and oracle quality validations.
 */
contract ReputationSBT is ERC721, AccessControl {
    /// @notice Role authorized to modify reputation scores (Marketplace, DisputeDAO).
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Baseline reputation score awarded upon registration (100 points).
    uint256 public constant BASELINE_REPUTATION = 100;

    /// @notice Structured reputation record for each participant.
    struct ReputationRecord {
        uint256 score;
        uint256 successfulTrades;
        uint256 disputesWon;
        uint256 disputesLost;
        uint256 registeredAt;
        bool exists;
    }

    /// @notice Counter for minted SBT IDs.
    uint256 private _nextTokenId;

    /// @notice Mapping from user address to their unique Soulbound Token ID.
    mapping(address => uint256) public userTokenId;

    /// @notice Mapping from user address to their reputation statistics.
    mapping(address => ReputationRecord) private _records;

    /// @notice Emitted when a new user registers and receives their Soulbound Reputation Token.
    event UserRegistered(address indexed user, uint256 indexed tokenId, uint256 initialScore);

    /// @notice Emitted when a user's reputation score is adjusted.
    event ReputationUpdated(
        address indexed user,
        uint256 newScore,
        int256 delta,
        string reason
    );

    /// @notice Custom error thrown when attempting to transfer a Soulbound Token.
    error SoulboundTokenNonTransferable();

    /// @notice Custom error thrown if a user attempts to register more than once.
    error UserAlreadyRegistered(address user);

    /// @notice Custom error thrown when querying an unregistered user.
    error UserNotRegistered(address user);

    /**
     * @notice Initializes the Reputation Soulbound Token contract.
     * @param admin Address granted default admin role.
     */
    constructor(address admin) ERC721("AgriChain Reputation SBT", "AGRI-REP") {
        require(admin != address(0), "Invalid admin address");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, admin);
    }

    /**
     * @notice Registers a new participant and mints their Soulbound identity token.
     * @dev Awards the BASELINE_REPUTATION score of 100.
     * @return tokenId The unique Soulbound token ID assigned to the user.
     */
    function register() external returns (uint256) {
        return _registerUser(msg.sender);
    }

    /**
     * @notice Registers a participant programmatically via an authorized operator.
     * @param user The address to register.
     * @return tokenId The unique Soulbound token ID.
     */
    function registerUser(address user) external onlyRole(OPERATOR_ROLE) returns (uint256) {
        return _registerUser(user);
    }

    /**
     * @dev Internal user registration and token minting logic.
     */
    function _registerUser(address user) internal returns (uint256) {
        require(user != address(0), "Invalid user address");
        if (_records[user].exists) {
            revert UserAlreadyRegistered(user);
        }

        uint256 tokenId = ++_nextTokenId;
        userTokenId[user] = tokenId;

        _records[user] = ReputationRecord({
            score: BASELINE_REPUTATION,
            successfulTrades: 0,
            disputesWon: 0,
            disputesLost: 0,
            registeredAt: block.timestamp,
            exists: true
        });

        _safeMint(user, tokenId);

        emit UserRegistered(user, tokenId, BASELINE_REPUTATION);
        return tokenId;
    }

    /**
     * @notice Records a successfully fulfilled trade, increasing reputation score.
     * @dev Restricted to OPERATOR_ROLE. Auto-registers user if not yet registered.
     * @param user The participant whose trade succeeded.
     * @param pointsBoost Points to add to reputation score (e.g. +10).
     */
    function recordTradeSuccess(
        address user,
        uint256 pointsBoost
    ) external onlyRole(OPERATOR_ROLE) {
        _ensureRegistered(user);

        ReputationRecord storage record = _records[user];
        record.score += pointsBoost;
        record.successfulTrades += 1;

        emit ReputationUpdated(user, record.score, int256(pointsBoost), "TRADE_SUCCESS");
    }

    /**
     * @notice Records a victory in a dispute resolution round.
     * @dev Restricted to OPERATOR_ROLE.
     * @param user The address of the prevailing party.
     * @param pointsBoost Points to add to reputation score.
     */
    function recordDisputeWin(
        address user,
        uint256 pointsBoost
    ) external onlyRole(OPERATOR_ROLE) {
        _ensureRegistered(user);

        ReputationRecord storage record = _records[user];
        record.score += pointsBoost;
        record.disputesWon += 1;

        emit ReputationUpdated(user, record.score, int256(pointsBoost), "DISPUTE_WON");
    }

    /**
     * @notice Records a dispute loss or fraudulent infraction, penalizing reputation score.
     * @dev Restricted to OPERATOR_ROLE. Score cannot drop below zero.
     * @param user The address of the penalized party.
     * @param penalty Points deducted from reputation.
     */
    function recordDisputeLoss(
        address user,
        uint256 penalty
    ) external onlyRole(OPERATOR_ROLE) {
        _ensureRegistered(user);

        ReputationRecord storage record = _records[user];
        if (penalty > record.score) {
            record.score = 0;
        } else {
            record.score -= penalty;
        }
        record.disputesLost += 1;

        emit ReputationUpdated(user, record.score, -int256(penalty), "DISPUTE_LOST");
    }

    /**
     * @notice Fetches the complete reputation profile of a user.
     * @param user Address of the user to query.
     * @return score Current numerical trust score.
     * @return successfulTrades Count of completed orders.
     * @return disputesWon Count of disputes resolved in favor of this user.
     * @return disputesLost Count of disputes lost.
     */
    function getReputation(
        address user
    ) external view returns (
        uint256 score,
        uint256 successfulTrades,
        uint256 disputesWon,
        uint256 disputesLost
    ) {
        if (!_records[user].exists) {
            return (0, 0, 0, 0);
        }
        ReputationRecord memory record = _records[user];
        return (
            record.score,
            record.successfulTrades,
            record.disputesWon,
            record.disputesLost
        );
    }

    /**
     * @notice Returns whether an account has registered a reputation profile.
     * @param user Address to check.
     */
    function isRegistered(address user) external view returns (bool) {
        return _records[user].exists;
    }

    /**
     * @dev Internal helper to ensure user is registered before updating records.
     */
    function _ensureRegistered(address user) internal {
        if (!_records[user].exists) {
            _registerUser(user);
        }
    }

    /**
     * @dev Overrides ERC-721 token transfer logic to enforce Soulbound (non-transferable) behavior.
     *      Allows minting (from == address(0)) and burning (to == address(0)).
     *      Reverts on any peer-to-peer or wallet-to-wallet transfer.
     */
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // If neither minting nor burning, prevent transfer
        if (from != address(0) && to != address(0)) {
            revert SoulboundTokenNonTransferable();
        }
        return super._update(to, tokenId, auth);
    }

    /**
     * @notice Overridden supportsInterface combining ERC721 and AccessControl.
     */
    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
