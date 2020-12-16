pragma solidity 0.6.1;

import "../../dependencies/DSGuard.sol";
import "./Runner.sol";
import "../../version/Registry.sol";

/// @notice Router for communication between components
/// @notice Has one or more Runners
contract BackOffice is DSGuard {

    event FundShutDown();

    struct Routes {
        address accounting;
        address feeManager;
        address participation;
        address policyManager;
        address shares;
        address trading;
        address vault;
        address registry;
        address version;
        address engine;
        address risqToken;
    }

    Routes public routes;
    address public manager;
    address public creator;
    string public name;
    bool public isShutDown;
    bool public fundInitialized;
    uint public creationTime;
    mapping (address => bool) public isRunner;

    constructor(address _manager, string memory _name) public {
        creator = msg.sender;
        manager = _manager;
        name = _name;
        creationTime = block.timestamp;
    }

    modifier onlyCreator() {
        require(msg.sender == creator, "Only creator can do this");
        _;
    }

    function shutDownFund() external {
        require(msg.sender == routes.version);
        isShutDown = true;
        emit FundShutDown();
    }

    function initializeAndSetPermissions(address[11] calldata _runners) external onlyCreator {
        require(!fundInitialized, "Fund is already initialized");
        for (uint i = 0; i < _runners.length; i++) {
            isRunner[_runners[i]] = true;
        }
        routes.accounting = _runners[0];
        routes.feeManager = _runners[1];
        routes.participation = _runners[2];
        routes.policyManager = _runners[3];
        routes.shares = _runners[4];
        routes.trading = _runners[5];
        routes.vault = _runners[6];
        routes.registry = _runners[7];
        routes.version = _runners[8];
        routes.engine = _runners[9];
        routes.risqToken = _runners[10];

        Runner(routes.accounting).initialize(_runners);
        Runner(routes.feeManager).initialize(_runners);
        Runner(routes.participation).initialize(_runners);
        Runner(routes.policyManager).initialize(_runners);
        Runner(routes.shares).initialize(_runners);
        Runner(routes.trading).initialize(_runners);
        Runner(routes.vault).initialize(_runners);

        permit(routes.participation, routes.vault, bytes4(keccak256('withdraw(address,uint256)')));
        permit(routes.trading, routes.vault, bytes4(keccak256('withdraw(address,uint256)')));
        permit(routes.participation, routes.shares, bytes4(keccak256('createFor(address,uint256)')));
        permit(routes.participation, routes.shares, bytes4(keccak256('destroyFor(address,uint256)')));
        permit(routes.feeManager, routes.shares, bytes4(keccak256('createFor(address,uint256)')));
        permit(routes.participation, routes.accounting, bytes4(keccak256('addAssetToOwnedAssets(address)')));
        permit(routes.trading, routes.accounting, bytes4(keccak256('addAssetToOwnedAssets(address)')));
        permit(routes.trading, routes.accounting, bytes4(keccak256('removeFromOwnedAssets(address)')));
        permit(routes.accounting, routes.feeManager, bytes4(keccak256('rewardAllFees()')));
        permit(manager, routes.policyManager, bytes4(keccak256('register(bytes4,address)')));
        permit(manager, routes.policyManager, bytes4(keccak256('batchRegister(bytes4[],address[])')));
        permit(manager, routes.participation, bytes4(keccak256('enableInvestment(address[])')));
        permit(manager, routes.participation, bytes4(keccak256('disableInvestment(address[])')));
        permit(manager, routes.trading, bytes4(keccak256('addExchange(address,address)')));
        fundInitialized = true;
    }

    function vault() external view returns (address) { return routes.vault; }
    function accounting() external view returns (address) { return routes.accounting; }
    function priceSource() external view returns (address) { return Registry(routes.registry).priceSource(); }
    function participation() external view returns (address) { return routes.participation; }
    function trading() external view returns (address) { return routes.trading; }
    function shares() external view returns (address) { return routes.shares; }
    function registry() external view returns (address) { return routes.registry; }
    function version() external view returns (address) { return routes.version; }
    function policyManager() external view returns (address) { return routes.policyManager; }
}

