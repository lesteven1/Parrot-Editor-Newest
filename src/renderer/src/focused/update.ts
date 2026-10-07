import type { PythonConversion } from '../../../shared/project'

interface ScratchSnapshot {
  projectBytes: Uint8Array
  frameDataUrl: string
}

export interface RegeneratePythonDependencies {
  scratchReady: boolean
  stopAll: () => Promise<void>
  snapshotScratch: () => Promise<ScratchSnapshot>
  convertScratch: (projectBytes: Uint8Array) => Promise<PythonConversion>
}

export async function regeneratePythonFromScratch({
  scratchReady,
  stopAll,
  snapshotScratch,
  convertScratch
}: RegeneratePythonDependencies): Promise<PythonConversion> {
  if (!scratchReady) throw new Error('The Scratch project is not ready to update yet.')
  await stopAll()
  const snapshot = await snapshotScratch()
  return convertScratch(snapshot.projectBytes)
}
