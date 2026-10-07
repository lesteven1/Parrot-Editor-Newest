import { unzipSync } from 'fflate'
import type { ParsedScratchArchive, ScratchProject } from './types.ts'

const MAX_ARCHIVE_ENTRIES = 5_000
const MAX_EXPANDED_BYTES = 200 * 1024 * 1024
const MAX_PROJECT_JSON_BYTES = 16 * 1024 * 1024

function assertZipExpansionIsReasonable(archive: Uint8Array): void {
  if (archive.byteLength < 22) throw new Error('The Scratch archive is missing its ZIP directory.')
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength)
  let endOffset = -1
  const searchStart = Math.max(0, archive.byteLength - 65_557)
  for (let offset = archive.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      endOffset = offset
      break
    }
  }
  if (endOffset < 0) throw new Error('The Scratch archive is missing its ZIP directory.')

  const entryCount = view.getUint16(endOffset + 10, true)
  const directoryOffset = view.getUint32(endOffset + 16, true)
  if (entryCount > MAX_ARCHIVE_ENTRIES) throw new Error('That Scratch project contains too many archive entries.')

  let cursor = directoryOffset
  let expandedBytes = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.byteLength || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('The Scratch archive directory is invalid.')
    }
    expandedBytes += view.getUint32(cursor + 24, true)
    if (expandedBytes > MAX_EXPANDED_BYTES) {
      throw new Error('That Scratch project expands beyond Parrot’s 200 MB safety limit.')
    }
    cursor += 46 + view.getUint16(cursor + 28, true) + view.getUint16(cursor + 30, true) +
      view.getUint16(cursor + 32, true)
  }
}

function parseProject(files: Record<string, Uint8Array>): ScratchProject {
  const projectBytes = files['project.json']
  if (!projectBytes) throw new Error('The Scratch archive does not contain project.json.')
  if (projectBytes.byteLength > MAX_PROJECT_JSON_BYTES) {
    throw new Error('The Scratch project definition is too large to convert safely.')
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(new TextDecoder().decode(projectBytes))
  } catch {
    throw new Error('The Scratch project definition is not valid JSON.')
  }
  if (!candidate || typeof candidate !== 'object' || !Array.isArray((candidate as ScratchProject).targets)) {
    throw new Error('The Scratch project does not contain a valid target list.')
  }
  return candidate as ScratchProject
}

export function parseScratchArchive(archive: Uint8Array): ParsedScratchArchive {
  assertZipExpansionIsReasonable(archive)
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(archive)
  } catch {
    throw new Error('Parrot could not unpack that Scratch project.')
  }
  return { project: parseProject(files), files }
}
