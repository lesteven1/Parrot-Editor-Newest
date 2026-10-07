import { randomUUID } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { ProjectSelection } from '../shared/project'

const MAX_PROJECT_BYTES = 100 * 1024 * 1024

type StoredProject = ProjectSelection & {
  path: string
  modifiedAt: number
}

const projects = new Map<string, StoredProject>()

async function validateScratchArchive(path: string, size: number): Promise<void> {
  if (size < 4 || size > MAX_PROJECT_BYTES) {
    throw new Error('Scratch projects must be between 4 bytes and 100 MB.')
  }

  const handle = await open(path, 'r')
  try {
    const signature = new Uint8Array(4)
    await handle.read(signature, 0, signature.length, 0)
    if (signature[0] !== 0x50 || signature[1] !== 0x4b) {
      throw new Error('That file has an .sb3 extension but is not a Scratch project archive.')
    }
  } finally {
    await handle.close()
  }
}

export async function registerScratchProject(candidatePath: string): Promise<ProjectSelection> {
  if (!candidatePath || extname(candidatePath).toLowerCase() !== '.sb3') {
    throw new Error('Parrot can only open Scratch .sb3 projects.')
  }

  let canonicalPath: string
  let file: Awaited<ReturnType<typeof stat>>
  try {
    canonicalPath = await realpath(candidatePath)
    file = await stat(canonicalPath)
  } catch {
    throw new Error('Parrot could not access that Scratch project.')
  }

  if (!file.isFile()) throw new Error('Choose a Scratch .sb3 file, not a folder.')
  await validateScratchArchive(canonicalPath, file.size)

  const stored: StoredProject = {
    id: randomUUID(),
    name: basename(canonicalPath),
    size: file.size,
    path: canonicalPath,
    modifiedAt: file.mtimeMs
  }
  projects.set(stored.id, stored)
  return { id: stored.id, name: stored.name, size: stored.size }
}

export async function resolveScratchProject(projectId: string): Promise<StoredProject> {
  const stored = projects.get(projectId)
  if (!stored) throw new Error('This project session has expired. Choose the .sb3 file again.')

  let file: Awaited<ReturnType<typeof stat>>
  try {
    file = await stat(stored.path)
  } catch {
    projects.delete(projectId)
    throw new Error('The selected Scratch project is no longer available.')
  }

  if (!file.isFile() || file.size !== stored.size || file.mtimeMs !== stored.modifiedAt) {
    projects.delete(projectId)
    throw new Error('The selected Scratch project changed. Choose it again before opening.')
  }
  return stored
}

export function clearScratchProjects(): void {
  projects.clear()
}
