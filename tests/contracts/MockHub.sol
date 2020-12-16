pragma solidity 0.6.1;

import "main/dependencies/DSGuard.sol";
import "main/fund/backoffice/Runner.sol";
import "main/version/Registry.sol";

/// @notice BackOffice used for testing
contract MockBackOffice is DSGuard {

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
        address risqAddress;
    }
    Routes public routes;
    address public manager;
    string public name;
    bool public isShutDown;

    function setManager(address _manager) public { manager = _manager; }

    function setName(string memory _name) public { name = _name; }

    function shutDownFund() public { isShutDown = true; }

    function setShutDownState(bool _state) public { isShutDown = _state; }

    function setRunners(address[11] memory _runners) public {
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
        routes.risqAddress = _runners[10];
    }

    function setRouting() public {
        address[11] memory runners = [
            routes.accounting, routes.feeManager, routes.participation,
            routes.policyManager, routes.shares, routes.trading,
            routes.vault, routes.registry, routes.version,
            routes.engine, routes.risqAddress
        ];
        Runner(routes.accounting).initialize(runners);
        Runner(routes.feeManager).initialize(runners);
        Runner(routes.participation).initialize(runners);
        Runner(routes.policyManager).initialize(runners);
        Runner(routes.shares).initialize(runners);
        Runner(routes.trading).initialize(runners);
        Runner(routes.vault).initialize(runners);
    }

    function setPermissions() public {
        permit(routes.participation, routes.vault, bytes4(keccak256('withdraw(address,uint256)')));
        permit(routes.trading, routes.vault, bytes4(keccak256('withdraw(address,uint256)')));
        permit(routes.participation, routes.shares, bytes4(keccak256('createFor(address,uint256)')));
        permit(routes.participation, routes.shares, bytes4(keccak256('destroyFor(address,uint256)')));
        permit(routes.feeManager, routes.shares, bytes4(keccak256('createFor(address,uint256)')));
        permit(routes.participation, routes.accounting, bytes4(keccak256('addAssetToOwnedAssets(address)')));
        permit(routes.participation, routes.accounting, bytes4(keccak256('removeFromOwnedAssets(address)')));
        permit(routes.trading, routes.accounting, bytes4(keccak256('addAssetToOwnedAssets(address)')));
        permit(routes.trading, routes.accounting, bytes4(keccak256('removeFromOwnedAssets(address)')));
        permit(routes.accounting, routes.feeManager, bytes4(keccak256('rewardAllFees()')));
        permit(manager, routes.feeManager, bytes4(keccak256('register(address)')));
        permit(manager, routes.feeManager, bytes4(keccak256('batchRegister(address[])')));
        permit(manager, routes.policyManager, bytes4(keccak256('register(bytes4,address)')));
        permit(manager, routes.policyManager, bytes4(keccak256('batchRegister(bytes4[],address[])')));
        permit(manager, routes.participation, bytes4(keccak256('enableInvestment(address[])')));
        permit(manager, routes.participation, bytes4(keccak256('disableInvestment(address[])')));
        permit(bytes32(bytes20(msg.sender)), ANY, ANY);
    }

    function permitSomething(address _from, address _to, bytes4 _sig) public {
        permit(
            bytes32(bytes20(_from)),
            bytes32(bytes20(_to)),
            _sig
        );
    }

    function initializeRunner(address _runner) public {
        address[11] memory runners = [
            routes.accounting, routes.feeManager, routes.participation,
            routes.policyManager, routes.shares, routes.trading,
            routes.vault, routes.registry, routes.version,
            routes.engine, routes.risqAddress
        ];
        Runner(_runner).initialize(runners);
    }

    function vault() public view returns (address) { return routes.vault; }
    function accounting() public view returns (address) { return routes.accounting; }
    function priceSource() public view returns (address) { return Registry(routes.registry).priceSource(); }
    function participation() public view returns (address) { return routes.participation; }
    function trading() public view returns (address) { return routes.trading; }
    function shares() public view returns (address) { return routes.shares; }
    function policyManager() public view returns (address) { return routes.policyManager; }
    function registry() public view returns (address) { return routes.registry; }
}

