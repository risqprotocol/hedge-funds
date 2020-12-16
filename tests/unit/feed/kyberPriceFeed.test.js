/*
 * @file Tests simple cases of updating price against a Kyber deployment
 *
 * @test Some unrelated account cannot update feed
 * @test Registy owner an update feed
 * @test Delegated updater can update the feed
 * @test RISQ price update on reserve changes price on feed post-update
 * @test Normal spread condition from Kyber rates yields midpoint price
 * @test Crossed market condition from Kyber rates yields midpoint price
 * @test boundaries of max spread
 * @test boundaries of max price deviation
 * TODO: add helper function for updating asset prices on kyber itself
 */

import { BN, toWei } from 'web3-utils';

import { BNExpDiv, BNExpInverse } from '~/tests/utils/BNmath';
import { CONTRACT_NAMES } from '~/tests/utils/constants';
import { getEventFromLogs } from '~/tests/utils/metadata';

import { partialRedeploy } from '~/deploy/scripts/deploy-system';
import { deploy, send, call } from '~/deploy/utils/deploy-contract';
import web3 from '~/deploy/utils/get-web3';

let deployer, updater, someAccount;
let deployerTxOpts, updaterTxOpts, someAccountTxOpts;
let conversionRates, kyberNetworkProxy, registry;
let eur, risq, weth, registeredAssets;

beforeAll(async () => {
  const accounts = await web3.eth.getAccounts();
  [deployer, updater, someAccount] = accounts;
  deployerTxOpts = { from: deployer, gas: 8000000 };
  updaterTxOpts = { from: updater, gas: 8000000 };
  someAccountTxOpts = { from: someAccount, gas: 8000000 };
  const deployed = await partialRedeploy([CONTRACT_NAMES.FUND_FACTORY]);
  const contracts = deployed.contracts;

  eur = contracts.EUR;
  risq = contracts.RISQ;
  weth = contracts.WETH;
  conversionRates = contracts.ConversionRates;
  kyberNetworkProxy = contracts.KyberNetworkProxy;

  registry = await deploy(CONTRACT_NAMES.REGISTRY, [deployer], deployerTxOpts);

  await send(registry, 'setNativeAsset', [weth.options.address], deployerTxOpts);

  for (const addr of [eur.options.address, risq.options.address, weth.options.address]) {
    await send(
      registry,
      'registerAsset',
      [ addr, '', '', '', '0', [], [] ],
      deployerTxOpts
    );
  }

  registeredAssets = await call(registry, 'getRegisteredAssets');
});

