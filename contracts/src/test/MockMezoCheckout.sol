// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20Move {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @dev Stand-in for Mezo's BTC precompile: an ERC-20 view of native balances. Hardhat
/// cannot move native BTC on behalf of a contract, so `transferFrom` only consumes the
/// allowance; the live precompile behaviour is checked against testnet by simulation.
contract MockBtcPrecompile {
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public pulled;

    function balanceOf(address account) external view returns (uint256) {
        return account.balance;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        pulled += amount;
        return true;
    }
}

/// @dev Mezo Pools router stand-in: pays MUSD from its own balance at a fixed rate.
contract MockPoolsRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    /// @notice MUSD paid per 1e18 of input.
    uint256 public rate;
    /// @notice Pays less than it reports, to prove the checkout measures for itself.
    bool public shortchange;

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function setShortchange(bool value) external {
        shortchange = value;
    }

    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] calldata routes, address to, uint256)
        external
        returns (uint256[] memory amounts)
    {
        require(routes.length == 1 && !routes[0].stable, "route");
        require(MockBtcPrecompile(routes[0].from).transferFrom(msg.sender, address(this), amountIn), "pull");
        uint256 out = amountIn * rate / 1e18;
        require(out >= amountOutMin, "INSUFFICIENT_OUTPUT_AMOUNT");
        require(IERC20Move(routes[0].to).transfer(to, shortchange ? out / 2 : out), "pay");
        amounts = new uint256[](2);
        amounts[0] = amountIn;
        amounts[1] = out;
    }
}

/// @dev Chainlink-style feed with settable answer, age and decimals.
contract MockPriceFeed {
    int256 public answer;
    uint256 public updatedAt;
    uint8 public decimals = 18;

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
    }

    function setDecimals(uint8 value) external {
        decimals = value;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
