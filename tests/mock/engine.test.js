import { BN, toWei } from 'web3-utils';
import { deploy } from '~/deploy/utils/deploy-contract';
import web3 from '~/deploy/utils/get-web3';
import { BNExpDiv } from '~/tests/utils/BNmath';
import { CONTRACT_NAMES } from '~/tests/utils/constants';
import { increaseTime } from '~/tests/utils/rpc';

describe('sell-and-burn-risq', () => {
  let deployer, altUser;
  let defaultTxOpts, altUserTxOpts;
  let contracts;
  const delay = 30 * 24 * 60 * 60; // 30 days

  beforeAll(async () => {
    const accounts = await web3.eth.getAccounts();
    [deployer, altUser] = accounts;
    defaultTxOpts = { from: deployer, gas: 8000000 };
    altUserTxOpts = { ...defaultTxOpts, from: altUser };

    const weth = await deploy(CONTRACT_NAMES.PREMINED_TOKEN, ['WETH', 18, '']);
    const risq = await deploy(CONTRACT_NAMES.BURNABLE_TOKEN, ['RISQ', 18, '']);
    const version = await deploy(CONTRACT_NAMES.MOCK_VERSION);
    const registry = await deploy(CONTRACT_NAMES.MOCK_REGISTRY);
    const priceSource = await deploy(
      CONTRACT_NAMES.TESTING_PRICEFEED,
      [weth.options.address, 18]
    );
    const engine = await deploy(
      CONTRACT_NAMES.ENGINE,
      [delay, registry.options.address]
    );
    contracts = { engine, risq, priceSource, registry, version }

    await registry.methods
      .setPriceSource(priceSource.options.address)
      .send(defaultTxOpts);
    await registry.methods
      .setRisqToken(risq.options.address)
      .send(defaultTxOpts);
    await engine.methods
      .setRegistry(registry.options.address)
      .send(defaultTxOpts);
    await priceSource.methods
      .update(
        [weth.options.address, risq.options.address],
        [toWei('1', 'ether'), toWei('2', 'ether')]
      )
      .send(defaultTxOpts);
  });

  test('directly sending eth fails', async () => {
    const { engine } = contracts;
    await expect(
      web3.eth
        .sendTransaction({
          from: deployer,
          to: engine.options.address,
          value: 1,
          gas: 8000000
        })
    ).rejects.toThrow('revert');
  });

  test('eth sent via contract selfdestruct is not tracked', async () => {
    const { engine } = contracts;

    const sendAmount = toWei('0.1', 'gwei');
    const selfDestructing = await deploy(CONTRACT_NAMES.SELF_DESTRUCTING);

    const preEthEngine = await web3.eth
      .getBalance(engine.options.address);
    expect(new BN(preEthEngine)).bigNumberEq(new BN(0));

    await web3.eth
      .sendTransaction({
        from: deployer,
        to: selfDestructing.options.address,
        value: sendAmount,
        gas: 8000000
      });
    await selfDestructing.methods
      .bequeath(engine.options.address)
      .send(defaultTxOpts);

    const postEthEngine = await web3.eth.getBalance(engine.options.address);
    const postFrozenEth = await engine.methods.frozenEther().call();
    const postLiquidEth = await engine.methods.liquidEther().call();

    expect(new BN(postEthEngine)).bigNumberEq(new BN(sendAmount));
    expect(new BN(postFrozenEth)).bigNumberEq(new BN(0));
    expect(new BN(postLiquidEth)).bigNumberEq(new BN(0));
  });

  test('PBGU payment fails when sender not fund', async () => {
    const { engine, registry } = contracts;
    const sendAmount = toWei('0.001', 'gwei');

    const isFund = await registry.methods.isFund(deployer).call();
    expect(isFund).toBe(false);

    await expect(
      engine.methods
        .payPbguInEther()
        .send({ ...defaultTxOpts, value: sendAmount })
    ).rejects.toThrow('revert');
  });

  test('eth sent as PBGU from a "fund" thaws and can be bought', async () => {
    const { engine, priceSource, risq, registry } = contracts;

    const sendAmountEth = '100000';

    await registry.methods.setIsFund(deployer).send(defaultTxOpts);
    const isFund = await registry.methods.isFund(deployer).call();
    expect(isFund).toBe(true);

    await engine.methods
      .payPbguInEther()
      .send({ ...defaultTxOpts, value: sendAmountEth });

    const preFrozenEth = new BN(await engine.methods.frozenEther().call());
    const preLiquidEth = new BN(await engine.methods.liquidEther().call());

    expect(preFrozenEth).bigNumberEq(new BN(sendAmountEth));
    expect(preLiquidEth).bigNumberEq(new BN(0));

    // early call to thaw fails
    await expect(
      engine.methods.thaw().send(altUserTxOpts),
    ).rejects.toThrow('revert');

    const enginePrice = new BN(await engine.methods.enginePrice().call());
    const premiumPercent = new BN(
      await engine.methods.premiumPercent().call()
    );
    const ethPerRisq = new BN(
      (await priceSource.methods.getPrice(risq.options.address).call()).price,
    );
    const premiumPrice =
      ethPerRisq.add(ethPerRisq.mul(premiumPercent).div(new BN(100)));

    expect(enginePrice).bigNumberEq(premiumPrice);

    const sendAmountRisq = BNExpDiv(
      new BN(sendAmountEth),
      premiumPrice
    ).toString();

    await risq.methods
      .approve(engine.options.address, sendAmountRisq)
      .send(defaultTxOpts);

    await expect(
      // throws when trying to burn without liquid ETH
      engine.methods.sellAndBurnRisq(sendAmountRisq).send(defaultTxOpts)
    ).rejects.toThrow('revert');

    await increaseTime(delay);

    await engine.methods.thaw().send(altUserTxOpts);

    const postFrozenEth = new BN(await engine.methods.frozenEther().call());
    const postLiquidEth = new BN(await engine.methods.liquidEther().call());

    expect(postFrozenEth).bigNumberEq(new BN(0));
    expect(postLiquidEth).bigNumberEq(new BN(sendAmountEth));

    const preBurnerRisq = new BN(await risq.methods.balanceOf(deployer).call());
    const preBurnerEth = new BN(await web3.eth.getBalance(deployer));
    const preEngineEth = new BN(
      await web3.eth.getBalance(engine.options.address)
    );
    const preRisqTotalSupply = new BN(await risq.methods.totalSupply().call());
    const expectedEthPurchased = new BN(
      await engine.methods.ethPayoutForRisqAmount(sendAmountRisq).call()
    );

    const gasPrice = new BN(toWei('2', 'gwei'));
    const receipt = await engine.methods
      .sellAndBurnRisq(sendAmountRisq)
      .send({ ...defaultTxOpts, gasPrice });

    const gasUsedCost =
      new BN(receipt.gasUsed).mul(gasPrice);
    const postBurnerEth = new BN(await web3.eth.getBalance(deployer));
    const postBurnerRisq = new BN(await risq.methods.balanceOf(deployer).call());
    const postEngineEth = new BN(
      await web3.eth.getBalance(engine.options.address)
    );
    const postEngineRisq = new BN(
      await risq.methods.balanceOf(engine.options.address).call()
    );
    const postRisqTotalSupply = new BN(await risq.methods.totalSupply().call());

    expect(postBurnerRisq).bigNumberEq(preBurnerRisq.sub(new BN(sendAmountRisq)));
    expect(postBurnerEth).bigNumberEq(
      preBurnerEth.sub(gasUsedCost).add(expectedEthPurchased)
    );
    expect(postEngineRisq).bigNumberEq(new BN(0));
    expect(postEngineEth).bigNumberEq(preEngineEth.sub(expectedEthPurchased));

    expect(
      postRisqTotalSupply).bigNumberEq(preRisqTotalSupply.sub(new BN(sendAmountRisq))
    );
  });

  // TODO:
  // test('Other contracts can pay pbgu on function calls', async () => {});
  // test('Engine price and premium computes at multiple values', async () => {});
});