describe('update', () => {
  const dummyPrices = [
    toWei('1', 'ether'),
    toWei('1', 'ether'),
    toWei('1', 'ether')
  ];
  let kyberPriceFeed;
  let maxDeviationFromFeed;
  let risqPriceFromKyber;

  beforeAll(async () => {
    kyberPriceFeed = await deploy(
      CONTRACT_NAMES.KYBER_PRICEFEED,
      [
        registry.options.address,
        kyberNetworkProxy.options.address,
        toWei('0.5', 'ether'),
        weth.options.address,
        toWei('0.1', 'ether')
      ],
      deployerTxOpts
    );
    maxDeviationFromFeed = new BN(await call(kyberPriceFeed, 'maxPriceDeviation'));
    risqPriceFromKyber = new BN((await call(
      kyberPriceFeed, 'getKyberPrice', [risq.options.address, weth.options.address]
    )).kyberPrice_);
  });

  test('Some unrelated account cannot update feed', async () => {
    const registryOwner = await call(registry, 'owner');
    const designatedUpdater = await call(kyberPriceFeed, 'updater');

    expect(registryOwner).not.toBe(someAccount);
    expect(designatedUpdater).not.toBe(someAccount);
    await expect(
      send(
        kyberPriceFeed,
        'update',
        [registeredAssets, dummyPrices, false],
        someAccountTxOpts
      )
    ).rejects.toThrowFlexible('Only registry owner or updater can call');
  });

  test('Registry owner can update feed', async () => {
    const registryOwner = await call(registry, 'owner');

    expect(registryOwner).toBe(deployer);

    let receipt = await send(
      kyberPriceFeed,
      'update',
      [registeredAssets, dummyPrices, false],
      deployerTxOpts
    );
    const logUpdated = getEventFromLogs(
        receipt.logs, CONTRACT_NAMES.KYBER_PRICEFEED, 'PricesUpdated'
    );

    expect(logUpdated.assets).toEqual(registeredAssets);
    expect(logUpdated.prices).toEqual(dummyPrices);
  });

  test('Designated updater can update feed', async () => {
    await expect(
      send(
        kyberPriceFeed,
        'update',
        [registeredAssets, dummyPrices, false],
        updaterTxOpts
      )
    ).rejects.toThrowFlexible('Only registry owner or updater can call');

    let receipt = await send(kyberPriceFeed, 'setUpdater', [updater], deployerTxOpts);
    const logSetUpdater = getEventFromLogs(
        receipt.logs, CONTRACT_NAMES.KYBER_PRICEFEED, 'UpdaterSet'
    );

    expect(logSetUpdater.updater).toBe(updater);

    receipt = await send(
      kyberPriceFeed,
      'update',
      [registeredAssets, dummyPrices, false],
      updaterTxOpts
    );
    const logUpdated = getEventFromLogs(
        receipt.logs, CONTRACT_NAMES.KYBER_PRICEFEED, 'PricesUpdated'
    );

    expect(logUpdated.assets).toEqual(registeredAssets);
    expect(logUpdated.prices).toEqual(dummyPrices);

    const hasValidRisqPrice = await call(kyberPriceFeed, 'hasValidPrice', [risq.options.address]);
    const { 0: risqPrice } = await call(kyberPriceFeed, 'getPrice', [risq.options.address]);

    expect(hasValidRisqPrice).toBe(true);
    expect(risqPrice.toString()).toBe(toWei('1', 'ether'));
  });

  test('Price hint above the upper deviation threshold reverts', async () => {
    const upperEndValidRisqPrice = risqPriceFromKyber.mul(
      new BN(toWei('1', 'ether'))
    ).div(new BN(toWei('1', 'ether')).sub(maxDeviationFromFeed));
    const barelyTooHighRisqPrice = upperEndValidRisqPrice.add(new BN('2'));

    await expect(
      send(
        kyberPriceFeed,
        'update',
        [
          registeredAssets,
          [
            toWei('1', 'ether'),
            barelyTooHighRisqPrice.toString(),
            toWei('1', 'ether')
          ],
          false
        ],
        deployerTxOpts
      )
    ).rejects.toThrowFlexible('update: Kyber price deviates too much from maxPriceDeviation');

    let receipt = await send(
      kyberPriceFeed,
      'update',
      [
        registeredAssets,
        [
          toWei('1', 'ether'),
          upperEndValidRisqPrice.toString(),
          toWei('1', 'ether')
        ],
        false
      ],
      deployerTxOpts
    );

    const logUpdated = getEventFromLogs(
        receipt.logs, CONTRACT_NAMES.KYBER_PRICEFEED, 'PricesUpdated'
    );

    expect(logUpdated.assets).toEqual(registeredAssets);
    expect(logUpdated.prices).toEqual(dummyPrices);
  });

  test('Price hint below the lower deviation threshold reverts', async () => {
    const maxDeviationFromFeed = new BN(await call(kyberPriceFeed, 'maxPriceDeviation'));
    const risqPriceFromKyber = new BN((await call(
      kyberPriceFeed, 'getKyberPrice', [risq.options.address, weth.options.address]
    )).kyberPrice_);
    const lowerEndValidRisqPrice = risqPriceFromKyber.mul(
      new BN(toWei('1', 'ether'))
    ).div(new BN(toWei('1', 'ether')).add(maxDeviationFromFeed)).add(new BN('1'));
    const barelyTooLowRisqPrice = lowerEndValidRisqPrice.sub(new BN('1'));

    await expect(
      send(
        kyberPriceFeed,
        'update',
        [
          registeredAssets,
          [
            toWei('1', 'ether'),
            barelyTooLowRisqPrice.toString(),
            toWei('1', 'ether')
          ],
          false
        ],
        deployerTxOpts
      )
    ).rejects.toThrowFlexible('update: Kyber price deviates too much from maxPriceDeviation');

    const receipt = await send(
      kyberPriceFeed,
      'update',
      [
        registeredAssets,
        [
          toWei('1', 'ether'),
          lowerEndValidRisqPrice.toString(),
          toWei('1', 'ether')
        ],
        false
      ],
      deployerTxOpts
    );

    const logUpdated = getEventFromLogs(
        receipt.logs, CONTRACT_NAMES.KYBER_PRICEFEED, 'PricesUpdated'
    );

    expect(logUpdated.assets).toEqual(registeredAssets);
    expect(logUpdated.prices).toEqual(dummyPrices);
  });

  test('Asset with spread greater than max results in invalid price', async () => {
    const maxSpreadFromFeed = new BN(await call(kyberPriceFeed, 'maxSpread'));
    // arbitrary ask rate
    const risqPerEthAskRate = new BN(toWei('0.5', 'ether'));
    // bid rate such that spread is the max permitted
    const risqPerEthBidRateValid = risqPerEthAskRate.sub(
      maxSpreadFromFeed.mul(risqPerEthAskRate).div(new BN(toWei('1', 'ether')))
    );
    // bid rate such that spread is just above max permitted
    const risqPerEthBidRateInvalid = risqPerEthBidRateValid.sub(new BN('1'))

    const ethPerRisqFromAsk = BNExpDiv(
      new BN(toWei('1', 'ether')),
      risqPerEthAskRate
    );
    const ethPerRisqFromBid = BNExpDiv(
      new BN(toWei('1', 'ether')),
      risqPerEthBidRateValid
    );
    const midpointPrice = BNExpDiv(
      ethPerRisqFromAsk.add(ethPerRisqFromBid), new BN(toWei('2', 'ether'))
    ).toString();

    const validPricePreUpdate1 = await call(kyberPriceFeed, 'hasValidPrice', [risq.options.address]);
    expect(validPricePreUpdate1).toBe(true);

    // setting price with spread equal to max yields valid price
    await send(
      conversionRates,
      'setBaseRate',
      [
        [risq.options.address],
        [risqPerEthBidRateValid.toString()],
        [ethPerRisqFromAsk.toString()],
        ['0x0000000000000000000000000000'],
        ['0x0000000000000000000000000000'],
        (await web3.eth.getBlock('latest')).number,
        [0]
      ],
      deployerTxOpts
    );

    await send(
      kyberPriceFeed,
      'update',
      [
        registeredAssets,
        [
          toWei('1', 'ether'),
          midpointPrice.toString(),
          toWei('1', 'ether')
        ],
        true
      ],
      deployerTxOpts
    );

    const validPricePostUpdate1 = await call(kyberPriceFeed, 'hasValidPrice', [risq.options.address]);
    expect(validPricePostUpdate1).toBe(true);
    const risqPricePostUpdate1 = await call(kyberPriceFeed, 'getPrice', [risq.options.address]);
    expect(risqPricePostUpdate1.price_).toBe(midpointPrice);

    const validPricePreUpdate2 = await call(kyberPriceFeed, 'hasValidPrice', [risq.options.address]);
    expect(validPricePreUpdate2).toBe(true);

    // setting price with spread outside max yields invalid price
    await send(
      conversionRates,
      'setBaseRate',
      [
        [risq.options.address],
        [risqPerEthBidRateInvalid.toString()],
        [ethPerRisqFromAsk.toString()],
        ['0x0000000000000000000000000000'],
        ['0x0000000000000000000000000000'],
        (await web3.eth.getBlock('latest')).number,
        [0]
      ],
      deployerTxOpts
    );

    // toggling failIfInvalid causes failure with >max spread
    await expect(
      send(
        kyberPriceFeed,
        'update',
        [
          registeredAssets,
          [
            toWei('1', 'ether'),
            midpointPrice.toString(),
            toWei('1', 'ether')
          ],
          true
        ],
        deployerTxOpts
      )
    ).rejects.toThrowFlexible('update: Aborting due to invalid price');

    await send(
      kyberPriceFeed,
      'update',
      [
        registeredAssets,
        [
          toWei('1', 'ether'),
          midpointPrice.toString(),
          toWei('1', 'ether')
        ],
        false
      ],
      deployerTxOpts
    );

    const validPricePostUpdate2 = await call(kyberPriceFeed, 'hasValidPrice', [risq.options.address]);
    expect(validPricePostUpdate2).toBe(false);
  });
});

