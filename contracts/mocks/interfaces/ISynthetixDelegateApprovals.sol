// SPDX-License-Identifier: GPL-3.0

/*
    This file is part of the Risq Protocol.

    (c) Risq Protocol <team@risq.capital>

    For the full license information, please view the LICENSE
    file that was distributed with this source code.
*/

pragma solidity 0.6.12;

/// @title ISynthetixDelegateApprovals Interface
/// @author Risq Protocol <team@risq.capital>
interface ISynthetixDelegateApprovals {
    function approveExchangeOnBehalf(address) external;

    function canExchangeFor(address, address) external view returns (bool);
}
