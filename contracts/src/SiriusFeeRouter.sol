// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Min {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface ISiriusEscrowCredit {
    function creditOf(address account) external view returns (uint256);
    function withdrawFor(address account) external returns (uint256);
}

/// @dev Mezo PoolsVoter (Velodrome-style).
interface IMezoVoter {
    function isAlive(address gauge) external view returns (bool);
    function gaugeToBribe(address gauge) external view returns (address);
}

/// @dev BribeVotingReward of a Mezo gauge: pays veBTC voters of that gauge for the epoch.
interface IMezoBribe {
    function notifyRewardAmount(address token, uint256 amount) external;
    function totalSupply() external view returns (uint256);
}

/// @title SiriusFeeRouter
/// @notice Turns Sirius platform fees into MUSD liquidity incentives on Mezo.
/// @dev The escrow credits fees to this contract as pull-only credit. `distribute(escrow)`,
/// callable by anyone, pulls them (the escrow's `withdrawFor` is permissionless, so the
/// router needs no reference to it and both can be immutable), sends the treasury share to the treasury, and posts the incentive share as a MUSD
/// bribe on the BTC/MUSD gauge, so veBTC holders who vote for that pool earn from every
/// training run sold on Sirius. When posting would be wasted (gauge killed, no votes yet,
/// or the first and last hour of an epoch, when Mezo restricts voting) the incentive share
/// stays here and goes out on a later call. If the incentive can no longer reach voters
/// (gauge killed, or no votes / failing bribe for `REDIRECT_AFTER`), it goes to the
/// treasury instead, so no MUSD is ever stranded. A failing bribe never blocks the
/// treasury share. Immutable: no owner, no setter, no sweep.
/// Residual risk, inherent to Mezo bribes: rewards are earned on the gauge's vote supply at
/// the end of the epoch, so a bribe posted while votes exist is still lost if every vote
/// is withdrawn before the epoch ends.
contract SiriusFeeRouter {
    string public constant VERSION = "sirius-fee-router-v1";
    uint256 internal constant BPS = 10_000;
    uint256 public constant EPOCH = 7 days;
    uint256 public constant EPOCH_GUARD = 1 hours;
    /// @notice How long an incentive may stay unpostable before it goes to the treasury.
    uint256 public constant REDIRECT_AFTER = 4 weeks;

    IERC20Min public immutable musd;
    IMezoVoter public immutable voter;
    address public immutable gauge;
    IMezoBribe public immutable bribe;
    address public immutable treasury;
    uint256 public immutable incentiveBps;

    /// @notice MUSD held for the next incentive post.
    uint256 public pendingIncentive;
    /// @notice Lifetime totals, for the proof page.
    uint256 public totalToTreasury;
    uint256 public totalIncentivized;
    /// @notice Since when the pending incentive has been unpostable (0 = it is not stuck).
    uint256 public stuckSince;
    uint8 private _guard;

    enum Deferral { None, NothingPending, GaugeKilled, NoVotes, EpochEdge, PostFailed }

    event Distributed(address indexed source, uint256 received, uint256 toTreasury, uint256 toIncentives);
    event IncentivePosted(address indexed bribe, uint256 indexed epochStart, uint256 amount);
    event IncentiveDeferred(Deferral reason, uint256 pending);
    event IncentiveRedirected(Deferral reason, uint256 amount);

    error ZeroAddress();
    error InvalidSplit();
    error BribeMismatch();
    error Reentrancy();
    error TokenTransferFailed();

    modifier nonReentrant() {
        if (_guard == 1) revert Reentrancy();
        _guard = 1;
        _;
        _guard = 0;
    }

    constructor(
        IERC20Min musd_,
        IMezoVoter voter_,
        address gauge_,
        address treasury_,
        uint256 incentiveBps_
    ) {
        if (address(musd_) == address(0) || address(voter_) == address(0) || gauge_ == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        if (incentiveBps_ > BPS) revert InvalidSplit();
        address bribe_ = voter_.gaugeToBribe(gauge_);
        if (bribe_ == address(0)) revert BribeMismatch();
        musd = musd_;
        voter = voter_;
        gauge = gauge_;
        bribe = IMezoBribe(bribe_);
        treasury = treasury_;
        incentiveBps = incentiveBps_;
    }

    /// @notice Pull fees from `source` (an escrow, or zero to skip), pay the treasury share,
    /// post the incentive share.
    /// @dev Never reverts because of the gauge or its bribe: a post that cannot happen now
    /// is deferred, and one that cannot happen for good goes to the treasury.
    /// Only the router's MUSD balance counts, so a fake `source` can at most waste gas.
    function distribute(ISiriusEscrowCredit source) external nonReentrant returns (uint256 posted) {
        if (address(source) != address(0) && source.creditOf(address(this)) != 0) {
            source.withdrawFor(address(this));
        }
        uint256 held = musd.balanceOf(address(this));
        uint256 fresh = held > pendingIncentive ? held - pendingIncentive : 0;
        if (fresh != 0) {
            uint256 toIncentives = fresh * incentiveBps / BPS;
            uint256 toTreasury = fresh - toIncentives;
            pendingIncentive += toIncentives;
            if (toTreasury != 0) {
                totalToTreasury += toTreasury;
                _transfer(treasury, toTreasury);
            }
            emit Distributed(address(source), fresh, toTreasury, toIncentives);
        }

        Deferral reason = incentiveDeferral();
        if (reason == Deferral.NothingPending) return 0;
        if (reason == Deferral.None) {
            posted = pendingIncentive;
            if (_post(posted)) {
                pendingIncentive = 0;
                stuckSince = 0;
                totalIncentivized += posted;
                emit IncentivePosted(address(bribe), block.timestamp - (block.timestamp % EPOCH), posted);
                return posted;
            }
            posted = 0;
            reason = Deferral.PostFailed;
        }
        if (reason == Deferral.EpochEdge) {
            emit IncentiveDeferred(reason, pendingIncentive);
            return 0;
        }
        // GaugeKilled, NoVotes or PostFailed: the incentive may never reach voters.
        if (stuckSince == 0) stuckSince = block.timestamp;
        if (reason == Deferral.GaugeKilled || block.timestamp - stuckSince >= REDIRECT_AFTER) {
            uint256 amount = pendingIncentive;
            pendingIncentive = 0;
            stuckSince = 0;
            totalToTreasury += amount;
            _transfer(treasury, amount);
            emit IncentiveRedirected(reason, amount);
            return 0;
        }
        emit IncentiveDeferred(reason, pendingIncentive);
    }

    /// @notice Why an incentive post would be deferred right now (None = it would go out).
    function incentiveDeferral() public view returns (Deferral) {
        if (pendingIncentive == 0) return Deferral.NothingPending;
        if (!voter.isAlive(gauge)) return Deferral.GaugeKilled;
        // A bribe posted while nobody votes for the gauge can never be claimed.
        if (bribe.totalSupply() == 0) return Deferral.NoVotes;
        uint256 intoEpoch = block.timestamp % EPOCH;
        if (intoEpoch < EPOCH_GUARD || intoEpoch >= EPOCH - EPOCH_GUARD) return Deferral.EpochEdge;
        return Deferral.None;
    }

    /// @dev Approve exactly, notify, reset the approval. Any failure is reported, not thrown,
    /// and leaves no allowance behind. The bribe must pull exactly `amount`.
    function _post(uint256 amount) private returns (bool) {
        if (!_approve(address(bribe), amount)) return false;
        uint256 before = musd.balanceOf(address(this));
        bool ok;
        try bribe.notifyRewardAmount(address(musd), amount) {
            ok = musd.balanceOf(address(this)) + amount == before;
        } catch {}
        if (!_approve(address(bribe), 0)) revert TokenTransferFailed();
        return ok;
    }

    function _approve(address spender, uint256 amount) private returns (bool) {
        (bool ok, bytes memory result) = address(musd).call(abi.encodeCall(IERC20Min.approve, (spender, amount)));
        return ok && (result.length == 0 || (result.length == 32 && abi.decode(result, (bool))));
    }

    function _transfer(address to, uint256 amount) private {
        (bool ok, bytes memory result) = address(musd).call(abi.encodeCall(IERC20Min.transfer, (to, amount)));
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenTransferFailed();
    }
}
