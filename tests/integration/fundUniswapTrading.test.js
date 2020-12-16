/*
 * @file Tests funds trading via the Uniswap adapter
 *
 * @test Swap ERC20 for WETH (with minimum set from Uniswap price)
 * @test Swap WETH for ERC20 (with minimum set from Uniswap price)
 * @test Swap ERC20 for ERC20 (with no minimum set)
 * @test Swap fails if minimum is not met
 * @test TODO: make liquidity pools shadow pricefeed price and test price tolerance?
 */

import { BN, toWei } from 'web3-utils';
import { partialRedeploy } from '~/deploy/scripts/deploy-system';
import { call, fetchContract, send } from '~/deploy/utils/deploy-contract';
import web3 from '~/deploy/utils/get-web3';
import { CONTRACT_NAMES, EMPTY_ADDRESS } from '~/tests/utils/constants';
import { setupFundWithParams } from '~/tests/utils/fund';
import getAccounts from '~/deploy/utils/getAccounts';
import { getFunctionSignature } from '~/tests/utils/metadata';

let deployer, manager, investor;
let defaultTxOpts, managerTxOpts;
let contracts;
let eur, risq, weth, fund;
let risqExchange, eurExchange;
let takeOrderSignature;
let exchangeIndex;
let takerAddress;

beforeAll(async () => {
  [deployer, manager, investor] = await getAccounts();
  defaultTxOpts = { from: deployer, gas: 8000000 };
  managerTxOpts = { ...defaultTxOpts, from: manager };

  const deployed = await partialRedeploy(
    [CONTRACT_NAMES.VERSION, CONTRACT_NAMES.UNISWAP_EXCHANGE]
  );
  contracts = deployed.contracts;

  takeOrderSignature = getFunctionSignature(
    CONTRACT_NAMES.EXCHANGE_ADAPTER,
    'takeOrder',
  );

  eur = contracts.EUR;
  risq = contracts.RISQ;
  weth = contracts.WETH;
  const version = contracts.Version;

  const uniswapFactory = contracts.UniswapFactory;
  const uniswapAdapter = contracts.UniswapAdapter;

  fund = await setupFundWithParams({
    defaultTokens: [risq.options.address, weth.options.address],
    exchanges: [uniswapFactory.options.address],
    exchangeAdapters: [uniswapAdapter.options.address],
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

  takerAddress = fund.trading.options.address;

  // Load interfaces for uniswap exchanges of tokens to be traded
  const iUniswapFactory = await fetchContract(
    "IUniswapFactory",
    contracts.UniswapFactory.options.address
  );
  const risqExchangeAddress = await call(iUniswapFactory, 'getExchange', [risq.options.address]);
  risqExchange = await fetchContract(
    "IUniswapExchange",
    risqExchangeAddress
  );
  const eurExchangeAddress = await call(uniswapFactory, 'getExchange', [eur.options.address]);
  eurExchange = await fetchContract(
    "IUniswapExchange",
    eurExchangeAddress
  );

  // Seed uniswap exchanges with liquidity
  const ethLiquidityAmount = toWei('1', 'ether');
  const eurLiquidityAmount = toWei('100', 'ether');
  const risqLiquidityAmount = toWei('2', 'ether');

  const minLiquidity = 0; // For first liquidity provider
  const deadline = (await web3.eth.getBlock('latest')).timestamp + 300 // Arbitrary

  await send(
    risq,
    'approve',
    [risqExchange.options.address, risqLiquidityAmount],
    defaultTxOpts
  );
  await send(
    risqExchange,
    'addLiquidity',
    [minLiquidity, risqLiquidityAmount, deadline],
    { ...defaultTxOpts, value: ethLiquidityAmount }
  );

  await send(
    eur,
    'approve',
    [eurExchange.options.address, eurLiquidityAmount],
    defaultTxOpts
  );
  await send(
    eurExchange,
    'addLiquidity',
    [minLiquidity, eurLiquidityAmount, deadline],
    { ...defaultTxOpts, value: ethLiquidityAmount }
  );

});

test('Swap WETH for RISQ with minimum derived from Uniswap price', async () => {
  const { accounting, trading, vault } = fund;

  const takerAsset = weth.options.address;
  const takerQuantity = toWei('0.1', 'ether');
  const makerAsset = risq.options.address;

  const makerQuantity = await call(
    risqExchange,
    'getEthToTokenInputPrice',
    [takerQuantity]
  );

  const preRisqFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [risq.options.address])
  );
  const preWethFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [weth.options.address])
  );
  const preRisqVault = new BN(await call(risq, 'balanceOf', [vault.options.address]));

  await send(
    trading,
    'callOnExchange',
    [
      exchangeIndex,
      takeOrderSignature,
      [
        EMPTY_ADDRESS,
        takerAddress,
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

  const postRisqFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [risq.options.address])
  );
  const postWethFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [weth.options.address])
  );
  const postRisqVault = new BN(await call(risq, 'balanceOf', [vault.options.address]));

  expect(postWethFundHoldings).bigNumberEq(
    preWethFundHoldings.sub(new BN(takerQuantity))
  );
  expect(postRisqFundHoldings).bigNumberEq(
    preRisqFundHoldings.add(new BN(makerQuantity))
  );
  expect(postRisqVault).bigNumberEq(preRisqVault.add(new BN(makerQuantity)));
});

