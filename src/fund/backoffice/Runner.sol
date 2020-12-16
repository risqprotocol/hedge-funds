pragma solidity 0.6.1;

import "./BackOffice.sol";
import "../../dependencies/DSAuth.sol";

/// @notice Has one BackOffice
contract Runner is DSAuth {
    BackOffice public backOffice;
    BackOffice.Routes public routes;
    bool public initialized;

    modifier onlyInitialized() {
        require(initialized, "Component not yet initialized");
        _;
    }

    modifier notShutDown() {
        require(!backOffice.isShutDown(), "BackOffice is shut down");
        _;
    }

    constructor(address _backOffice) public {
        backOffice = BackOffice(_backOffice);
        setAuthority(backOffice);
        setOwner(address(backOffice)); // temporary, to allow initialization
    }

    function initialize(address[11] calldata _runners) external auth {
        require(msg.sender == address(backOffice));
        require(!initialized, "Already initialized");
        routes = BackOffice.Routes(
            _runners[0],
            _runners[1],
            _runners[2],
            _runners[3],
            _runners[4],
            _runners[5],
            _runners[6],
            _runners[7],
            _runners[8],
            _runners[9],
            _runners[10]
        );
        initialized = true;
        setOwner(address(0));
    }

    function engine() public view virtual returns (address) { return routes.engine; }
    function risqToken() public view virtual returns (address) { return routes.risqToken; }
    function priceSource() public view virtual returns (address) { return backOffice.priceSource(); }
    function version() public view virtual returns (address) { return routes.version; }
    function registry() public view virtual returns (address) { return routes.registry; }
}

