import { BigNumber, utils } from 'ethers';
import { EthereumTestnetProvider, randomAddress } from '@crestproject/crestproject';
import { defaultTestDeployment, assertEvent, addTrackedAssets, createNewFund } from '@risqprotocol/testutils';
import { addTrackedAssetsArgs, addTrackedAssetsSelector, SpendAssetsHandleType } from '@risqprotocol/protocol';

async function snapshot(provider: EthereumTestnetProvider) {
  const {
    accounts: [fundOwner, ...remainingAccounts],
    deployment,
    config,
  } = await defaultTestDeployment(provider);

  const { comptrollerProxy, vaultProxy } = await createNewFund({
    signer: config.deployer,
    fundOwner,
    fundDeployer: deployment.fundDeployer,
    denominationAsset: deployment.tokens.weth,
  });

  return {
    accounts: remainingAccounts,
    deployment,
    config,
    fund: {
      comptrollerProxy,
      fundOwner,
      vaultProxy,
    },
  };
}

describe('constructor', () => {
  it('sets state vars', async () => {
    const {
      deployment: { integrationManager, trackedAssetsAdapter },
    } = await provider.snapshot(snapshot);

    const getIntegrationManagerCall = await trackedAssetsAdapter.getIntegrationManager();
    expect(getIntegrationManagerCall).toMatchAddress(integrationManager);
  });
});

describe('parseAssetsForMethod', () => {
  it('does not allow a bad selector', async () => {
    const {
      deployment: { trackedAssetsAdapter },
    } = await provider.snapshot(snapshot);

    const args = addTrackedAssetsArgs([randomAddress()]);
    await expect(trackedAssetsAdapter.parseAssetsForMethod(utils.randomBytes(4), args)).rejects.toBeRevertedWith(
      '_selector invalid',
    );

    await expect(trackedAssetsAdapter.parseAssetsForMethod(addTrackedAssetsSelector, args)).resolves.toBeTruthy();
  });

  it('generates expected output', async () => {
    const {
      deployment: { trackedAssetsAdapter },
    } = await provider.snapshot(snapshot);

    const incomingAsset = randomAddress();
    const args = addTrackedAssetsArgs([incomingAsset]);

    const {
      spendAssetsHandleType_,
      incomingAssets_,
      spendAssets_,
      spendAssetAmounts_,
      minIncomingAssetAmounts_,
    } = await trackedAssetsAdapter.parseAssetsForMethod(addTrackedAssetsSelector, args);

    expect({
      spendAssetsHandleType_,
      incomingAssets_,
      spendAssets_,
      spendAssetAmounts_,
      minIncomingAssetAmounts_,
    }).toMatchObject({
      spendAssetsHandleType_: SpendAssetsHandleType.None,
      incomingAssets_: [incomingAsset],
      spendAssets_: [],
      spendAssetAmounts_: [],
      minIncomingAssetAmounts_: [BigNumber.from(1)],
    });
  });
});

describe('addTrackedAssets', () => {
  it('addTrackedAssets successfully', async () => {
    const {
      deployment: {
        trackedAssetsAdapter,
        integrationManager,
        tokens: { risq, dai },
      },
      fund: { comptrollerProxy, fundOwner, vaultProxy },
    } = await provider.snapshot(snapshot);

    const incomingAssets = [risq, dai];

    const risqAmount = utils.parseEther('1');
    const daiAmount = utils.parseEther('1');
    await risq.transfer(vaultProxy, risqAmount);
    await dai.transfer(vaultProxy, daiAmount);

    const receipt = await addTrackedAssets({
      comptrollerProxy,
      integrationManager,
      fundOwner,
      trackedAssetsAdapter,
      incomingAssets,
    });

    const CallOnIntegrationExecutedForFundEvent = integrationManager.abi.getEvent('CallOnIntegrationExecutedForFund');

    assertEvent(receipt, CallOnIntegrationExecutedForFundEvent, {
      comptrollerProxy,
      vaultProxy,
      caller: fundOwner,
      adapter: trackedAssetsAdapter,
      selector: addTrackedAssetsSelector,
      incomingAssets: [risq, dai],
      incomingAssetAmounts: [risqAmount, daiAmount],
      outgoingAssets: [],
      outgoingAssetAmounts: [],
      integrationData: expect.anything(),
    });

    const trackedAssets = await vaultProxy.getTrackedAssets();
    expect(trackedAssets.includes(risq.address)).toBe(true);
    expect(trackedAssets.includes(dai.address)).toBe(true);
    expect(await vaultProxy.isTrackedAsset(risq)).toBe(true);
    expect(await vaultProxy.isTrackedAsset(dai)).toBe(true);
  });
});
