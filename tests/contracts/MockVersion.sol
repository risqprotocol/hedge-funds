pragma solidity 0.6.1;

import "main/fund/backoffice/BackOffice.sol";

/// @notice Version contract useful for testing
contract MockVersion {
    uint public pbguPrice;
    bool public isShutDown;

    function setPbguPrice(uint _price) public { pbguPrice = _price; }
    function securityShutDown() external { isShutDown = true; }
    function shutDownFund(address _backOffice) external { BackOffice(_backOffice).shutDownFund(); }
    function getShutDownStatus() external view returns (bool) {return isShutDown;}
    function getPbguPrice() public view returns (uint) { return pbguPrice; }
}
