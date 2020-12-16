import { toWei } from 'web3-utils';

import { deploy } from '~/deploy/utils/deploy-contract';
import web3 from '~/deploy/utils/get-web3';

import { CONTRACT_NAMES } from '~/tests/utils/constants';

/**
 * Deploys a fresh set of (potentially) mocked contracts.
 * Arguments can be overriden to deploy mock or real contracts as needed.
 */
const deployMockSystem = async (
  {
    accountingContract = CONTRACT_NAMES.MOCK_ACCOUNTING,
    engineContract = CONTRACT_NAMES.ENGINE,
    feeManagerContract = CONTRACT_NAMES.MOCK_FEE_MANAGER,
    fees = [],
    backOfficeContract = CONTRACT_NAMES.MOCK_BACK_OFFICE,
    policyManagerContract = CONTRACT_NAMES.POLICY_MANAGER,
    participationContract = CONTRACT_NAMES.PARTICIPATION,
    priceSourceContract = CONTRACT_NAMES.TESTING_PRICEFEED,
    registryContract = CONTRACT_NAMES.MOCK_REGISTRY,
    sharesContract = CONTRACT_NAMES.MOCK_SHARES,
    tradingContract = CONTRACT_NAMES.TRADING,
    vaultContract = CONTRACT_NAMES.VAULT,
    versionContract = CONTRACT_NAMES.MOCK_VERSION
  } = {},
) => {
  const deployer = web3.eth.accounts.wallet[0].address;
  const defaultTxOpts = { from: deployer, gas: 8000000 };

  const weth = await deploy(CONTRACT_NAMES.WETH);
  const risq = await deploy(CONTRACT_NAMES.PREMINED_TOKEN, ['RISQ', 18, 'Risq']);

  const quoteToken = weth;
  const baseToken = risq;

  // Deposit Ether to get WETH Tokens
  const depositAmount = toWei('1000000', 'ether');
  await weth.methods
    .deposit()
    .send({ ...defaultTxOpts, value: depositAmount });

  const quoteTokenDecimals = await weth.methods.decimals().call();
  const priceSource = await deploy(
    priceSourceContract,
    [
      quoteToken.options.address,
      quoteTokenDecimals,
    ]
  );

  const closeTime = 999999999999;
  const oasisDex = await deploy(
    CONTRACT_NAMES.OASIS_DEX_EXCHANGE,
    [closeTime]
  );
  await oasisDex.methods
    .addTokenPairWhitelist(
      quoteToken.options.address,
      baseToken.options.address
    )
    .send(defaultTxOpts)

  const oasisDexAdapter = await deploy(CONTRACT_NAMES.OASIS_DEX_ADAPTER);

  const version = await deploy(versionContract);
  const registry = await deploy(registryContract);

  await registry.methods
    .setPriceSource(priceSource.options.address)
    .send(defaultTxOpts);
  await registry.methods
    .setRisqToken(risq.options.address)
    .send(defaultTxOpts);
  await registry.methods
    .setNativeAsset(weth.options.address)
    .send(defaultTxOpts);
  await registry.methods
    .registerExchangeAdapter(
      oasisDex.options.address,
      oasisDexAdapter.options.address,
    )
    .send(defaultTxOpts);

  const backOffice = await deploy(backOfficeContract);
  await backOffice.methods
    .setManager(deployer)
    .send(defaultTxOpts);
  await backOffice.methods
    .setName('Mock')
    .send(defaultTxOpts);

  const accounting = await deploy(
    accountingContract,
    [
      backOffice.options.address,
      quoteToken.options.address,
      weth.options.address
    ]
  );

  const feeManager = await deploy(
    feeManagerContract,
    [
      backOffice.options.address,
      quoteToken.options.address,
      fees.map(f => f.feeAddress),
      fees.map(f => f.feePeriod),
      fees.map(f => f.feeRate),
      registry.options.address
    ]
  );

  const policyManager = await deploy(
    policyManagerContract,
    [backOffice.options.address]
  );

  const participation = await deploy(
    participationContract,
    [
      backOffice.options.address,
      [quoteToken.options.address, baseToken.options.address],
      registry.options.address,
    ]
  );

  const shares = await deploy(
    sharesContract,
    [backOffice.options.address]
  );

  const trading = await deploy(
    tradingContract,
    [
      backOffice.options.address,
      [oasisDex.options.address],
      [oasisDexAdapter.options.address],
      registry.options.address,
    ]
  );

  const vault = await deploy(
    vaultContract,
    [backOffice.options.address]
  );

  // TODO: replace with raw function when MockEngine is available
  const thawTime = 30 * 24 * 60 * 60;
  const engine = await deploy(
    engineContract,
    [thawTime, registry.options.address]
  );

  await registry.methods
    .setEngine(engine.options.address)
    .send(defaultTxOpts);
  await engine.methods
    .setRegistry(registry.options.address)
    .send(defaultTxOpts);

  await backOffice.methods
    .setRunners([
      accounting.options.address,
      feeManager.options.address,
      participation.options.address,
      policyManager.options.address,
      shares.options.address,
      trading.options.address,
      vault.options.address,
      registry.options.address,
      version.options.address,
      engine.options.address,
      risq.options.address,
    ])
    .send(defaultTxOpts);

  const toInit = [
    accounting,
    participation,
    shares,
    trading,
    vault,
    feeManager,
  ];
  for (const contract of toInit) {
    await backOffice.methods
      .initializeRunner(contract.options.address)
      .send(defaultTxOpts);
  }
  await backOffice.methods
    .setPermissions()
    .send(defaultTxOpts);

  const contracts = {
    accounting,
    engine,
    feeManager,
    backOffice,
    risq,
    participation,
    policyManager,
    priceSource,
    registry,
    shares,
    trading,
    vault,
    version,
    weth,
  };

  return contracts;
};

module.exports = deployMockSystem;
