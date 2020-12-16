pragma solidity 0.6.1;

import "../backoffice/Runner.sol";
import "../../factory/Factory.sol";
import "../../dependencies/TokenUser.sol";

/// @notice Dumb custody component
contract Vault is TokenUser, Runner {

    constructor(address _backOffice) public Runner(_backOffice) {}

    function withdraw(address token, uint amount) external auth {
        safeTransfer(token, msg.sender, amount);
    }
}

contract VaultFactory is Factory {
    function createInstance(address _backOffice) external returns (address) {
        address vault = address(new Vault(_backOffice));
        childExists[vault] = true;
        emit NewInstance(_backOffice, vault);
        return vault;
    }
}

