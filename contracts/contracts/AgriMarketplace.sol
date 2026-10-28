// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "./CropBatchNFT.sol";
import "./ReputationSBT.sol";

interface IAgriShipmentTracker {
    function orderCheckpointRoots(uint256 orderId) external view returns (bytes32);
    function isDeliveryProofValid(uint256 orderId, bytes32 leaf, bytes32[] calldata proof) external view returns (bool);
}

interface IAgriDisputeDAO {
    function createDispute(uint256 orderId, address buyer, address farmer, address oracleNode, bytes32 evidenceHash) external returns (uint256);
}

/**
 * @title AgriMarketplace
 * @author AgriChain Core Engineering Team
 * @notice Decentralized agricultural marketplace enabling direct farmer-to-buyer transactions
 *         with automated smart-contract escrow, quality threshold enforcement, and dispute resolution bridges.
 * @dev Employs the Checks-Effects-Interactions pattern, ReentrancyGuard, and automated timeout release.
 */
contract AgriMarketplace is AccessControl, ReentrancyGuard, IERC721Receiver {
    /// @notice Role granted to the DisputeDAO contract to execute dispute outcomes.
    bytes32 public constant DAO_ROLE = keccak256("DAO_ROLE");

    /// @notice Fee basis points denominator (10,000 = 100%).
    uint256 public constant BASIS_POINTS = 10_000;

    /// @notice Platform fee (200 basis points = 2.00%).
    uint256 public platformFeeBps = 200;

    /// @notice Auto-release timeout: 3 days after the buyer marks physical receipt.
    /// @dev Perishable goods rot in transit/at the door, so the clock must NOT
    ///      run from shipment. It starts only when the buyer confirms the goods
    ///      are in hand (markReceived). Until then no timeout release is possible.
    uint256 public autoReleaseTimeout = 3 days;

    /// @notice Address collecting platform fees.
    address public feeRecipient;

    /// @notice Reference to AgriToken (ERC-20 payment token).
    IERC20 public immutable agriToken;

    /// @notice Reference to CropBatchNFT contract.
    CropBatchNFT public immutable cropBatchNFT;

    /// @notice Reference to ReputationSBT contract.
    ReputationSBT public immutable reputationSBT;
    IAgriShipmentTracker public supplyChainTracker;
    IAgriDisputeDAO public disputeDAO;

    /// @notice Listing lifecycle states.
    enum ListingStatus {
        ACTIVE,
        SOLD,
        CANCELLED
    }

    /// @notice Order escrow lifecycle states.
    /// @dev RECEIVED is appended last (value 6) so existing numeric statuses
    ///      0-5 never shift for indexers and clients.
    enum OrderStatus {
        PLACED,
        SHIPPED,
        DELIVERED,
        DISPUTED,
        RESOLVED,
        CANCELLED,
        RECEIVED
    }

    /// @notice Marketplace listing structure.
    struct Listing {
        uint256 listingId;
        uint256 tokenId;
        address farmer;
        uint256 pricePerUnit; // In AGRI wei per unit
        uint256 availableQuantity;
        CropBatchNFT.QualityGrade minQualityGrade;
        ListingStatus status;
        uint256 createdAt;
    }

    /// @notice Escrowed order structure.
    struct Order {
        uint256 orderId;
        uint256 listingId;
        uint256 tokenId;
        address buyer;
        address farmer;
        uint256 quantity;
        uint256 totalAmount; // AGRI locked in escrow
        uint256 platformFee;
        OrderStatus status;
        uint256 placedAt;
        uint256 shippedAt;
        uint256 receivedAt;
        uint256 deliveredAt;
        bytes32 disputeReasonHash;
    }

    /// @notice Listing counter.
    uint256 private _nextListingId;

    /// @notice Order counter.
    uint256 private _nextOrderId;

    /// @notice Mapping from listing ID to Listing details.
    mapping(uint256 => Listing) public listings;

    /// @notice Mapping from order ID to Order details.
    mapping(uint256 => Order) public orders;

    /// @notice Mapping from token ID to active listing ID.
    mapping(uint256 => uint256) public tokenActiveListing;

    /// @notice Emitted when a farmer lists a verified crop batch.
    event ListingCreated(
        uint256 indexed listingId,
        uint256 indexed tokenId,
        address indexed farmer,
        uint256 pricePerUnit,
        uint256 quantity,
        CropBatchNFT.QualityGrade minGrade
    );

    /// @notice Emitted when a farmer cancels an active listing.
    event ListingCancelled(uint256 indexed listingId, uint256 indexed tokenId, address indexed farmer);

    /// @notice Emitted when a buyer places an order and locks payment in escrow.
    event OrderPlaced(
        uint256 indexed orderId,
        uint256 indexed listingId,
        uint256 indexed tokenId,
        address buyer,
        address farmer,
        uint256 quantity,
        uint256 escrowAmount
    );

    /// @notice Emitted when the farmer ships the crop batch.
    event OrderShipped(uint256 indexed orderId, uint256 shippedAt);

    /// @notice Emitted when the buyer confirms physical receipt of the goods.
    /// @dev Starts the freshness/auto-release clock. Distinct from delivery
    ///      confirmation (which also releases escrow immediately).
    event OrderReceived(uint256 indexed orderId, uint256 receivedAt);

    /// @notice Emitted when buyer confirms delivery and escrow funds are released to farmer.
    event OrderDelivered(uint256 indexed orderId, uint256 payoutToFarmer, uint256 platformFee);

    /// @notice Emitted when a buyer or farmer files a dispute, freezing escrow.
    event DisputeRaised(uint256 indexed orderId, address indexed raisedBy, bytes32 reasonHash);

    /// @notice Emitted when the DisputeDAO resolves a disputed order.
    event DisputeSettled(
        uint256 indexed orderId,
        uint256 buyerRefund,
        uint256 farmerPayout,
        string outcome
    );

    /// @notice Emitted when funds are auto-released after delivery timeout.
    event AutoReleased(uint256 indexed orderId, uint256 payoutToFarmer);

    /// @notice Custom errors.
    error ListingNotActive(uint256 listingId);
    error NotListingOwner(uint256 listingId, address caller);
    error CropNotVerified(uint256 tokenId);
    error BelowRequiredQuality(CropBatchNFT.QualityGrade actualGrade, CropBatchNFT.QualityGrade requiredGrade);
    error InvalidPriceOrQuantity();
    error OrderNotShipped(uint256 orderId);
    error OrderNotReceived(uint256 orderId);
    error OrderNotPlaced(uint256 orderId);
    error OrderNotInDisputableState(uint256 orderId);
    error NotOrderBuyer(uint256 orderId, address caller);
    error NotOrderFarmer(uint256 orderId, address caller);
    error TimeoutNotElapsed(uint256 currentTimestamp, uint256 releaseTimestamp);
    error InvalidSettlementAmounts(uint256 totalAttempted, uint256 escrowAmount);
    error DeliveryProofRequired(uint256 orderId);
    error InvalidContractAddress();

    /**
     * @notice Initializes the AgriMarketplace contract.
     * @param admin Admin and configuration manager.
     * @param _feeRecipient Address collecting marketplace platform fees.
     * @param _agriToken Address of the AGRI payment token.
     * @param _cropBatchNFT Address of the CropBatchNFT contract.
     * @param _reputationSBT Address of the ReputationSBT contract.
     */
    constructor(
        address admin,
        address _feeRecipient,
        address _agriToken,
        address _cropBatchNFT,
        address _reputationSBT
    ) {
        require(admin != address(0), "Invalid admin");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        require(_agriToken != address(0), "Invalid token");
        require(_cropBatchNFT != address(0), "Invalid NFT");
        require(_reputationSBT != address(0), "Invalid SBT");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DAO_ROLE, admin);

        feeRecipient = _feeRecipient;
        agriToken = IERC20(_agriToken);
        cropBatchNFT = CropBatchNFT(_cropBatchNFT);
        reputationSBT = ReputationSBT(_reputationSBT);
    }

    /**
     * @notice Lists a verified crop batch on the marketplace.
     * @dev Transfers the CropBatchNFT to the marketplace contract as escrow.
     * @param tokenId The identifier of the CropBatchNFT.
     * @param pricePerUnit Price in AGRI tokens per unit of crop.
     * @param minQualityGrade Minimum acceptable quality grade for this listing.
     */
    function createListing(
        uint256 tokenId,
        uint256 pricePerUnit,
        CropBatchNFT.QualityGrade minQualityGrade
    ) external nonReentrant returns (uint256) {
        if (pricePerUnit == 0) {
            revert InvalidPriceOrQuantity();
        }

        CropBatchNFT.BatchMetadata memory batch = cropBatchNFT.getBatch(tokenId);
        if (!batch.isVerified) {
            revert CropNotVerified(tokenId);
        }
        if (batch.qualityGrade == CropBatchNFT.QualityGrade.REJECTED || 
            (minQualityGrade != CropBatchNFT.QualityGrade.NOT_GRADED && batch.qualityGrade > minQualityGrade)) {
            revert BelowRequiredQuality(batch.qualityGrade, minQualityGrade);
        }

        require(cropBatchNFT.ownerOf(tokenId) == msg.sender, "Caller must own batch NFT");

        uint256 listingId = ++_nextListingId;
        listings[listingId] = Listing({
            listingId: listingId,
            tokenId: tokenId,
            farmer: msg.sender,
            pricePerUnit: pricePerUnit,
            availableQuantity: batch.quantity,
            minQualityGrade: minQualityGrade,
            status: ListingStatus.ACTIVE,
            createdAt: block.timestamp
        });

        tokenActiveListing[tokenId] = listingId;

        emit ListingCreated(listingId, tokenId, msg.sender, pricePerUnit, batch.quantity, minQualityGrade);

        // Transfer NFT to marketplace for custodial escrow
        cropBatchNFT.safeTransferFrom(msg.sender, address(this), tokenId);

        return listingId;
    }

    /**
     * @notice Cancels an active listing and returns the CropBatchNFT to the farmer.
     * @param listingId Identifier of the listing.
     */
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        if (listing.status != ListingStatus.ACTIVE) {
            revert ListingNotActive(listingId);
        }
        if (listing.farmer != msg.sender) {
            revert NotListingOwner(listingId, msg.sender);
        }

        listing.status = ListingStatus.CANCELLED;
        delete tokenActiveListing[listing.tokenId];

        emit ListingCancelled(listingId, listing.tokenId, msg.sender);

        cropBatchNFT.safeTransferFrom(address(this), msg.sender, listing.tokenId);
    }

    /**
     * @notice Places an order for a listed crop batch and deposits AGRI tokens into escrow.
     * @param listingId Identifier of the listing.
     * @param quantity Amount of crop purchased (must equal availableQuantity for batch sale).
     */
    function placeOrder(uint256 listingId, uint256 quantity) external nonReentrant returns (uint256) {
        Listing storage listing = listings[listingId];
        if (listing.status != ListingStatus.ACTIVE) {
            revert ListingNotActive(listingId);
        }
        // The batch is represented by one indivisible ERC-721. Partial orders
        // would transfer the whole crop NFT to the first buyer while leaving
        // an impossible remainder listed, so require whole-batch purchase.
        if (quantity == 0 || quantity != listing.availableQuantity) {
            revert InvalidPriceOrQuantity();
        }

        uint256 totalCost = listing.pricePerUnit * quantity;
        uint256 platformFee = (totalCost * platformFeeBps) / BASIS_POINTS;

        listing.status = ListingStatus.SOLD;
        listing.availableQuantity -= quantity;

        uint256 orderId = ++_nextOrderId;
        orders[orderId] = Order({
            orderId: orderId,
            listingId: listingId,
            tokenId: listing.tokenId,
            buyer: msg.sender,
            farmer: listing.farmer,
            quantity: quantity,
            totalAmount: totalCost,
            platformFee: platformFee,
            status: OrderStatus.PLACED,
            placedAt: block.timestamp,
            shippedAt: 0,
            receivedAt: 0,
            deliveredAt: 0,
            disputeReasonHash: bytes32(0)
        });

        emit OrderPlaced(orderId, listingId, listing.tokenId, msg.sender, listing.farmer, quantity, totalCost);

        // Pull AGRI into escrow
        bool success = agriToken.transferFrom(msg.sender, address(this), totalCost);
        require(success, "Escrow deposit failed");

        return orderId;
    }

    /**
     * @notice Marks an order as dispatched/shipped.
     * @param orderId Identifier of the order.
     */
    function shipOrder(uint256 orderId) external {
        Order storage order = orders[orderId];
        if (order.status != OrderStatus.PLACED) {
            revert OrderNotPlaced(orderId);
        }
        if (order.farmer != msg.sender) {
            revert NotOrderFarmer(orderId, msg.sender);
        }

        order.status = OrderStatus.SHIPPED;
        order.shippedAt = block.timestamp;

        emit OrderShipped(orderId, block.timestamp);
    }

    /**
     * @notice Buyer confirms physical receipt of the goods.
     * @dev Starts the auto-release freshness clock. The buyer can still inspect
     *      and either confirmDelivery (immediate release) or raiseDispute.
     *      Perishables must not auto-release while the box sits unopened, so
     *      this attestation — not shipment — is the timeout anchor.
     * @param orderId Identifier of the order.
     */
    function markReceived(uint256 orderId) external {
        Order storage order = orders[orderId];
        if (order.status != OrderStatus.SHIPPED) {
            revert OrderNotShipped(orderId);
        }
        if (order.buyer != msg.sender) {
            revert NotOrderBuyer(orderId, msg.sender);
        }

        order.status = OrderStatus.RECEIVED;
        order.receivedAt = block.timestamp;

        emit OrderReceived(orderId, block.timestamp);
    }

    /**
     * @notice Confirms receipt and satisfactory delivery, releasing escrow funds to the farmer.
     * @dev Transfers CropBatchNFT to buyer, pays farmer (minus platform fee), and boosts reputations.
     * @param orderId Identifier of the order.
     */
    function confirmDelivery(uint256 orderId, bytes32 deliveryLeaf, bytes32[] calldata proof) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.status != OrderStatus.SHIPPED && order.status != OrderStatus.RECEIVED) {
            revert OrderNotShipped(orderId);
        }
        if (order.buyer != msg.sender) {
            revert NotOrderBuyer(orderId, msg.sender);
        }
        _requireDeliveryProof(orderId, deliveryLeaf, proof);

        _finalizeSuccessfulDelivery(orderId);
    }

    /**
     * @notice Automatically releases escrow to the farmer if buyer goes silent AFTER confirming receipt.
     * @dev Timeout runs from receivedAt, never from shippedAt: fruit left on a porch
     *      must not trigger payment. Disputes remain possible until release executes.
     * @param orderId Identifier of the order.
     */
    function autoReleaseAfterTimeout(uint256 orderId, bytes32 deliveryLeaf, bytes32[] calldata proof) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.status != OrderStatus.RECEIVED) {
            revert OrderNotReceived(orderId);
        }

        uint256 releaseTime = order.receivedAt + autoReleaseTimeout;
        if (block.timestamp < releaseTime) {
            revert TimeoutNotElapsed(block.timestamp, releaseTime);
        }

        // Timeout is only a buyer-inactivity fallback. It cannot bypass the
        // same committed-checkpoint inclusion proof required for confirmation.
        _requireDeliveryProof(orderId, deliveryLeaf, proof);

        emit AutoReleased(orderId, order.totalAmount - order.platformFee);
        _finalizeSuccessfulDelivery(orderId);
    }

    function _requireDeliveryProof(uint256 orderId, bytes32 leaf, bytes32[] calldata proof) internal view {
        IAgriShipmentTracker tracker = supplyChainTracker;
        if (address(tracker) == address(0) || tracker.orderCheckpointRoots(orderId) == bytes32(0) ||
            !tracker.isDeliveryProofValid(orderId, leaf, proof)) {
            revert DeliveryProofRequired(orderId);
        }
    }

    /**
     * @dev Internal helper settling an order upon verified delivery.
     */
    function _finalizeSuccessfulDelivery(uint256 orderId) internal {
        Order storage order = orders[orderId];
        order.status = OrderStatus.DELIVERED;
        order.deliveredAt = block.timestamp;

        uint256 farmerPayout = order.totalAmount - order.platformFee;

        emit OrderDelivered(orderId, farmerPayout, order.platformFee);

        // Boost reputation scores (+10 points for trade completion)
        try reputationSBT.recordTradeSuccess(order.farmer, 10) {} catch {}
        try reputationSBT.recordTradeSuccess(order.buyer, 10) {} catch {}

        // Transfer CropBatchNFT ownership to buyer
        cropBatchNFT.safeTransferFrom(address(this), order.buyer, order.tokenId);

        // Distribute platform fee
        if (order.platformFee > 0) {
            bool feeSuccess = agriToken.transfer(feeRecipient, order.platformFee);
            require(feeSuccess, "Fee transfer failed");
        }

        // Release payout to farmer
        bool payoutSuccess = agriToken.transfer(order.farmer, farmerPayout);
        require(payoutSuccess, "Farmer payout failed");
    }

    /**
     * @notice Freezes escrow and escalates order to DisputeDAO.
     * @param orderId Identifier of the order.
     * @param reasonHash keccak256 hash of the dispute claim text; evidence files are off-chain.
     */
    function raiseDispute(uint256 orderId, bytes32 reasonHash, address oracleNode) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.status != OrderStatus.PLACED && order.status != OrderStatus.SHIPPED && order.status != OrderStatus.RECEIVED) {
            revert OrderNotInDisputableState(orderId);
        }
        if (msg.sender != order.buyer && msg.sender != order.farmer) {
            revert NotOrderBuyer(orderId, msg.sender);
        }

        order.status = OrderStatus.DISPUTED;
        order.disputeReasonHash = reasonHash;

        emit DisputeRaised(orderId, msg.sender, reasonHash);

        // DAO case and escrow freeze are atomic: if DAO case creation fails,
        // this transaction also rolls back the status change above.
        IAgriDisputeDAO dao = disputeDAO;
        if (address(dao) == address(0)) revert InvalidContractAddress();
        dao.createDispute(orderId, order.buyer, order.farmer, oracleNode, reasonHash);
    }

    function setSupplyChainTracker(address tracker) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tracker == address(0)) revert InvalidContractAddress();
        supplyChainTracker = IAgriShipmentTracker(tracker);
    }

    function setDisputeDAO(address dao) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (dao == address(0)) revert InvalidContractAddress();
        disputeDAO = IAgriDisputeDAO(dao);
    }

    /**
     * @notice Resolves a dispute according to the DisputeDAO verdict.
     * @dev Restricted to DAO_ROLE.
     * @param orderId Identifier of the order.
     * @param buyerRefund Amount refunded to the buyer from escrow.
     * @param farmerPayout Amount paid to the farmer from escrow.
     * @param returnNftToFarmer If true, NFT returns to farmer; if false, transfers to buyer.
     * @param outcome Summary description of verdict.
     */
    function resolveDisputeFromDAO(
        uint256 orderId,
        uint256 buyerRefund,
        uint256 farmerPayout,
        bool returnNftToFarmer,
        string calldata outcome
    ) external onlyRole(DAO_ROLE) nonReentrant {
        Order storage order = orders[orderId];
        require(order.status == OrderStatus.DISPUTED, "Order not in dispute");

        if (buyerRefund + farmerPayout > order.totalAmount) {
            revert InvalidSettlementAmounts(buyerRefund + farmerPayout, order.totalAmount);
        }

        order.status = OrderStatus.RESOLVED;

        emit DisputeSettled(orderId, buyerRefund, farmerPayout, outcome);

        // Return or award NFT
        if (returnNftToFarmer) {
            cropBatchNFT.safeTransferFrom(address(this), order.farmer, order.tokenId);
        } else {
            cropBatchNFT.safeTransferFrom(address(this), order.buyer, order.tokenId);
        }

        // Refund buyer
        if (buyerRefund > 0) {
            bool refundSuccess = agriToken.transfer(order.buyer, buyerRefund);
            require(refundSuccess, "Buyer refund failed");
        }

        // Pay farmer
        if (farmerPayout > 0) {
            bool farmerSuccess = agriToken.transfer(order.farmer, farmerPayout);
            require(farmerSuccess, "Farmer settlement failed");
        }
    }

    /**
     * @notice Updates the platform fee.
     * @param newFeeBps New fee in basis points (max 1,000 = 10%).
     */
    function setPlatformFee(uint256 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newFeeBps <= 1000, "Fee cannot exceed 10%");
        platformFeeBps = newFeeBps;
    }

    /**
     * @notice Updates the auto-release timeout.
     * @param newTimeoutSeconds New timeout period in seconds.
     */
    function setAutoReleaseTimeout(uint256 newTimeoutSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newTimeoutSeconds >= 1 hours, "Timeout must be at least 1 hour");
        autoReleaseTimeout = newTimeoutSeconds;
    }

    /**
     * @notice Returns complete order details.
     * @param orderId Identifier of the order.
     */
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    /**
     * @notice Required by IERC721Receiver to safely accept CropBatchNFT deposits.
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}
