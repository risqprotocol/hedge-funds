import { BigNumber, BigNumberish, constants, utils } from 'ethers';
import { EthereumTestnetProvider, randomAddress, SignerWithAddress } from '@crestproject/crestproject';
import {
  addTrackedAssets,
  assertEvent,
  defaultTestDeployment,
  createNewFund,
  getAssetBalances,
  mockGenericSwap,
  mockGenericSwapArgs,
  mockGenericSwapASelector,
  mockGenericSwapDirectFromVaultSelector,
} from '@risqprotocol/testutils';
import {
  callOnIntegrationArgs,
  ComptrollerLib,
  encodeArgs,
  IntegrationManager,
  IntegrationManagerActionId,
  MockGenericAdapter,
  PolicyHook,
  sighash,
  StandardToken,
  validateRulePostCoIArgs,
  validateRulePreCoIArgs,
  VaultLib,
} from '@risqprotocol/protocol';

async function snapshot(provider: EthereumTestnetProvider) {
  const {
    accounts: [fundOwner, ...remainingAccounts],
    deployment,
    config,
  } = await defaultTestDeployment(provider);

  const denominationAsset = deployment.tokens.weth;
  const { comptrollerProxy, vaultProxy } = await createNewFund({
    signer: config.deployer,
    fundOwner,
    fundDeployer: deployment.fundDeployer,
    denominationAsset,
  });

  return {
    accounts: remainingAccounts,
    deployment,
    config,
    fund: {
      comptrollerProxy,
      denominationAsset,
      fundOwner,
      vaultProxy,
    },
  };
}

async function seedFundByTrading({
  comptrollerProxy,
  vaultProxy,
  integrationManager,
  fundOwner,
  mockGenericAdapter,
  incomingAsset,
  incomingAssetAmount,
}: {
  comptrollerProxy: ComptrollerLib;
  vaultProxy: VaultLib;
  integrationManager: IntegrationManager;
  fundOwner: SignerWithAddress;
  mockGenericAdapter: MockGenericAdapter;
  incomingAsset: StandardToken;
  incomingAssetAmount: BigNumberish;
}) {
  const swapArgs = {
    spendAssets: [],
    actualSpendAssetAmounts: [],
    incomingAssets: [incomingAsset],
    minIncomingAssetAmounts: [BigNumber.from(1)],
    actualIncomingAssetAmounts: [incomingAssetAmount],
  };

  const receipt = await mockGenericSwap({
    comptrollerProxy,
    vaultProxy,
    integrationManager,
    fundOwner,
    mockGenericAdapter,
    seedFund: true,
    ...swapArgs,
  });

  const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

  const integrationData = mockGenericSwapArgs({ ...swapArgs });

  assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
    adapter: mockGenericAdapter,
    comptrollerProxy,
    caller: fundOwner,
    incomingAssets: [incomingAsset],
    incomingAssetAmounts: [incomingAssetAmount],
    outgoingAssets: [],
    outgoingAssetAmounts: [],
    selector: mockGenericSwapASelector,
    integrationData,
    vaultProxy,
  });
}

