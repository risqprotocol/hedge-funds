pragma solidity 0.6.1;


interface IPolicyManagerFactory {
    function createInstance(address _backOffice) external returns (address);
}

