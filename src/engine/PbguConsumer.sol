pragma solidity 0.6.1;

import "../dependencies/DSMath.sol";
import "../dependencies/token/IERC20.sol";
import "../prices/IPriceSource.sol";
import "../version/IVersion.sol";
import "./IEngine.sol";
import "../version/Registry.sol";

/// @notice Abstract contracts
/// @notice inherit this to pay PBGU on a function call
abstract contract PbguConsumer is DSMath {

    /// @dev each of these must be implemented by the inheriting contract
    function engine() public view virtual returns (address);
    function risqToken() public view virtual returns (address);
    function priceSource() public view virtual returns (address);
    function registry() public view virtual returns (address);
    event PbguPaid(address indexed payer, uint256 totalPbguPaidInEth, uint256 pbguChargableGas, uint256 incentivePaid);

    /// bool deductIncentive is used when sending extra eth beyond pbgu
    modifier pbguPayable(bool deductIncentive) {
        uint preGas = gasleft();
        _;
        uint postGas = gasleft();

        uint risqPerPbgu = IEngine(engine()).getPbguPrice();
        uint risqQuantity = mul(
            risqPerPbgu,
            sub(preGas, postGas)
        );
        address nativeAsset = Registry(registry()).nativeAsset();
        uint ethToPay = IPriceSource(priceSource()).convertQuantity(
            risqQuantity,
            risqToken(),
            nativeAsset
        );
        uint incentiveAmount;
        if (deductIncentive) {
            incentiveAmount = Registry(registry()).incentive();
        } else {
            incentiveAmount = 0;
        }
        require(
            msg.value >= add(ethToPay, incentiveAmount),
            "Insufficent PBGU and/or incentive"
        );
        IEngine(engine()).payPbguInEther.value(ethToPay)();

        require(
            msg.sender.send(
                sub(
                    sub(msg.value, ethToPay),
                    incentiveAmount
                )
            ),
            "Refund failed"
        );
        emit PbguPaid(msg.sender, ethToPay, sub(preGas, postGas), incentiveAmount);
    }
}
