pragma solidity 0.6.1;

import "main/fund/backoffice/Runner.sol";
import "main/dependencies/token/StandardToken.sol";

/// @dev Shares can be destroyed and created by anyone (testing)
contract MockShares is Runner, StandardToken {
    string public symbol;
    string public name;
    uint8 public decimals;

    constructor(address _backOffice) public Runner(_backOffice) {
        name = backOffice.name();
        symbol = "MOCK";
        decimals = 18;
    }

    function createFor(address who, uint amount) public {
        _mint(who, amount);
    }

    function destroyFor(address who, uint amount) public {
        _burn(who, amount);
    }

    function setBalanceFor(address who, uint newBalance) public {
        uint currentBalance = balances[who];
        if (currentBalance > newBalance) {
            destroyFor(who, currentBalance.sub(newBalance));
        } else if (balances[who] < newBalance) {
            createFor(who, newBalance.sub(currentBalance));
        }
    }
}

