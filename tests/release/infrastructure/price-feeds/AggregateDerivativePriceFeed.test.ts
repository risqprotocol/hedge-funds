import { EthereumTestnetProvider, extractEvent, randomAddress } from '@crestproject/crestproject';
import { IDerivativePriceFeed, MockToken } from '@risqprotocol/protocol';
import { defaultTestDeployment } from '@risqprotocol/testutils';
import { constants } from 'ethers';

async function snapshot(provider: EthereumTestnetProvider) {
  const { deployment, config } = await defaultTestDeployment(provider);

  const mockDerivative1 = await MockToken.deploy(config.deployer, 'Mock Derivative 1', 'MCKD001', 18);
  const mockDerivative2 = await MockToken.deploy(config.deployer, 'Mock Derivative 2', 'MCKD002', 18);

  const mockDerivativePriceFeed1 = await IDerivativePriceFeed.mock(config.deployer);
  await mockDerivativePriceFeed1.isSupportedAsset.returns(false);

  const mockDerivativePriceFeed2 = await IDerivativePriceFeed.mock(config.deployer);
  await mockDerivativePriceFeed2.isSupportedAsset.returns(false);

  return {
    deployment,
    mockDerivative1,
    mockDerivative2,
    mockDerivativePriceFeed1,
    mockDerivativePriceFeed2,
    config,
  };
}

describe('constructor', () => {
  it('sets initial storage vars', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed, chaiPriceFeed, compoundPriceFeed, uniswapV2PoolPriceFeed },
      config: {
        derivatives: { chai, compound, uniswapV2 },
      },
    } = await provider.snapshot(snapshot);

    // Check chai
    const storedPriceFeed = await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(chai);
    expect(storedPriceFeed).toMatchAddress(chaiPriceFeed);

    // Check compound
    const compoundTokens = Object.values(compound);
    for (const cToken of compoundTokens) {
      const storedPriceFeed = await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(cToken);
      expect(storedPriceFeed).toMatchAddress(compoundPriceFeed);
    }

    // Check uniswapV2
    const uniswapTokens = Object.values(uniswapV2);
    for (const lpToken of uniswapTokens) {
      const storedPriceFeed = await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(lpToken);
      expect(storedPriceFeed).toMatchAddress(uniswapV2PoolPriceFeed);
    }

    // TODO: add other derivatives
  });
});

describe('addDerivatives', () => {
  it('adds a set of new derivatives with price feeds', async () => {
    const {
      mockDerivative1,
      mockDerivative2,
      mockDerivativePriceFeed1,
      mockDerivativePriceFeed2,
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    // Define which asset each mock price feed supports
    await mockDerivativePriceFeed1.isSupportedAsset.given(mockDerivative1).returns(true);
    await mockDerivativePriceFeed2.isSupportedAsset.given(mockDerivative2).returns(true);

    // Add derivatives to the aggreagated price feed
    const addPriceFeedReceipt = await aggregatedDerivativePriceFeed.addDerivatives(
      [mockDerivative1, mockDerivative2],
      [mockDerivativePriceFeed1, mockDerivativePriceFeed2],
    );

    // Check correct stored price feed
    expect(await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(mockDerivative1)).toMatchAddress(
      mockDerivativePriceFeed1,
    );
    expect(await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(mockDerivative2)).toMatchAddress(
      mockDerivativePriceFeed2,
    );

    // Extract events from tx and check all of them were fired
    const events = extractEvent(addPriceFeedReceipt, 'DerivativeAdded');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchEventArgs({
      derivative: mockDerivative1,
      priceFeed: mockDerivativePriceFeed1,
    });
    expect(events[1]).toMatchEventArgs({
      derivative: mockDerivative2,
      priceFeed: mockDerivativePriceFeed2,
    });
  });

  it('does not support adding a non supportedAsset', async () => {
    const {
      mockDerivative1,
      mockDerivativePriceFeed1,
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    // It should not be possible now to add this derivative
    await expect(
      aggregatedDerivativePriceFeed.addDerivatives([mockDerivative1], [mockDerivativePriceFeed1]),
    ).rejects.toBeRevertedWith('Unsupported derivative');
  });

  it('does not allow adding an already added derivative', async () => {
    const {
      mockDerivative1,
      mockDerivativePriceFeed1,
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    // Define which asset the mock price feed supports
    await mockDerivativePriceFeed1.isSupportedAsset.given(mockDerivative1).returns(true);

    // Add a derivative to the aggregated feed
    await aggregatedDerivativePriceFeed.addDerivatives([mockDerivative1], [mockDerivativePriceFeed1]);

    // Attempting to add the same derivative should fail
    await expect(
      aggregatedDerivativePriceFeed.addDerivatives([mockDerivative1], [mockDerivativePriceFeed1]),
    ).rejects.toBeRevertedWith('Already added');
  });

  it('does not allow an empty list of derivatives', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    await expect(aggregatedDerivativePriceFeed.addDerivatives([], [randomAddress()])).rejects.toBeRevertedWith(
      '_derivatives cannot be empty',
    );
  });

  it('does not allow an empty derivative value', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    await expect(
      aggregatedDerivativePriceFeed.addDerivatives([constants.AddressZero], [randomAddress()]),
    ).rejects.toBeRevertedWith('Empty _derivative');
  });

  it('does not allow different argument length as an input', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    // Use arrays with length 1 and 2 to assert it reverts
    await expect(
      aggregatedDerivativePriceFeed.addDerivatives([randomAddress()], [randomAddress(), randomAddress()]),
    ).rejects.toBeRevertedWith('Unequal _derivatives and _priceFeeds array lengths');
  });
});

