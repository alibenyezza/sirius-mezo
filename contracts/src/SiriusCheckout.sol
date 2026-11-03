// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SiriusEscrow} from "./SiriusEscrow.sol";

interface IERC20Checkout {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @dev Mezo Pools router (Aerodrome-style basic pools).
interface IMezoPoolsRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);
}

/// @dev Chainlink-style feed; on Mezo, the Skip BTC/USD price oracle precompile.
interface IPriceFeed {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title SiriusCheckout
/// @notice Pay for a Sirius training run with BTC, in one transaction: the BTC sent with the
/// call is swapped to MUSD on the Mezo Pools BTC/MUSD pool, the MUSD lands in the buyer's
/// wallet, and the escrow locks the price from it through the buyer's signed `LockRequest`.
/// @dev The swap must clear both the buyer's own minimum and an oracle floor (Skip BTC/USD,
/// read fresh) so a manipulated pool cannot fill the order far below the market. Nothing is
/// ever held here between calls: the MUSD goes straight to the buyer, who owns the loan.
/// Immutable: no owner, no setter.
contract SiriusCheckout {
    string public constant VERSION = "sirius-checkout-v1";
    uint256 internal constant BPS = 10_000;

    SiriusEscrow public immutable escrow;
    IERC20Checkout public immutable musd;
    /// @notice BTC as an ERC-20 (Mezo precompile); the native balance and this token are one.
    IERC20Checkout public immutable btc;
    IMezoPoolsRouter public immutable router;
    address public immutable poolFactory;
    IPriceFeed public immutable btcUsdFeed;
    /// @notice Largest shortfall of the swap below the oracle price, in basis points.
    uint256 public immutable maxSlippageBps;
    /// @notice Oldest oracle update accepted, in seconds.
    uint256 public immutable maxFeedAge;
    uint8 private _guard;

    event PaidWithBtc(
        bytes32 indexed loanKey, address indexed buyer, uint256 btcIn, uint256 musdOut, uint256 oraclePrice
    );

    error ZeroAddress();
    error InvalidConfig();
    error Reentrancy();
    error NotBuyer();
    error NoBtc();
    error StaleOracle(uint256 updatedAt);
    error BadOraclePrice();
    error BelowOracleFloor(uint256 musdOut, uint256 floor);
    error SwapShortfall(uint256 received, uint256 expected);
    error ApproveFailed();

    modifier nonReentrant() {
        if (_guard == 1) revert Reentrancy();
        _guard = 1;
        _;
        _guard = 0;
    }

    constructor(
        SiriusEscrow escrow_,
        IERC20Checkout btc_,
        IMezoPoolsRouter router_,
        address poolFactory_,
        IPriceFeed btcUsdFeed_,
        uint256 maxSlippageBps_,
        uint256 maxFeedAge_
    ) {
        if (
            address(escrow_) == address(0) || address(btc_) == address(0) || address(router_) == address(0)
                || poolFactory_ == address(0) || address(btcUsdFeed_) == address(0)
        ) revert ZeroAddress();
        if (maxSlippageBps_ == 0 || maxSlippageBps_ > 1_000 || maxFeedAge_ == 0 || maxFeedAge_ > 1 days) {
            revert InvalidConfig();
        }
        // Both legs are priced in 18 decimals: BTC on Mezo, MUSD, and the feed.
        if (btcUsdFeed_.decimals() != 18) revert InvalidConfig();
        escrow = escrow_;
        musd = IERC20Checkout(address(escrow_.usdc()));
        btc = btc_;
        router = router_;
        poolFactory = poolFactory_;
        btcUsdFeed = btcUsdFeed_;
        maxSlippageBps = maxSlippageBps_;
        maxFeedAge = maxFeedAge_;
    }

    /// @notice MUSD the oracle says `btcIn` is worth, and the floor a swap must clear.
    function oracleFloor(uint256 btcIn) public view returns (uint256 price, uint256 fair, uint256 floor) {
        (, int256 answer,, uint256 updatedAt,) = btcUsdFeed.latestRoundData();
        if (answer <= 0) revert BadOraclePrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxFeedAge) revert StaleOracle(updatedAt);
        price = uint256(answer);
        fair = btcIn * price / 1e18;
        floor = fair * (BPS - maxSlippageBps) / BPS;
    }

    /// @notice Swap the BTC sent with the call to MUSD and lock the purchase in the escrow.
    /// @param minMusdOut The buyer's own minimum for the swap (from a fresh quote).
    /// @dev The caller must be the borrower of `request`: the loan, the refund and any
    /// leftover MUSD are theirs. The escrow checks the borrower's signature, the permit and
    /// the Sirius authorization exactly as for a relayed `lockWithSignature`.
    function buyWithBtc(
        uint256 minMusdOut,
        SiriusEscrow.LockRequest calldata request,
        bytes calldata borrowerSignature,
        SiriusEscrow.Permit calldata permit,
        SiriusEscrow.LockAuthorization calldata authorization
    ) external payable nonReentrant returns (bytes32 loanKey, uint256 musdOut) {
        if (msg.sender != request.borrower) revert NotBuyer();
        if (msg.value == 0) revert NoBtc();
        (uint256 price,, uint256 floor) = oracleFloor(msg.value);
        uint256 minOut = minMusdOut > floor ? minMusdOut : floor;

        if (!btc.approve(address(router), msg.value)) revert ApproveFailed();
        IMezoPoolsRouter.Route[] memory routes = new IMezoPoolsRouter.Route[](1);
        routes[0] = IMezoPoolsRouter.Route({from: address(btc), to: address(musd), stable: false, factory: poolFactory});
        uint256 before = musd.balanceOf(msg.sender);
        router.swapExactTokensForTokens(msg.value, minOut, routes, msg.sender, block.timestamp);
        musdOut = musd.balanceOf(msg.sender) - before;
        if (musdOut < minOut) revert SwapShortfall(musdOut, minOut);
        if (btc.allowance(address(this), address(router)) != 0 && !btc.approve(address(router), 0)) revert ApproveFailed();

        loanKey = escrow.lockWithSignature(request, borrowerSignature, permit, authorization);
        emit PaidWithBtc(loanKey, msg.sender, msg.value, musdOut, price);
    }

    /// @dev Only the BTC sent with `buyWithBtc` belongs here, and it leaves in the same call.
    receive() external payable {
        revert NoBtc();
    }
}
