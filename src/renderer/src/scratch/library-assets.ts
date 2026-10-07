import type { ScratchStorage } from '@scratch/scratch-storage'

const configuredStorages = new WeakSet<ScratchStorage>()

export const SCRATCH_LIBRARY_PATH = './scratch-library/'

/** Prefer Parrot's packaged Scratch library before any network-backed store. */
export function configureLocalScratchLibrary(storage: ScratchStorage): void {
  if (configuredStorages.has(storage)) return
  configuredStorages.add(storage)
  storage.addWebStore(
    [storage.AssetType.ImageVector, storage.AssetType.ImageBitmap, storage.AssetType.Sound],
    (asset) => `${SCRATCH_LIBRARY_PATH}${asset.assetId}.${asset.dataFormat}`
  )
  const localStore = storage.webHelper.stores.pop()
  if (localStore) storage.webHelper.stores.unshift(localStore)
}
