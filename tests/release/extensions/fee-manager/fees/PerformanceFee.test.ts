import { BigNumber, BigNumberish, BytesLike, constants, utils } from 'ethers';
import { EthereumTestnetProvider, MockContract } from '@crestproject/crestproject';
import {
  ComptrollerLib,
  FeeHook,
  FeeManager,
  FeeManagerActionId,
  feeManagerConfigArgs,
  FeeSettlementType,
  PerformanceFee,
  performanceFeeConfigArgs,
  performanceFeeSharesDue,
  StandardToken,
  VaultLib,
} from '@risqprotocol/protocol';
import {
  addTrackedAssets,
  assertEvent,
  assertNoEvent,
  buyShares,
  callOnExtension,
  createFundDeployer,
  createMigratedFundConfig,
  createNewFund,
  defaultTestDeployment,
  transactionTimestamp,
  updateChainlinkAggregator,
} from '@risqprotocol/testutils';

async function snapshot(provider: EthereumTestnetProvider) {
  const { accounts, deployment, config } = await defaultTestDeployment(provider);

  // Mock a FeeManager
  const mockFeeManager = await FeeManager.mock(config.deployer);
  await mockFeeManager.getFeeSharesOutstandingForFund.returns(0);

  // Create standalone PerformanceFee
  const standalonePerformanceFee = await PerformanceFee.deploy(config.deployer, mockFeeManager);

  // Mock a denomination asset
  const mockDenominationAsset = await StandardToken.mock(config.deployer);
  await mockDenominationAsset.decimals.returns(18);

  // Mock a VaultProxy
  const mockVaultProxy = await VaultLib.mock(config.deployer);
  await mockVaultProxy.totalSupply.returns(0);
  await mockVaultProxy.balanceOf.returns(0);

  // Mock a ComptrollerProxy
  const mockComptrollerProxy = await ComptrollerLib.mock(config.deployer);
  await mockComptrollerProxy.calcGav.returns(0, false);
  await mockComptrollerProxy.calcGrossShareValue.returns(utils.parseEther('1'), true);
  await mockComptrollerProxy.getDenominationAsset.returns(mockDenominationAsset);
  await mockComptrollerProxy.getVaultProxy.returns(mockVaultProxy);

  // Add fee settings for ComptrollerProxy
  const performanceFeeRate = utils.parseEther('.1'); // 10%
  const performanceFeePeriod = BigNumber.from(60 * 60 * 24 * 365); // 365 days
  const performanceFeeConfig = performanceFeeConfigArgs({
    rate: performanceFeeRate,
    period: performanceFeePeriod,
  });

  await mockFeeManager.forward(standalonePerformanceFee.addFundSettings, mockComptrollerProxy, performanceFeeConfig);

  return {
    accounts,
    config,
    deployment,
    performanceFeeRate,
    performanceFeePeriod,
    mockComptrollerProxy,
    mockFeeManager,
    mockVaultProxy,
    standalonePerformanceFee,
  };
}

async function activateWithInitialValues({
  mockFeeManager,
  mockComptrollerProxy,
  mockVaultProxy,
  performanceFee,
  gav = utils.parseEther('1'),
  totalSharesSupply = utils.parseEther('1'),
}: {
  mockFeeManager: MockContract<FeeManager>;
  mockComptrollerProxy: MockContract<ComptrollerLib>;
  mockVaultProxy: MockContract<VaultLib>;
  performanceFee: PerformanceFee;
  gav?: BigNumberish;
  totalSharesSupply?: BigNumberish;
}) {
  await mockComptrollerProxy.calcGav.returns(gav, true);
  await mockVaultProxy.totalSupply.returns(totalSharesSupply);
  await mockComptrollerProxy.calcGrossShareValue.returns(
    BigNumber.from(gav).mul(utils.parseEther('1')).div(totalSharesSupply),
    true,
  );

  return mockFeeManager.forward(performanceFee.activateForFund, mockComptrollerProxy, mockVaultProxy);
}

