import { EthereumTestnetProvider } from '@crestproject/crestproject';
import { StandardToken } from '@risqprotocol/protocol';
import { randomizedTestDeployment } from '@risqprotocol/testutils';
import { BigNumber, utils } from 'ethers';

async function snapshot(provider: EthereumTestnetProvider) {
  const { accounts, deployment, config } = await randomizedTestDeployment(provider);
  return { accounts, deployment, config };
}

describe('calcLiveAssetValue', () => {
  it('correctly calculates a value (derivative baseAsset and quoteAsset)', async () => {
    const {
      config: {
        deployer,
        derivatives: {
          uniswapV2: { risqWeth: risqWethAddress },
        },
      },
      deployment: {
        centralizedRateProvider,
        valueInterpreter,
        tokens: { dai: refAsset },
        compoundTokens: { cusdc },
      },
    } = await provider.snapshot(snapshot);

    const risqWeth = new StandardToken(risqWethAddress, deployer);

    const cusdcAssetDecimals = await cusdc.decimals();
    const risqWethAssetDecimals = await risqWeth.decimals();

    const amountIn = utils.parseUnits('1', cusdcAssetDecimals);

    const cusdcValue = (
      await valueInterpreter.calcLiveAssetValue.args(cusdc, utils.parseUnits('1', cusdcAssetDecimals), refAsset).call()
    ).value_;

    const risqWethValue = (
      await valueInterpreter.calcLiveAssetValue
        .args(risqWeth, utils.parseUnits('1', risqWethAssetDecimals), refAsset)
        .call()
    ).value_;

    const expectedRisqWeth = cusdcValue
      .mul(amountIn)
      .mul(utils.parseUnits('1', risqWethAssetDecimals))
      .div(risqWethValue)
      .div(utils.parseUnits('1', cusdcAssetDecimals));

    const calculateRisqWeth = await centralizedRateProvider.calcLiveAssetValue.args(cusdc, amountIn, risqWeth).call();
    expect(expectedRisqWeth).toEqBigNumber(calculateRisqWeth);
  });
});

describe('calcLiveAssetValueRandomized', () => {
  it('correctly calculates a randomized asset value on sender', async () => {
    const {
      accounts: [accountZero, accountOne],
      deployment: {
        centralizedRateProvider,
        tokens: { dai, risq },
      },
    } = await provider.snapshot(snapshot);

    await centralizedRateProvider.setMaxDeviationPerSender(BigNumber.from('20'));

    const liveAssetValueAccountZero = await centralizedRateProvider
      .connect(accountZero)
      .calcLiveAssetValueRandomized.args(risq, utils.parseEther('1'), dai, 0)
      .call();

    const liveAssetValueAccountOne = await centralizedRateProvider
      .connect(accountOne)
      .calcLiveAssetValueRandomized.args(risq, utils.parseEther('1'), dai, 0)
      .call();

    // Min max values given a sender slippage of 5%
    const minimumExpectedValue = utils.parseEther('0.80');
    const maximumExpectedValue = utils.parseEther('1.20');

    // Randomized function has low entropy, there could be a collision here
    expect(liveAssetValueAccountZero).not.toEqBigNumber(liveAssetValueAccountOne);

    // Check both accounts return a value inside bonds
    expect(liveAssetValueAccountZero).toBeGteBigNumber(minimumExpectedValue);
    expect(liveAssetValueAccountZero).toBeLteBigNumber(maximumExpectedValue);
    expect(liveAssetValueAccountOne).toBeGteBigNumber(minimumExpectedValue);
    expect(liveAssetValueAccountOne).toBeLteBigNumber(maximumExpectedValue);
  });

  it('correctly calculates a randomized asset value on time', async () => {
    const {
      accounts: [account],
      deployment: {
        centralizedRateProvider,
        tokens: { dai, risq },
      },
    } = await provider.snapshot(snapshot);

    await centralizedRateProvider.setMaxDeviationPerSender(BigNumber.from('0'));

    const liveAssetValueBlockOne = await centralizedRateProvider
      .connect(account)
      .calcLiveAssetValueRandomized.args(risq, utils.parseEther('1'), dai, 5)
      .call();

    await provider.send('evm_mine', []);

    const liveAssetValueBlockTwo = await centralizedRateProvider
      .connect(account)
      .calcLiveAssetValueRandomized.args(risq, utils.parseEther('1'), dai, 5)
      .call();

    // Min max values given a sender slippage of 10% (5% + 5% combined)
    const minimumExpectedValue = utils.parseEther('0.90');
    const maximumExpectedValue = utils.parseEther('1.10');

    // Randomized function has low entropy, there could be a collision here
    expect(liveAssetValueBlockOne).not.toEqBigNumber(liveAssetValueBlockTwo);

    // Check both accounts return a value inside bonds
    expect(liveAssetValueBlockOne).toBeGteBigNumber(minimumExpectedValue);
    expect(liveAssetValueBlockOne).toBeLteBigNumber(maximumExpectedValue);
    expect(liveAssetValueBlockTwo).toBeGteBigNumber(minimumExpectedValue);
    expect(liveAssetValueBlockTwo).toBeLteBigNumber(maximumExpectedValue);
  });
});
