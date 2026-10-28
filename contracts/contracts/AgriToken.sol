// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgriToken
 * @author AgriChain Core Engineering Team
 * @notice Native utility, staking, and governance token for the AgriChain decentralized agricultural ecosystem.
 * @dev Implements standard ERC-20, ERC20Burnable, AccessControl for RBAC, and an integrated staking mechanism
 *      used by AI Oracle nodes, DAO jurors, and marketplace participants.
 */
contract AgriToken is ERC20, ERC20Burnable, AccessControl, ReentrancyGuard {
    /// @notice Role identifier for accounts permitted to mint new tokens.
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @notice Role identifier for contracts (e.g., DisputeDAO, OracleRegistry) authorized to slash staked tokens.
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    /// @notice Default faucet drip amount: 1,000 AGRI (with 18 decimals).
    uint256 public constant FAUCET_DRIP_AMOUNT = 1_000 * 10 ** 18;

    /// @notice Cooldown period between successive faucet requests per address (12 hours).
    uint256 public constant FAUCET_COOLDOWN = 12 hours;

    /// @notice Maximum cap for initial supply minting (100 million AGRI).
    uint256 public constant MAX_SUPPLY = 100_000_000 * 10 ** 18;

    /// @notice Tracks the amount of AGRI staked by each account.
    mapping(address => uint256) private _stakedBalances;

    /// @notice Total amount of AGRI currently staked across all accounts.
    uint256 private _totalStaked;

    /// @notice Timestamp of the last faucet request per address.
    mapping(address => uint256) public lastFaucetRequest;

    /// @notice Emitted when an account stakes AGRI tokens into the contract.
    event Staked(address indexed user, uint256 amount, uint256 newStakedBalance);

    /// @notice Emitted when an account unstakes AGRI tokens from the contract.
    event Unstaked(address indexed user, uint256 amount, uint256 remainingStakedBalance);

    /// @notice Emitted when an account's stake is slashed due to a proven dispute or oracle fraud.
    event Slashed(address indexed user, uint256 amount, address indexed slashedBy, address recipient);

    /// @notice Emitted when the testnet faucet dispenses tokens to an applicant.
    event FaucetDripped(address indexed recipient, uint256 amount, uint256 timestamp);

    /// @notice Custom error thrown when attempting to stake zero tokens.
    error ZeroAmountNotAllowed();

    /// @notice Custom error thrown when attempting to unstake more tokens than currently staked.
    error InsufficientStakedBalance(uint256 requested, uint256 available);

    /// @notice Custom error thrown when faucet cooldown has not yet expired.
    error FaucetCooldownActive(uint256 nextAvailableTimestamp);

    /// @notice Custom error thrown when attempting to slash more than the user's staked balance.
    error ExceedsStakedBalance(uint256 requested, uint256 staked);

    /// @notice Custom error thrown if minting would exceed maximum token supply.
    error MaxSupplyExceeded(uint256 attemptedTotalSupply, uint256 maxAllowed);

    /**
     * @notice Initializes the AgriToken contract with initial supply and role assignments.
     * @param initialAdmin Address granted admin, minter, and slasher roles.
     * @param initialMintRecipient Address receiving the initial token allocation.
     * @param initialMintAmount Amount of tokens minted at deployment (e.g. 10,000,000 AGRI).
     */
    constructor(
        address initialAdmin,
        address initialMintRecipient,
        uint256 initialMintAmount
    ) ERC20("AgriChain Token", "AGRI") {
        require(initialAdmin != address(0), "Invalid admin address");
        require(initialMintRecipient != address(0), "Invalid recipient address");

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(MINTER_ROLE, initialAdmin);
        _grantRole(SLASHER_ROLE, initialAdmin);

        if (initialMintAmount > 0) {
            if (initialMintAmount > MAX_SUPPLY) {
                revert MaxSupplyExceeded(initialMintAmount, MAX_SUPPLY);
            }
            _mint(initialMintRecipient, initialMintAmount);
        }
    }

    /**
     * @notice Mints new tokens to an authorized recipient.
     * @dev Restricted to addresses with MINTER_ROLE.
     * @param to Recipient address.
     * @param amount Amount of tokens to mint in wei.
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert MaxSupplyExceeded(totalSupply() + amount, MAX_SUPPLY);
        }
        _mint(to, amount);
    }

    /**
     * @notice Testnet/demo faucet enabling test users to acquire AGRI tokens.
     * @dev Rate-limited to FAUCET_DRIP_AMOUNT per address every FAUCET_COOLDOWN.
     */
    function faucet() external nonReentrant {
        uint256 lastReq = lastFaucetRequest[msg.sender];
        if (lastReq != 0 && block.timestamp < lastReq + FAUCET_COOLDOWN) {
            revert FaucetCooldownActive(lastReq + FAUCET_COOLDOWN);
        }

        lastFaucetRequest[msg.sender] = block.timestamp;

        if (totalSupply() + FAUCET_DRIP_AMOUNT > MAX_SUPPLY) {
            revert MaxSupplyExceeded(totalSupply() + FAUCET_DRIP_AMOUNT, MAX_SUPPLY);
        }

        _mint(msg.sender, FAUCET_DRIP_AMOUNT);
        emit FaucetDripped(msg.sender, FAUCET_DRIP_AMOUNT, block.timestamp);
    }

    /**
     * @notice Stakes a specified amount of AGRI tokens into the contract.
     * @dev Transfers tokens from msg.sender to the contract address and increments staked balance.
     *      Tokens staked here serve as collateral for Oracle nodes, Juror voting weight, or marketplace bonds.
     * @param amount The quantity of tokens to stake (in wei).
     */
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmountNotAllowed();
        }

        // Checks-Effects-Interactions pattern
        _stakedBalances[msg.sender] += amount;
        _totalStaked += amount;

        emit Staked(msg.sender, amount, _stakedBalances[msg.sender]);

        _transfer(msg.sender, address(this), amount);
    }

    /**
     * @notice Unstakes previously staked AGRI tokens and returns them to the user.
     * @dev Decrements staked balance and transfers tokens from the contract to msg.sender.
     * @param amount The quantity of tokens to unstake (in wei).
     */
    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) {
            revert ZeroAmountNotAllowed();
        }
        uint256 currentStake = _stakedBalances[msg.sender];
        if (currentStake < amount) {
            revert InsufficientStakedBalance(amount, currentStake);
        }

        _stakedBalances[msg.sender] = currentStake - amount;
        _totalStaked -= amount;

        emit Unstaked(msg.sender, amount, _stakedBalances[msg.sender]);

        _transfer(address(this), msg.sender, amount);
    }

    /**
     * @notice Slashes a portion or all of a user's staked tokens.
     * @dev Callable only by authorized contracts/addresses with SLASHER_ROLE (e.g. DisputeDAO, OracleRegistry).
     *      Slashed tokens can be transferred to a penalty pool, burned, or redistributed to honest jurors.
     * @param account The address whose stake is being slashed.
     * @param amount The amount of staked tokens to slash.
     * @param recipient The address receiving the slashed tokens (or address(0) to burn).
     */
    function slash(
        address account,
        uint256 amount,
        address recipient
    ) external onlyRole(SLASHER_ROLE) nonReentrant {
        if (amount == 0) {
            revert ZeroAmountNotAllowed();
        }
        uint256 currentStake = _stakedBalances[account];
        if (currentStake < amount) {
            revert ExceedsStakedBalance(amount, currentStake);
        }

        _stakedBalances[account] = currentStake - amount;
        _totalStaked -= amount;

        emit Slashed(account, amount, msg.sender, recipient);

        if (recipient == address(0)) {
            _burn(address(this), amount);
        } else {
            _transfer(address(this), recipient, amount);
        }
    }

    /**
     * @notice Returns the amount of tokens currently staked by an account.
     * @param account Address to query.
     * @return Staked token balance in wei.
     */
    function stakedBalanceOf(address account) external view returns (uint256) {
        return _stakedBalances[account];
    }

    /**
     * @notice Returns the total amount of tokens staked across the entire platform.
     * @return Total staked tokens in wei.
     */
    function totalStaked() external view returns (uint256) {
        return _totalStaked;
    }

    /**
     * @notice Computes the governance and juror voting power for an account.
     * @dev Staked tokens are given full voting power weight. Liquid tokens can optionally add a fraction,
     *      but prioritizing staked tokens prevents flash-loan governance manipulation.
     * @param account The address to inspect.
     * @return Effective voting power (equal to staked balance).
     */
    function votingPower(address account) external view returns (uint256) {
        return _stakedBalances[account];
    }
}
