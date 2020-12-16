pragma solidity 0.6.1;


interface IEngine {
    function payPbguInEther() external payable;
    function getPbguPrice() external view returns (uint256);
}
