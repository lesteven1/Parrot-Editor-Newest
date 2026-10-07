import type {
  WorkspaceEntry,
  WorkspaceFileEntry,
  WorkspaceFolderEntry
} from '../../../shared/project'

export interface VisibleWorkspaceRow {
  entry: WorkspaceEntry
  depth: number
  parentId: string
  siblingIds: string[]
}

export type WorkspaceSiblingOrder = Record<string, string[]>
export type WorkspaceDropPosition = 'before' | 'after'

export interface WorkspaceFilePlacement {
  parentId: string
  afterId: string
}

export type WorkspaceFilePlacements = Record<string, WorkspaceFilePlacement>

export function workspaceFileParentId(
  root: WorkspaceFolderEntry,
  fileId: string
): string | undefined {
  for (const entry of root.children) {
    if (entry.type === 'file' && entry.id === fileId) return root.id
    if (entry.type === 'folder') {
      const parentId = workspaceFileParentId(entry, fileId)
      if (parentId) return parentId
    }
  }
  return undefined
}

/** Adds renderer-created files to the visual tree without changing the imported tree. */
export function insertVirtualWorkspaceFiles(
  root: WorkspaceFolderEntry,
  virtualFiles: WorkspaceFileEntry[],
  placements: WorkspaceFilePlacements
): WorkspaceFolderEntry {
  const folderIds = new Set<string>()
  const collectFolderIds = (folder: WorkspaceFolderEntry): void => {
    folderIds.add(folder.id)
    folder.children.forEach((entry) => {
      if (entry.type === 'folder') collectFolderIds(entry)
    })
  }
  collectFolderIds(root)
  const filesByParent = new Map<string, WorkspaceFileEntry[]>()
  for (const file of virtualFiles) {
    const requestedParentId = placements[file.id]?.parentId
    const parentId = requestedParentId && folderIds.has(requestedParentId) ? requestedParentId : root.id
    filesByParent.set(parentId, [...(filesByParent.get(parentId) ?? []), file])
  }

  const cloneFolder = (folder: WorkspaceFolderEntry): WorkspaceFolderEntry => {
    const children: WorkspaceEntry[] = folder.children.map((entry) => (
      entry.type === 'folder' ? cloneFolder(entry) : entry
    ))
    for (const file of filesByParent.get(folder.id) ?? []) {
      const afterId = placements[file.id]?.afterId
      const afterIndex = afterId ? children.findIndex((entry) => entry.id === afterId) : -1
      children.splice(afterIndex >= 0 ? afterIndex + 1 : children.length, 0, file)
    }
    return { ...folder, children }
  }

  return cloneFolder(root)
}

function orderedChildren(
  folder: WorkspaceFolderEntry,
  siblingOrder: WorkspaceSiblingOrder
): WorkspaceEntry[] {
  const preferredIds = siblingOrder[folder.id]
  if (!preferredIds) return folder.children
  const files = folder.children.filter((entry): entry is WorkspaceFileEntry => entry.type === 'file')
  const byId = new Map(files.map((entry) => [entry.id, entry]))
  const orderedFiles = preferredIds.flatMap((id) => {
    const entry = byId.get(id)
    if (!entry) return []
    byId.delete(id)
    return [entry]
  })
  orderedFiles.push(...files.filter((entry) => byId.has(entry.id)))
  let fileIndex = 0
  return folder.children.map((entry) => (
    entry.type === 'folder' ? entry : orderedFiles[fileIndex++]!
  ))
}

export function workspaceFiles(root: WorkspaceFolderEntry): WorkspaceFileEntry[] {
  const files: WorkspaceFileEntry[] = []
  const visit = (folder: WorkspaceFolderEntry): void => {
    for (const entry of folder.children) {
      if (entry.type === 'folder') visit(entry)
      else files.push(entry)
    }
  }
  visit(root)
  return files
}

export function workspaceEntryIds(root: WorkspaceFolderEntry): Set<string> {
  const ids = new Set<string>([root.id])
  const visit = (folder: WorkspaceFolderEntry): void => {
    for (const entry of folder.children) {
      ids.add(entry.id)
      if (entry.type === 'folder') visit(entry)
    }
  }
  visit(root)
  return ids
}

export function visibleWorkspaceRows(
  root: WorkspaceFolderEntry,
  collapsedFolderIds: ReadonlySet<string>,
  siblingOrder: WorkspaceSiblingOrder = {}
): VisibleWorkspaceRow[] {
  if (collapsedFolderIds.has(root.id)) return []
  const rows: VisibleWorkspaceRow[] = []
  const visit = (folder: WorkspaceFolderEntry, depth: number): void => {
    const children = orderedChildren(folder, siblingOrder)
    const siblingIds = children
      .filter((entry) => entry.type === 'file')
      .map((entry) => entry.id)
    for (const entry of children) {
      rows.push({ entry, depth, parentId: folder.id, siblingIds })
      if (entry.type === 'folder' && !collapsedFolderIds.has(entry.id)) {
        visit(entry, depth + 1)
      }
    }
  }
  visit(root, 0)
  return rows
}

/** Reorders renderer-only siblings. It never changes a path or writes to disk. */
export function reorderWorkspaceSiblings(
  siblingOrder: WorkspaceSiblingOrder,
  parentId: string,
  renderedSiblingIds: string[],
  sourceId: string,
  targetId: string,
  position: WorkspaceDropPosition
): WorkspaceSiblingOrder {
  if (sourceId === targetId) return siblingOrder
  if (!renderedSiblingIds.includes(sourceId) || !renderedSiblingIds.includes(targetId)) {
    return siblingOrder
  }
  const nextIds = renderedSiblingIds.filter((id) => id !== sourceId)
  const targetIndex = nextIds.indexOf(targetId)
  nextIds.splice(targetIndex + (position === 'after' ? 1 : 0), 0, sourceId)
  if (nextIds.every((id, index) => id === renderedSiblingIds[index])) return siblingOrder
  return { ...siblingOrder, [parentId]: nextIds }
}

export function toggleCollapsedFolder(
  collapsedFolderIds: ReadonlySet<string>,
  folderId: string
): Set<string> {
  const next = new Set(collapsedFolderIds)
  if (next.has(folderId)) next.delete(folderId)
  else next.add(folderId)
  return next
}