async function assertAdjustedPerformance({
  mockFeeManager,
  mockComptrollerProxy,
  mockVaultProxy,
  performanceFee,
  nextGav,
  feeHook = FeeHook.Continuous,
  settlementData = constants.HashZero,
}: {
  mockFeeManager: MockContract<FeeManager>;
  mockComptrollerProxy: MockContract<ComptrollerLib>;
  mockVaultProxy: MockContract<VaultLib>;
  performanceFee: PerformanceFee;
  nextGav: BigNumberish;
  feeHook?: FeeHook;
  settlementData?: BytesLike;
}) {
  // Change the share price by altering the gav
  const prevTotalSharesSupply = await mockVaultProxy.totalSupply();
  await mockComptrollerProxy.calcGav.returns(nextGav, true);
  await mockComptrollerProxy.calcGrossShareValue.returns(
    BigNumber.from(nextGav).mul(utils.parseEther('1')).div(prevTotalSharesSupply),
    true,
  );

  // Calculate expected performance results for next settlement
  const feeInfo = await performanceFee.getFeeInfoForFund(mockComptrollerProxy);
  const prevTotalSharesOutstanding = await mockVaultProxy.balanceOf(mockVaultProxy);
  const prevPerformanceFeeSharesOutstanding = await mockFeeManager.getFeeSharesOutstandingForFund(
    mockComptrollerProxy,
    performanceFee,
  );

  const { nextAggregateValueDue, nextSharePrice, sharesDue } = performanceFeeSharesDue({
    rate: feeInfo.rate,
    totalSharesSupply: prevTotalSharesSupply,
    totalSharesOutstanding: prevTotalSharesOutstanding,
    performanceFeeSharesOutstanding: prevPerformanceFeeSharesOutstanding,
    gav: nextGav,
    highWaterMark: feeInfo.highWaterMark,
    prevSharePrice: feeInfo.lastSharePrice,
    prevAggregateValueDue: feeInfo.aggregateValueDue,
  });

  // Determine fee settlement type
  let feeSettlementType = FeeSettlementType.None;
  if (sharesDue.gt(0)) {
    feeSettlementType = FeeSettlementType.MintSharesOutstanding;
  } else if (sharesDue.lt(0)) {
    feeSettlementType = FeeSettlementType.BurnSharesOutstanding;
  }

  // settle.call() to assert return values and get the sharesOutstanding
  const settleCall = await performanceFee.settle
    .args(mockComptrollerProxy, mockVaultProxy, feeHook, settlementData, nextGav)
    .from(mockFeeManager)
    .call();

  expect(settleCall).toMatchFunctionOutput(performanceFee.settle, {
    settlementType_: feeSettlementType,
    sharesDue_: sharesDue.abs(),
  });

  // Execute settle() tx
  const settleReceipt = await mockFeeManager.forward(
    performanceFee.settle,
    mockComptrollerProxy,
    mockVaultProxy,
    feeHook,
    settlementData,
    nextGav,
  );

  // Assert PerformanceUpdated event
  assertEvent(settleReceipt, 'PerformanceUpdated', {
    comptrollerProxy: mockComptrollerProxy,
    prevAggregateValueDue: feeInfo.aggregateValueDue,
    nextAggregateValueDue,
    sharesOutstandingDiff: sharesDue,
  });

  // Execute update() tx
  const updateReceipt = await mockFeeManager.forward(
    performanceFee.update,
    mockComptrollerProxy,
    mockVaultProxy,
    feeHook,
    settlementData,
    nextGav,
  );

  // Assert event
  assertEvent(updateReceipt, 'LastSharePriceUpdated', {
    comptrollerProxy: mockComptrollerProxy,
    prevSharePrice: feeInfo.lastSharePrice,
    nextSharePrice,
  });

  // Set sharesOutstanding and new shares total supply
  await mockVaultProxy.balanceOf.given(mockVaultProxy).returns(prevTotalSharesOutstanding.add(sharesDue));
  await mockFeeManager.getFeeSharesOutstandingForFund
    .given(mockComptrollerProxy, performanceFee)
    .returns(prevPerformanceFeeSharesOutstanding.add(sharesDue));
  await mockVaultProxy.totalSupply.returns(prevTotalSharesSupply.add(sharesDue));

  return { feeSettlementType, settleReceipt };
}

