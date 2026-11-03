// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SiriusKybRegistry} from "./SiriusKybRegistry.sol";
import {SiriusDatasetRegistry} from "./SiriusDatasetRegistry.sol";

interface IERC20 {
    function decimals() external view returns (uint8);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @dev EIP-2612 surface of the settlement token (MUSD implements it on Mezo).
interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/// @notice Optional fee schedule read at release. It may only lower the escrow's base fee.
/// @dev Implemented by SiriusMezoFeePolicy (veMEZO holders pay less). The escrow calls it with a
/// gas cap and ignores any failure, so a broken policy can never block a release.
interface ISiriusFeePolicy {
    function feeBpsFor(address provider, uint256 baseFeeBps) external view returns (uint256);
}

/// @title SiriusEscrow
/// @notice Hashlock escrow in USDC for a Sirius confidential training loan.
/// @dev The deployed USDC address is immutable. There is no owner, proxy or upgrade path.
contract SiriusEscrow {
    enum Status { None, Locked, Released, Refunded }

    struct Loan {
        address provider;
        uint96 amount;
        address borrower;
        uint40 deadline;
        Status status;
        bytes32 hashlock;
        bytes32 preimage;
        bytes32 datasetId;
        bytes32 trainingProfile;
    }

    struct LockAuthorization {
        uint40 deadline;
        bytes signature;
    }

    /// @notice Lock terms signed off-chain by the borrower (EIP-712), so that any account
    ///         may submit the transaction on the borrower's behalf.
    struct LockRequest {
        address borrower;
        address provider;
        uint256 amount;
        bytes32 hashlock;
        uint8 challengeDays;
        bytes32 loanIdHash;
        bytes32 datasetId;
        bytes32 trainingProfile;
        uint256 nonce;
        uint256 deadline;
    }

    /// @notice EIP-2612 permit granting this contract an allowance on the borrower's tokens.
    /// @dev A zero `deadline` means "no permit": the existing allowance is used as is.
    struct Permit {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    string public constant VERSION = "sirius-escrow-usdc-v6";
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant LOCK_AUTHORIZATION_TYPEHASH =
        keccak256("LockAuthorization(bytes32 termsHash,uint40 deadline)");
    bytes32 private constant LOCK_REQUEST_TYPEHASH = keccak256(
        "LockRequest(address borrower,address provider,uint256 amount,bytes32 hashlock,uint8 challengeDays,"
        "bytes32 loanIdHash,bytes32 datasetId,bytes32 trainingProfile,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant LOAN_KEY_DOMAIN = keccak256("sirius.escrow.loanKey.v1");
    uint8 public constant MIN_CHALLENGE_DAYS = 1;
    uint8 public constant MAX_CHALLENGE_DAYS = 30;
    /// @notice Smallest lockable amount: 0.001 token, derived from the token's own precision.
    /// @dev Kept in this casing because it is part of the published ABI. It cannot be a
    /// constant: USDC exposes 6 decimals on some networks and 18 on others, so a literal
    /// would mean a dust floor on one network and a fortune on the other — with no error
    /// raised either way.
    uint256 public immutable MIN_AMOUNT;
    uint256 internal constant MAX_AMOUNT = type(uint96).max;
    /// @notice Hard ceiling on the platform fee, whatever the deployment says: 10 %.
    uint256 public constant MAX_FEE_BPS = 1_000;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant FEE_POLICY_GAS = 300_000;
    /// @notice Longest validity a borrower may give a signed `LockRequest`.
    uint256 public constant MAX_LOCK_REQUEST_TTL = 1 days;
    bytes32 internal constant ZERO_PREIMAGE_HASH =
        0x66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925;

    IERC20 public immutable usdc;
    SiriusKybRegistry public immutable kyb;
    SiriusDatasetRegistry public immutable datasets;
    address public immutable lockAuthorizer;
    /// @notice Receives the platform fee as pull-only credit. Zero disables the fee.
    address public immutable feeRecipient;
    /// @notice Base platform fee on each release, in basis points of the loan amount.
    uint256 public immutable feeBps;
    /// @notice Optional schedule that can only lower `feeBps` for a provider. Zero = flat fee.
    ISiriusFeePolicy public immutable feePolicy;
    mapping(bytes32 => Loan) private _loans;
    mapping(bytes32 => uint256) private _activeLoansForDataset;
    mapping(address => uint256) private _credit;
    /// @notice Next `LockRequest.nonce` expected from each borrower. Replay protection for
    ///         `lockWithSignature`: a signed request is consumed exactly once.
    mapping(address => uint256) public lockNonces;
    uint256 public lockedUsdc;
    uint256 public owedUsdc;
    uint64 public eventSeq;
    uint8 private _guard;

    event LoanLocked(
        bytes32 indexed loanKey,
        address indexed borrower,
        address indexed provider,
        uint256 amount,
        uint40 deadline,
        bytes32 hashlock,
        bytes32 trainingProfile,
        uint64 seq
    );
    event LoanReleased(
        bytes32 indexed loanKey,
        address indexed provider,
        address indexed caller,
        bytes32 preimage,
        uint256 amount,
        uint64 seq
    );
    event PreimageRevealed(bytes32 indexed hashlock, bytes32 indexed loanKey, bytes32 preimage);
    event LoanRefunded(bytes32 indexed loanKey, address indexed borrower, uint256 amount, uint64 seq);
    event CreditAccrued(address indexed account, bytes32 indexed loanKey, uint256 amount, uint256 balance);
    event Withdrawn(address indexed account, uint256 amount);
    event FeeCharged(bytes32 indexed loanKey, address indexed provider, address indexed recipient, uint256 fee, uint256 feeBps);
    event LockNonceCancelled(address indexed borrower, uint256 cancelledNonce);

    error Reentrancy();
    error ZeroAddress();
    error InvalidUsdcContract();
    error UnsupportedUsdcDecimals(uint8 tokenDecimals);
    error ZeroAmount();
    error AmountTooSmall();
    error AmountOverflow();
    error InvalidProvider();
    error SelfDealing();
    error InvalidHashlock();
    error InvalidChallengePeriod();
    error InvalidLoanId();
    error KybRequired();
    error LoanExists(bytes32 loanKey);
    error LoanNotLocked(bytes32 loanKey, Status status);
    error ChallengePeriodActive(uint40 deadline, uint256 nowTs);
    error ChallengePeriodElapsed(uint40 deadline, uint256 nowTs);
    error InvalidPreimage();
    error NothingToWithdraw();
    error TokenTransferFailed();
    error InexactTokenTransfer();
    error Sha256Unavailable();
    error InvalidDataset();
    error DatasetEscrowMismatch();
    error InvalidLockAuthorization();
    error LockAuthorizationExpired();
    error LockRequestExpired();
    error InvalidBorrowerSignature();
    error PermitFailed();
    error InvalidFee();

    modifier nonReentrant() {
        if (_guard == 1) revert Reentrancy();
        _guard = 1;
        _;
        _guard = 0;
    }

    constructor(
        IERC20 usdc_,
        SiriusKybRegistry kyb_,
        SiriusDatasetRegistry datasets_,
        address lockAuthorizer_,
        address feeRecipient_,
        uint256 feeBps_,
        ISiriusFeePolicy feePolicy_
    ) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        if (address(usdc_).code.length == 0) revert InvalidUsdcContract();
        if (address(kyb_) == address(0)) revert ZeroAddress();
        if (address(datasets_) == address(0)) revert ZeroAddress();
        if (lockAuthorizer_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert InvalidFee();
        // A fee needs somewhere to go; a recipient without a fee is a misconfiguration too.
        if ((feeRecipient_ == address(0)) != (feeBps_ == 0)) revert InvalidFee();
        // Credit owed to the escrow itself or to the token could never be withdrawn.
        if (feeRecipient_ == address(this) || feeRecipient_ == address(usdc_)) revert InvalidFee();
        if (address(feePolicy_) != address(0) && (feeBps_ == 0 || address(feePolicy_).code.length == 0)) revert InvalidFee();

        // The floor follows the token, not the chain. Reading decimals() here also proves
        // the address answers like an ERC-20 before a single loan can exist.
        uint8 tokenDecimals = usdc_.decimals();
        if (tokenDecimals < 3 || tokenDecimals > 30) revert UnsupportedUsdcDecimals(tokenDecimals);
        MIN_AMOUNT = 10 ** (uint256(tokenDecimals) - 3);

        usdc = usdc_;
        kyb = kyb_;
        datasets = datasets_;
        lockAuthorizer = lockAuthorizer_;
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
        feePolicy = feePolicy_;
    }

    function loanKeyOf(address borrower, bytes32 loanIdHash) public pure returns (bytes32) {
        return keccak256(abi.encode(LOAN_KEY_DOMAIN, borrower, loanIdHash));
    }

    /// @notice Lock an exact USDC amount. The borrower must approve this contract first.
    function lock(
        address provider,
        uint256 amount,
        bytes32 hashlock,
        uint8 challengeDays,
        bytes32 loanIdHash,
        bytes32 datasetId,
        bytes32 trainingProfile,
        LockAuthorization calldata authorization
    )
        external
        nonReentrant
        returns (bytes32 loanKey)
    {
        return _lock(
            msg.sender, provider, amount, hashlock, challengeDays, loanIdHash, datasetId, trainingProfile, authorization
        );
    }

    /// @notice Lock on behalf of `request.borrower` with off-chain signatures only. Anyone may
    ///         submit the transaction and pay the gas: a relayer, the application, an agent.
    /// @dev The borrower proves the terms with an EIP-712 signature over `LockRequest`; the
    ///      Sirius authorizer still co-signs the same terms through `authorization`, so the
    ///      submitter can alter nothing. `permit` is applied first when `permit.deadline` is
    ///      non-zero. Its failure is tolerated only if the allowance already covers the
    ///      amount: a front-runner replaying the permit cannot block the lock.
    function lockWithSignature(
        LockRequest calldata request,
        bytes calldata borrowerSignature,
        Permit calldata permit,
        LockAuthorization calldata authorization
    )
        external
        nonReentrant
        returns (bytes32 loanKey)
    {
        if (block.timestamp >= request.deadline) revert LockRequestExpired();
        if (request.deadline > block.timestamp + MAX_LOCK_REQUEST_TTL) revert LockRequestExpired();
        if (request.nonce != lockNonces[request.borrower]) revert InvalidBorrowerSignature();
        address signer = _recover(_digest(_lockRequestHash(request)), borrowerSignature);
        if (signer == address(0) || signer != request.borrower) revert InvalidBorrowerSignature();
        unchecked { lockNonces[request.borrower] = request.nonce + 1; }

        if (permit.deadline != 0) {
            try IERC20Permit(address(usdc)).permit(
                request.borrower, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s
            ) {} catch {
                if (usdc.allowance(request.borrower, address(this)) < request.amount) revert PermitFailed();
            }
        }

        return _lock(
            request.borrower, request.provider, request.amount, request.hashlock, request.challengeDays,
            request.loanIdHash, request.datasetId, request.trainingProfile, authorization
        );
    }

    /// @notice Burn the caller's next `LockRequest` nonce, voiding any request already signed
    ///         with it (and, since nonces are sequential, every later one).
    function cancelLockNonce() external returns (uint256 cancelled) {
        cancelled = lockNonces[msg.sender];
        unchecked { lockNonces[msg.sender] = cancelled + 1; }
        emit LockNonceCancelled(msg.sender, cancelled);
    }

    /// @dev Checks and effects shared by `lock` and `lockWithSignature`. `borrower` is the
    ///      account whose tokens are pulled and who owns the loan; the caller has proven it.
    function _lock(
        address borrower,
        address provider,
        uint256 amount,
        bytes32 hashlock,
        uint8 challengeDays,
        bytes32 loanIdHash,
        bytes32 datasetId,
        bytes32 trainingProfile,
        LockAuthorization calldata authorization
    )
        internal
        returns (bytes32 loanKey)
    {
        if (amount == 0) revert ZeroAmount();
        if (amount < MIN_AMOUNT) revert AmountTooSmall();
        if (amount > MAX_AMOUNT) revert AmountOverflow();
        if (provider == address(0) || provider == address(this)) revert InvalidProvider();
        if (provider == borrower) revert SelfDealing();
        if (address(datasets.escrow()) != address(this)) revert DatasetEscrowMismatch();
        if (datasetId == bytes32(0) || trainingProfile == bytes32(0)
            || !datasets.isLiveForProviderAndProfile(datasetId, provider, trainingProfile)) revert InvalidDataset();
        if (hashlock == bytes32(0) || hashlock == ZERO_PREIMAGE_HASH) revert InvalidHashlock();
        if (challengeDays < MIN_CHALLENGE_DAYS || challengeDays > MAX_CHALLENGE_DAYS) revert InvalidChallengePeriod();
        if (loanIdHash == bytes32(0)) revert InvalidLoanId();
        if (!kyb.isKybValid(borrower) || !kyb.isKybValid(provider)) revert KybRequired();
        _requireLockAuthorization(
            keccak256(abi.encode(borrower, provider, amount, hashlock, challengeDays, loanIdHash, datasetId, trainingProfile)),
            authorization
        );

        loanKey = loanKeyOf(borrower, loanIdHash);
        Loan storage loan = _loans[loanKey];
        if (loan.status != Status.None) revert LoanExists(loanKey);

        _transferFrom(borrower, address(this), amount);

        uint40 deadline = uint40(block.timestamp + uint256(challengeDays) * 1 days);
        loan.provider = provider;
        loan.amount = uint96(amount);
        loan.borrower = borrower;
        loan.deadline = deadline;
        loan.status = Status.Locked;
        loan.hashlock = hashlock;
        loan.datasetId = datasetId;
        loan.trainingProfile = trainingProfile;
        lockedUsdc += amount;
        unchecked { _activeLoansForDataset[datasetId] += 1; }

        emit LoanLocked(loanKey, borrower, provider, amount, deadline, hashlock, trainingProfile, _nextSeq());
    }

    function _requireLockAuthorization(bytes32 termsHash, LockAuthorization calldata authorization) private view {
        if (block.timestamp >= authorization.deadline) revert LockAuthorizationExpired();
        if (authorization.deadline > block.timestamp + 5 minutes) revert InvalidLockAuthorization();
        bytes32 digest = _digest(keccak256(abi.encode(LOCK_AUTHORIZATION_TYPEHASH, termsHash, authorization.deadline)));
        if (_recover(digest, authorization.signature) != lockAuthorizer) revert InvalidLockAuthorization();
    }

    /// @dev EIP-712 `hashStruct(LockRequest)`. Every field is static, so encoding the struct
    ///      is byte-for-byte the encoding of its fields in order, as the standard requires.
    function _lockRequestHash(LockRequest calldata request) private pure returns (bytes32) {
        return keccak256(abi.encode(LOCK_REQUEST_TYPEHASH, request));
    }

    /// @dev EIP-712 digest under this contract's domain (name "SiriusEscrow", version "6").
    function _digest(bytes32 structHash) private view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            DOMAIN_TYPEHASH, keccak256("SiriusEscrow"), keccak256("6"), block.chainid, address(this)
        ));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    /// @dev EOA signatures only: 65 bytes, canonical `s`, `v` in {27, 28}. Returns the zero
    ///      address for anything else, which no caller accepts as a signer.
    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0
            || (v != 27 && v != 28)) return address(0);
        return ecrecover(digest, v, r, s);
    }

    /// @notice Publish a valid preimage and credit the provider atomically.
    function release(bytes32 loanKey, bytes32 preimage) external nonReentrant {
        Loan storage loan = _loans[loanKey];
        if (loan.status != Status.Locked) revert LoanNotLocked(loanKey, loan.status);
        if (block.timestamp >= loan.deadline) revert ChallengePeriodElapsed(loan.deadline, block.timestamp);
        if (_sha256(preimage) != loan.hashlock) revert InvalidPreimage();

        uint256 amount = loan.amount;
        loan.status = Status.Released;
        loan.preimage = preimage;
        lockedUsdc -= amount;
        unchecked { _activeLoansForDataset[loan.datasetId] -= 1; }
        address provider = loan.provider;
        uint256 bps = feeBpsFor(provider);
        uint256 fee = amount * bps / BPS;
        uint256 net = amount - fee;
        uint256 balance = _credit[provider] + net;
        _credit[provider] = balance;
        owedUsdc += amount;

        emit LoanReleased(loanKey, provider, msg.sender, preimage, amount, _nextSeq());
        emit PreimageRevealed(loan.hashlock, loanKey, preimage);
        emit CreditAccrued(provider, loanKey, net, balance);
        if (fee != 0) {
            uint256 feeBalance = _credit[feeRecipient] + fee;
            _credit[feeRecipient] = feeBalance;
            emit FeeCharged(loanKey, provider, feeRecipient, fee, bps);
            emit CreditAccrued(feeRecipient, loanKey, fee, feeBalance);
        }
    }

    /// @notice Fee rate a release would apply to `provider` now, in basis points.
    /// @dev The policy is read with a gas cap through a raw staticcall: a revert, an
    /// out-of-gas or a malformed answer falls back to the base fee, and an answer above
    /// the base fee is ignored. Refunds never pay a fee.
    function feeBpsFor(address provider) public view returns (uint256 bps) {
        bps = feeBps;
        if (bps == 0 || address(feePolicy) == address(0)) return bps;
        bytes memory query = abi.encodeCall(ISiriusFeePolicy.feeBpsFor, (provider, bps));
        address policy = address(feePolicy);
        bool ok;
        uint256 size;
        uint256 offered;
        // Raw call so that only one word of return data is ever copied (no return bomb).
        assembly ("memory-safe") {
            ok := staticcall(FEE_POLICY_GAS, policy, add(query, 0x20), mload(query), 0x00, 0x20)
            size := returndatasize()
            offered := mload(0x00)
        }
        if (!ok || size != 32) return bps;
        if (offered < bps) bps = offered;
    }

    /// @notice Credit the borrower after the challenge period. Permissionless for liveness.
    function refund(bytes32 loanKey) external nonReentrant {
        Loan storage loan = _loans[loanKey];
        if (loan.status != Status.Locked) revert LoanNotLocked(loanKey, loan.status);
        if (block.timestamp < loan.deadline) revert ChallengePeriodActive(loan.deadline, block.timestamp);

        uint256 amount = loan.amount;
        loan.status = Status.Refunded;
        lockedUsdc -= amount;
        unchecked { _activeLoansForDataset[loan.datasetId] -= 1; }
        uint256 balance = _credit[loan.borrower] + amount;
        _credit[loan.borrower] = balance;
        owedUsdc += amount;

        emit LoanRefunded(loanKey, loan.borrower, amount, _nextSeq());
        emit CreditAccrued(loan.borrower, loanKey, amount, balance);
    }

    function withdrawFor(address account) public nonReentrant returns (uint256 amount) {
        amount = _credit[account];
        if (amount == 0) revert NothingToWithdraw();
        _credit[account] = 0;
        owedUsdc -= amount;
        _transfer(account, amount);
        emit Withdrawn(account, amount);
    }

    function withdraw() external returns (uint256) {
        return withdrawFor(msg.sender);
    }

    function getLoan(bytes32 loanKey) external view returns (Loan memory) {
        return _loans[loanKey];
    }

    function preimageOf(bytes32 loanKey) external view returns (bool revealed, bytes32 preimage) {
        Loan storage loan = _loans[loanKey];
        return (loan.status == Status.Released, loan.preimage);
    }

    function creditOf(address account) external view returns (uint256) {
        return _credit[account];
    }

    function activeLoansForDataset(bytes32 datasetId) external view returns (uint256) {
        return _activeLoansForDataset[datasetId];
    }

    function isReleasable(bytes32 loanKey) external view returns (bool) {
        return _loans[loanKey].status == Status.Locked;
    }

    function isRefundable(bytes32 loanKey) external view returns (bool) {
        Loan storage loan = _loans[loanKey];
        return loan.status == Status.Locked && block.timestamp >= loan.deadline;
    }

    function accounting() external view returns (uint256 locked, uint256 owed, uint256 balance, uint64 seq) {
        return (lockedUsdc, owedUsdc, usdc.balanceOf(address(this)), eventSeq);
    }

    function matchesScope(
        bytes32 loanKey,
        address borrower,
        address provider,
        uint256 amount,
        bytes32 hashlock,
        bytes32 trainingProfile,
        uint256 minimumRemaining
    ) external view returns (bool) {
        Loan storage loan = _loans[loanKey];
        return loan.status == Status.Locked && loan.borrower == borrower && loan.provider == provider
            && uint256(loan.amount) == amount && loan.hashlock == hashlock
            && loan.trainingProfile == trainingProfile
            && uint256(loan.deadline) > block.timestamp + minimumRemaining;
    }

    function _nextSeq() private returns (uint64 seq) {
        unchecked { seq = ++eventSeq; }
    }

    function _transferFrom(address from, address to, uint256 amount) private {
        uint256 beforeBalance = usdc.balanceOf(to);
        _callToken(abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
        uint256 afterBalance = usdc.balanceOf(to);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert InexactTokenTransfer();
    }

    function _transfer(address to, uint256 amount) private {
        uint256 beforeBalance = usdc.balanceOf(to);
        _callToken(abi.encodeCall(IERC20.transfer, (to, amount)));
        uint256 afterBalance = usdc.balanceOf(to);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert InexactTokenTransfer();
    }

    function _callToken(bytes memory data) private {
        (bool ok, bytes memory result) = address(usdc).call(data);
        if (!ok || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenTransferFailed();
    }

    function _sha256(bytes32 input) private view returns (bytes32 digest) {
        bool ok;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(ptr, input)
            ok := staticcall(gas(), 0x02, ptr, 0x20, ptr, 0x20)
            digest := mload(ptr)
        }
        if (!ok) revert Sha256Unavailable();
    }
}