describe('updateDerivatives', () => {
  it('updates a set of derivatives to new price feeds', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
      mockDerivative1,
      mockDerivative2,
      mockDerivativePriceFeed1,
      mockDerivativePriceFeed2,
    } = await provider.snapshot(snapshot);

    // Add both derivatives to the aggregate feed using mockDerivativePriceFeed1
    await mockDerivativePriceFeed1.isSupportedAsset.given(mockDerivative1).returns(true);
    await mockDerivativePriceFeed1.isSupportedAsset.given(mockDerivative2).returns(true);
    await aggregatedDerivativePriceFeed.addDerivatives(
      [mockDerivative1, mockDerivative2],
      [mockDerivativePriceFeed1, mockDerivativePriceFeed1],
    );

    // Add both derivatives to mockDerivativePriceFeed2
    await mockDerivativePriceFeed2.isSupportedAsset.given(mockDerivative1).returns(true);
    await mockDerivativePriceFeed2.isSupportedAsset.given(mockDerivative2).returns(true);

    // Assign derivatives to mockDerivativePriceFeed2
    const updatePriceFeedReceipt = await aggregatedDerivativePriceFeed.updateDerivatives(
      [mockDerivative1, mockDerivative2],
      [mockDerivativePriceFeed2, mockDerivativePriceFeed2],
    );

    // Check the aggreagated price feed was properly updated
    expect(await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(mockDerivative1)).toMatchAddress(
      mockDerivativePriceFeed2,
    );
    expect(await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(mockDerivative2)).toMatchAddress(
      mockDerivativePriceFeed2,
    );

    // Check events were properly emitted
    const events = extractEvent(updatePriceFeedReceipt, 'DerivativeUpdated');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchEventArgs({
      derivative: mockDerivative1,
      prevPriceFeed: mockDerivativePriceFeed1,
      nextPriceFeed: mockDerivativePriceFeed2,
    });
    expect(events[1]).toMatchEventArgs({
      derivative: mockDerivative2,
      prevPriceFeed: mockDerivativePriceFeed1,
      nextPriceFeed: mockDerivativePriceFeed2,
    });
  });

  it('does not allow an empty array of derivatives', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    await expect(aggregatedDerivativePriceFeed.updateDerivatives([], [randomAddress()])).rejects.toBeRevertedWith(
      '_derivatives cannot be empty',
    );
  });

  it('does not allow different argument length as an input', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    // Call updateDerivatives with array lengths of 1 and 2
    await expect(
      aggregatedDerivativePriceFeed.updateDerivatives([randomAddress()], [randomAddress(), randomAddress()]),
    ).rejects.toBeRevertedWith('Unequal _derivatives and _priceFeeds array lengths');
  });

  it('does not allow a non added derivative address as an input', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    await expect(
      aggregatedDerivativePriceFeed.updateDerivatives([randomAddress()], [randomAddress()]),
    ).rejects.toBeRevertedWith('Derivative not yet added');
  });

  it('does not allow to update to an already set value', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
      mockDerivative1,
      mockDerivativePriceFeed1,
    } = await provider.snapshot(snapshot);

    // Add a derivative to the aggregate feed
    await mockDerivativePriceFeed1.isSupportedAsset.given(mockDerivative1).returns(true);
    await aggregatedDerivativePriceFeed.addDerivatives([mockDerivative1], [mockDerivativePriceFeed1]);

    // Attempting to update the derivative to the same derivative price feed should fail
    await expect(
      aggregatedDerivativePriceFeed.updateDerivatives([mockDerivative1], [mockDerivativePriceFeed1]),
    ).rejects.toBeRevertedWith('Value already set');
  });
});

describe('removeDerivatives', () => {
  it('removes a set of derivatives', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
      mockDerivative1,
      mockDerivative2,
      mockDerivativePriceFeed1,
    } = await provider.snapshot(snapshot);

    // Add both derivatives to the aggregate feed using mockDerivativePriceFeed1
    await mockDerivativePriceFeed1.isSupportedAsset.given(mockDerivative1).returns(true);
    await mockDerivativePriceFeed1.isSupportedAsset.given(mockDerivative2).returns(true);
    await aggregatedDerivativePriceFeed.addDerivatives(
      [mockDerivative1, mockDerivative2],
      [mockDerivativePriceFeed1, mockDerivativePriceFeed1],
    );

    // Add then remove the derivatives
    const removeDerivativeReceipt = await aggregatedDerivativePriceFeed.removeDerivatives([
      mockDerivative1,
      mockDerivative2,
    ]);

    // Check the derivatives are not registered anymore
    expect(await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(mockDerivative1)).toMatchAddress(
      constants.AddressZero,
    );
    expect(await aggregatedDerivativePriceFeed.getPriceFeedForDerivative(mockDerivative2)).toMatchAddress(
      constants.AddressZero,
    );

    // Check events where properly emitted
    const events = extractEvent(removeDerivativeReceipt, 'DerivativeRemoved');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchEventArgs({
      derivative: mockDerivative1,
    });
    expect(events[1]).toMatchEventArgs({
      derivative: mockDerivative2,
    });
  });

  it('does not allow to remove a derivative that has not been added before', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    await expect(aggregatedDerivativePriceFeed.removeDerivatives([randomAddress()])).rejects.toBeRevertedWith(
      'Derivative not yet added',
    );
  });

  it('does not allow an empty array of derivatives', async () => {
    const {
      deployment: { aggregatedDerivativePriceFeed },
    } = await provider.snapshot(snapshot);

    await expect(aggregatedDerivativePriceFeed.removeDerivatives([])).rejects.toBeRevertedWith(
      '_derivatives cannot be empty',
    );
  });
});
