import { IChainlinkAggregator, StandardToken } from '@risqprotocol/protocol';
import { ForkDeployment, loadForkDeployment } from '@risqprotocol/testutils';
import { utils } from 'ethers';
import hre from 'hardhat';

let fork: ForkDeployment;

beforeEach(async () => {
  fork = await loadForkDeployment();
});

describe('calcUnderlyingValues', () => {
  it('returns rate for underlying token weth', async () => {
    const wdgldPriceFeed = fork.deployment.WdgldPriceFeed;
    const wdgld = new StandardToken(fork.config.wdgld.wdgld, hre.ethers.provider);
    const weth = new StandardToken(fork.config.weth, hre.ethers.provider);
    const xauAggregator = new IChainlinkAggregator(fork.config.wdgld.xauusd, hre.ethers.provider);
    const ethUSDAggregator = new IChainlinkAggregator(fork.config.wdgld.ethusd, hre.ethers.provider);

    const xauToUsdRate = await xauAggregator.latestAnswer();
    const ethToUsdRate = await ethUSDAggregator.latestAnswer();

    const wdgldToXauRate = await wdgldPriceFeed.calcWdgldToXauRate();

    const wdgldUnit = utils.parseUnits('1', 8);

    const underlyingValues = await wdgldPriceFeed.calcUnderlyingValues.args(wdgld, wdgldUnit).call();
    // 10**17 is a combination of ETH_UNIT / WDGLD_UNIT * GTR_PRECISION
    const expectedAmount = wdgldUnit
      .mul(wdgldToXauRate)
      .mul(xauToUsdRate)
      .div(ethToUsdRate)
      .div(utils.parseUnits('1', 17));

    expect(underlyingValues.underlyings_[0]).toMatchAddress(weth);
    expect(underlyingValues.underlyingAmounts_[0]).toEqBigNumber(expectedAmount);
  });

  it('returns the expected value from the valueInterpreter', async () => {
    const valueInterpreter = fork.deployment.ValueInterpreter;
    const wdgld = new StandardToken(fork.config.wdgld.wdgld, hre.ethers.provider);
    const usdc = new StandardToken(fork.config.primitives.usdc, hre.ethers.provider);

    // XAU/USD price at Jan 6, 2021 had a rate of 1849 USD. Given an approximate GTR of 0.0988xx gives a value around 182 USD
    const canonicalAssetValue = await valueInterpreter.calcCanonicalAssetValue
      .args(wdgld, utils.parseUnits('1', 8), usdc)
      .call();

    expect(canonicalAssetValue).toMatchFunctionOutput(valueInterpreter.calcCanonicalAssetValue, {
      value_: 180904956,
      isValid_: true,
    });
  });
});
