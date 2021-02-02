import { randomAddress, SignerWithAddress } from '@crestproject/crestproject';
import {
  adapterBlacklistArgs,
  adapterWhitelistArgs,
  assetBlacklistArgs,
  ComptrollerLib,
  convertRateToScaledPerSecondRate,
  entranceRateFeeConfigArgs,
  feeManagerConfigArgs,
  investorWhitelistArgs,
  managementFeeConfigArgs,
  maxConcentrationArgs,
  performanceFeeConfigArgs,
  policyManagerConfigArgs,
  StandardToken,
  VaultLib,
} from '@risqprotocol/protocol';
import {
  addTrackedAssets,
  buyShares,
  chaiLend,
  chaiRedeem,
  createNewFund,
  ForkDeployment,
  KyberNetworkProxy,
  kyberTakeOrder,
  loadForkDeployment,
  mainnetWhales,
  unlockWhales,
  redeemShares,
} from '@risqprotocol/testutils';
import { BigNumberish, utils } from 'ethers';
import hre from 'hardhat';

// All values are rounded up to nearest 1000
// Note that due to the nature of `toCostLessThan()`,
const expectedGasCosts = {
  'create fund': {
    weth: 703000,
    usdc: 710000,
  },
  'buy shares: denomination asset only: first investment': {
    weth: 418000,
    usdc: 437000,
  },
  'buy shares: denomination asset only: second investment': {
    weth: 446000,
    usdc: 454000,
  },
  'calc gav: denomination asset only': {
    weth: 44000,
    usdc: 48000,
  },
  'calc gav: 20 assets': {
    weth: 784000,
    usdc: 977000,
  },
  // Kyber is used here because it is one of the most expensive.
  // If another adapter is significantly more expensive, we should use that one.
  'trade on Kyber: max assets': {
    weth: 1656000,
    usdc: 2434100,
  },
  'redeem partial shares: max assets': {
    weth: 2268000,
    usdc: 2472000,
  },
  'buy shares: max assets': {
    weth: 1218000,
    usdc: 1439000,
  },
  'redeem all shares: max assets: all remaining': {
    weth: 2222000,
    usdc: 2348000,
  },
};
const gasAssertionTolerance = 0.03; // 3%
let fork: ForkDeployment;
const whales: Record<string, SignerWithAddress> = {};

beforeAll(async () => {
  // Denomination assets
  whales.usdc = ((await hre.ethers.getSigner(mainnetWhales.usdc)) as any) as SignerWithAddress;
  whales.weth = ((await hre.ethers.getSigner(mainnetWhales.weth)) as any) as SignerWithAddress;

  // Primitives
  whales.bat = ((await hre.ethers.getSigner(mainnetWhales.bat)) as any) as SignerWithAddress;
  whales.bnb = ((await hre.ethers.getSigner(mainnetWhales.bnb)) as any) as SignerWithAddress;
  whales.bnt = ((await hre.ethers.getSigner(mainnetWhales.bnt)) as any) as SignerWithAddress;
  whales.comp = ((await hre.ethers.getSigner(mainnetWhales.comp)) as any) as SignerWithAddress;
  whales.dai = ((await hre.ethers.getSigner(mainnetWhales.dai)) as any) as SignerWithAddress;
  whales.link = ((await hre.ethers.getSigner(mainnetWhales.link)) as any) as SignerWithAddress;
  whales.mana = ((await hre.ethers.getSigner(mainnetWhales.mana)) as any) as SignerWithAddress;
  whales.risq = ((await hre.ethers.getSigner(mainnetWhales.risq)) as any) as SignerWithAddress;
  whales.ren = ((await hre.ethers.getSigner(mainnetWhales.ren)) as any) as SignerWithAddress;
  whales.rep = ((await hre.ethers.getSigner(mainnetWhales.rep)) as any) as SignerWithAddress;
  whales.susd = ((await hre.ethers.getSigner(mainnetWhales.susd)) as any) as SignerWithAddress;
  whales.uni = ((await hre.ethers.getSigner(mainnetWhales.uni)) as any) as SignerWithAddress;
  whales.usdt = ((await hre.ethers.getSigner(mainnetWhales.usdt)) as any) as SignerWithAddress;
  whales.zrx = ((await hre.ethers.getSigner(mainnetWhales.zrx)) as any) as SignerWithAddress;

  // Compound tokens
  whales.ccomp = ((await hre.ethers.getSigner(mainnetWhales.ccomp)) as any) as SignerWithAddress;
  whales.cdai = ((await hre.ethers.getSigner(mainnetWhales.cdai)) as any) as SignerWithAddress;
  whales.ceth = ((await hre.ethers.getSigner(mainnetWhales.ceth)) as any) as SignerWithAddress;
  whales.cusdc = ((await hre.ethers.getSigner(mainnetWhales.cusdc)) as any) as SignerWithAddress;
  whales.cuni = ((await hre.ethers.getSigner(mainnetWhales.cuni)) as any) as SignerWithAddress;

  await unlockWhales({
    provider: hre.ethers.provider,
    whales: Object.values(whales),
  });
});

