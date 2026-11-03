// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {SiriusEscrow} from "../SiriusEscrow.sol";

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Escrow stand-in for live simulations of SiriusCheckout (eth_call with state
/// overrides): answers `usdc()` and accepts any `lockWithSignature`, reporting the
/// borrower's MUSD balance at that moment as the loan key.
contract MockLockSink {
    address public immutable usdc;

    constructor(address usdc_) {
        usdc = usdc_;
    }

    function lockWithSignature(
        SiriusEscrow.LockRequest calldata request,
        bytes calldata,
        SiriusEscrow.Permit calldata,
        SiriusEscrow.LockAuthorization calldata
    ) external view returns (bytes32) {
        return bytes32(IERC20Balance(usdc).balanceOf(request.borrower));
    }
}
