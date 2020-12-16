import { BN, toWei, randomHex } from 'web3-utils';
import { deploy } from '~/deploy/utils/deploy-contract';
import web3 from '~/deploy/utils/get-web3';
import { CONTRACT_NAMES, EMPTY_ADDRESS } from '~/tests/utils/constants';
import deployMockSystem from '~/tests/utils/deployMockSystem';

describe('trading', () => {
  let user, defaulTxOpts;
  let mockSystem;
  let trading;

  // Mock data
  const mockExchanges = [ randomHex(20), randomHex(20) ];
  const mockExchangeAdapters = [ randomHex(20), randomHex(20) ];

  beforeAll(async () => {
    const accounts = await web3.eth.getAccounts();
    user = accounts[0];
    defaulTxOpts = { from: user, gas: 8000000 }
    mockSystem = await deployMockSystem();
    for (const i in mockExchanges) {
      await mockSystem.registry.methods
        .registerExchangeAdapter(mockExchanges[i], mockExchangeAdapters[i])
        .send({ from: user, gas: 8000000 });
    }

    trading = await deploy(CONTRACT_NAMES.TRADING, [
      mockSystem.backOffice.options.address,
      mockExchanges,
      mockExchangeAdapters,
      mockSystem.registry.options.address,
    ]);

    await mockSystem.backOffice.methods
      .setRunners([
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        mockSystem.vault.options.address,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
        EMPTY_ADDRESS,
      ])
      .send(defaulTxOpts);
    await mockSystem.backOffice.methods
      .initializeRunner(trading.options.address)
      .send({ from: user, gas: 8000000 });
  });

  test('Exchanges are properly initialized', async () => {
    for (const i in mockExchanges) {
      const exchangeObject = await trading.methods.exchanges(i).call();
      expect(exchangeObject.exchange.toLowerCase()).toBe(mockExchanges[i]);
      expect(exchangeObject.adapter.toLowerCase()).toBe(mockExchangeAdapters[i]);
      const exchangeAdded = await trading.methods
        .adapterIsAdded(exchangeObject.adapter)
        .call();
      expect(exchangeAdded).toBe(true);
    }
  });

  test('Exchanges cannot be initialized without their adapters', async () => {
    await expect(
      deploy(CONTRACT_NAMES.TRADING, [
        mockSystem.backOffice.options.address,
        mockExchanges,
        [mockExchangeAdapters[0]],
        mockSystem.registry.options.address,
      ], {gas: 8000000})
    ).rejects.toThrow('Array lengths unequal');
  });

  test('returnBatchToVault sends back token balances to the vault', async () => {
    const tokenQuantity = new BN(toWei('1', 'Ether'));

    await mockSystem.risq.methods
      .transfer(trading.options.address, `${tokenQuantity}`)
      .send(defaulTxOpts);
    await mockSystem.weth.methods
      .transfer(trading.options.address, `${tokenQuantity}`)
      .send(defaulTxOpts);

    const preRisqVault = new BN(
      await mockSystem.risq.methods.balanceOf(mockSystem.vault.options.address).call(),
    );
    const preWethVault = new BN(
      await mockSystem.weth.methods.balanceOf(mockSystem.vault.options.address).call(),
    );

    await trading.methods
      .returnBatchToVault([
        mockSystem.risq.options.address,
        mockSystem.weth.options.address,
      ])
      .send(defaulTxOpts);

    const postRisqTrading = new BN(
      await mockSystem.risq.methods.balanceOf(trading.options.address).call(),
    );
    const postWethTrading = new BN(
      await mockSystem.weth.methods
        .balanceOf(trading.options.address)
        .call(),
    );
    const postRisqVault = new BN(
      await mockSystem.risq.methods.balanceOf(mockSystem.vault.options.address).call(),
    );
    const postWethVault = new BN(
      await mockSystem.weth.methods.balanceOf(mockSystem.vault.options.address).call(),
    );

    expect(postRisqTrading.isZero()).toBe(true);
    expect(postWethTrading.isZero()).toBe(true);
    expect(postRisqVault.eq(preRisqVault.add(tokenQuantity))).toBe(true);
    expect(postWethVault.eq(preWethVault.add(tokenQuantity))).toBe(true);
  });
});
