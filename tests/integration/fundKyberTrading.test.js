/*
 * @file Tests funds trading via the Kyber adapter
 *
 * @test Fund takes a RISQ order with WETH using KyberNetworkProxy's expected price
 * @test Fund takes a WETH order with RISQ using KyberNetworkProxy's expected price
 * @test Fund takes a EUR order with RISQ without intermediary options specified
 * @test Fund take order fails with too high maker quantity
 */

import { BN, toWei } from 'web3-utils';
import { call, send } from '~/deploy/utils/deploy-contract';
import { partialRedeploy } from '~/deploy/scripts/deploy-system';
import { BNExpMul } from '~/tests/utils/BNmath';
import {
  CONTRACT_NAMES,
  EMPTY_ADDRESS,
  KYBER_ETH_ADDRESS,
} from '~/tests/utils/constants';
import { setupFundWithParams } from '~/tests/utils/fund';
import getAccounts from '~/deploy/utils/getAccounts';
import { getFunctionSignature } from '~/tests/utils/metadata';

let defaultTxOpts, managerTxOpts;
let deployer, manager, investor;
let contracts;
let exchangeIndex, takeOrderSignature;
let version, kyberAdapter, kyberNetworkProxy, weth, risq, eur;
let fund;

beforeAll(async () => {
  [deployer, manager, investor] = await getAccounts();
  defaultTxOpts = { from: deployer, gas: 8000000 };
  managerTxOpts = { ...defaultTxOpts, from: manager };

  const deployed = await partialRedeploy([CONTRACT_NAMES.VERSION]);
  contracts = deployed.contracts;

  version = contracts.Version;
  kyberAdapter = contracts.KyberAdapter;
  kyberNetworkProxy = contracts.KyberNetworkProxy;
  weth = contracts.WETH;
  risq = contracts.RISQ;
  eur = contracts.EUR;

  fund = await setupFundWithParams({
    defaultTokens: [risq.options.address, weth.options.address],
    exchanges: [kyberNetworkProxy.options.address],
    exchangeAdapters: [kyberAdapter.options.address],
    initialInvestment: {
      contribAmount: toWei('1', 'ether'),
      investor,
      tokenContract: weth
    },
    manager,
    quoteToken: weth.options.address,
    version
  });

  exchangeIndex = 0;

  takeOrderSignature = getFunctionSignature(
    CONTRACT_NAMES.EXCHANGE_ADAPTER,
    'takeOrder'
  );
});

test('swap WETH for RISQ with expected rate from kyberNetworkProxy', async () => {
  const { trading, vault } = fund;

  const takerAsset = weth.options.address;
  const takerQuantity = toWei('0.1', 'ether');
  const makerAsset = risq.options.address;

  const { 0: expectedRate } = await call(
    kyberNetworkProxy,
    'getExpectedRate',
    [KYBER_ETH_ADDRESS, makerAsset, takerQuantity],
  );

  const makerQuantity = BNExpMul(
    new BN(takerQuantity.toString()),
    new BN(expectedRate.toString()),
  ).toString();

  const preRisqVault = new BN(await call(risq, 'balanceOf', [vault.options.address]));
  const preWethVault = new BN(await call(weth, 'balanceOf', [vault.options.address]));

  await send(
    trading,
    'callOnExchange',
    [
      exchangeIndex,
      takeOrderSignature,
      [
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        makerAsset,
        takerAsset,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
      ],
      [makerQuantity, takerQuantity, 0, 0, 0, 0, takerQuantity, 0],
      ['0x0', '0x0', '0x0', '0x0'],
      '0x0',
      '0x0',
    ],
    managerTxOpts
  );

  const postRisqVault = new BN(await call(risq, 'balanceOf', [vault.options.address]));
  const postWethVault = new BN(await call(weth, 'balanceOf', [vault.options.address]));

  expect(postWethVault).bigNumberEq(preWethVault.sub(new BN(takerQuantity)));
  expect(postRisqVault).bigNumberEq(preRisqVault.add(new BN(makerQuantity)));
});