describe('constructor', () => {
  it('sets state vars', async () => {
    const {
      deployment: { feeManager, performanceFee },
    } = await provider.snapshot(snapshot);

    const getFeeManagerCall = await performanceFee.getFeeManager();
    expect(getFeeManagerCall).toMatchAddress(feeManager);

    // Implements expected hooks
    const implementedHooksCall = await performanceFee.implementedHooks();
    expect(implementedHooksCall).toMatchFunctionOutput(performanceFee.implementedHooks.fragment, {
      implementedHooksForSettle_: [FeeHook.Continuous, FeeHook.BuySharesSetup, FeeHook.PreRedeemShares],
      implementedHooksForUpdate_: [FeeHook.Continuous, FeeHook.BuySharesCompleted, FeeHook.PreRedeemShares],
      usesGavOnSettle_: true,
      usesGavOnUpdate_: true,
    });

    // Is registered with correct hooks

    // Settle - true
    const feeSettlesOnHookContinuousValue = await feeManager.feeSettlesOnHook(performanceFee, FeeHook.Continuous);
    expect(feeSettlesOnHookContinuousValue).toBe(true);

    const feeSettlesOnHookBuySharesSetupValue = await feeManager.feeSettlesOnHook(
      performanceFee,
      FeeHook.BuySharesSetup,
    );
    expect(feeSettlesOnHookBuySharesSetupValue).toBe(true);

    const feeSettlesOnHookPreRedeemSharesValue = await feeManager.feeSettlesOnHook(
      performanceFee,
      FeeHook.PreRedeemShares,
    );
    expect(feeSettlesOnHookPreRedeemSharesValue).toBe(true);

    // Settle - false
    const feeSettlesOnHookPreBuySharesValue = await feeManager.feeSettlesOnHook(performanceFee, FeeHook.PreBuyShares);
    expect(feeSettlesOnHookPreBuySharesValue).toBe(false);

    const feeSettlesOnHookPostBuySharesValue = await feeManager.feeSettlesOnHook(performanceFee, FeeHook.PostBuyShares);
    expect(feeSettlesOnHookPostBuySharesValue).toBe(false);

    // Update - true
    const feeUpdatesOnHookContinuousValue = await feeManager.feeUpdatesOnHook(performanceFee, FeeHook.Continuous);
    expect(feeUpdatesOnHookContinuousValue).toBe(true);

    const feeUpdatesOnHookBuySharesCompletedValue = await feeManager.feeUpdatesOnHook(
      performanceFee,
      FeeHook.BuySharesCompleted,
    );
    expect(feeUpdatesOnHookBuySharesCompletedValue).toBe(true);

    const feeUpdatesOnHookPreRedeemSharesValue = await feeManager.feeUpdatesOnHook(
      performanceFee,
      FeeHook.PreRedeemShares,
    );
    expect(feeUpdatesOnHookPreRedeemSharesValue).toBe(true);

    // Update - false
    const feeUpdatesOnHookPreBuySharesValue = await feeManager.feeUpdatesOnHook(performanceFee, FeeHook.PreBuyShares);
    expect(feeUpdatesOnHookPreBuySharesValue).toBe(false);

    const feeUpdatesOnHookPostBuySharesValue = await feeManager.feeUpdatesOnHook(performanceFee, FeeHook.PostBuyShares);
    expect(feeUpdatesOnHookPostBuySharesValue).toBe(false);

    // Uses GAV
    const feeUsesGavOnSettleValue = await feeManager.feeUsesGavOnSettle(performanceFee);
    expect(feeUsesGavOnSettleValue).toBe(true);

    const feeUsesGavOnUpdateValue = await feeManager.feeUsesGavOnUpdate(performanceFee);
    expect(feeUsesGavOnUpdateValue).toBe(true);
  });
});