describe('callOnIntegration', () => {
  it('only allows authorized users', async () => {
    const {
      accounts: [newAuthUser],
      deployment: { mockGenericAdapter, integrationManager },
      fund: { comptrollerProxy, fundOwner },
    } = await provider.snapshot(snapshot);

    const swapArgs = mockGenericSwapArgs({});

    const callArgs = callOnIntegrationArgs({
      adapter: mockGenericAdapter,
      selector: mockGenericSwapASelector,
      encodedCallArgs: swapArgs,
    });

    // Call should be allowed by the fund owner
    await expect(
      comptrollerProxy
        .connect(fundOwner)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).resolves.toBeReceipt();

    // Call not allowed by the yet-to-be authorized user
    await expect(
      comptrollerProxy
        .connect(newAuthUser)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).rejects.toBeRevertedWith('Not an authorized user');

    // Set the new auth user
    await integrationManager.connect(fundOwner).addAuthUserForFund(comptrollerProxy, newAuthUser);

    // Call should be allowed for the authorized user
    await expect(
      comptrollerProxy
        .connect(newAuthUser)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).resolves.toBeReceipt();
  });

  it('does not allow an unregistered adapter', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        tokens: { weth: outgoingAsset, risq: incomingAsset },
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    await expect(integrationManager.deregisterAdapters([mockGenericAdapter])).resolves.toBeReceipt();

    await expect(
      mockGenericSwap({
        comptrollerProxy,
        vaultProxy,
        integrationManager,
        fundOwner,
        mockGenericAdapter,
        spendAssets: [outgoingAsset],
        actualSpendAssetAmounts: [0],
        incomingAssets: [incomingAsset],
        minIncomingAssetAmounts: [utils.parseEther('1')],
      }),
    ).rejects.toBeRevertedWith('Adapter is not registered');
  });

  it('does not allow spendAssets and actualSpendAssetAmounts arrays to have unequal lengths', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { risq: incomingAsset, weth, dai },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner },
    } = await provider.snapshot(snapshot);

    const swapArgs = mockGenericSwapArgs({
      spendAssets: [weth, dai],
      actualSpendAssetAmounts: [utils.parseEther('1')],
      incomingAssets: [incomingAsset],
      actualIncomingAssetAmounts: [utils.parseEther('1')],
    });

    const callArgs = callOnIntegrationArgs({
      adapter: mockGenericAdapter,
      selector: mockGenericSwapASelector,
      encodedCallArgs: swapArgs,
    });

    await expect(
      comptrollerProxy
        .connect(fundOwner)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).rejects.toBeRevertedWith('Spend assets arrays unequal');
  });

  it('does not allow incomingAssets and incomingAssetAmounts arrays to have unequal lengths', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { risq: outgoingAsset, weth, dai },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner },
    } = await provider.snapshot(snapshot);

    const swapArgs = mockGenericSwapArgs({
      spendAssets: [outgoingAsset],
      actualSpendAssetAmounts: [utils.parseEther('1')],
      incomingAssets: [weth, dai],
      actualIncomingAssetAmounts: [utils.parseEther('1')],
    });

    const callArgs = callOnIntegrationArgs({
      adapter: mockGenericAdapter,
      selector: mockGenericSwapASelector,
      encodedCallArgs: swapArgs,
    });

    await expect(
      comptrollerProxy
        .connect(fundOwner)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).rejects.toBeRevertedWith('Incoming assets arrays unequal');
  });

  it('does not allow duplicate spend assets', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { risq: outgoingAsset, weth: incomingAsset },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner },
    } = await provider.snapshot(snapshot);

    const swapArgs = mockGenericSwapArgs({
      spendAssets: [outgoingAsset, outgoingAsset],
      actualSpendAssetAmounts: Array(2).fill(utils.parseEther('1')),
      incomingAssets: [incomingAsset],
      actualIncomingAssetAmounts: [utils.parseEther('1')],
    });

    const callArgs = callOnIntegrationArgs({
      adapter: mockGenericAdapter,
      selector: mockGenericSwapASelector,
      encodedCallArgs: swapArgs,
    });

    await expect(
      comptrollerProxy
        .connect(fundOwner)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).rejects.toBeRevertedWith('Duplicate spend asset');
  });

  it('does not allow duplicate incoming assets', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { risq: outgoingAsset, weth: incomingAsset },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner },
    } = await provider.snapshot(snapshot);

    const swapArgs = mockGenericSwapArgs({
      spendAssets: [outgoingAsset],
      actualSpendAssetAmounts: [utils.parseEther('1')],
      incomingAssets: [incomingAsset, incomingAsset],
      actualIncomingAssetAmounts: Array(2).fill(utils.parseEther('1')),
    });

    const callArgs = callOnIntegrationArgs({
      adapter: mockGenericAdapter,
      selector: mockGenericSwapASelector,
      encodedCallArgs: swapArgs,
    });

    await expect(
      comptrollerProxy
        .connect(fundOwner)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).rejects.toBeRevertedWith('Duplicate incoming asset');
  });

  it('does not allow a non-receivable incoming asset', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { weth: outgoingAsset },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const nonReceivableToken = new StandardToken(randomAddress(), provider);
    await expect(
      mockGenericSwap({
        comptrollerProxy,
        vaultProxy,
        integrationManager,
        fundOwner,
        mockGenericAdapter,
        spendAssets: [outgoingAsset],
        actualSpendAssetAmounts: [utils.parseEther('1')],
        incomingAssets: [nonReceivableToken],
        minIncomingAssetAmounts: [utils.parseEther('1')],
      }),
    ).rejects.toBeRevertedWith('Non-receivable incoming asset');
  });

  it('does not allow spendAsset spent to be greater than expected', async () => {
    const {
      deployment: {
        integrationManager,
        fundDeployer,
        mockGenericAdapter,
        mockGenericIntegratee,
        tokens: { weth: outgoingAsset },
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const maxSpendAssetAmount = utils.parseEther('1');
    const actualSpendAssetAmount = maxSpendAssetAmount.add(1);

    // Seed fund with actualSpendAssetAmount
    await outgoingAsset.transfer(vaultProxy, actualSpendAssetAmount);

    // Approve the adapter's integratee to directly use a VaultProxy's balance of the spendAsset,
    // by registering the token's approve() function for use in vaultCallOnContract()
    const approveSelector = sighash(outgoingAsset.approve.fragment);
    await fundDeployer.registerVaultCalls([outgoingAsset], [approveSelector]);
    await comptrollerProxy
      .connect(fundOwner)
      .vaultCallOnContract(
        outgoingAsset,
        approveSelector,
        encodeArgs(['address', 'uint256'], [mockGenericIntegratee, actualSpendAssetAmount]),
      );

    await expect(
      mockGenericSwap({
        comptrollerProxy,
        vaultProxy,
        integrationManager,
        fundOwner,
        mockGenericAdapter,
        selector: mockGenericSwapDirectFromVaultSelector,
        spendAssets: [outgoingAsset],
        maxSpendAssetAmounts: [maxSpendAssetAmount],
        actualSpendAssetAmounts: [actualSpendAssetAmount],
      }),
    ).rejects.toBeRevertedWith('Spent amount greater than expected');
  });

  it('does not allow incomingAsset received to be less than expected', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { weth: outgoingAsset, risq: incomingAsset },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    await expect(
      mockGenericSwap({
        comptrollerProxy,
        vaultProxy,
        integrationManager,
        fundOwner,
        mockGenericAdapter,
        spendAssets: [outgoingAsset],
        actualSpendAssetAmounts: [utils.parseEther('1')],
        incomingAssets: [incomingAsset],
        minIncomingAssetAmounts: [utils.parseEther('2')],
        actualIncomingAssetAmounts: [utils.parseEther('1')],
        seedFund: true,
      }),
    ).rejects.toBeRevertedWith('Received incoming asset less than expected');
  });

  it('does not allow empty spend asset address', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { risq: incomingAsset },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner },
    } = await provider.snapshot(snapshot);

    const swapArgs = mockGenericSwapArgs({
      spendAssets: [constants.AddressZero],
      actualSpendAssetAmounts: [utils.parseEther('1')],
      incomingAssets: [incomingAsset],
      actualIncomingAssetAmounts: [utils.parseEther('1')],
    });

    const callArgs = callOnIntegrationArgs({
      adapter: mockGenericAdapter,
      selector: mockGenericSwapASelector,
      encodedCallArgs: swapArgs,
    });

    await expect(
      comptrollerProxy
        .connect(fundOwner)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).rejects.toBeRevertedWith('Empty spend asset');
  });

  it('does not allow empty incoming asset address', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { risq: outgoingAsset },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner },
    } = await provider.snapshot(snapshot);

    const swapArgs = mockGenericSwapArgs({
      spendAssets: [outgoingAsset],
      actualSpendAssetAmounts: [utils.parseEther('1')],
      incomingAssets: [constants.AddressZero],
      actualIncomingAssetAmounts: [utils.parseEther('1')],
    });

    const callArgs = callOnIntegrationArgs({
      adapter: mockGenericAdapter,
      selector: mockGenericSwapASelector,
      encodedCallArgs: swapArgs,
    });

    await expect(
      comptrollerProxy
        .connect(fundOwner)
        .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs),
    ).rejects.toBeRevertedWith('Empty incoming asset address');
  });

  it('does not allow empty spend asset amount', async () => {
    const {
      deployment: {
        mockGenericAdapter,
        tokens: { weth: outgoingAsset, risq: incomingAsset },
        integrationManager,
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    await expect(
      mockGenericSwap({
        comptrollerProxy,
        vaultProxy,
        integrationManager,
        fundOwner,
        mockGenericAdapter,
        spendAssets: [outgoingAsset],
        actualSpendAssetAmounts: [0],
        incomingAssets: [incomingAsset],
        minIncomingAssetAmounts: [utils.parseEther('1')],
      }),
    ).rejects.toBeRevertedWith('Empty max spend asset amount');
  });

  it.todo('does not allow a spendAsset that fails to reach settlement finality (e.g., an unsettleable Synth)');
});