test('swap RISQ for WETH with expected rate from kyberNetworkProxy', async () => {
  const { trading, vault } = fund;

  const takerAsset = risq.options.address;
  const takerQuantity = toWei('0.01', 'ether');
  const makerAsset = weth.options.address;

  const { 0: expectedRate } = await call(
    kyberNetworkProxy,
    'getExpectedRate',
    [takerAsset, KYBER_ETH_ADDRESS, takerQuantity],
  );

  const makerQuantity = BNExpMul(
    new BN(takerQuantity.toString()),
    new BN(expectedRate.toString()),
  ).toString();

  const preRisqVault = new BN(await call(risq, 'balanceOf', [vault.options.address]));
  const preWethVault = new BN(await call(weth, 'balanceOf', [vault.options.address]));

  await send(
    trading,
    'callOnExchange',
    [
      exchangeIndex,
      takeOrderSignature,
      [
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        makerAsset,
        takerAsset,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS
      ],
      [makerQuantity, takerQuantity, 0, 0, 0, 0, takerQuantity, 0],
      ['0x0', '0x0', '0x0', '0x0'],
      '0x0',
      '0x0',
    ],
    managerTxOpts
  );

  const postRisqVault = new BN(await call(risq, 'balanceOf', [vault.options.address]));
  const postWethVault = new BN(await call(weth, 'balanceOf', [vault.options.address]));

  expect(postRisqVault).bigNumberEq(preRisqVault.sub(new BN(takerQuantity)));
  expect(postWethVault).bigNumberEq(preWethVault.add(new BN(makerQuantity)));
});

test('swap RISQ directly to EUR without intermediary', async () => {
  const { trading, vault } = fund;

  const takerAsset = risq.options.address;
  const takerQuantity = toWei('0.01', 'ether');
  const makerAsset = eur.options.address;

  const { 0: expectedRate } = await call(
    kyberNetworkProxy,
    'getExpectedRate',
    [takerAsset, makerAsset, takerQuantity],
  );

  const makerQuantity = BNExpMul(
    new BN(takerQuantity.toString()),
    new BN(expectedRate.toString()),
  ).toString();

  const preEurVault = new BN(await call(eur, 'balanceOf', [vault.options.address]));
  const preRisqVault = new BN(await call(risq, 'balanceOf', [vault.options.address]));
  const preWethVault = new BN(await call(weth, 'balanceOf', [vault.options.address]));

  await send(
    trading,
    'callOnExchange',
    [
      exchangeIndex,
      takeOrderSignature,
      [
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        makerAsset,
        takerAsset,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS
      ],
      [makerQuantity, takerQuantity, 0, 0, 0, 0, takerQuantity, 0],
      ['0x0', '0x0', '0x0', '0x0'],
      '0x0',
      '0x0',
    ],
    managerTxOpts
  );

  const postEurVault = new BN(await call(eur, 'balanceOf', [vault.options.address]));
  const postRisqVault = new BN(await call(risq, 'balanceOf', [vault.options.address]));
  const postWethVault = new BN(await call(weth, 'balanceOf', [vault.options.address]));

  expect(postWethVault).bigNumberEq(preWethVault);
  expect(postRisqVault).bigNumberEq(preRisqVault.sub(new BN(takerQuantity)));
  expect(postEurVault).bigNumberEq(preEurVault.add(new BN(makerQuantity)));
});

test('swap fails if make quantity is too high', async () => {
  const { trading } = fund;

  const takerAsset = risq.options.address;
  const takerQuantity = toWei('0.1', 'ether');
  const makerAsset = eur.options.address;

  const { 0: expectedRate } = await call(
    kyberNetworkProxy,
    'getExpectedRate',
    [takerAsset, makerAsset, takerQuantity],
  );

  const makerQuantity = BNExpMul(
    new BN(takerQuantity.toString()),
    new BN(expectedRate.toString()).mul(new BN(2)),
  ).toString();

  await expect(
    send(
      trading,
      'callOnExchange',
      [
        exchangeIndex,
        takeOrderSignature,
        [
          EMPTY_ADDRESS,
          EMPTY_ADDRESS,
          makerAsset,
          takerAsset,
          EMPTY_ADDRESS,
          EMPTY_ADDRESS,
          EMPTY_ADDRESS,
          EMPTY_ADDRESS,
        ],
      [makerQuantity, takerQuantity, 0, 0, 0, 0, takerQuantity, 0],
      ['0x0', '0x0', '0x0', '0x0'],
      '0x0',
      '0x0',
      ],
      managerTxOpts
    )
  ).rejects.toThrowFlexible();
});