describe.each([['weth' as const], ['usdc' as const]])(
  'Walkthrough for %s as denomination asset',
  (denominationAssetId) => {
    let manager: SignerWithAddress;
    let investor: SignerWithAddress;
    let anotherInvestor: SignerWithAddress;

    let comptrollerProxy: ComptrollerLib;
    let vaultProxy: VaultLib;
    let denominationAsset: StandardToken;
    let denominationAssetDecimals: BigNumberish;

    beforeAll(async () => {
      fork = await loadForkDeployment();

      manager = fork.accounts[1];
      investor = fork.accounts[2];
      anotherInvestor = fork.accounts[3];

      denominationAsset =
        denominationAssetId === 'weth'
          ? new StandardToken(fork.config.weth, whales.weth)
          : new StandardToken(fork.config.primitives[denominationAssetId], whales[denominationAssetId]);
      denominationAssetDecimals = await denominationAsset.decimals();

      // Seed investors with denomination asset
      const denominationAssetSeedAmount = utils.parseUnits('100', await denominationAsset.decimals());
      await denominationAsset.transfer(investor, denominationAssetSeedAmount);
      await denominationAsset.transfer(anotherInvestor, denominationAssetSeedAmount);
    });

    it('creates a new fund', async () => {
      // fees
      const rate = utils.parseEther('0.01');
      const scaledPerSecondRate = convertRateToScaledPerSecondRate(rate);

      const managementFeeSettings = managementFeeConfigArgs(scaledPerSecondRate);
      const performanceFeeSettings = performanceFeeConfigArgs({
        rate: utils.parseEther('0.1'),
        period: 365 * 24 * 60 * 60,
      });
      const entranceRateFeeSettings = entranceRateFeeConfigArgs(utils.parseEther('0.05'));

      const feeManagerConfig = feeManagerConfigArgs({
        fees: [fork.deployment.ManagementFee, fork.deployment.PerformanceFee, fork.deployment.EntranceRateBurnFee],
        settings: [managementFeeSettings, performanceFeeSettings, entranceRateFeeSettings],
      });

      // policies
      const maxConcentrationSettings = maxConcentrationArgs(utils.parseEther('1'));
      const adapterBlacklistSettings = adapterBlacklistArgs([fork.deployment.CompoundAdapter]);
      const adapterWhitelistSettings = adapterWhitelistArgs([
        fork.deployment.KyberAdapter,
        fork.deployment.UniswapV2Adapter,
        fork.deployment.TrackedAssetsAdapter,
        fork.deployment.ChaiAdapter,
      ]);
      const assetBlacklistSettings = assetBlacklistArgs([fork.config.primitives.knc]);

      const policyManagerConfig = policyManagerConfigArgs({
        policies: [
          fork.deployment.MaxConcentration,
          fork.deployment.AdapterBlacklist,
          fork.deployment.AdapterWhitelist,
          fork.deployment.AssetBlacklist,
        ],
        settings: [
          maxConcentrationSettings,
          adapterBlacklistSettings,
          adapterWhitelistSettings,
          assetBlacklistSettings,
        ],
      });

      const createFundTx = await createNewFund({
        signer: manager,
        fundDeployer: fork.deployment.FundDeployer,
        fundOwner: manager,
        denominationAsset,
        feeManagerConfig,
        policyManagerConfig,
      });

      comptrollerProxy = createFundTx.comptrollerProxy;
      vaultProxy = createFundTx.vaultProxy;

      expect(createFundTx.receipt).toCostLessThan(
        expectedGasCosts['create fund'][denominationAssetId],
        gasAssertionTolerance,
      );
    });

    it('enables the InvestorWhitelist policy for the fund', async () => {
      const enabled = await fork.deployment.PolicyManager.connect(manager)
        .enablePolicyForFund.args(
          comptrollerProxy.address,
          fork.deployment.InvestorWhitelist,
          investorWhitelistArgs({
            investorsToAdd: [randomAddress(), randomAddress(), investor.address],
          }),
        )
        .send();

      expect(enabled).toBeReceipt();
    });

    it('buys shares of a fund', async () => {
      const buySharesTx = await buyShares({
        comptrollerProxy,
        signer: investor,
        buyers: [investor],
        denominationAsset,
        investmentAmounts: [utils.parseUnits('1', denominationAssetDecimals)],
        minSharesAmounts: [utils.parseUnits('0.00001', denominationAssetDecimals)],
      });

      const rate = utils.parseEther('0.05');
      const rateDivisor = utils.parseEther('1');
      const expectedFee = utils.parseUnits('1', denominationAssetDecimals).mul(rate).div(rateDivisor.add(rate));

      expect(await vaultProxy.balanceOf(investor)).toBeGteBigNumber(
        utils.parseUnits('1', denominationAssetDecimals).sub(expectedFee),
      );

      expect(buySharesTx).toCostLessThan(
        expectedGasCosts['buy shares: denomination asset only: first investment'][denominationAssetId],
        gasAssertionTolerance,
      );
    });

    it('buys more shares of a fund', async () => {
      const previousBalance = await vaultProxy.balanceOf(investor);

      const minSharesAmount = utils.parseUnits('0.00001', denominationAssetDecimals);
      const buySharesTx = await buyShares({
        comptrollerProxy,
        signer: investor,
        buyers: [investor],
        denominationAsset,
        investmentAmounts: [utils.parseUnits('1', denominationAssetDecimals)],
        minSharesAmounts: [minSharesAmount],
      });

      expect(await vaultProxy.balanceOf(investor)).toBeGteBigNumber(minSharesAmount.add(previousBalance));

      expect(buySharesTx).toCostLessThan(
        expectedGasCosts['buy shares: denomination asset only: second investment'][denominationAssetId],
        gasAssertionTolerance,
      );
    });

    it('calculates the GAV of the fund with only the denomination asset', async () => {
      const calcGavTx = await comptrollerProxy.calcGav(true);

      expect(calcGavTx).toCostLessThan(
        expectedGasCosts['calc gav: denomination asset only'][denominationAssetId],
        gasAssertionTolerance,
      );
    });

    it('trades on Kyber', async () => {
      const kyberNetworkProxy = new KyberNetworkProxy(fork.config.kyber.networkProxy, hre.ethers.provider);

      const outgoingAsset = denominationAsset;
      const incomingAsset = new StandardToken(fork.config.primitives.dai, hre.ethers.provider);
      const outgoingAssetAmount = utils.parseUnits('0.1', denominationAssetDecimals);

      const { expectedRate } = await kyberNetworkProxy.getExpectedRate(
        outgoingAsset,
        incomingAsset,
        outgoingAssetAmount,
      );
      expect(expectedRate).toBeGtBigNumber(0);

      const minIncomingAssetAmount = expectedRate
        .mul(outgoingAssetAmount)
        .div(utils.parseUnits('1', denominationAssetDecimals));

      await kyberTakeOrder({
        comptrollerProxy,
        vaultProxy,
        integrationManager: fork.deployment.IntegrationManager,
        fundOwner: manager,
        kyberAdapter: fork.deployment.KyberAdapter,
        incomingAsset,
        minIncomingAssetAmount,
        outgoingAsset,
        outgoingAssetAmount,
      });

      const balance = await incomingAsset.balanceOf(vaultProxy);
      expect(balance).toBeGteBigNumber(minIncomingAssetAmount);
    });

    xit('lends and redeems Chai', async () => {
      const dai = new StandardToken(fork.config.primitives.dai, hre.ethers.provider);
      const chai = new StandardToken(fork.config.chai.chai, hre.ethers.provider);
      const daiAmount = await dai.balanceOf(vaultProxy);

      await chaiLend({
        comptrollerProxy,
        vaultProxy,
        integrationManager: fork.deployment.IntegrationManager,
        fundOwner: manager,
        chaiAdapter: fork.deployment.ChaiAdapter,
        dai: new StandardToken(fork.config.primitives.dai, hre.ethers.provider),
        daiAmount,
        minChaiAmount: daiAmount.mul(90).div(100),
      });

      const chaiAmount = await chai.balanceOf(vaultProxy);

      await chaiRedeem({
        comptrollerProxy,
        vaultProxy,
        integrationManager: fork.deployment.IntegrationManager,
        fundOwner: manager,
        chai,
        chaiAdapter: fork.deployment.ChaiAdapter,
        chaiAmount,
        minDaiAmount: chaiAmount.mul(90).div(100),
      });
    });

    it('seeds the fund with all more assets', async () => {
      const assets = [
        new StandardToken(fork.config.primitives.bat, whales.bat),
        new StandardToken(fork.config.primitives.bnb, whales.bnb),
        new StandardToken(fork.config.primitives.bnt, whales.bnt),
        new StandardToken(fork.config.primitives.comp, whales.comp),
        new StandardToken(fork.config.primitives.link, whales.link),
        new StandardToken(fork.config.primitives.mana, whales.mana),
        new StandardToken(fork.config.primitives.risq, whales.risq),
        new StandardToken(fork.config.primitives.ren, whales.ren),
        new StandardToken(fork.config.primitives.rep, whales.rep),
        new StandardToken(fork.config.primitives.susd, whales.susd),
        new StandardToken(fork.config.primitives.uni, whales.uni),
        new StandardToken(fork.config.primitives.usdt, whales.usdt),
        new StandardToken(fork.config.primitives.zrx, whales.zrx),
      ];

      for (const asset of Object.values(assets)) {
        const decimals = await asset.decimals();
        const transferAmount = utils.parseUnits('1', decimals);
        await asset.transfer.args(vaultProxy, transferAmount).send();

        const balance = await asset.balanceOf(vaultProxy);
        expect(balance).toBeGteBigNumber(transferAmount);
      }

      await addTrackedAssets({
        comptrollerProxy,
        integrationManager: fork.deployment.IntegrationManager,
        fundOwner: manager,
        trackedAssetsAdapter: fork.deployment.TrackedAssetsAdapter,
        incomingAssets: Object.values(assets),
      });
    });

    it('seeds the fund with cTokens', async () => {
      const compoundAssets = [
        new StandardToken(fork.config.compound.ctokens.ccomp, whales.ccomp),
        new StandardToken(fork.config.compound.ctokens.cdai, whales.cdai),
        new StandardToken(fork.config.compound.ceth, whales.ceth),
        new StandardToken(fork.config.compound.ctokens.cusdc, whales.cusdc),
        new StandardToken(fork.config.compound.ctokens.cuni, whales.cuni),
      ];

      for (const asset of Object.values(compoundAssets)) {
        const decimals = await asset.decimals();
        const transferAmount = utils.parseUnits('1', decimals);

        await asset.transfer.args(vaultProxy, transferAmount).send();

        const balance = await asset.balanceOf(vaultProxy);
        expect(balance).toBeGteBigNumber(transferAmount);
      }

      await addTrackedAssets({
        comptrollerProxy,
        integrationManager: fork.deployment.IntegrationManager,
        fundOwner: manager,
        trackedAssetsAdapter: fork.deployment.TrackedAssetsAdapter,
        incomingAssets: Object.values(compoundAssets),
      });
    });

    it('calculates the GAV of the fund with 20 assets', async () => {
      expect((await vaultProxy.getTrackedAssets()).length).toBe(20);

      const calcGavTx = await comptrollerProxy.calcGav(true);

      expect(calcGavTx).toCostLessThan(
        expectedGasCosts['calc gav: 20 assets'][denominationAssetId],
        gasAssertionTolerance,
      );
    });

    it('trades on Kyber again', async () => {
      const kyberNetworkProxy = new KyberNetworkProxy(fork.config.kyber.networkProxy, hre.ethers.provider);

      const outgoingAsset = denominationAsset;
      const incomingAsset = new StandardToken(fork.config.primitives.dai, hre.ethers.provider);
      const outgoingAssetAmount = utils.parseUnits('0.1', denominationAssetDecimals);

      const { expectedRate } = await kyberNetworkProxy.getExpectedRate(
        outgoingAsset,
        incomingAsset,
        outgoingAssetAmount,
      );
      expect(expectedRate).toBeGteBigNumber(0);

      const minIncomingAssetAmount = expectedRate
        .mul(outgoingAssetAmount)
        .div(utils.parseUnits('1', denominationAssetDecimals));

      const receipt = await kyberTakeOrder({
        comptrollerProxy,
        vaultProxy,
        integrationManager: fork.deployment.IntegrationManager,
        fundOwner: manager,
        kyberAdapter: fork.deployment.KyberAdapter,
        incomingAsset,
        minIncomingAssetAmount,
        outgoingAsset,
        outgoingAssetAmount,
      });

      const balance = await incomingAsset.balanceOf(vaultProxy);
      expect(balance).toBeGteBigNumber(minIncomingAssetAmount);

      expect(receipt).toCostLessThan(
        expectedGasCosts['trade on Kyber: max assets'][denominationAssetId],
        gasAssertionTolerance,
      );
    });

    it("sends an asset amount to the fund's vault", async () => {
      const gavBefore = await comptrollerProxy.calcGav.args(true).call();
      const grossShareValueBefore = await comptrollerProxy.calcGrossShareValue.call();

      const dai = new StandardToken(fork.config.primitives.dai, whales.dai);
      const amount = utils.parseEther('1');

      await dai.transfer(vaultProxy, amount);

      const gavAfter = await comptrollerProxy.calcGav.args(true).call();
      const grossShareValueAfter = await comptrollerProxy.calcGrossShareValue.call();

      expect(gavAfter.gav_).toBeGtBigNumber(gavBefore.gav_);
      expect(grossShareValueAfter.grossShareValue_).toBeGtBigNumber(grossShareValueBefore.grossShareValue_);
    });

    it('redeems some shares of the investor', async () => {
      const balance = await vaultProxy.balanceOf(investor);
      const redeemQuantity = balance.div(2);

      const redeemed = await redeemShares({
        comptrollerProxy,
        signer: investor,
        quantity: redeemQuantity,
      });

      expect(await vaultProxy.balanceOf(investor)).toEqBigNumber(balance.sub(redeemQuantity));

      expect(redeemed).toCostLessThan(
        expectedGasCosts['redeem partial shares: max assets'][denominationAssetId],
        gasAssertionTolerance,
      );
    });

    it("sends an asset amount to the fund's vault again", async () => {
      const gavBefore = await comptrollerProxy.calcGav.args(true).call();
      const grossShareValueBefore = await comptrollerProxy.calcGrossShareValue.call();

      const zrx = new StandardToken(fork.config.primitives.zrx, whales.zrx);
      const amount = utils.parseEther('1');

      await zrx.transfer(vaultProxy, amount);

      const gavAfter = await comptrollerProxy.calcGav.args(true).call();
      const grossShareValueAfter = await comptrollerProxy.calcGrossShareValue.call();

      expect(gavAfter.gav_).toBeGtBigNumber(gavBefore.gav_);
      expect(grossShareValueAfter.grossShareValue_).toBeGtBigNumber(grossShareValueBefore.grossShareValue_);
    });

    it('changes the InvestorWhitelist', async () => {
      await fork.deployment.PolicyManager.connect(manager)
        .updatePolicySettingsForFund.args(
          comptrollerProxy.address,
          fork.deployment.InvestorWhitelist,
          investorWhitelistArgs({
            investorsToAdd: [anotherInvestor],
            investorsToRemove: [investor],
          }),
        )
        .send();
    });

    it('buys shares of a fund as another investor', async () => {
      const investmentAmount = utils.parseUnits('1', denominationAssetDecimals);

      const grossShareValue = await comptrollerProxy.calcGrossShareValue.call();
      const minSharesAmount = investmentAmount
        .mul(utils.parseEther('1'))
        .div(grossShareValue.grossShareValue_)
        .mul(95) // deduct 5% for safety
        .div(100);

      const buySharesTx = await buyShares({
        comptrollerProxy,
        signer: anotherInvestor,
        buyers: [anotherInvestor],
        denominationAsset,
        investmentAmounts: [investmentAmount],
        minSharesAmounts: [minSharesAmount],
      });

      expect(await vaultProxy.balanceOf(anotherInvestor)).toBeGteBigNumber(minSharesAmount);

      expect(buySharesTx).toCostLessThan(
        expectedGasCosts['buy shares: max assets'][denominationAssetId],
        gasAssertionTolerance,
      );
    });

    it('redeems all remaining shares of the first investor', async () => {
      await redeemShares({
        comptrollerProxy,
        signer: investor,
      });

      expect(await vaultProxy.balanceOf(investor)).toEqBigNumber(utils.parseEther('0'));
    });

    it('redeems all remaining shares of the other investor', async () => {
      const redeemed = await redeemShares({
        comptrollerProxy,
        signer: anotherInvestor,
      });

      expect(await vaultProxy.balanceOf(anotherInvestor)).toEqBigNumber(utils.parseEther('0'));

      expect(redeemed).toCostLessThan(
        expectedGasCosts['redeem all shares: max assets: all remaining'][denominationAssetId],
        gasAssertionTolerance,
      );
    });
  },
);
