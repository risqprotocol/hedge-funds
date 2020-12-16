const {call, send, nab} = require('../utils/deploy-contract');
const web3 = require('../utils/get-web3');
const BN = web3.utils.BN;

// TODO: check whether each "send" needs to be done before sending it
const main = async input => {
  const conf = input.conf;
  const risqConf = input.risq.conf;
  const risqAddrs = input.risq.addr;
  const tokenAddrs = input.tokens.addr;

  const ethfinexAdapter = await nab('EthfinexAdapter', [], risqAddrs);
  const kyberAdapter = await nab('KyberAdapter', [], risqAddrs);
  const oasisDexAdapter = await nab('OasisDexAdapter', [], risqAddrs);
  const oasisDexAccessor = await nab('OasisDexAccessor', [], risqAddrs);
  const uniswapAdapter = await nab('UniswapAdapter', [], risqAddrs);
  const zeroExV2Adapter = await nab('ZeroExV2Adapter', [], risqAddrs);
  const zeroExV3Adapter = await nab('ZeroExV3Adapter', [], risqAddrs);
  const engineAdapter = await nab('EngineAdapter', [], risqAddrs);
  const priceTolerance = await nab('PriceTolerance', [risqConf.priceTolerance], risqAddrs);
  const userWhitelist = await nab('UserWhitelist', [risqConf.userWhitelist], risqAddrs);
  const managementFee = await nab('ManagementFee', [], risqAddrs);
  const performanceFee = await nab('PerformanceFee', [], risqAddrs);
  const accountingFactory = await nab('AccountingFactory', [], risqAddrs);
  const feeManagerFactory = await nab('FeeManagerFactory', [], risqAddrs);
  const participationFactory = await nab('ParticipationFactory', [], risqAddrs);
  const policyManagerFactory = await nab('PolicyManagerFactory', [], risqAddrs);
  const sharesFactory = await nab('SharesFactory', [], risqAddrs);
  const tradingFactory = await nab('TradingFactory', [], risqAddrs);
  const vaultFactory = await nab('VaultFactory', [], risqAddrs);
  const registry = await nab('Registry', [risqConf.registryOwner], risqAddrs);
  const engine = await nab('Engine', [risqConf.engineDelay, registry.options.address], risqAddrs);

  let priceSource;
  if (conf.track === 'KYBER_PRICE') {
    priceSource = await nab('KyberPriceFeed', [
      registry.options.address, input.kyber.addr.KyberNetworkProxy,
      risqConf.maxSpread, tokenAddrs.WETH, risqConf.initialUpdater
    ], risqAddrs);
  } else if (conf.track === 'TESTING') {
    priceSource = await nab('TestingPriceFeed', [tokenAddrs.WETH, input.tokens.conf.WETH.decimals], risqAddrs);
  }

  const previousRegisteredPriceSource = await call(registry, 'priceSource');
  if (`${previousRegisteredPriceSource}`.toLowerCase() !== priceSource.options.address.toLowerCase()) {
    await send(registry, 'setPriceSource', [priceSource.options.address]);
  }
  const previousRegisteredNativeAsset = await call(registry, 'nativeAsset');
  if (`${previousRegisteredNativeAsset}`.toLowerCase() !== tokenAddrs.WETH.toLowerCase()) {
    await send(registry, 'setNativeAsset', [tokenAddrs.WETH]);
  }
  const previousRegisteredRisqToken = await call(registry, 'risqToken');
  if (`${previousRegisteredRisqToken}`.toLowerCase() !== tokenAddrs.RISQ.toLowerCase()) {
    await send(registry, 'setRisqToken', [tokenAddrs.RISQ]);
  }
  const previousRegisteredEngine = await call(registry, 'engine');
  if (`${previousRegisteredEngine}`.toLowerCase() !== engine.options.address.toLowerCase()) {
    await send(registry, 'setEngine', [engine.options.address]);
  }
  const previousRegisteredMGM = await call(registry, 'MGM');
  if (`${previousRegisteredMGM}`.toLowerCase() !== risqConf.initialMGM.toLowerCase()) {
    await send(registry, 'setMGM', [risqConf.initialMGM]);
  }
  const previousRegisteredEthfinexWrapperRegistry = await call(registry, 'MGM');
  if (input.ethfinex) {
    if (`${previousRegisteredEthfinexWrapperRegistry}`.toLowerCase() !== input.ethfinex.addr.WrapperRegistryEFX.toLowerCase()) {
      await send(registry, 'setEthfinexWrapperRegistry', [input.ethfinex.addr.WrapperRegistryEFX]);
    }
  }
  await send(registry, 'registerFees', [[ managementFee.options.address, performanceFee.options.address]]);

  const sigs = [
    'makeOrder(address,address[8],uint256[8],bytes[4],bytes32,bytes)',
    'takeOrder(address,address[8],uint256[8],bytes[4],bytes32,bytes)',
    'cancelOrder(address,address[8],uint256[8],bytes[4],bytes32,bytes)',
    'withdrawTokens(address,address[8],uint256[8],bytes[4],bytes32,bytes)',
  ].map(s => web3.utils.keccak256(s).slice(0,10));

  const exchanges = {};
  exchanges.engine = {
    exchange: engine.options.address,
    adapter: engineAdapter.options.address,
    takesCustody: risqConf.exchangeTakesCustody.engine
  };
  if (input.ethfinex) {
    exchanges.ethfinex = {
      exchange: input.ethfinex.addr.ZeroExV2Exchange,
      adapter: ethfinexAdapter.options.address,
      takesCustody: risqConf.exchangeTakesCustody.ethfinex
    };
  }
  if (input.kyber) {
    exchanges.kyber = {
      exchange: input.kyber.addr.KyberNetworkProxy,
      adapter: kyberAdapter.options.address,
      takesCustody: risqConf.exchangeTakesCustody.kyber
    };
  }
  if (input.oasis) {
    exchanges.oasis = {
      exchange: input.oasis.addr.OasisDexExchange,
      adapter: oasisDexAdapter.options.address,
      takesCustody: risqConf.exchangeTakesCustody.oasis
    };
  }
  if (input.uniswap) {
    exchanges.uniswap = {
      exchange: input.uniswap.addr.UniswapFactory,
      adapter: uniswapAdapter.options.address,
      takesCustody: risqConf.exchangeTakesCustody.uniswap
    };
  }
  if (input.zeroExV2) {
    exchanges.zeroExV2 = {
      exchange: input.zeroExV2.addr.ZeroExV2Exchange,
      adapter: zeroExV2Adapter.options.address,
      takesCustody: risqConf.exchangeTakesCustody.zeroExV2
    };
  }
  if (input.zeroExV3) {
    exchanges.zeroExV3 = {
      exchange: input.zeroExV3.addr.ZeroExV3Exchange,
      adapter: zeroExV3Adapter.options.address,
      takesCustody: risqConf.exchangeTakesCustody.zeroExV3
    };
  }

  for (const info of Object.values(exchanges)) {
    const isRegistered = await call(registry, 'exchangeAdapterIsRegistered', [info.adapter]);
    // TODO: check here if we actually need to update as well
    if (isRegistered) {
      await send(registry, 'updateExchangeAdapter', [info.exchange, info.adapter, info.takesCustody, sigs]);
    } else {
      await send(registry, 'registerExchangeAdapter', [info.exchange, info.adapter, info.takesCustody, sigs]);
    }
  }

  for (const [sym, info] of Object.entries(input.tokens.conf)) {
    const tokenAddress = tokenAddrs[sym];
    const assetInfo = await call(registry, 'assetInformation', [tokenAddress]);
    const reserveMin = info.reserveMin || '0';
    if (!assetInfo.exists) {
      await send(registry, 'registerAsset', [tokenAddress, info.name, sym, '', reserveMin, [], []]);
    } else {
      await send(registry, 'updateAsset', [tokenAddress, info.name, sym, '', reserveMin, [], []]);
    }
    if (conf.track === 'TESTING') {
      const previousDecimals = await call(priceSource, 'assetsToDecimals', [tokenAddress]);
      if (previousDecimals.toString() !== info.decimals.toString()) {
        await send(priceSource, 'setDecimals', [tokenAddress, info.decimals]);
      }
    }
  }

  const version = await nab('Version', [
    accountingFactory.options.address,
    feeManagerFactory.options.address,
    participationFactory.options.address,
    sharesFactory.options.address,
    tradingFactory.options.address,
    vaultFactory.options.address,
    policyManagerFactory.options.address,
    registry.options.address,
    risqConf.versionOwner
  ], risqAddrs);

  const versionInformation = await call(registry, 'versionInformation', [version.options.address]);

  if (!versionInformation.exists) {
    let versionName;
    if (conf.track === 'TESTING') {
      versionName = web3.utils.padLeft(web3.utils.toHex(risqConf.versionName), 64)
    } else {
      versionName = web3.utils.padLeft(web3.utils.toHex(`${Date.now()}`), 64)
    }
    await send(registry, 'registerVersion', [ version.options.address, versionName ]);
  }

  if (conf.track === 'KYBER_PRICE')
    await send(priceSource, 'update');
  else if (conf.track === 'TESTING') {
    // TODO: get actual prices
    const fakePrices = Object.values(tokenAddrs).map(() => (new BN('10')).pow(new BN('18')).toString());
    await send(priceSource, 'update', [Object.values(tokenAddrs), fakePrices]);
  }

  const contracts = {
    "EthfinexAdapter": ethfinexAdapter,
    "KyberAdapter": kyberAdapter,
    "OasisDexAdapter": oasisDexAdapter,
    "OasisDexAccessor": oasisDexAccessor,
    "UniswapAdapter": uniswapAdapter,
    "ZeroExV2Adapter": zeroExV2Adapter,
    "ZeroExV3Adapter": zeroExV3Adapter,
    "EngineAdapter": engineAdapter,
    "PriceTolerance": priceTolerance,
    "UserWhitelist": userWhitelist,
    "ManagementFee": performanceFee,
    "AccountingFactory": accountingFactory,
    "FeeManagerFactory": feeManagerFactory,
    "ParticipationFactory": participationFactory,
    "PolicyManagerFactory": policyManagerFactory,
    "SharesFactory": sharesFactory,
    "TradingFactory": tradingFactory,
    "VaultFactory": vaultFactory,
    "PerformanceFee": performanceFee,
    "ManagementFee": managementFee,
    "Registry": registry,
    "Engine": engine,
    "Version": version,
  };

  if (conf.track === 'KYBER_PRICE') {
    contracts.KyberPriceFeed = priceSource;
  } else if (conf.track === 'TESTING') {
    contracts.TestingPriceFeed = priceSource;
  }

  return contracts;
}

module.exports = main;
