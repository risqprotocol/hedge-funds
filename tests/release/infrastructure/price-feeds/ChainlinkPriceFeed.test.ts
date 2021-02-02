import { EthereumTestnetProvider, extractEvent, randomAddress, resolveAddress } from '@crestproject/crestproject';
import { MockChainlinkPriceSource, MockToken, ChainlinkRateAsset } from '@risqprotocol/protocol';
import { assertEvent, defaultTestDeployment } from '@risqprotocol/testutils';
import { constants, utils } from 'ethers';

async function snapshot(provider: EthereumTestnetProvider) {
  const { accounts, deployment, config } = await defaultTestDeployment(provider);

  const primitiveMocks = await Promise.all([
    MockToken.deploy(config.deployer, 'Mock Token 1', 'MCK001', 18),
    MockToken.deploy(config.deployer, 'Mock Token 2', 'MCK001', 18),
  ]);

  const aggregatorMocks = await Promise.all([
    MockChainlinkPriceSource.deploy(config.deployer, 18),
    MockChainlinkPriceSource.deploy(config.deployer, 18),
  ]);

  const rateAssets = [0, 0];

  return {
    accounts,
    deployment,
    mocks: { aggregatorMocks, primitiveMocks, rateAssets },
    config,
  };
}

describe('constructor', () => {
  it('sets state vars', async () => {
    const {
      config: {
        dispatcher,
        weth,
        chainlink: { ethUsdAggregator, primitives, aggregators, rateAssets },
      },
      deployment: { chainlinkPriceFeed },
    } = await provider.snapshot(snapshot);

    const storedDispatcher = await chainlinkPriceFeed.getDispatcher();
    const storedWeth = await chainlinkPriceFeed.getWethToken();
    const storedEthUsdAggregator = await chainlinkPriceFeed.getEthUsdAggregator();

    // Check variables
    expect(storedDispatcher).toMatchAddress(dispatcher);
    expect(storedWeth).toMatchAddress(weth);
    expect(storedEthUsdAggregator).toMatchAddress(ethUsdAggregator);

    // Check static weth values
    expect(await chainlinkPriceFeed.getRateAssetForPrimitive(weth)).toEqBigNumber(ChainlinkRateAsset.ETH);
    expect(await chainlinkPriceFeed.getUnitForPrimitive(weth)).toEqBigNumber(utils.parseEther('1'));

    // Check primitives setup
    for (let i = 0; i < primitives.length; i++) {
      const storedPrimitive = await chainlinkPriceFeed.getAggregatorInfoForPrimitive(primitives[i]);
      expect(storedPrimitive).toMatchFunctionOutput(chainlinkPriceFeed.getAggregatorInfoForPrimitive, {
        aggregator: aggregators[i],
        rateAsset: rateAssets[i],
      });
    }
  });
});