describe('addFundSettings', () => {
  it('can only be called by the FeeManager', async () => {
    const {
      performanceFeePeriod,
      performanceFeeRate,
      mockComptrollerProxy,
      standalonePerformanceFee,
    } = await provider.snapshot(snapshot);

    const performanceFeeConfig = performanceFeeConfigArgs({
      rate: performanceFeeRate,
      period: performanceFeePeriod,
    });

    await expect(
      standalonePerformanceFee.addFundSettings(mockComptrollerProxy, performanceFeeConfig),
    ).rejects.toBeRevertedWith('Only the FeeManger can make this call');
  });

  it('correctly handles valid call', async () => {
    const {
      performanceFeePeriod,
      performanceFeeRate,
      mockComptrollerProxy,
      mockFeeManager,
      standalonePerformanceFee,
    } = await provider.snapshot(snapshot);

    const performanceFeeConfig = performanceFeeConfigArgs({
      rate: performanceFeeRate,
      period: performanceFeePeriod,
    });

    const receipt = await mockFeeManager.forward(
      standalonePerformanceFee.addFundSettings,
      mockComptrollerProxy,
      performanceFeeConfig,
    );

    // Assert correct event was emitted
    assertEvent(receipt, 'FundSettingsAdded', {
      comptrollerProxy: mockComptrollerProxy,
      rate: performanceFeeRate,
      period: performanceFeePeriod,
    });

    // Assert state
    const getFeeInfoForFundCall = await standalonePerformanceFee.getFeeInfoForFund(mockComptrollerProxy);

    expect(getFeeInfoForFundCall).toMatchFunctionOutput(standalonePerformanceFee.getFeeInfoForFund, {
      rate: performanceFeeRate,
      period: performanceFeePeriod,
      activated: BigNumber.from(0),
      lastPaid: BigNumber.from(0),
      highWaterMark: BigNumber.from(0),
      lastSharePrice: BigNumber.from(0),
      aggregateValueDue: BigNumber.from(0),
    });
  });
});

describe('activateForFund', () => {
  it('can only be called by the FeeManager', async () => {
    const { mockComptrollerProxy, mockVaultProxy, standalonePerformanceFee } = await provider.snapshot(snapshot);

    await expect(
      standalonePerformanceFee.activateForFund(mockComptrollerProxy, mockVaultProxy),
    ).rejects.toBeRevertedWith('Only the FeeManger can make this call');
  });

  it('correctly handles valid call', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      performanceFeePeriod,
      performanceFeeRate,
      standalonePerformanceFee,
    } = await provider.snapshot(snapshot);

    // Set grossShareValue to an arbitrary value
    const grossShareValue = utils.parseEther('5');
    await mockComptrollerProxy.calcGrossShareValue.returns(grossShareValue, true);

    // Activate fund
    const receipt = await mockFeeManager.forward(
      standalonePerformanceFee.activateForFund,
      mockComptrollerProxy,
      mockVaultProxy,
    );

    // Assert event
    assertEvent(receipt, 'ActivatedForFund', {
      comptrollerProxy: mockComptrollerProxy,
      highWaterMark: grossShareValue,
    });

    // Assert state
    const getFeeInfoForFundCall = await standalonePerformanceFee.getFeeInfoForFund(mockComptrollerProxy);
    const activationTimestamp = await transactionTimestamp(receipt);
    expect(getFeeInfoForFundCall).toMatchFunctionOutput(standalonePerformanceFee.getFeeInfoForFund, {
      rate: performanceFeeRate,
      period: performanceFeePeriod,
      activated: BigNumber.from(activationTimestamp),
      lastPaid: BigNumber.from(0),
      highWaterMark: grossShareValue,
      lastSharePrice: grossShareValue,
      aggregateValueDue: BigNumber.from(0),
    });
  });
});