test('Swap RISQ for WETH with minimum derived from Uniswap price', async () => {
  const { accounting, trading, vault } = fund;

  const takerAsset = risq.options.address;
  const takerQuantity = toWei('0.01', 'ether');
  const makerAsset = weth.options.address;

  const makerQuantity = await call(
    risqExchange,
    'getTokenToEthInputPrice',
    [takerQuantity]
  );

  const preRisqFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [risq.options.address])
  );
  const preWethFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [weth.options.address])
  );
  const preWethVault = new BN(await call(weth, 'balanceOf', [vault.options.address]));

  await send(
    trading,
    'callOnExchange',
    [
      exchangeIndex,
      takeOrderSignature,
      [
        EMPTY_ADDRESS,
        takerAddress,
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

  const postRisqFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [risq.options.address])
  );
  const postWethFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [weth.options.address])
  );
  const postWethVault = new BN(await call(weth, 'balanceOf', [vault.options.address]));

  expect(postWethFundHoldings).bigNumberEq(
    preWethFundHoldings.add(new BN(makerQuantity))
  );
  expect(postRisqFundHoldings).bigNumberEq(
    preRisqFundHoldings.sub(new BN(takerQuantity))
  );
  expect(postWethVault).bigNumberEq(preWethVault.add(new BN(makerQuantity)));
});

test('Swap RISQ directly to EUR without specifying a minimum maker quantity', async () => {
  const { accounting, trading, vault } = fund;

  const takerAsset = risq.options.address;
  const takerQuantity = toWei('0.01', 'ether');
  const makerAsset = eur.options.address;
  const makerQuantity = "1";

  const intermediateEth = await call(
    risqExchange,
    'getTokenToEthInputPrice',
    [takerQuantity]
  );
  const expectedMakerQuantity = await call(
    eurExchange,
    'getEthToTokenInputPrice',
    [intermediateEth]
  );

  const preEurFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [eur.options.address])
  );
  const preRisqFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [risq.options.address])
  );
  const preWethFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [weth.options.address])
  );
  const preEurVault = new BN(await call(eur, 'balanceOf', [vault.options.address]));

  await send(
    trading,
    'callOnExchange',
    [
      exchangeIndex,
      takeOrderSignature,
      [
        EMPTY_ADDRESS,
        takerAddress,
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

  const postEurFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [eur.options.address])
  );
  const postRisqFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [risq.options.address])
  );
  const postWethFundHoldings = new BN(
    await call(accounting, 'assetHoldings', [weth.options.address])
  );
  const postEurVault = new BN(await call(eur, 'balanceOf', [vault.options.address]));

  expect(postWethFundHoldings).bigNumberEq(preWethFundHoldings);
  expect(postRisqFundHoldings).bigNumberEq(
    preRisqFundHoldings.sub(new BN(takerQuantity))
  );
  expect(postEurFundHoldings).bigNumberEq(
    preEurFundHoldings.add(new BN(expectedMakerQuantity))
  );
  expect(postEurVault).bigNumberEq(preEurVault.add(new BN(expectedMakerQuantity)));
});

test('Order fails if maker amount is not satisfied', async () => {
  const { trading } = fund;

  const takerAsset = risq.options.address;
  const takerQuantity = toWei('0.1', 'ether');
  const makerAsset = weth.options.address;

  const makerQuantity = await call(
    risqExchange,
    'getTokenToEthInputPrice',
    [takerQuantity]
  );
  const highMakerQuantity = new BN(makerQuantity).mul(new BN(2)).toString();

  await expect(
    send(
      trading,
      'callOnExchange',
      [
        exchangeIndex,
        takeOrderSignature,
        [
          EMPTY_ADDRESS,
          takerAddress,
          makerAsset,
          takerAsset,
          EMPTY_ADDRESS,
          EMPTY_ADDRESS,
          EMPTY_ADDRESS,
          EMPTY_ADDRESS
        ],
        [highMakerQuantity, takerQuantity, 0, 0, 0, 0, takerQuantity, 0],
        ['0x0', '0x0', '0x0', '0x0'],
        '0x0',
        '0x0',
      ],
      managerTxOpts
    )
  ).rejects.toThrowFlexible();
});
