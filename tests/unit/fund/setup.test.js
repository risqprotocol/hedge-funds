import { toWei } from 'web3-utils';
import { send } from '~/deploy/utils/deploy-contract';
import { partialRedeploy } from '~/deploy/scripts/deploy-system';
import { CONTRACT_NAMES } from '~/tests/utils/constants';
import getAccounts from '~/deploy/utils/getAccounts';

let deployer, manager, user;
let defaultTxOpts, managerTxOpts, userTxOpts;
let version;

beforeAll(async () => {
  [deployer, manager, user] = await getAccounts();
  defaultTxOpts = { from: deployer, gas: 8000000 };
  managerTxOpts = { ...defaultTxOpts, from: manager };
  userTxOpts = { ...defaultTxOpts, from: user };

  const deployed = await partialRedeploy([CONTRACT_NAMES.VERSION]);
  const contracts = deployed.contracts;
  version = contracts[CONTRACT_NAMES.VERSION];
  const weth = contracts.WETH;
  const risq = contracts.RISQ;
  
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
      weth.options.address,
      [risq.options.address, weth.options.address],
    ],
    managerTxOpts
  );
});

test('continue setup of a fund', async () => {
  const pbguTxValue = toWei('0.01', 'ether')
  const userTxOptsWithPbgu = { ...userTxOpts, value: pbguTxValue };
  
  await send(version, 'createAccountingFor', [manager], userTxOptsWithPbgu);
  await send(version, 'createFeeManagerFor', [manager], userTxOptsWithPbgu);
  await send(version, 'createParticipationFor', [manager], userTxOptsWithPbgu);
  await send(version, 'createPolicyManagerFor', [manager], userTxOptsWithPbgu);
  await send(version, 'createSharesFor', [manager], userTxOptsWithPbgu);
  await send(version, 'createTradingFor', [manager], userTxOptsWithPbgu);
  await send(version, 'createVaultFor', [manager], userTxOptsWithPbgu);
  const res = await send(version, 'completeSetupFor', [manager], userTxOptsWithPbgu);
  expect(res).toBeTruthy();
});
