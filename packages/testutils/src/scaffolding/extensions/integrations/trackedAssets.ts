import { AddressLike, SignerWithAddress } from '@crestproject/crestproject';
import {
  addTrackedAssetsArgs,
  addTrackedAssetsSelector,
  callOnIntegrationArgs,
  ComptrollerLib,
  IntegrationManager,
  IntegrationManagerActionId,
  TrackedAssetsAdapter,
} from '@risqprotocol/protocol';

export async function addTrackedAssets({
  comptrollerProxy,
  integrationManager,
  fundOwner,
  trackedAssetsAdapter,
  incomingAssets,
}: {
  comptrollerProxy: ComptrollerLib;
  integrationManager: IntegrationManager;
  fundOwner: SignerWithAddress;
  trackedAssetsAdapter: TrackedAssetsAdapter;
  incomingAssets: AddressLike[];
}) {
  const args = addTrackedAssetsArgs(incomingAssets);
  const callArgs = callOnIntegrationArgs({
    adapter: trackedAssetsAdapter,
    selector: addTrackedAssetsSelector,
    encodedCallArgs: args,
  });

  const addTrackedAssetsTx = comptrollerProxy
    .connect(fundOwner)
    .callOnExtension(integrationManager, IntegrationManagerActionId.CallOnIntegration, callArgs);

  await expect(addTrackedAssetsTx).resolves.toBeReceipt();

  return addTrackedAssetsTx;
}
