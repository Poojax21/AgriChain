// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./AgriToken.sol";
import "./AgriMarketplace.sol";
import "./OracleRegistry.sol";
import "./ReputationSBT.sol";

/**
 * @title DisputeDAO
 * @author AgriChain Core Engineering Team
 * @notice Decentralized dispute resolution and juror governance protocol for AgriChain.
 * @dev Employs stake-weighted juror voting, slashing of bad-actor oracles and dishonest parties,
 *      and automated execution of marketplace escrow settlements.
 */
contract DisputeDAO is AccessControl, ReentrancyGuard {
    /// @notice Minimum AGRI stake required to participate as a juror (1,000 AGRI).
    uint256 public constant MINIMUM_JUROR_STAKE = 1_000 * 10 ** 18;

    /// @notice Default dispute voting duration (2 days).
    uint256 public votingDuration = 2 days;

    /// @notice Slashing penalty rate for losing/dissenting jurors (500 basis points = 5%).
    uint256 public jurorSlashingBps = 500;

    /// @notice References to platform contracts.
    AgriToken public immutable agriToken;
    AgriMarketplace public immutable marketplace;
    OracleRegistry public immutable oracleRegistry;
    ReputationSBT public immutable reputationSBT;

    /// @notice Dispute resolution verdicts.
    enum Verdict {
        PENDING,       // 0: Under voting
        REFUND_BUYER,  // 1: Buyer claim validated (goods defective/spoiled)
        PAY_FARMER,    // 2: Farmer claim validated (goods as described, buyer malicious)
        SPLIT_SETTLEMENT // 3: Shared fault or mutual compromise
    }

    /// @notice Dispute lifecycle state.
    struct Dispute {
        uint256 disputeId;
        uint256 orderId;
        address buyer;
        address farmer;
        address oracleNode;
        bytes32 evidenceHash;
        uint256 totalVotesBuyer;
        uint256 totalVotesFarmer;
        uint256 totalVotesSplit;
        uint256 votingEndsAt;
        Verdict verdict;
        bool isResolved;
    }

    /// @notice Vote record per juror per dispute.
    struct JurorVote {
        bool hasVoted;
        Verdict choice;
        uint256 weight;
    }

    /// @notice Dispute counter.
    uint256 private _nextDisputeId;

    /// @notice Mapping from dispute ID to Dispute record.
    mapping(uint256 => Dispute) public disputes;

    /// @notice Mapping from order ID to dispute ID.
    mapping(uint256 => uint256) public orderDisputeId;

    /// @notice Mapping: disputeId => juror address => JurorVote.
    mapping(uint256 => mapping(address => JurorVote)) public jurorVotes;

    /// @notice Mapping: disputeId => list of jurors who voted.
    mapping(uint256 => address[]) public disputeJurors;

    /// @notice Emitted when a dispute is opened for juror review.
    event DisputeOpened(
        uint256 indexed disputeId,
        uint256 indexed orderId,
        address buyer,
        address farmer,
        bytes32 evidenceHash,
        uint256 votingEndsAt
    );

    /// @notice Emitted when a juror casts their stake-weighted vote.
    event VoteCast(
        uint256 indexed disputeId,
        address indexed juror,
        Verdict choice,
        uint256 weight
    );

    /// @notice Emitted when a dispute reaches final verdict and settles on-chain.
    event DisputeResolved(uint256 indexed disputeId, Verdict finalVerdict, uint256 winningVotes);

    /// @notice Custom errors.
    error DisputeAlreadyExists(uint256 orderId);
    error DisputeNotFound(uint256 disputeId);
    error VotingPeriodEnded(uint256 disputeId, uint256 endsAt);
    error VotingPeriodActive(uint256 disputeId, uint256 endsAt);
    error DisputeAlreadyResolved(uint256 disputeId);
    error AlreadyVoted(uint256 disputeId, address juror);
    error InsufficientJurorStake(address juror, uint256 currentStake, uint256 requiredStake);
    error InvalidVerdictChoice();
    error OnlyMarketplace();

    /**
     * @notice Initializes the DisputeDAO contract.
     * @param admin Governance administrator.
     * @param _agriToken Address of AgriToken.
     * @param _marketplace Address of AgriMarketplace.
     * @param _oracleRegistry Address of OracleRegistry.
     * @param _reputationSBT Address of ReputationSBT.
     */
    constructor(
        address admin,
        address _agriToken,
        address _marketplace,
        address _oracleRegistry,
        address _reputationSBT
    ) {
        require(admin != address(0), "Invalid admin");
        require(_agriToken != address(0), "Invalid token");
        require(_marketplace != address(0), "Invalid marketplace");
        require(_oracleRegistry != address(0), "Invalid oracle registry");
        require(_reputationSBT != address(0), "Invalid SBT");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        agriToken = AgriToken(_agriToken);
        marketplace = AgriMarketplace(_marketplace);
        oracleRegistry = OracleRegistry(_oracleRegistry);
        reputationSBT = ReputationSBT(_reputationSBT);
    }

    /**
     * @notice Creates a new dispute case for community juror voting.
     * @param orderId The identifier of the disputed order in AgriMarketplace.
     * @param buyer Address of the buyer.
     * @param farmer Address of the farmer.
     * @param oracleNode Address of the AI oracle node that graded the batch (if applicable).
     * @param evidenceHash On-chain commitment to the dispute claim. Evidence files remain off-chain in this prototype.
     * @return disputeId The unique ID of the created dispute.
     */
    function createDispute(
        uint256 orderId,
        address buyer,
        address farmer,
        address oracleNode,
        bytes32 evidenceHash
    ) external nonReentrant returns (uint256) {
        if (msg.sender != address(marketplace)) revert OnlyMarketplace();
        if (orderDisputeId[orderId] != 0) {
            revert DisputeAlreadyExists(orderId);
        }

        uint256 disputeId = ++_nextDisputeId;
        orderDisputeId[orderId] = disputeId;

        uint256 votingEndsAt = block.timestamp + votingDuration;

        disputes[disputeId] = Dispute({
            disputeId: disputeId,
            orderId: orderId,
            buyer: buyer,
            farmer: farmer,
            oracleNode: oracleNode,
            evidenceHash: evidenceHash,
            totalVotesBuyer: 0,
            totalVotesFarmer: 0,
            totalVotesSplit: 0,
            votingEndsAt: votingEndsAt,
            verdict: Verdict.PENDING,
            isResolved: false
        });

        emit DisputeOpened(disputeId, orderId, buyer, farmer, evidenceHash, votingEndsAt);
        return disputeId;
    }

    /**
     * @notice Casts a stake-weighted vote on an active dispute.
     * @param disputeId Identifier of the dispute.
     * @param choice Verdict choice (REFUND_BUYER, PAY_FARMER, or SPLIT_SETTLEMENT).
     */
    function vote(uint256 disputeId, Verdict choice) external nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.disputeId == 0) {
            revert DisputeNotFound(disputeId);
        }
        if (block.timestamp >= dispute.votingEndsAt) {
            revert VotingPeriodEnded(disputeId, dispute.votingEndsAt);
        }
        if (dispute.isResolved) {
            revert DisputeAlreadyResolved(disputeId);
        }
        if (choice != Verdict.REFUND_BUYER && choice != Verdict.PAY_FARMER && choice != Verdict.SPLIT_SETTLEMENT) {
            revert InvalidVerdictChoice();
        }

        JurorVote storage jurorVote = jurorVotes[disputeId][msg.sender];
        if (jurorVote.hasVoted) {
            revert AlreadyVoted(disputeId, msg.sender);
        }

        uint256 votingWeight = agriToken.votingPower(msg.sender);
        if (votingWeight < MINIMUM_JUROR_STAKE) {
            revert InsufficientJurorStake(msg.sender, votingWeight, MINIMUM_JUROR_STAKE);
        }

        jurorVote.hasVoted = true;
        jurorVote.choice = choice;
        jurorVote.weight = votingWeight;
        disputeJurors[disputeId].push(msg.sender);

        if (choice == Verdict.REFUND_BUYER) {
            dispute.totalVotesBuyer += votingWeight;
        } else if (choice == Verdict.PAY_FARMER) {
            dispute.totalVotesFarmer += votingWeight;
        } else {
            dispute.totalVotesSplit += votingWeight;
        }

        emit VoteCast(disputeId, msg.sender, choice, votingWeight);
    }

    /**
     * @notice Tallies votes and executes the final resolution.
     * @param disputeId Identifier of the dispute.
     */
    function resolveDispute(uint256 disputeId) external nonReentrant {
        Dispute storage dispute = disputes[disputeId];
        if (dispute.disputeId == 0) {
            revert DisputeNotFound(disputeId);
        }
        if (block.timestamp < dispute.votingEndsAt) {
            revert VotingPeriodActive(disputeId, dispute.votingEndsAt);
        }
        if (dispute.isResolved) {
            revert DisputeAlreadyResolved(disputeId);
        }

        dispute.isResolved = true;

        Verdict finalVerdict;
        uint256 winningVotes;

        if (dispute.totalVotesBuyer >= dispute.totalVotesFarmer && dispute.totalVotesBuyer >= dispute.totalVotesSplit) {
            finalVerdict = Verdict.REFUND_BUYER;
            winningVotes = dispute.totalVotesBuyer;
        } else if (dispute.totalVotesFarmer >= dispute.totalVotesBuyer && dispute.totalVotesFarmer >= dispute.totalVotesSplit) {
            finalVerdict = Verdict.PAY_FARMER;
            winningVotes = dispute.totalVotesFarmer;
        } else {
            finalVerdict = Verdict.SPLIT_SETTLEMENT;
            winningVotes = dispute.totalVotesSplit;
        }

        dispute.verdict = finalVerdict;
        emit DisputeResolved(disputeId, finalVerdict, winningVotes);

        // Fetch order total escrow from marketplace
        AgriMarketplace.Order memory order = marketplace.getOrder(dispute.orderId);
        uint256 totalEscrow = order.totalAmount;

        if (finalVerdict == Verdict.REFUND_BUYER) {
            // Full refund to buyer, return NFT to farmer
            marketplace.resolveDisputeFromDAO(dispute.orderId, totalEscrow, 0, true, "REFUND_BUYER");

            // Slash offending oracle if assigned
            if (dispute.oracleNode != address(0)) {
                try oracleRegistry.slashOracle(dispute.oracleNode, 1000 ether, dispute.buyer, "Faulty grading proven by DAO") {} catch {}
            }

            // Update reputations
            try reputationSBT.recordDisputeWin(dispute.buyer, 15) {} catch {}
            try reputationSBT.recordDisputeLoss(dispute.farmer, 25) {} catch {}

        } else if (finalVerdict == Verdict.PAY_FARMER) {
            // Full payout to farmer, buyer gets NFT
            marketplace.resolveDisputeFromDAO(dispute.orderId, 0, totalEscrow, false, "PAY_FARMER");

            try reputationSBT.recordDisputeWin(dispute.farmer, 15) {} catch {}
            try reputationSBT.recordDisputeLoss(dispute.buyer, 25) {} catch {}

        } else {
            // Split settlement 50/50, return NFT to farmer
            uint256 half = totalEscrow / 2;
            marketplace.resolveDisputeFromDAO(dispute.orderId, half, totalEscrow - half, true, "SPLIT_SETTLEMENT");
        }
    }

    /**
     * @notice Updates the voting duration for new disputes.
     * @param newDurationSeconds New duration in seconds (minimum 1 hour).
     */
    function setVotingDuration(uint256 newDurationSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDurationSeconds >= 1 hours, "Duration must be at least 1 hour");
        votingDuration = newDurationSeconds;
    }
}