describe('payout', () => {
  it('can only be called by the FeeManager', async () => {
    const { mockComptrollerProxy, mockVaultProxy, standalonePerformanceFee } = await provider.snapshot(snapshot);

    await expect(standalonePerformanceFee.payout(mockComptrollerProxy, mockVaultProxy)).rejects.toBeRevertedWith(
      'Only the FeeManger can make this call',
    );
  });

  it('correctly handles a valid call (HWM has not increased)', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      performanceFeePeriod,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    const feeInfoPrePayout = await performanceFee.getFeeInfoForFund(mockComptrollerProxy);

    // Warp to the end of the period
    await provider.send('evm_increaseTime', [performanceFeePeriod.toNumber()]);
    await provider.send('evm_mine', []);

    // call() function to assert return value
    const payoutCall = await performanceFee.payout
      .args(mockComptrollerProxy, mockVaultProxy)
      .from(mockFeeManager)
      .call();

    expect(payoutCall).toBe(true);

    // send() function
    const receipt = await mockFeeManager.forward(performanceFee.payout, mockComptrollerProxy, mockVaultProxy);

    // Assert event
    assertEvent(receipt, 'PaidOut', {
      comptrollerProxy: mockComptrollerProxy,
      prevHighWaterMark: feeInfoPrePayout.highWaterMark,
      nextHighWaterMark: feeInfoPrePayout.highWaterMark,
      aggregateValueDue: feeInfoPrePayout.aggregateValueDue,
    });

    // Assert state
    const getFeeInfoForFundCall = await performanceFee.getFeeInfoForFund(mockComptrollerProxy);

    const payoutTimestamp = await transactionTimestamp(receipt);
    expect(getFeeInfoForFundCall).toMatchFunctionOutput(performanceFee.getFeeInfoForFund, {
      rate: feeInfoPrePayout.rate,
      period: feeInfoPrePayout.period,
      activated: feeInfoPrePayout.activated,
      lastPaid: BigNumber.from(payoutTimestamp), // updated
      highWaterMark: feeInfoPrePayout.highWaterMark,
      lastSharePrice: feeInfoPrePayout.lastSharePrice,
      aggregateValueDue: 0, // updated
    });
  });

  it('correctly handles a valid call (HWM has increased)', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      performanceFeePeriod,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    const initialSharePrice = (await mockComptrollerProxy.calcGrossShareValue.call()).grossShareValue_;

    // Raise next high water mark by increasing price
    await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('1.1'),
      performanceFee,
    });

    const feeInfoPrePayout = await performanceFee.getFeeInfoForFund(mockComptrollerProxy);

    // Warp to the end of the period
    await provider.send('evm_increaseTime', [performanceFeePeriod.toNumber()]);
    await provider.send('evm_mine', []);

    // call() function to assert return value
    const payoutCall = await performanceFee.payout
      .args(mockComptrollerProxy, mockVaultProxy)
      .from(mockFeeManager)
      .call();

    expect(payoutCall).toBe(true);

    // send() function
    const receipt = await mockFeeManager.forward(performanceFee.payout, mockComptrollerProxy, mockVaultProxy);

    // Assert event
    assertEvent(receipt, 'PaidOut', {
      comptrollerProxy: mockComptrollerProxy,
      prevHighWaterMark: initialSharePrice,
      nextHighWaterMark: feeInfoPrePayout.lastSharePrice,
      aggregateValueDue: feeInfoPrePayout.aggregateValueDue,
    });

    // Assert state
    const getFeeInfoForFundCall = await performanceFee.getFeeInfoForFund(mockComptrollerProxy);
    const payoutTimestamp = await transactionTimestamp(receipt);
    expect(getFeeInfoForFundCall).toMatchFunctionOutput(performanceFee.getFeeInfoForFund, {
      rate: feeInfoPrePayout.rate,
      period: feeInfoPrePayout.period,
      activated: feeInfoPrePayout.activated,
      lastPaid: BigNumber.from(payoutTimestamp), // updated
      highWaterMark: feeInfoPrePayout.lastSharePrice, // updated
      lastSharePrice: feeInfoPrePayout.lastSharePrice,
      aggregateValueDue: 0, // updated
    });
  });
});