describe('getPrice', () => {
  let kyberPriceFeed;

  beforeAll(async () => {
    kyberPriceFeed = await deploy(
      CONTRACT_NAMES.KYBER_PRICEFEED,
      [
        registry.options.address,
        kyberNetworkProxy.options.address,
        toWei('0.5', 'ether'),
        weth.options.address,
        toWei('0.1', 'ether')
      ],
      deployerTxOpts
    );
  });

  test('Price change in reserve is reflected in getPrice post-update', async () => {
    const risqPrice = BNExpDiv(
      new BN(toWei('1', 'ether')),
      new BN(toWei('0.05', 'ether'))
    );
    const ethPriceInRisq = BNExpInverse(new BN(risqPrice))

    const eurPrice = BNExpDiv(
      new BN(toWei('1', 'ether')),
      new BN(toWei('0.008', 'ether')),
    );
    const ethPriceInEur = BNExpInverse(new BN(eurPrice))

    await send(
      conversionRates,
      'setBaseRate',
      [
        [risq.options.address, eur.options.address],
        [ethPriceInRisq.toString(), ethPriceInEur.toString()],
        [risqPrice.toString(), eurPrice.toString()],
        ['0x0000000000000000000000000000'],
        ['0x0000000000000000000000000000'],
        (await web3.eth.getBlock('latest')).number,
        [0]
      ],
      deployerTxOpts
    );

    await send(
      kyberPriceFeed,
      'update',
      [
        registeredAssets,
        [
          eurPrice.toString(),
          risqPrice.toString(),
          toWei('1', 'ether')
        ],
        false
      ],
      deployerTxOpts
    );

    const { 0: updatedRisqPrice } = await call(kyberPriceFeed, 'getPrice', [risq.options.address]);
    const { 0: updatedEurPrice } = await call(kyberPriceFeed, 'getPrice', [eur.options.address]);

    expect(updatedRisqPrice.toString()).toBe(risqPrice.toString());
    expect(updatedEurPrice.toString()).toBe(eurPrice.toString());
  });

  test('Normal (positive) spread condition yields midpoint price', async () => {
    const risqBid = BNExpDiv(
      new BN(toWei('1', 'ether')),
      new BN(toWei('0.05', 'ether'))
    );
    const risqAsk = BNExpDiv(
      new BN(toWei('1', 'ether')),
      new BN(toWei('0.04', 'ether'))
    );
    const ethBidInRisq = BNExpInverse(risqBid); // ETH per 1 RISQ (based on bid)
    const midpointPrice = BNExpDiv(
      risqBid.add(risqAsk), new BN(toWei('2', 'ether'))
    ).toString();

    await send(
      conversionRates,
      'setBaseRate',
      [
        [risq.options.address],
        [ethBidInRisq.toString()],
        [risqAsk.toString()],
        ['0x0000000000000000000000000000'],
        ['0x0000000000000000000000000000'],
        (await web3.eth.getBlock('latest')).number,
        [0]
      ],
      deployerTxOpts
    );

    const preEurPrice = await call(kyberPriceFeed, 'getPrice', [eur.options.address]);

    await send(
      kyberPriceFeed,
      'update',
      [
        registeredAssets,
        [
          preEurPrice.price_.toString(),
          midpointPrice.toString(),
          toWei('1', 'ether')
        ],
        false
      ],
      deployerTxOpts
    );

    const postRisqPrice = await call(kyberPriceFeed, 'getPrice', [risq.options.address]);
    expect(postRisqPrice.price_).toBe(midpointPrice);
  });

  test('Crossed market condition yields midpoint price', async () => {
    const risqBid = BNExpDiv(
      new BN(toWei('1', 'ether')),
      new BN(toWei('0.04', 'ether'))
    );
    const risqAsk = BNExpDiv(
      new BN(toWei('1', 'ether')),
      new BN(toWei('0.05', 'ether'))
    );
    const ethBidInRisq = BNExpInverse(risqBid); // ETH per 1 RISQ (based on bid)
    const midpointPrice = BNExpDiv(
      risqBid.add(risqAsk), new BN(toWei('2', 'ether'))
    ).toString();

    await send(
      conversionRates,
      'setBaseRate',
      [
        [risq.options.address],
        [ethBidInRisq.toString()],
        [risqAsk.toString()],
        ['0x0000000000000000000000000000'],
        ['0x0000000000000000000000000000'],
        (await web3.eth.getBlock('latest')).number,
        [0]
      ],
      deployerTxOpts
    );

    const preEurPrice = await call(kyberPriceFeed, 'getPrice', [eur.options.address]);

    await send(
      kyberPriceFeed,
      'update',
      [
        registeredAssets,
        [
          preEurPrice.price_.toString(),
          midpointPrice,
          toWei('1', 'ether')
        ],
        false
      ],
      deployerTxOpts
    );

    const postRisqPrice = await call(kyberPriceFeed, 'getPrice', [risq.options.address]);

    expect(postRisqPrice.price_).toBe(midpointPrice);
  });
});
