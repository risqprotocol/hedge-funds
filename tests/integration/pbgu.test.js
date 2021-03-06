import { toWei, BN } from 'web3-utils';
import web3 from '~/deploy/utils/get-web3';
import { partialRedeploy } from '~/deploy/scripts/deploy-system';
import { call, send } from '~/deploy/utils/deploy-contract';
import getAccounts from '~/deploy/utils/getAccounts';
import { CONTRACT_NAMES } from '~/tests/utils/constants';
import { getFundComponents } from '~/tests/utils/fund';
import { getEventFromLogs } from '~/tests/utils/metadata';

let deployer;
let defaultTxOpts, managerTxOpts;
let baseToken, quoteToken;
let engine, version, priceSource, registry;
let pbguPrice;

async function assertPbguTx(contract, method, args = []) {
  const arbitraryEthAmount = toWei('1', 'ether');
  const preUserBalance = new BN(await web3.eth.getBalance(deployer));
  const gasPrice = await web3.eth.getGasPrice();
  const result = await send(
    contract,
    method,
    args,
    { ...defaultTxOpts, value: arbitraryEthAmount, gasPrice }
  );

  const {payer, pbguChargableGas, incentivePaid} = getEventFromLogs(
    result.logs,
    CONTRACT_NAMES.PBGU_CONSUMER,
    'PbguPaid',
  );

  // TODO: This method does not result in less than the estimate
  if (method === 'completeSetup') return result;

  const postUserBalance = new BN(await web3.eth.getBalance(deployer));

  const wethAddress = await call(registry, 'nativeAsset');
  const risqAddress = await call(version, 'risqToken');
  const risqPbguAmount = new BN(pbguPrice).mul(new BN(pbguChargableGas));
  const ethPbguAmount = new BN(
    await call(
      priceSource,
      'convertQuantity',
      [risqPbguAmount.toString(), risqAddress, wethAddress]
    )
  );
  const txCostInWei = new BN(gasPrice).mul(new BN(result.gasUsed));
  const estimatedTotalUserCost = ethPbguAmount.add(txCostInWei);
  const totalUserCost = preUserBalance.sub(postUserBalance);

  expect(txCostInWei).bigNumberLt(totalUserCost);
  expect(estimatedTotalUserCost).bigNumberEq(totalUserCost);
  expect(new BN(incentivePaid)).bigNumberEq(new BN(0));
  expect(payer.toLowerCase()).toBe(deployer.toLowerCase());

  return result;
}

beforeAll(async () => {
  [deployer] = await getAccounts();
  defaultTxOpts = { from: deployer, gas: 8000000 };

  pbguPrice = toWei('1', 'gwei');
})

beforeEach(async () => {
  const deployed = await partialRedeploy([
    CONTRACT_NAMES.VERSION
  ]);
  const contracts = deployed.contracts;

  engine = contracts.Engine;
  version = contracts.Version;
  registry = contracts.Registry;
  priceSource = contracts.TestingPriceFeed;

  quoteToken = contracts.WETH;
  baseToken = contracts.RISQ;
});

// Reset pbgu and incentive after all tests so as not to affect other tests in suite
afterEach(async () => {
  await send(engine, 'setPbguPrice', [0], defaultTxOpts);
  const resetPbguPrice = await call(engine, 'getPbguPrice');
  expect(resetPbguPrice).toBe('0');

  const incentivePrice = toWei('0.01', 'ether');
  await send(registry, 'setIncentive', [incentivePrice], defaultTxOpts);
  const resetIncentive = await call(registry, 'incentive');
  expect(resetIncentive).toBe(incentivePrice);
});

test('Set pbgu and check its usage in single pbguPayable function', async () => {
  await send(engine, 'setPbguPrice', [pbguPrice], defaultTxOpts);
  const newPbguPrice = await call(engine, 'getPbguPrice');
  expect(newPbguPrice).toBe(pbguPrice);

  const newInputBaseTokenPrice = toWei('2', 'ether');
  await send(
    priceSource,
    'update',
    [[baseToken.options.address], [newInputBaseTokenPrice]],
    defaultTxOpts
  );
  const newBaseTokenPrice = await call(priceSource, 'getPrice', [baseToken.options.address]);
  expect(newBaseTokenPrice[0]).toBe(newInputBaseTokenPrice);

  await send(
    version,
    'beginSetup',
    [
      `test-fund-${Date.now()}`,
      [],
      [],
      [],
      [],
      [],
      quoteToken.options.address,
      [baseToken.options.address, quoteToken.options.address]
    ],
    managerTxOpts
  );

  await assertPbguTx(version, 'createAccounting');
});

