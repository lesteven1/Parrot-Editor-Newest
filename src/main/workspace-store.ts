import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { lstat, readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, parse, relative, sep } from 'node:path'
import type {
  ProjectSelection,
  WorkspaceFileEntry,
  WorkspaceFileKind,
  WorkspaceFolderEntry,
  WorkspaceSelection
} from '../shared/project'

const MAX_WORKSPACE_ENTRIES = 5_000
const MAX_WORKSPACE_DEPTH = 32
const IGNORED_WORKSPACE_FILES = new Set(['.DS_Store'])

export interface StoredWorkspaceFile {
  id: string
  name: string
  kind: WorkspaceFileKind
  path?: string
  size: number
  modifiedAt: number
  pairFileId?: string
}

interface StoredWorkspace {
  project: ProjectSelection
  rootPath: string
  root: WorkspaceFolderEntry
  files: Map<string, StoredWorkspaceFile>
}

function fileKind(name: string): WorkspaceFileKind {
  const extension = extname(name).toLowerCase()
  if (extension === '.sb3') return 'scratch'
  if (extension === '.py') return 'python'
  return 'other'
}

function isIgnoredWorkspaceFile(name: string): boolean {
  return IGNORED_WORKSPACE_FILES.has(name)
}

function sortEntries<T extends WorkspaceFileEntry | WorkspaceFolderEntry>(entries: T[]): T[] {
  return entries.sort((first, second) => {
    if (first.type !== second.type) return first.type === 'folder' ? -1 : 1
    return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' })
  })
}

function programStem(name: string): string {
  return parse(name).name.toLocaleLowerCase()
}

function pairExistingProgramsInFolder(
  folder: WorkspaceFolderEntry,
  files: Map<string, StoredWorkspaceFile>
): void {
  for (const child of folder.children) {
    if (child.type === 'folder') pairExistingProgramsInFolder(child, files)
  }

  const directFiles = folder.children.filter((entry): entry is WorkspaceFileEntry => entry.type === 'file')
  const pythonByStem = new Map(
    directFiles
      .filter((entry) => entry.fileKind === 'python')
      .map((entry) => [programStem(entry.name), entry])
  )

  for (const scratchEntry of directFiles.filter((entry) => entry.fileKind === 'scratch')) {
    const scratch = files.get(scratchEntry.id)
    if (!scratch) continue
    const existingPython = pythonByStem.get(programStem(scratchEntry.name))
    if (existingPython) {
      scratch.pairFileId = existingPython.id
      const python = files.get(existingPython.id)
      if (python) python.pairFileId = scratch.id
    }
  }
}