describe('addPrimitives', () => {
  it('adds multiple primitives and emit events', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks, primitiveMocks, rateAssets },
    } = await provider.snapshot(snapshot);

    // Add primitives
    const addPrimitivesReceipt = await chainlinkPriceFeed.addPrimitives(primitiveMocks, aggregatorMocks, rateAssets);

    // Extract events
    const events = extractEvent(addPrimitivesReceipt, 'PrimitiveAdded');
    expect(events).toHaveLength(primitiveMocks.length);

    // Check primitives added and events emited
    for (let i = 0; i < primitiveMocks.length; i++) {
      const info = await chainlinkPriceFeed.getAggregatorInfoForPrimitive(primitiveMocks[i]);
      expect(info).toMatchFunctionOutput(chainlinkPriceFeed.getAggregatorInfoForPrimitive, {
        aggregator: aggregatorMocks[i],
        rateAsset: rateAssets[i],
      });
      expect(await chainlinkPriceFeed.getRateAssetForPrimitive(primitiveMocks[i])).toEqBigNumber(rateAssets[i]);

      const primitiveUnit = utils.parseUnits('1', await primitiveMocks[i].decimals());
      expect(await chainlinkPriceFeed.getUnitForPrimitive(primitiveMocks[i])).toEqBigNumber(primitiveUnit);

      expect(events[i]).toMatchEventArgs({
        primitive: primitiveMocks[i],
        aggregator: aggregatorMocks[i],
        rateAsset: rateAssets[i],
        unit: primitiveUnit,
      });
    }
  });

  it('reverts when the aggregator is empty', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { primitiveMocks },
    } = await provider.snapshot(snapshot);

    // Set the aggregator address to zero
    const aggregatorAddress = constants.AddressZero;

    await expect(
      chainlinkPriceFeed.addPrimitives([primitiveMocks[0]], [aggregatorAddress], [0]),
    ).rejects.toBeRevertedWith('Empty _aggregator');
  });

  it('reverts when primitives are empty', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks },
    } = await provider.snapshot(snapshot);

    await expect(chainlinkPriceFeed.addPrimitives([], [aggregatorMocks[0]], [0])).rejects.toBeRevertedWith(
      '_primitives cannot be empty',
    );
  });

  it('reverts when params array length differs', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks },
    } = await provider.snapshot(snapshot);

    // Check they revert
    await expect(
      chainlinkPriceFeed.addPrimitives([randomAddress()], [aggregatorMocks[0], aggregatorMocks[1]], [0]),
    ).rejects.toBeRevertedWith('Unequal _primitives and _aggregators array lengths');
    await expect(
      chainlinkPriceFeed.addPrimitives([randomAddress()], [aggregatorMocks[0]], [0, 0]),
    ).rejects.toBeRevertedWith('Unequal _primitives and _rateAssets array lengths');
  });

  it('reverts when the primitive is already set', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks, primitiveMocks, rateAssets },
    } = await provider.snapshot(snapshot);

    // Add the primitive mocks
    await chainlinkPriceFeed.addPrimitives(primitiveMocks, aggregatorMocks, rateAssets);

    // Attempting to re-add the primitive mocks should fail
    await expect(
      chainlinkPriceFeed.addPrimitives(primitiveMocks, aggregatorMocks, rateAssets),
    ).rejects.toBeRevertedWith('Value already set');
  });

  it('reverts when latest answer is zero', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks, primitiveMocks },
    } = await provider.snapshot(snapshot);

    // Set latest answer on aggregator mock to be 0
    const latestTimestamp = (await provider.getBlock('latest')).timestamp;
    const latestAnswer = 0;

    await aggregatorMocks[0].setLatestAnswer(latestAnswer, latestTimestamp);

    await expect(
      chainlinkPriceFeed.addPrimitives([primitiveMocks[0]], [aggregatorMocks[0]], [0]),
    ).rejects.toBeRevertedWith('No rate detected');
  });
});

describe('updatePrimitives', () => {
  it('updates multiple primitives and emit events', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      config: {
        chainlink: { primitives, aggregators, rateAssets },
      },
      mocks: { aggregatorMocks },
    } = await provider.snapshot(snapshot);

    // Start off from the already deployed primitives
    const primitivesToUpdate = primitives.slice(0, 2);

    // Update primitives to aggregatorMocks
    const updatePrimitivesReceipt = await chainlinkPriceFeed.updatePrimitives(primitivesToUpdate, aggregatorMocks);

    // Check events and values stored are consistent
    const events = extractEvent(updatePrimitivesReceipt, 'PrimitiveUpdated');
    expect(events).toHaveLength(primitivesToUpdate.length);

    for (let i = 0; i < primitivesToUpdate.length; i++) {
      const aggregator = await chainlinkPriceFeed.getAggregatorInfoForPrimitive(primitivesToUpdate[i]);
      expect(aggregator).toMatchFunctionOutput(chainlinkPriceFeed.getAggregatorInfoForPrimitive, {
        aggregator: aggregatorMocks[i],
        rateAsset: rateAssets[i],
      });

      expect(events[i]).toMatchEventArgs({
        primitive: primitivesToUpdate[i],
        prevAggregator: aggregators[i],
        nextAggregator: aggregatorMocks[i],
      });
    }
  });

  it('reverts when primitives are empty', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks },
    } = await provider.snapshot(snapshot);

    // Update primitives with an empty value
    const updatedPrimitives = chainlinkPriceFeed.updatePrimitives([], [aggregatorMocks[0]]);
    await expect(updatedPrimitives).rejects.toBeRevertedWith('_primitives cannot be empty');
  });

  it('reverts when updating a non added primitive', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks },
    } = await provider.snapshot(snapshot);

    // Update primitives with a random address
    await expect(chainlinkPriceFeed.updatePrimitives([randomAddress()], [aggregatorMocks[0]])).rejects.toBeRevertedWith(
      'Primitive not yet added',
    );
  });

  it('reverts when updating a primitive to an already set value', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks, primitiveMocks },
    } = await provider.snapshot(snapshot);

    // Add primitive and aggregator mocks
    await chainlinkPriceFeed.addPrimitives([primitiveMocks[0]], [aggregatorMocks[0]], [0]);

    // Update to the same values
    await expect(
      chainlinkPriceFeed.updatePrimitives([primitiveMocks[0]], [aggregatorMocks[0]]),
    ).rejects.toBeRevertedWith('Value already set');
  });
});

