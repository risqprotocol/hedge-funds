// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Risq Protocol.

    (c) Risq Protocol <team@risq.capital>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity 0.6.12;

/// @title ISynthetix Interface
/// @author Risq Protocol <team@risq.capital>
interface ISynthetix {
    function exchangeOnBehalfWithTracking(
        address,
        bytes32,
        uint256,
        bytes32,
        address,
        bytes32
    ) external returns (uint256);
}