describe('payoutAllowed', () => {
  it('requires one full period to have passed since activation', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      performanceFeePeriod,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    // payoutAllowed should be false
    await expect(performanceFee.payoutAllowed(mockComptrollerProxy)).resolves.toBe(false);

    // Warp to almost the end of the period
    const warpOffset = 10;
    await provider.send('evm_increaseTime', [performanceFeePeriod.sub(warpOffset).toNumber()]);
    await provider.send('evm_mine', []);

    // payoutAllowed should still be false
    await expect(performanceFee.payoutAllowed(mockComptrollerProxy)).resolves.toBe(false);

    // Warp to the end of the period
    await provider.send('evm_increaseTime', [warpOffset]);
    await provider.send('evm_mine', []);

    // payoutAllowed should be true
    await expect(performanceFee.payoutAllowed(mockComptrollerProxy)).resolves.toBe(true);
  });

  it('requires a subsequent period to pass after a previous payout', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      performanceFeePeriod,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    // Raise next high water mark by increasing price
    await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('1.1'),
      performanceFee,
    });

    // Warp to the end of the period + an offset
    const offset = 1000;
    await provider.send('evm_increaseTime', [performanceFeePeriod.add(offset).toNumber()]);
    await provider.send('evm_mine', []);

    // Payout once to reset the fee period
    const initialPayoutCall = await performanceFee.payout
      .args(mockComptrollerProxy, mockVaultProxy)
      .from(mockFeeManager)
      .call();

    expect(initialPayoutCall).toBe(true);

    await mockFeeManager.forward(performanceFee.payout, mockComptrollerProxy, mockVaultProxy);

    // Warp to the end of the 2nd period (performanceFeePeriod - offset1) - another offset2
    const offset2 = 100;
    const increaseTime = performanceFeePeriod.sub(offset).sub(offset2).toNumber();

    await provider.send('evm_increaseTime', [increaseTime]);
    await provider.send('evm_mine', []);

    // payoutAllowed should return false since we haven't completed the 2nd period
    const badPayoutAllowedCall = await performanceFee.payoutAllowed(mockComptrollerProxy);
    expect(badPayoutAllowedCall).toBe(false);

    // Warp to the end of the period
    await provider.send('evm_increaseTime', [offset2]);
    await provider.send('evm_mine', []);

    // payoutAllowed should now return true
    const goodPayoutAllowedCall = await performanceFee.payoutAllowed(mockComptrollerProxy);
    expect(goodPayoutAllowedCall).toBe(true);
  });
});

describe('settle', () => {
  it('can only be called by the FeeManager', async () => {
    const { mockComptrollerProxy, mockVaultProxy, standalonePerformanceFee } = await provider.snapshot(snapshot);

    await expect(
      standalonePerformanceFee.settle(mockComptrollerProxy, mockVaultProxy, FeeHook.Continuous, '0x', 0),
    ).rejects.toBeRevertedWith('Only the FeeManger can make this call');
  });

  it('correctly handles valid call (no change in share price)', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    const feeHook = FeeHook.Continuous;
    const settlementData = constants.HashZero;

    // settle.call() to assert return values and get the sharesOutstanding
    const gav = (await mockComptrollerProxy.calcGav.args(true).call()).gav_;
    const settleCall = await performanceFee.settle
      .args(mockComptrollerProxy, mockVaultProxy, feeHook, settlementData, gav)
      .from(mockFeeManager)
      .call();

    expect(settleCall).toMatchFunctionOutput(performanceFee.settle, {
      settlementType_: FeeSettlementType.None,
      sharesDue_: BigNumber.from(0),
    });

    // Execute settle() tx
    const settleReceipt = await mockFeeManager.forward(
      performanceFee.settle,
      mockComptrollerProxy,
      mockVaultProxy,
      feeHook,
      settlementData,
      gav,
    );

    // Assert that no events were emitted
    assertNoEvent(settleReceipt, 'PerformanceUpdated');
  });

  it('correctly handles valid call (positive value change with no shares outstanding)', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    // Increase performance
    const { feeSettlementType } = await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('2'),
      performanceFee,
    });

    expect(feeSettlementType).toBe(FeeSettlementType.MintSharesOutstanding);
  });

  it('correctly handles valid call (positive value change with shares outstanding)', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    // Increase performance
    await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('2'),
      performanceFee,
    });

    // Increase performance further
    const { feeSettlementType } = await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('3'),
      performanceFee,
    });

    expect(feeSettlementType).toBe(FeeSettlementType.MintSharesOutstanding);
  });

  it('correctly handles valid call (negative value change less than shares outstanding)', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    // Increase performance
    await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('2'),
      performanceFee,
    });

    // Decrease performance, still above HWM
    const { feeSettlementType } = await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('1.5'),
      performanceFee,
    });

    expect(feeSettlementType).toBe(FeeSettlementType.BurnSharesOutstanding);
  });

  it('correctly handles valid call (negative value change greater than shares outstanding)', async () => {
    const {
      mockComptrollerProxy,
      mockFeeManager,
      mockVaultProxy,
      standalonePerformanceFee: performanceFee,
    } = await provider.snapshot(snapshot);

    await activateWithInitialValues({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      performanceFee,
    });

    // Increase performance
    await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('2'),
      performanceFee,
    });

    // Decrease performance, below HWM
    const { feeSettlementType } = await assertAdjustedPerformance({
      mockFeeManager,
      mockComptrollerProxy,
      mockVaultProxy,
      nextGav: utils.parseEther('0.5'),
      performanceFee,
    });

    expect(feeSettlementType).toBe(FeeSettlementType.BurnSharesOutstanding);

    // Outstanding shares should be back to 0
    await expect(mockVaultProxy.balanceOf(mockVaultProxy)).resolves.toEqBigNumber(0);
  });
});