describe('removePrimitives', () => {
  it('removes multiple primitives and emit events', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      config: {
        chainlink: { primitives },
      },
    } = await provider.snapshot(snapshot);

    // Select the already deployed primitives
    const primitivesToRemove = primitives.slice(0, 2);
    const removePrimitivesReceipt = await chainlinkPriceFeed.removePrimitives(primitivesToRemove);

    // Remove and check consistent values and events
    const events = extractEvent(removePrimitivesReceipt, 'PrimitiveRemoved');
    expect(events).toHaveLength(primitivesToRemove.length);

    for (let i = 0; i < primitivesToRemove.length; i++) {
      const aggregatorInfo = await chainlinkPriceFeed.getAggregatorInfoForPrimitive(primitivesToRemove[i]);
      expect(aggregatorInfo).toMatchFunctionOutput(chainlinkPriceFeed.getAggregatorInfoForPrimitive, {
        aggregator: constants.AddressZero,
        rateAsset: 0,
      });

      expect(await chainlinkPriceFeed.getUnitForPrimitive(primitivesToRemove[i])).toEqBigNumber(0);

      expect(events[i]).toMatchEventArgs({ primitive: resolveAddress(primitivesToRemove[i]) });
    }
  });

  it('reverts when primitives are empty', async () => {
    const {
      deployment: { chainlinkPriceFeed },
    } = await provider.snapshot(snapshot);

    // Call remove with empty values
    await expect(chainlinkPriceFeed.removePrimitives([])).rejects.toBeRevertedWith('_primitives cannot be empty');
  });

  it('reverts when primitives have not yet been added', async () => {
    const {
      deployment: { chainlinkPriceFeed },
    } = await provider.snapshot(snapshot);

    // Call remove on a random (non added) address
    await expect(chainlinkPriceFeed.removePrimitives([randomAddress()])).rejects.toBeRevertedWith(
      'Primitive not yet added',
    );
  });
});

describe('removeStalePrimitives', () => {
  it('reverts when primitives are empty', async () => {
    const {
      deployment: { chainlinkPriceFeed },
    } = await provider.snapshot(snapshot);

    // Call remove with empty values
    await expect(chainlinkPriceFeed.removeStalePrimitives([])).rejects.toBeRevertedWith('_primitives cannot be empty');
  });

  it('reverts when primitives have not yet been added', async () => {
    const {
      deployment: { chainlinkPriceFeed },
    } = await provider.snapshot(snapshot);

    // Call remove on a random (non added) address
    await expect(chainlinkPriceFeed.removeStalePrimitives([randomAddress()])).rejects.toBeRevertedWith(
      'Invalid primitive',
    );
  });

  it('allows a random user to remove a stale primitive based on the timestamp, and fires the correct event', async () => {
    const {
      accounts: [randomUser],
      deployment: {
        chainlinkPriceFeed,
        tokens: { dai, usdc },
      },
    } = await provider.snapshot(snapshot);

    const primitivesToRemove = [dai, usdc];

    // Should fail initially because the rate is not stale
    await expect(
      chainlinkPriceFeed.connect(randomUser).removeStalePrimitives(primitivesToRemove),
    ).rejects.toBeRevertedWith('Rate is not stale');

    // Should succeed after warping beyond staleness threshold
    await provider.send('evm_increaseTime', [60 * 60 * 49]);
    const receipt = await chainlinkPriceFeed.connect(randomUser).removeStalePrimitives(primitivesToRemove);

    // Assert that the primitive has been removed from storage, and that the correct event fired
    const events = extractEvent(receipt, 'StalePrimitiveRemoved');
    expect(events).toHaveLength(primitivesToRemove.length);
    for (let i = 0; i < primitivesToRemove.length; i++) {
      const aggregatorInfo = await chainlinkPriceFeed.getAggregatorInfoForPrimitive(primitivesToRemove[i]);
      expect(aggregatorInfo).toMatchFunctionOutput(chainlinkPriceFeed.getAggregatorInfoForPrimitive, {
        aggregator: constants.AddressZero,
        rateAsset: 0,
      });

      expect(events[i]).toMatchEventArgs({ primitive: resolveAddress(primitivesToRemove[i]) });
    }
  });
});

