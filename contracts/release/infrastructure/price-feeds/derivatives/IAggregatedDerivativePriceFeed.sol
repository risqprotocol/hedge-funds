// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Risq Protocol.

    (c) Risq Protocol <team@risq.capital>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity 0.6.12;

import "./IDerivativePriceFeed.sol";

/// @title IDerivativePriceFeed Interface
/// @author Risq Protocol <team@risq.capital>
interface IAggregatedDerivativePriceFeed is IDerivativePriceFeed {
    function getPriceFeedForDerivative(address) external view returns (address);
}