test('set pbgu with incentive attatched and check its usage in creating a fund', async () => {
  await send(engine, 'setPbguPrice', [pbguPrice], defaultTxOpts);
  const newPbguPrice = await call(engine, 'getPbguPrice');
  expect(newPbguPrice).toBe(pbguPrice);

  const newInputBaseTokenPrice = toWei('2', 'ether');
  await send(
    priceSource,
    'update',
    [[baseToken.options.address], [newInputBaseTokenPrice]],
    defaultTxOpts
  );
  const newBaseTokenPrice = await call(priceSource, 'getPrice', [baseToken.options.address]);
  expect(newBaseTokenPrice[0]).toBe(newInputBaseTokenPrice);

  await send(
    version,
    'beginSetup',
    [
      `test-fund-${Date.now()}`,
      [],
      [],
      [],
      [],
      [],
      quoteToken.options.address,
      [baseToken.options.address, quoteToken.options.address]
    ],
    managerTxOpts
  );

  await assertPbguTx(version, 'createAccounting');
  await assertPbguTx(version, 'createFeeManager');
  await assertPbguTx(version, 'createParticipation');
  await assertPbguTx(version, 'createPolicyManager');
  await assertPbguTx(version, 'createShares');
  await assertPbguTx(version, 'createTrading');
  await assertPbguTx(version, 'createVault');
  const res = await assertPbguTx(version, 'completeSetup');

  const backOfficeAddress = getEventFromLogs(res.logs, CONTRACT_NAMES.VERSION, 'NewFund').backOffice;
  const fund = await getFundComponents(backOfficeAddress);

  const requestedShares = toWei('100', 'ether');
  const investmentAmount = toWei('100', 'ether');

  await send(
    quoteToken,
    'approve',
    [fund.participation.options.address, investmentAmount],
    defaultTxOpts
  );

  const incentiveInputAmount = toWei('100', 'ether');
  await send(registry, 'setIncentive', [incentiveInputAmount], defaultTxOpts);
  const newIncentiveAmount = await call(registry, 'incentive');
  expect(newIncentiveAmount).toBe(incentiveInputAmount);

  const preUserBalance = new BN(await web3.eth.getBalance(deployer));
  const gasPrice = await web3.eth.getGasPrice();
  const requestInvestmentRes = await send(
    fund.participation,
    'requestInvestment',
    [
      requestedShares,
      investmentAmount,
      quoteToken.options.address
    ],
    { ...defaultTxOpts, value: toWei('101', 'ether'), gasPrice }
  );

  const {
    payer,
    pbguChargableGas,
    incentivePaid
  } = getEventFromLogs(
    requestInvestmentRes.logs,
    CONTRACT_NAMES.PARTICIPATION,
    'PbguPaid',
  );

  const postUserBalance = new BN(await web3.eth.getBalance(deployer));

  const wethAddress = await call(registry, 'nativeAsset');
  const risqAddress = await call(version, 'risqToken');
  const risqPbguAmount = new BN(pbguPrice).mul(new BN(pbguChargableGas));
  const ethPbguAmount = new BN(
    await call(
      priceSource,
      'convertQuantity',
      [risqPbguAmount.toString(), risqAddress, wethAddress]
    )
  );

  const txCostInWei = new BN(gasPrice).mul(new BN(requestInvestmentRes.gasUsed));
  const estimatedTotalUserCost = ethPbguAmount.add(txCostInWei).add(new BN(newIncentiveAmount));
  const totalUserCost = preUserBalance.sub(postUserBalance);

  expect(txCostInWei).bigNumberLt(totalUserCost);
  expect(estimatedTotalUserCost).bigNumberEq(totalUserCost);
  expect(payer.toLowerCase()).toBe(deployer.toLowerCase());
  expect(new BN(incentivePaid)).bigNumberEq(new BN(newIncentiveAmount));
});
