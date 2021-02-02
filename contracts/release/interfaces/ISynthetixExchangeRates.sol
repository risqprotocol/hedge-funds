// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Risq Protocol.

    (c) Risq Protocol <team@risq.capital>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity 0.6.12;

/// @title ISynthetixExchangeRates Interface
/// @author Risq Protocol <team@risq.capital>
interface ISynthetixExchangeRates {
    function rateAndInvalid(bytes32) external view returns (uint256, bool);
}