describe('valid calls', () => {
  it('handles multiple incoming assets and multiple spend assets', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        policyManager,
        tokens: { dai, knc, risq, weth },
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const spendAssets = [dai, knc];
    const actualSpendAssetAmounts = Array(2).fill(utils.parseEther('1'));
    const incomingAssets = [risq, weth];
    const actualIncomingAssetAmounts = [utils.parseEther('1'), utils.parseEther('2')];
    const minIncomingAssetAmounts = Array(2).fill(utils.parseEther('1'));

    const swapArgs = {
      spendAssets,
      actualSpendAssetAmounts,
      incomingAssets,
      minIncomingAssetAmounts,
      actualIncomingAssetAmounts,
    };

    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      seedFund: true,
      ...swapArgs,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    const integrationData = mockGenericSwapArgs({ ...swapArgs });

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      adapter: mockGenericAdapter,
      comptrollerProxy,
      caller: fundOwner,
      incomingAssets,
      incomingAssetAmounts: actualIncomingAssetAmounts,
      outgoingAssets: spendAssets,
      outgoingAssetAmounts: actualSpendAssetAmounts,
      selector: mockGenericSwapASelector,
      integrationData,
      vaultProxy,
    });

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets,
        incomingAssetAmounts: actualIncomingAssetAmounts,
        outgoingAssets: spendAssets,
        outgoingAssetAmounts: actualSpendAssetAmounts,
      }),
    );

    const spendAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: spendAssets,
    });
    expect(spendAssetBalancesCall).toEqual([utils.parseEther('0'), utils.parseEther('0')]);

    const incomingAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: incomingAssets,
    });
    expect(incomingAssetBalancesCall).toEqual(actualIncomingAssetAmounts);
  });

  it('handles untracked incoming asset with a non-zero starting balance', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        policyManager,
        tokens: { knc },
      },
      fund: { comptrollerProxy, denominationAsset, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    // seed fund with incomingAsset
    const seedFundAmount = utils.parseEther('1');
    await knc.transfer(vaultProxy, seedFundAmount);

    const spendAssets: [] = [];
    const actualSpendAssetAmounts: [] = [];
    const incomingAssets = [knc];
    const actualIncomingAssetAmounts = [utils.parseEther('2')];
    const minIncomingAssetAmounts = [utils.parseEther('1')];
    const expectedIncomingAssetAmount = actualIncomingAssetAmounts[0].add(seedFundAmount);

    const preTxGetTrackedAssetsCall = await vaultProxy.getTrackedAssets();
    expect(preTxGetTrackedAssetsCall).toEqual([denominationAsset.address]);

    const swapArgs = { incomingAssets, minIncomingAssetAmounts, actualIncomingAssetAmounts };

    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      ...swapArgs,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    const integrationData = mockGenericSwapArgs({ ...swapArgs });

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      adapter: mockGenericAdapter,
      comptrollerProxy,
      caller: fundOwner,
      incomingAssets: incomingAssets,
      incomingAssetAmounts: [expectedIncomingAssetAmount],
      outgoingAssets: spendAssets,
      outgoingAssetAmounts: actualSpendAssetAmounts,
      selector: mockGenericSwapASelector,
      integrationData,
      vaultProxy,
    });

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets: incomingAssets,
        incomingAssetAmounts: [expectedIncomingAssetAmount],
        outgoingAssets: spendAssets,
        outgoingAssetAmounts: actualSpendAssetAmounts,
      }),
    );

    const incomingAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: incomingAssets,
    });
    expect(incomingAssetBalancesCall).toEqual([expectedIncomingAssetAmount]);
    const postTxGetTrackedAssetsCall = await vaultProxy.getTrackedAssets();
    expect(postTxGetTrackedAssetsCall).toEqual([
      denominationAsset.address,
      ...incomingAssets.map((token) => token.address),
    ]);
  });

  it('handles untracked incoming asset with a zero starting balance', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        policyManager,
        tokens: { knc },
      },
      fund: { comptrollerProxy, denominationAsset, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const spendAssets: [] = [];
    const actualSpendAssetAmounts: [] = [];
    const incomingAssets = [knc];
    const actualIncomingAssetAmounts = [utils.parseEther('2')];
    const minIncomingAssetAmounts = [utils.parseEther('1')];

    const preTxGetTrackedAssetsCall = await vaultProxy.getTrackedAssets();
    expect(preTxGetTrackedAssetsCall).toEqual([denominationAsset.address]);

    const swapArgs = { incomingAssets, minIncomingAssetAmounts, actualIncomingAssetAmounts };

    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      ...swapArgs,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    const integrationData = mockGenericSwapArgs({ ...swapArgs });

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      adapter: mockGenericAdapter,
      comptrollerProxy,
      caller: fundOwner,
      incomingAssets,
      incomingAssetAmounts: actualIncomingAssetAmounts,
      outgoingAssets: spendAssets,
      outgoingAssetAmounts: actualSpendAssetAmounts,
      selector: mockGenericSwapASelector,
      integrationData,
      vaultProxy,
    });

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets,
        incomingAssetAmounts: actualIncomingAssetAmounts,
        outgoingAssets: spendAssets,
        outgoingAssetAmounts: actualSpendAssetAmounts,
      }),
    );

    const incomingAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: incomingAssets,
    });
    expect(incomingAssetBalancesCall).toEqual(actualIncomingAssetAmounts);
    const postTxGetTrackedAssetsCall = await vaultProxy.getTrackedAssets();
    expect(postTxGetTrackedAssetsCall).toEqual([
      denominationAsset.address,
      ...incomingAssets.map((token) => token.address),
    ]);
  });

  it('handles a spend asset that is also an incoming asset and increases', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        policyManager,
        tokens: { risq },
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const spendAssets = [risq];
    const actualSpendAssetAmounts = [utils.parseEther('1')];
    const incomingAssets = [risq];
    const actualIncomingAssetAmounts = [utils.parseEther('2')];
    const minIncomingAssetAmounts = [utils.parseEther('1')];

    const swapArgs = {
      spendAssets,
      actualSpendAssetAmounts,
      incomingAssets,
      minIncomingAssetAmounts,
      actualIncomingAssetAmounts,
    };

    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      seedFund: true,
      ...swapArgs,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    const integrationData = mockGenericSwapArgs({ ...swapArgs });

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      adapter: mockGenericAdapter,
      comptrollerProxy,
      caller: fundOwner,
      incomingAssets,
      incomingAssetAmounts: actualIncomingAssetAmounts,
      outgoingAssets: [],
      outgoingAssetAmounts: [],
      selector: mockGenericSwapASelector,
      integrationData,
      vaultProxy,
    });

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets,
        incomingAssetAmounts: actualIncomingAssetAmounts,
        outgoingAssets: [],
        outgoingAssetAmounts: [],
      }),
    );

    const spendAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: spendAssets,
    });
    expect(spendAssetBalancesCall).toEqual(actualIncomingAssetAmounts);
  });

  it('handles a spend asset that is also an incoming asset and decreases', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        policyManager,
        tokens: { risq },
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    // seed fund
    const amount = utils.parseEther('75');
    await risq.transfer(vaultProxy, amount);

    const spendAssets = [risq];
    const actualSpendAssetAmounts = [utils.parseEther('50')];
    const incomingAssets = [risq];
    const actualIncomingAssetAmounts = [utils.parseEther('1')];
    const expectedSpendAssetBalance = amount.sub(actualSpendAssetAmounts[0]).add(actualIncomingAssetAmounts[0]);

    const swapArgs = { spendAssets, actualSpendAssetAmounts, incomingAssets, actualIncomingAssetAmounts };

    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      ...swapArgs,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    const integrationData = mockGenericSwapArgs({ ...swapArgs });

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      adapter: mockGenericAdapter,
      comptrollerProxy,
      caller: fundOwner,
      incomingAssets,
      incomingAssetAmounts: [expectedSpendAssetBalance],
      outgoingAssets: [],
      outgoingAssetAmounts: [],
      selector: mockGenericSwapASelector,
      integrationData,
      vaultProxy,
    });

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets: incomingAssets,
        incomingAssetAmounts: [expectedSpendAssetBalance],
        outgoingAssets: [],
        outgoingAssetAmounts: [],
      }),
    );

    const incomingAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: incomingAssets,
    });
    expect(incomingAssetBalancesCall).toEqual([expectedSpendAssetBalance]);
  });

  it('handles a spend asset that is not an incoming asset and increases', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        policyManager,
        tokens: { risq },
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const spendAssetAmountOnAdapter = BigNumber.from(5);
    await risq.transfer(mockGenericAdapter, spendAssetAmountOnAdapter);

    const spendAssets = [risq];
    const actualSpendAssetAmounts = [BigNumber.from(1)];

    const swapArgs = {
      spendAssets,
      actualSpendAssetAmounts,
    };

    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      seedFund: true,
      ...swapArgs,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    const integrationData = mockGenericSwapArgs({ ...swapArgs });

    // Actual incoming asset info, accounting for token balance on adapter
    const actualIncomingAssets = spendAssets;
    const actualIncomingAssetAmounts = [spendAssetAmountOnAdapter.sub(actualSpendAssetAmounts[0])];

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      adapter: mockGenericAdapter,
      comptrollerProxy: comptrollerProxy,
      caller: fundOwner,
      incomingAssets: actualIncomingAssets,
      incomingAssetAmounts: actualIncomingAssetAmounts,
      outgoingAssets: [],
      outgoingAssetAmounts: [],
      selector: mockGenericSwapASelector,
      integrationData,
      vaultProxy,
    });

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets: actualIncomingAssets,
        incomingAssetAmounts: actualIncomingAssetAmounts,
        outgoingAssets: [],
        outgoingAssetAmounts: [],
      }),
    );

    const spendAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: spendAssets,
    });
    expect(spendAssetBalancesCall).toEqual([spendAssetAmountOnAdapter]);
  });

  it('handles a spend asset that is entirely transferred to the adapter, but partially used', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        policyManager,
        trackedAssetsAdapter,
        tokens: { risq: spendAsset },
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const spendAssetAmount = utils.parseEther('1');
    const spendAssetRebate = utils.parseEther('0.1');

    // Seed and track the spend asset in the VaultProxy
    spendAsset.transfer(vaultProxy, spendAssetAmount);
    await addTrackedAssets({
      comptrollerProxy,
      integrationManager,
      fundOwner,
      trackedAssetsAdapter,
      incomingAssets: [spendAsset],
    });

    // Seed the adapter with the spend asset amount to refund
    await spendAsset.transfer(mockGenericAdapter, spendAssetRebate);

    // Define spend assets and actual incoming assets
    const spendAssets = [spendAsset];
    const actualSpendAssetAmounts = [spendAssetAmount];
    const outgoingAssets = spendAssets;
    const outgoingAssetAmounts = [spendAssetAmount.sub(spendAssetRebate)];

    // Swap the spend assets and receive the rebate
    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      spendAssets,
      actualSpendAssetAmounts,
    });

    // Assert that the rebated amount was received and that the spend asset is still tracked
    expect(await spendAsset.balanceOf(vaultProxy)).toEqual(spendAssetRebate);
    expect(await vaultProxy.isTrackedAsset(spendAsset)).toBe(true);

    // Assert event emitted correctly
    assertEvent(receipt, integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund'), {
      adapter: mockGenericAdapter,
      comptrollerProxy: comptrollerProxy,
      caller: fundOwner,
      incomingAssets: [],
      incomingAssetAmounts: [],
      outgoingAssets,
      outgoingAssetAmounts,
      selector: mockGenericSwapASelector,
      integrationData: mockGenericSwapArgs({
        spendAssets,
        actualSpendAssetAmounts,
      }),
      vaultProxy,
    });

    // Assert expected calls to PolicyManager
    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets: [],
        incomingAssetAmounts: [],
        outgoingAssets,
        outgoingAssetAmounts,
      }),
    );
  });

  it('handles empty spend assets and incoming assets', async () => {
    const {
      deployment: { integrationManager, mockGenericAdapter, policyManager },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const spendAssets: [] = [];
    const actualSpendAssetAmounts: [] = [];
    const incomingAssets: [] = [];
    const actualIncomingAssetAmounts: [] = [];

    const swapArgs = { spendAssets, actualSpendAssetAmounts, incomingAssets, actualIncomingAssetAmounts };

    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      ...swapArgs,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    const integrationData = mockGenericSwapArgs({ ...swapArgs });

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      adapter: mockGenericAdapter,
      comptrollerProxy,
      caller: fundOwner,
      incomingAssets,
      incomingAssetAmounts: actualIncomingAssetAmounts,
      outgoingAssets: spendAssets,
      outgoingAssetAmounts: actualSpendAssetAmounts,
      selector: mockGenericSwapASelector,
      integrationData,
      vaultProxy,
    });

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets,
        incomingAssetAmounts: actualIncomingAssetAmounts,
        outgoingAssets: spendAssets,
        outgoingAssetAmounts: actualSpendAssetAmounts,
      }),
    );
  });

  it('handles a spend asset that is completely spent', async () => {
    const {
      deployment: {
        integrationManager,
        mockGenericAdapter,
        policyManager,
        tokens: { risq },
      },
      fund: { comptrollerProxy, denominationAsset, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    await seedFundByTrading({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      incomingAsset: risq,
      incomingAssetAmount: utils.parseEther('1'),
    });

    const spendAssets = [risq];
    const actualSpendAssetAmounts = [utils.parseEther('1')];
    const incomingAssets = [denominationAsset];
    const actualIncomingAssetAmounts = [utils.parseEther('1')];

    const swapArgs = {
      spendAssets,
      actualSpendAssetAmounts,
      incomingAssets,
      actualIncomingAssetAmounts,
    };

    const receipt = await mockGenericSwap({
      comptrollerProxy,
      vaultProxy,
      integrationManager,
      fundOwner,
      mockGenericAdapter,
      ...swapArgs,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    const integrationData = mockGenericSwapArgs({ ...swapArgs });

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      adapter: mockGenericAdapter,
      comptrollerProxy,
      caller: fundOwner,
      incomingAssets,
      incomingAssetAmounts: actualIncomingAssetAmounts,
      outgoingAssets: spendAssets,
      outgoingAssetAmounts: actualSpendAssetAmounts,
      selector: mockGenericSwapASelector,
      integrationData,
      vaultProxy,
    });

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PreCallOnIntegration,
      validateRulePreCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
      }),
    );

    expect(policyManager.validatePolicies).toHaveBeenCalledOnContractWith(
      comptrollerProxy,
      PolicyHook.PostCallOnIntegration,
      validateRulePostCoIArgs({
        adapter: mockGenericAdapter,
        selector: mockGenericSwapASelector,
        incomingAssets,
        incomingAssetAmounts: actualIncomingAssetAmounts,
        outgoingAssets: spendAssets,
        outgoingAssetAmounts: actualSpendAssetAmounts,
      }),
    );

    const spendAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: spendAssets,
    });

    expect(spendAssetBalancesCall).toEqual([utils.parseEther('0')]);
    const incomingAssetBalancesCall = await getAssetBalances({
      account: vaultProxy,
      assets: incomingAssets,
    });
    expect(incomingAssetBalancesCall).toEqual(actualIncomingAssetAmounts);
    const postTxGetTrackedAssetsCall = await vaultProxy.getTrackedAssets();
    expect(postTxGetTrackedAssetsCall).toEqual([denominationAsset.address]);
  });

  it.todo(
    'attempts to reach finality for an incomingAsset, but does not fail if it cannot settle (e.g., an unsettleable Synth)',
  );
});

describe('SpendAssetsHandleType', () => {
  it.todo('does not approve or transfer a spend asset if type is `None`');

  it.todo('approves adapter with spend asset allowance if type is `Approve`');

  it.todo('transfers spend asset to adapter if type is `Transfer`');
});