export async function scanWorkspacePath(candidatePath: string): Promise<{
  rootPath: string
  root: WorkspaceFolderEntry
  files: Map<string, StoredWorkspaceFile>
  totalSize: number
}> {
  let canonicalPath: string
  let rootStat: Awaited<ReturnType<typeof lstat>>
  try {
    canonicalPath = await realpath(candidatePath)
    rootStat = await lstat(canonicalPath)
  } catch {
    throw new Error('Parrot could not access that file or folder.')
  }

  const files = new Map<string, StoredWorkspaceFile>()
  let entryCount = 0
  let totalSize = 0

  const scanFile = async (path: string, name: string): Promise<WorkspaceFileEntry | null> => {
    if (entryCount >= MAX_WORKSPACE_ENTRIES) {
      throw new Error(`Folders can contain up to ${MAX_WORKSPACE_ENTRIES.toLocaleString()} visible items.`)
    }
    entryCount += 1
    let file: Awaited<ReturnType<typeof lstat>>
    try {
      file = await lstat(path)
    } catch {
      return null
    }
    const id = randomUUID()
    const kind = file.isFile() ? fileKind(name) : 'other'
    totalSize += file.isFile() ? file.size : 0
    files.set(id, {
      id,
      name,
      kind,
      path,
      size: file.size,
      modifiedAt: file.mtimeMs
    })
    return { type: 'file', id, name, fileKind: kind }
  }

  const scanFolder = async (path: string, name: string, depth: number): Promise<WorkspaceFolderEntry> => {
    if (depth > MAX_WORKSPACE_DEPTH) {
      throw new Error(`Folders can be nested up to ${MAX_WORKSPACE_DEPTH} levels deep.`)
    }
    if (entryCount >= MAX_WORKSPACE_ENTRIES) {
      throw new Error(`Folders can contain up to ${MAX_WORKSPACE_ENTRIES.toLocaleString()} visible items.`)
    }
    entryCount += 1
    const folder: WorkspaceFolderEntry = { type: 'folder', id: randomUUID(), name, children: [] }
    let entries: Dirent[]
    try {
      entries = await readdir(path, { withFileTypes: true })
    } catch {
      return folder
    }

    const children: Array<WorkspaceFileEntry | WorkspaceFolderEntry> = []
    for (const entry of entries) {
      if (isIgnoredWorkspaceFile(entry.name)) continue
      const childPath = join(path, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        children.push(await scanFolder(childPath, entry.name, depth + 1))
      } else {
        const child = await scanFile(childPath, entry.name)
        if (child) children.push(child)
      }
    }
    folder.children = sortEntries(children)
    return folder
  }

  let root: WorkspaceFolderEntry
  let rootPath: string
  if (rootStat.isDirectory()) {
    rootPath = canonicalPath
    root = await scanFolder(canonicalPath, basename(canonicalPath), 0)
  } else if (rootStat.isFile()) {
    if (isIgnoredWorkspaceFile(basename(canonicalPath))) {
      throw new Error('Parrot ignores macOS folder metadata files.')
    }
    rootPath = dirname(canonicalPath)
    const selected = await scanFile(canonicalPath, basename(canonicalPath))
    const name = parse(canonicalPath).name || basename(rootPath)
    root = {
      type: 'folder',
      id: randomUUID(),
      name,
      children: selected ? [selected] : []
    }
  } else {
    throw new Error('Choose a regular file or folder.')
  }

  pairExistingProgramsInFolder(root, files)
  return { rootPath, root, files, totalSize }
}

export class WorkspaceStore {
  private readonly workspaces = new Map<string, StoredWorkspace>()

  async register(candidatePath: string): Promise<WorkspaceSelection> {
    const scanned = await scanWorkspacePath(candidatePath)
    const project: ProjectSelection = {
      id: randomUUID(),
      name: scanned.root.name,
      size: scanned.totalSize
    }
    this.workspaces.set(project.id, {
      project,
      rootPath: scanned.rootPath,
      root: scanned.root,
      files: scanned.files
    })
    return { project, root: scanned.root }
  }

  async resolveFile(workspaceId: string, fileId: string): Promise<StoredWorkspaceFile> {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) throw new Error('This folder session has expired. Import it again.')
    const stored = workspace.files.get(fileId)
    if (!stored) throw new Error('That file is not part of the imported folder.')
    if (!stored.path) throw new Error('Parrot could not resolve that file.')

    let canonicalPath: string
    let file: Awaited<ReturnType<typeof stat>>
    try {
      canonicalPath = await realpath(stored.path)
      file = await stat(canonicalPath)
    } catch {
      throw new Error(`${stored.name} is no longer available. Import the folder again.`)
    }
    const insideRoot = relative(workspace.rootPath, canonicalPath)
    if (insideRoot === '..' || insideRoot.startsWith(`..${sep}`) || isAbsolute(insideRoot)) {
      throw new Error('Parrot rejected a file outside the imported folder.')
    }
    if (!file.isFile() || file.size !== stored.size || file.mtimeMs !== stored.modifiedAt) {
      throw new Error(`${stored.name} changed on disk. Import the folder again before opening it.`)
    }
    return stored
  }

  async resolveProgramPair(workspaceId: string, fileId: string): Promise<{
    requested: StoredWorkspaceFile
    scratch?: StoredWorkspaceFile
    python?: StoredWorkspaceFile
  }> {
    const requested = await this.resolveFile(workspaceId, fileId)
    if (requested.kind === 'other') {
      throw new Error('Parrot can currently open Scratch .sb3 and Python .py files.')
    }
    const partner = requested.pairFileId
      ? await this.resolveFile(workspaceId, requested.pairFileId)
      : undefined
    const records = [requested, partner].filter((record): record is StoredWorkspaceFile => Boolean(record))
    const scratch = records.find((record) => record.kind === 'scratch')
    const python = records.find((record) => record.kind === 'python')
    return { requested, scratch, python }
  }

  close(workspaceId: string): void {
    this.workspaces.delete(workspaceId)
  }

  clear(): void {
    this.workspaces.clear()
  }
}
