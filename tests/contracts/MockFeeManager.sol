pragma solidity 0.6.1;
pragma experimental ABIEncoderV2;

import "main/fund/backoffice/Runner.sol";
import "main/fund/shares/Shares.sol";
import "main/factory/Factory.sol";
import "main/dependencies/DSMath.sol";
import "main/engine/PbguConsumer.sol";

contract MockFeeManager is DSMath, Runner, PbguConsumer {

    struct FeeInfo {
        address feeAddress;
        uint feeRate;
        uint feePeriod;
    }

    uint totalFees;
    uint performanceFees;

    constructor(
        address _backOffice,
        address _denominationAsset,
        address[] memory _fees,
        uint[] memory _periods,
        uint _rates,
        address registry
    ) Runner(_backOffice) public {}

    function setTotalFeeAmount(uint _amt) public { totalFees = _amt; }
    function setPerformanceFeeAmount(uint _amt) public { performanceFees = _amt; }

    function rewardManagementFee() public { return; }
    function performanceFeeAmount() external returns (uint) { return performanceFees; }
    function totalFeeAmount() external returns (uint) { return totalFees; }
    function engine() public view override(PbguConsumer, Runner) returns (address) { return routes.engine; }
    function risqToken() public view override(PbguConsumer, Runner) returns (address) { return routes.risqToken; }
    function priceSource() public view override(PbguConsumer, Runner) returns (address) { return backOffice.priceSource(); }
    function registry() public view override(PbguConsumer, Runner) returns (address) { return routes.registry; }
}
