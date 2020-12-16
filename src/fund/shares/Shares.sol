pragma solidity 0.6.1;

import "../backoffice/Runner.sol";
import "../../dependencies/token/StandardToken.sol";
import "../../factory/Factory.sol";

contract Shares is Runner, StandardToken {
    string public symbol;
    string public name;
    uint8 public decimals;

    constructor(address _backOffice) public Runner(_backOffice) {
        name = backOffice.name();
        symbol = "RISQF";
        decimals = 18;
    }

    function createFor(address who, uint amount) public auth {
        _mint(who, amount);
    }

    function destroyFor(address who, uint amount) public auth {
        _burn(who, amount);
    }

    function transfer(address to, uint amount) public override returns (bool) {
        revert("Unimplemented");
    }

    function transferFrom(
        address from,
        address to,
        uint amount
    )
        public
        override
        returns (bool)
    {
        revert("Unimplemented");
    }

    function approve(address spender, uint amount) public override returns (bool) {
        revert("Unimplemented");
    }

    function increaseApproval(
        address spender,
        uint amount
    )
        public
        override
        returns (bool)
    {
        revert("Unimplemented");
    }

    function decreaseApproval(
        address spender,
        uint amount
    )
        public
        override
        returns (bool)
    {
        revert("Unimplemented");
    }
}

contract SharesFactory is Factory {
    function createInstance(address _backOffice) external returns (address) {
        address shares = address(new Shares(_backOffice));
        childExists[shares] = true;
        emit NewInstance(_backOffice, shares);
        return shares;
    }
}

