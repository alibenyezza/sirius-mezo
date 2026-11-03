// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev veMEZO surface (Mezo vote-escrow v2). Positions are NFTs; there is no owner total.
interface IVotingEscrowNft {
    function balanceOf(address owner) external view returns (uint256);
    function ownerToNFTokenIdList(address owner, uint256 index) external view returns (uint256);
    function votingPowerOfNFT(uint256 tokenId) external view returns (uint256);
}

/// @title SiriusMezoFeePolicy
/// @notice Data providers who lock MEZO pay a lower platform fee on Sirius.
/// @dev Read by SiriusEscrow at release through a gas-capped staticcall. A provider whose
/// veMEZO voting power reaches `minPower` pays `discountedBps` instead of the base fee.
/// Only the first `MAX_POSITIONS` NFTs are counted, which bounds the gas; a large holder
/// reaches the threshold with any one of them. veMEZO returns zero power in the block an
/// NFT changes owner, so a position cannot be borrowed into the release transaction.
/// Immutable: no owner, no setter.
contract SiriusMezoFeePolicy {
    string public constant VERSION = "sirius-mezo-fee-policy-v1";
    uint256 public constant MAX_POSITIONS = 5;

    IVotingEscrowNft public immutable veMezo;
    uint256 public immutable minPower;
    uint256 public immutable discountedBps;

    error ZeroAddress();
    error InvalidPolicy();

    constructor(IVotingEscrowNft veMezo_, uint256 minPower_, uint256 discountedBps_) {
        if (address(veMezo_) == address(0)) revert ZeroAddress();
        if (address(veMezo_).code.length == 0 || minPower_ == 0) revert InvalidPolicy();
        veMezo = veMezo_;
        minPower = minPower_;
        discountedBps = discountedBps_;
    }

    /// @notice Voting power counted for `owner`, capped at MAX_POSITIONS NFTs.
    function countedPower(address owner) public view returns (uint256 power) {
        uint256 positions = veMezo.balanceOf(owner);
        if (positions > MAX_POSITIONS) positions = MAX_POSITIONS;
        for (uint256 i = 0; i < positions; ++i) {
            power += veMezo.votingPowerOfNFT(veMezo.ownerToNFTokenIdList(owner, i));
            if (power >= minPower) return power;
        }
    }

    /// @notice Fee in basis points for `provider`, never above `baseFeeBps`.
    function feeBpsFor(address provider, uint256 baseFeeBps) external view returns (uint256) {
        if (discountedBps >= baseFeeBps) return baseFeeBps;
        return countedPower(provider) >= minPower ? discountedBps : baseFeeBps;
    }
}