describe('integration', () => {
  it('can create a new fund with this fee, works correctly while buying shares, and is paid out when allowed', async () => {
    const {
      accounts: [fundOwner, fundInvestor],
      deployment: {
        chainlinkAggregators,
        feeManager,
        trackedAssetsAdapter,
        integrationManager,
        performanceFee,
        fundDeployer,
        tokens: { weth: denominationAsset, risq: risq },
      },
    } = await provider.snapshot(snapshot);

    const performanceFeeRate = utils.parseEther('.1'); // 10%

    const performanceFeePeriod = BigNumber.from(60 * 60 * 24 * 365); // 365 days

    const performanceFeeConfigSettings = performanceFeeConfigArgs({
      rate: performanceFeeRate,
      period: performanceFeePeriod,
    });

    const feeManagerConfig = feeManagerConfigArgs({
      fees: [performanceFee],
      settings: [performanceFeeConfigSettings],
    });

    const { comptrollerProxy, vaultProxy } = await createNewFund({
      signer: fundOwner,
      fundDeployer,
      denominationAsset,
      fundOwner: fundOwner,
      fundName: 'TestFund',
      feeManagerConfig,
    });

    const feeInfo = await performanceFee.getFeeInfoForFund(comptrollerProxy.address);

    // check that the fee has been registered and the parameters are correct
    expect(feeInfo.rate).toEqBigNumber(performanceFeeRate);
    expect(feeInfo.period).toEqBigNumber(performanceFeePeriod);

    // check whether payout is allowed before the fee period has passed
    const falsePayoutCall = await performanceFee.payoutAllowed(comptrollerProxy);

    // time warp to end of fee period
    await provider.send('evm_increaseTime', [performanceFeePeriod.toNumber()]);
    await provider.send('evm_mine', []);

    // check whether payout is allowed at the end of the fee period
    const truePayoutCall = await performanceFee.payoutAllowed(comptrollerProxy);

    expect(falsePayoutCall).toBe(false);
    expect(truePayoutCall).toBe(true);

    // invest in the fund so there are shares
    const investmentAmount = utils.parseEther('1');
    await buyShares({
      comptrollerProxy,
      signer: fundOwner,
      buyers: [fundInvestor],
      denominationAsset,
      investmentAmounts: [investmentAmount],
      minSharesAmounts: [utils.parseEther('1')],
    });

    // add assets to fund
    const amount = utils.parseEther('75');
    await risq.transfer(vaultProxy, amount);

    // track them
    await addTrackedAssets({
      comptrollerProxy,
      integrationManager,
      fundOwner,
      trackedAssetsAdapter,
      incomingAssets: [risq],
    });

    // make sure you're past the next performanceFeePeriod
    await provider.send('evm_increaseTime', [performanceFeePeriod.toNumber()]);
    await provider.send('evm_mine', []);

    // count shares of fund
    const profitCaseSharesBeforeSettlement = await vaultProxy.totalSupply();

    // update price feed to accommodate time warp
    await updateChainlinkAggregator(chainlinkAggregators.risq);

    // settle fees
    await callOnExtension({
      signer: fundOwner,
      comptrollerProxy,
      extension: feeManager,
      actionId: FeeManagerActionId.InvokeContinuousHook,
    });

    // recount shares of the fund
    const profitCaseSharesAfterSettlement = await vaultProxy.totalSupply();

    // with gains, contract settles by minting new shares - shares after settlement should be > shares before
    expect(profitCaseSharesAfterSettlement).toBeGtBigNumber(profitCaseSharesBeforeSettlement);

    // fast forward to payout
    await provider.send('evm_increaseTime', [performanceFeePeriod.toNumber()]);
    await provider.send('evm_mine', []);

    // count shares of the fund
    const lossCaseSharesBeforeSettlement = await vaultProxy.totalSupply();

    // update price feed to accommodate time warp and tick down the price of RISQ to decrease GAV
    await updateChainlinkAggregator(chainlinkAggregators.risq, utils.parseEther('.75'));

    // buy shares to settle fees
    await buyShares({
      comptrollerProxy,
      signer: fundOwner,
      buyers: [fundInvestor],
      denominationAsset,
      investmentAmounts: [investmentAmount],
      minSharesAmounts: [utils.parseEther('.01')],
    });

    // count shares of fund
    const lossCaseSharesAfterSettlement = await vaultProxy.totalSupply();

    // with losses, fees are settled by burning shares, new total supply of shares after investment
    // should be less than lossCaseBefore plus investment amount
    expect(lossCaseSharesAfterSettlement).toBeLtBigNumber(lossCaseSharesBeforeSettlement.add(investmentAmount));
  });

  it('can create a migrated fund with this fee', async () => {
    const {
      accounts: [fundOwner],
      config: {
        deployer,
        integratees: {
          synthetix: { addressResolver: synthetixAddressResolverAddress },
        },
      },
      deployment: {
        chainlinkPriceFeed,
        dispatcher,
        feeManager,
        fundDeployer,
        integrationManager,
        policyManager,
        synthetixPriceFeed,
        valueInterpreter,
        vaultLib,
        performanceFee,
        tokens: { weth: denominationAsset },
      },
    } = await provider.snapshot(snapshot);

    const performanceFeeRate = utils.parseEther('.1'); // 10%

    const performanceFeePeriod = BigNumber.from(60 * 60 * 24 * 365); // 365 days

    const performanceFeeConfigSettings = performanceFeeConfigArgs({
      rate: performanceFeeRate,
      period: performanceFeePeriod,
    });

    const feeManagerConfig = feeManagerConfigArgs({
      fees: [performanceFee],
      settings: [performanceFeeConfigSettings],
    });

    const { vaultProxy } = await createNewFund({
      signer: fundOwner,
      fundDeployer,
      denominationAsset,
      fundOwner,
      fundName: 'TestFund',
      feeManagerConfig,
    });

    const nextFundDeployer = await createFundDeployer({
      deployer,
      chainlinkPriceFeed,
      dispatcher,
      feeManager,
      integrationManager,
      policyManager,
      synthetixPriceFeed,
      synthetixAddressResolverAddress,
      valueInterpreter,
      vaultLib,
    });

    const { comptrollerProxy: nextComptrollerProxy } = await createMigratedFundConfig({
      signer: fundOwner,
      fundDeployer: nextFundDeployer,
      denominationAsset,
      feeManagerConfigData: feeManagerConfig,
    });

    const signedNextFundDeployer = nextFundDeployer.connect(fundOwner);
    await signedNextFundDeployer.signalMigration(vaultProxy, nextComptrollerProxy);

    const migrationTimelock = await dispatcher.getMigrationTimelock();
    await provider.send('evm_increaseTime', [migrationTimelock.toNumber()]);

    await signedNextFundDeployer.executeMigration(vaultProxy);

    const feeInfo = await performanceFee.getFeeInfoForFund(nextComptrollerProxy);
    expect(feeInfo.rate).toEqBigNumber(performanceFeeRate);
    expect(feeInfo.period).toEqBigNumber(performanceFeePeriod);
  });
});
