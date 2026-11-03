// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Pull {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev veMEZO v2 surface: NFTs per owner, voting power per NFT.
contract MockVeMezo {
    mapping(address => uint256[]) private _ids;
    mapping(uint256 => uint256) public votingPowerOfNFT;
    uint256 private _next = 1;

    function give(address owner, uint256 power) external returns (uint256 id) {
        id = _next++;
        _ids[owner].push(id);
        votingPowerOfNFT[id] = power;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return _ids[owner].length;
    }

    function ownerToNFTokenIdList(address owner, uint256 index) external view returns (uint256) {
        return _ids[owner][index];
    }
}

/// @dev PoolsVoter surface used by the fee router.
contract MockMezoVoter {
    mapping(address => bool) public isAlive;
    mapping(address => address) public gaugeToBribe;

    function setGauge(address gauge, address bribe, bool alive) external {
        gaugeToBribe[gauge] = bribe;
        isAlive[gauge] = alive;
    }
}

/// @dev BribeVotingReward surface: pulls the reward from the caller like the real one.
contract MockMezoBribe {
    uint256 public totalSupply;
    mapping(address => uint256) public received;
    uint256 public notifications;
    bool public failing;

    function setTotalSupply(uint256 value) external {
        totalSupply = value;
    }

    function setFailing(bool value) external {
        failing = value;
    }

    function notifyRewardAmount(address token, uint256 amount) external {
        require(!failing, "bribe paused");
        require(IERC20Pull(token).transferFrom(msg.sender, address(this), amount), "pull");
        received[token] += amount;
        notifications += 1;
    }
}

/// @dev Policies that misbehave: the escrow must fall back to its base fee.
contract MockRevertingFeePolicy {
    function feeBpsFor(address, uint256) external pure returns (uint256) {
        revert("policy down");
    }
}

contract MockGreedyFeePolicy {
    function feeBpsFor(address, uint256) external pure returns (uint256) {
        return 9_000;
    }
}

contract MockGasBurnerFeePolicy {
    function feeBpsFor(address, uint256) external view returns (uint256 x) {
        while (gasleft() > 1_000) {
            x += 1;
        }
    }
}

/// @dev Answers with far more than one word: the escrow must copy only 32 bytes.
contract MockReturnBombFeePolicy {
    function feeBpsFor(address, uint256) external pure returns (uint256) {
        assembly {
            mstore(0x00, 50)
            return(0x00, 200000)
        }
    }
}

/// @dev Answers with nothing at all.
contract MockSilentFeePolicy {
    fallback() external {
        assembly {
            return(0x00, 0)
        }
    }
}

/// @dev Answers with two words.
contract MockTwoWordFeePolicy {
    function feeBpsFor(address, uint256) external pure returns (uint256, uint256) {
        return (50, 50);
    }
}

/// @dev Waives the fee entirely.
contract MockZeroFeePolicy {
    function feeBpsFor(address, uint256) external pure returns (uint256) {
        return 0;
    }
}

interface IDistributor {
    function distribute(address source) external returns (uint256);
}

/// @dev A fake escrow that tries to re-enter the router while being pulled.
contract MockReentrantSource {
    IDistributor public router;

    function setRouter(IDistributor router_) external {
        router = router_;
    }

    function creditOf(address) external pure returns (uint256) {
        return 1;
    }

    function withdrawFor(address) external returns (uint256) {
        router.distribute(address(this));
        return 0;
    }
}
