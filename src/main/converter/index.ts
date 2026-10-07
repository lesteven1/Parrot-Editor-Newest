import { parseScratchArchive } from './archive.ts'
import { ReadablePythonGenerator } from './python-generator.ts'
import { buildRuntimeBundle } from './runtime-manifest.ts'
import type { ScratchConversion } from './types.ts'

export function convertScratchToPython(archive: Uint8Array): ScratchConversion {
  const { project, files } = parseScratchArchive(archive)
  const generator = new ReadablePythonGenerator(project)
  const python = generator.generate()
  const runtime = buildRuntimeBundle(project, files, generator.warnings)
  return {
    python,
    runtime,
    warnings: [...generator.warnings],
    convertedBlockCount: generator.convertedBlockCount
  }
}

export type { RuntimeBundle, ScratchConversion } from './types.ts'
