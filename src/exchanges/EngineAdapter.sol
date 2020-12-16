pragma solidity 0.6.1;
pragma experimental ABIEncoderV2;

import "../engine/Engine.sol";
import "../fund/backoffice/BackOffice.sol";
import "../fund/trading/Trading.sol";
import "../fund/vault/Vault.sol";
import "../dependencies/DSMath.sol";
import "../dependencies/WETH.sol";
import "../dependencies/token/IERC20.sol";
import "./ExchangeAdapter.sol";
import "../dependencies/TokenUser.sol";

/// @notice Trading adapter to Risq Engine
contract EngineAdapter is DSMath, TokenUser, ExchangeAdapter {

    /// @notice Buys Ether from the engine, selling RISQ
    /// @param targetExchange Address of the engine
    /// @param orderValues [0] Min Eth to receive from the engine
    /// @param orderValues [1] RISQ quantity
    /// @param orderValues [6] Same as orderValues[1]
    /// @param orderAddresses [2] WETH token
    /// @param orderAddresses [3] Risq Protocol
    function takeOrder (
        address targetExchange,
        address[8] memory orderAddresses,
        uint[8] memory orderValues,
        bytes[4] memory orderData,
        bytes32 identifier,
        bytes memory signature
    ) public override onlyManager notShutDown {
        BackOffice backOffice = getBackOffice();

        address wethAddress = orderAddresses[2];
        address risqAddress = orderAddresses[3];
        uint minEthToReceive = orderValues[0];
        uint risqQuantity = orderValues[1];

        require(
            wethAddress == Registry(backOffice.registry()).nativeAsset(),
            "maker asset doesnt match nativeAsset on registry"
        );
        require(
            orderValues[1] == orderValues[6],
            "fillTakerQuantity must equal takerAssetQuantity"
        );

        approveAsset(risqAddress, targetExchange, risqQuantity, "takerAsset");

        uint ethToReceive = Engine(targetExchange).ethPayoutForRisqAmount(risqQuantity);

        require(
            ethToReceive >= minEthToReceive,
            "Expected ETH to receive is less than takerQuantity (minEthToReceive)"
        );

        Engine(targetExchange).sellAndBurnRisq(risqQuantity);
        WETH(payable(wethAddress)).deposit.value(ethToReceive)();
        safeTransfer(wethAddress, address(Vault(backOffice.vault())), ethToReceive);

        getAccounting().addAssetToOwnedAssets(wethAddress);
        getAccounting().updateOwnedAssets();
        getTrading().orderUpdateHook(
            targetExchange,
            bytes32(0),
            Trading.UpdateType.take,
            [payable(wethAddress), payable(risqAddress)],
            [ethToReceive, risqQuantity, risqQuantity]
        );
    }
}
