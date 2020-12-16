pragma solidity 0.6.1;
pragma experimental ABIEncoderV2;

import "../fund/accounting/IAccounting.sol";
import "../fund/fees/IFeeManager.sol";
import "../fund/backoffice/BackOffice.sol";
import "../fund/policies/IPolicyManager.sol";
import "../fund/participation/IParticipation.sol";
import "../fund/shares/IShares.sol";
import "../fund/trading/ITrading.sol";
import "../fund/vault/IVault.sol";
import "../version/IVersion.sol";
import "../engine/PbguConsumer.sol";
import "./Factory.sol";

/// @notice Creates fund routes and links them together
contract FundFactory is PbguConsumer, Factory {

    event NewFund(
        address indexed manager,
        address indexed backOffice,
        address[11] routes
    );

    IVersion public version;
    Registry public associatedRegistry;
    IAccountingFactory public accountingFactory;
    IFeeManagerFactory public feeManagerFactory;
    IParticipationFactory public participationFactory;
    IPolicyManagerFactory public policyManagerFactory;
    ISharesFactory public sharesFactory;
    ITradingFactory public tradingFactory;
    IVaultFactory public vaultFactory;

    address[] public funds;
    mapping (address => address) public managersToBackOffices;
    mapping (address => BackOffice.Routes) public managersToRoutes;
    mapping (address => Settings) public managersToSettings;

    /// @dev Parameters stored when beginning setup
    struct Settings {
        string name;
        address[] exchanges;
        address[] adapters;
        address denominationAsset;
        address[] defaultInvestmentAssets;
        address[] fees;
        uint[] feeRates;
        uint[] feePeriods;
    }

    constructor(
        address _accountingFactory,
        address _feeManagerFactory,
        address _participationFactory,
        address _sharesFactory,
        address _tradingFactory,
        address _vaultFactory,
        address _policyManagerFactory,
        address _version
    )
        public
    {
        accountingFactory = IAccountingFactory(_accountingFactory);
        feeManagerFactory = IFeeManagerFactory(_feeManagerFactory);
        participationFactory = IParticipationFactory(_participationFactory);
        sharesFactory = ISharesFactory(_sharesFactory);
        tradingFactory = ITradingFactory(_tradingFactory);
        vaultFactory = IVaultFactory(_vaultFactory);
        policyManagerFactory = IPolicyManagerFactory(_policyManagerFactory);
        version = IVersion(_version);
    }

    function componentExists(address _component) internal pure returns (bool) {
        return _component != address(0);
    }

    function ensureComponentNotSet(address _component) internal {
        require(
            !componentExists(_component),
            "This step has already been run"
        );
    }

    function ensureComponentSet(address _component) internal {
        require(
            componentExists(_component),
            "Component preprequisites not met"
        );
    }

    function beginSetup(
        string memory _name,
        address[] memory _fees,
        uint[] memory _feeRates,
        uint[] memory _feePeriods,
        address[] memory _exchanges,
        address[] memory _adapters,
        address _denominationAsset,
        address[] memory _defaultInvestmentAssets
    )
        public
    {
        ensureComponentNotSet(managersToBackOffices[msg.sender]);
        associatedRegistry.reserveFundName(
            msg.sender,
            _name
        );
        require(
            associatedRegistry.assetIsRegistered(_denominationAsset),
            "Denomination asset must be registered"
        );

        managersToBackOffices[msg.sender] = address(new BackOffice(msg.sender, _name));
        managersToSettings[msg.sender] = Settings(
            _name,
            _exchanges,
            _adapters,
            _denominationAsset,
            _defaultInvestmentAssets,
            _fees,
            _feeRates,
            _feePeriods
        );
        managersToRoutes[msg.sender].registry = address(associatedRegistry);
        managersToRoutes[msg.sender].version = address(version);
        managersToRoutes[msg.sender].engine = engine();
        managersToRoutes[msg.sender].risqToken = risqToken();
    }

    function _createAccountingFor(address _manager)
        internal
    {
        ensureComponentSet(managersToBackOffices[_manager]);
        ensureComponentNotSet(managersToRoutes[_manager].accounting);
        managersToRoutes[_manager].accounting = accountingFactory.createInstance(
            managersToBackOffices[_manager],
            managersToSettings[_manager].denominationAsset,
            associatedRegistry.nativeAsset()
        );
    }

    function createAccountingFor(address _manager) external pbguPayable(false) payable { _createAccountingFor(_manager); }
    function createAccounting() external pbguPayable(false) payable { _createAccountingFor(msg.sender); }

    function _createFeeManagerFor(address _manager)
        internal
    {
        ensureComponentSet(managersToBackOffices[_manager]);
        ensureComponentNotSet(managersToRoutes[_manager].feeManager);
        managersToRoutes[_manager].feeManager = feeManagerFactory.createInstance(
            managersToBackOffices[_manager],
            managersToSettings[_manager].denominationAsset,
            managersToSettings[_manager].fees,
            managersToSettings[_manager].feeRates,
            managersToSettings[_manager].feePeriods,
            managersToRoutes[_manager].registry
        );
    }

    function createFeeManagerFor(address _manager) external pbguPayable(false) payable { _createFeeManagerFor(_manager); }
    function createFeeManager() external pbguPayable(false) payable { _createFeeManagerFor(msg.sender); }

    function _createParticipationFor(address _manager)
        internal
    {
        ensureComponentSet(managersToBackOffices[_manager]);
        ensureComponentNotSet(managersToRoutes[_manager].participation);
        managersToRoutes[_manager].participation = participationFactory.createInstance(
            managersToBackOffices[_manager],
            managersToSettings[_manager].defaultInvestmentAssets,
            managersToRoutes[_manager].registry
        );
    }

    function createParticipationFor(address _manager) external pbguPayable(false) payable { _createParticipationFor(_manager); }
    function createParticipation() external pbguPayable(false) payable { _createParticipationFor(msg.sender); }

    function _createPolicyManagerFor(address _manager)
        internal
    {
        ensureComponentSet(managersToBackOffices[_manager]);
        ensureComponentNotSet(managersToRoutes[_manager].policyManager);
        managersToRoutes[_manager].policyManager = policyManagerFactory.createInstance(
            managersToBackOffices[_manager]
        );
    }

    function createPolicyManagerFor(address _manager) external pbguPayable(false) payable { _createPolicyManagerFor(_manager); }
    function createPolicyManager() external pbguPayable(false) payable { _createPolicyManagerFor(msg.sender); }

    function _createSharesFor(address _manager)
        internal
    {
        ensureComponentSet(managersToBackOffices[_manager]);
        ensureComponentNotSet(managersToRoutes[_manager].shares);
        managersToRoutes[_manager].shares = sharesFactory.createInstance(
            managersToBackOffices[_manager]
        );
    }

    function createSharesFor(address _manager) external pbguPayable(false) payable { _createSharesFor(_manager); }
    function createShares() external pbguPayable(false) payable { _createSharesFor(msg.sender); }

    function _createTradingFor(address _manager)
        internal
    {
        ensureComponentSet(managersToBackOffices[_manager]);
        ensureComponentNotSet(managersToRoutes[_manager].trading);
        managersToRoutes[_manager].trading = tradingFactory.createInstance(
            managersToBackOffices[_manager],
            managersToSettings[_manager].exchanges,
            managersToSettings[_manager].adapters,
            managersToRoutes[_manager].registry
        );
    }

    function createTradingFor(address _manager) external pbguPayable(false) payable { _createTradingFor(_manager); }
    function createTrading() external pbguPayable(false) payable { _createTradingFor(msg.sender); }

    function _createVaultFor(address _manager)
        internal
    {
        ensureComponentSet(managersToBackOffices[_manager]);
        ensureComponentNotSet(managersToRoutes[_manager].vault);
        managersToRoutes[_manager].vault = vaultFactory.createInstance(
            managersToBackOffices[_manager]
        );
    }

    function createVaultFor(address _manager) external pbguPayable(false) payable { _createVaultFor(_manager); }
    function createVault() external pbguPayable(false) payable { _createVaultFor(msg.sender); }

    function _completeSetupFor(address _manager) internal {
        BackOffice.Routes memory routes = managersToRoutes[_manager];
        BackOffice backOffice = BackOffice(managersToBackOffices[_manager]);
        require(!childExists[address(backOffice)], "Setup already complete");
        require(
            componentExists(address(backOffice)) &&
            componentExists(routes.accounting) &&
            componentExists(routes.feeManager) &&
            componentExists(routes.participation) &&
            componentExists(routes.policyManager) &&
            componentExists(routes.shares) &&
            componentExists(routes.trading) &&
            componentExists(routes.vault),
            "Components must be set before completing setup"
        );
        childExists[address(backOffice)] = true;
        backOffice.initializeAndSetPermissions([
            routes.accounting,
            routes.feeManager,
            routes.participation,
            routes.policyManager,
            routes.shares,
            routes.trading,
            routes.vault,
            routes.registry,
            routes.version,
            routes.engine,
            routes.risqToken
        ]);
        funds.push(address(backOffice));
        associatedRegistry.registerFund(
            address(backOffice),
            _manager,
            managersToSettings[_manager].name
        );

        emit NewFund(
            msg.sender,
            address(backOffice),
            [
                routes.accounting,
                routes.feeManager,
                routes.participation,
                routes.policyManager,
                routes.shares,
                routes.trading,
                routes.vault,
                routes.registry,
                routes.version,
                routes.engine,
                routes.risqToken
            ]
        );
    }

    function completeSetupFor(address _manager) external pbguPayable(false) payable { _completeSetupFor(_manager); }
    function completeSetup() external pbguPayable(false) payable { _completeSetupFor(msg.sender); }

    function getFundById(uint withId) external view returns (address) { return funds[withId]; }
    function getLastFundId() external view returns (uint) { return funds.length - 1; }

    function risqToken() public view override returns (address) {
        return address(associatedRegistry.risqToken());
    }
    function engine() public view override returns (address) {
        return address(associatedRegistry.engine());
    }
    function priceSource() public view override returns (address) {
        return address(associatedRegistry.priceSource());
    }
    function registry() public view override returns (address) { return address(associatedRegistry); }
    function getExchangesInfo(address user) public view returns (address[] memory) {
        return (managersToSettings[user].exchanges);
    }
}