describe('setEthUsdAggregator', () => {
  it('properly sets eth/usd aggregator', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks },
    } = await provider.snapshot(snapshot);

    // Get already stored ETH USD aggregator
    const storedEthUsdAggregator = await chainlinkPriceFeed.getEthUsdAggregator();

    // Update to new value
    const setEthUsdAggregatorReceipt = await chainlinkPriceFeed.setEthUsdAggregator(aggregatorMocks[0]);

    const updatedEthUsdAggregator = await chainlinkPriceFeed.getEthUsdAggregator();
    expect(updatedEthUsdAggregator).toMatchAddress(aggregatorMocks[0]);

    // Event should inlude the old and new ETH USD aggregators
    assertEvent(setEthUsdAggregatorReceipt, 'EthUsdAggregatorSet', {
      prevEthUsdAggregator: storedEthUsdAggregator,
      nextEthUsdAggregator: updatedEthUsdAggregator,
    });
  });

  it('reverts when setting an already set aggregator', async () => {
    const {
      deployment: { chainlinkPriceFeed },
    } = await provider.snapshot(snapshot);

    const storedEthUsdAggregator = await chainlinkPriceFeed.getEthUsdAggregator();

    // Set the same aggregator than stored
    await expect(chainlinkPriceFeed.setEthUsdAggregator(storedEthUsdAggregator)).rejects.toBeRevertedWith(
      'Value already set',
    );
  });
});

// NOTE: Behaviour tests included under e2e tests
describe('getCanonicalRate', () => {
  it('reverts when it receives a negative or zero value', async () => {
    const {
      deployment: { chainlinkPriceFeed },
      mocks: { aggregatorMocks, primitiveMocks },
    } = await provider.snapshot(snapshot);

    // Create aggreagator mocks with negative (-1) and 0 values
    const latestTimestamp = (await provider.getBlock('latest')).timestamp;
    await aggregatorMocks[0].setLatestAnswer(-1, latestTimestamp);
    await aggregatorMocks[1].setLatestAnswer(constants.Zero, latestTimestamp);

    // Check both revert
    await expect(
      chainlinkPriceFeed.addPrimitives([primitiveMocks[0]], [aggregatorMocks[0]], [0]),
    ).rejects.toBeRevertedWith('No rate detected');
    await expect(
      chainlinkPriceFeed.addPrimitives([primitiveMocks[1]], [aggregatorMocks[1]], [0]),
    ).rejects.toBeRevertedWith('No rate detected');
  });
});

describe('setStaleRateThreshold', () => {
  it('does not allow its prev value', async () => {
    const {
      deployment: { chainlinkPriceFeed },
    } = await provider.snapshot(snapshot);

    const storedStaleRateThreshold = await chainlinkPriceFeed.getStaleRateThreshold();

    await expect(chainlinkPriceFeed.setStaleRateThreshold(storedStaleRateThreshold)).rejects.toBeRevertedWith(
      'Value already set',
    );
  });

  it('properly sets value', async () => {
    const {
      deployment: { chainlinkPriceFeed },
    } = await provider.snapshot(snapshot);

    // Get stored staleRateThreshold
    const storedStaleRateThreshold = await chainlinkPriceFeed.getStaleRateThreshold();

    // Set new value to 1 day
    const newStaleThreshold = 60 * 60 * 24;
    const setStaleRateThresholdReceipt = await chainlinkPriceFeed.setStaleRateThreshold(newStaleThreshold);

    //Check events
    const updatedStaleRateThreshold = await chainlinkPriceFeed.getStaleRateThreshold();
    expect(updatedStaleRateThreshold).toEqBigNumber(newStaleThreshold);

    assertEvent(setStaleRateThresholdReceipt, 'StaleRateThresholdSet', {
      prevStaleRateThreshold: storedStaleRateThreshold,
      nextStaleRateThreshold: newStaleThreshold,
    });
  });
});
