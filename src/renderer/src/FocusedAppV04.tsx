import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent
} from 'react'
import type {
  WorkspaceFileEntry,
  WorkspaceFolderEntry,
  WorkspaceSelection
} from '../../shared/project'
import { ActiveTabSession, type ActiveTabSessionHandle } from './App'
import { VscodeIcon, type VscodeIconName } from './components/VscodeIcon'
import {
  insertVirtualWorkspaceFiles,
  reorderWorkspaceSiblings,
  toggleCollapsedFolder,
  visibleWorkspaceRows,
  workspaceEntryIds,
  workspaceFileParentId,
  workspaceFiles,
  type WorkspaceDropPosition,
  type WorkspaceFilePlacements,
  type WorkspaceSiblingOrder
} from './explorer/model'
import { type FocusedActivity } from './focused/model'
import {
  MAX_OPEN_TABS,
  MAX_OUTPUT_VISIBLE_TABS,
  appendGeneratedPythonTab,
  appendPythonTab,
  appendScratchTab,
  checkedPausedTabIds,
  closeTab,
  connectTabs,
  connectedPairs,
  connectedPartner,
  connectionColor,
  connectionTargets,
  createEmptyProjectTabs,
  disconnectTab,
  displayedTabIds,
  duplicateTab,
  outputViewGrid,
  outputViewPosition,
  openWorkspacePrograms,
  replaceConnectedPython,
  replaceEditedTab,
  replaceTab,
  runChecklistTabIds,
  selectTab,
  selectedRunGroups,
  setSelectionGroup,
  uncheckedRunningTabIds,
  unconnectedTabs,
  type ProjectTab,
  type ProjectTabsState,
  type PythonProjectTab,
  type ScratchProjectTab,
  type WorkspaceViewMode
} from './tabs/model'

interface RendererWorkspace extends WorkspaceSelection {
  tabs: ProjectTabsState
}

const EXPLORER_FILE_DRAG_TYPE = 'application/x-parrot-explorer-file'

interface ExplorerDraggedFile {
  workspaceId: string
  fileId: string
  parentId: string
}

interface ExplorerDropTarget extends ExplorerDraggedFile {
  position: WorkspaceDropPosition
}

function isExplorerFileDrag(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes(EXPLORER_FILE_DRAG_TYPE)
}

async function hydrateWorkspace(selection: WorkspaceSelection): Promise<{
  workspace: RendererWorkspace
  warnings: string[]
}> {
  const warnings: string[] = []
  let tabs = createEmptyProjectTabs()
  const opened = new Set<string>()
  const programs = workspaceFiles(selection.root).filter((entry) => entry.fileKind !== 'other')

  for (const program of programs) {
    if (opened.has(program.id) || tabs.tabs.length >= MAX_OPEN_TABS) continue
    try {
      const result = await window.parrot!.openWorkspaceFile(selection.project.id, program.id)
      tabs = openWorkspacePrograms(tabs, result)
      result.programs.forEach((item) => opened.add(item.id))
    } catch (reason) {
      warnings.push(reason instanceof Error ? reason.message : `Parrot could not open ${program.name}.`)
    }
  }

  if (programs.some((program) => !opened.has(program.id))) {
    warnings.push(`Only the first ${MAX_OPEN_TABS} Scratch and Python programs were opened. Other files remain available in Explorer.`)
  }
  const firstOpenId = programs.find((program) => tabs.tabs.some((tab) => tab.id === program.id))?.id
  if (firstOpenId) tabs = selectTab(tabs, firstOpenId)
  return { workspace: { ...selection, tabs }, warnings }
}

function ActivityButton({
  activity,
  current,
  sidebarOpen,
  label,
  icon,
  onSelect
}: {
  activity: FocusedActivity
  current: FocusedActivity
  sidebarOpen: boolean
  label: string
  icon: VscodeIconName
  onSelect: (activity: FocusedActivity) => void
}): React.JSX.Element {
  const active = sidebarOpen && current === activity
  return <button
    className={`fp-activity-button ${active ? 'fp-activity-button--active' : ''}`}
    type="button"
    aria-label={label}
    aria-pressed={active}
    title={label}
    onClick={() => onSelect(activity)}
  ><VscodeIcon name={icon} /></button>
}

interface ExplorerSidebarProps {
  workspaces: RendererWorkspace[]
  activeWorkspaceId: string
  activity: FocusedActivity
  addMenuOpen: boolean
  displayedIds: string[]
  collapsedFolderIds: ReadonlySet<string>
  siblingOrderByWorkspace: Record<string, WorkspaceSiblingOrder>
  filePlacementsByWorkspace: Record<string, WorkspaceFilePlacements>
  onImport: () => void
  onOpenFile: (workspaceId: string, file: WorkspaceFileEntry) => void
  onCloseTab: (workspaceId: string, id: string) => void
  onCloseProject: (workspaceId: string) => void
  onToggleFolder: (id: string) => void
  onToggleAddMenu: (workspaceId: string) => void
  onAddFile: (source: 'new' | 'upload', kind: 'scratch' | 'python') => void
  onReorderFile: (
    workspaceId: string,
    parentId: string,
    siblingIds: string[],
    sourceId: string,
    targetId: string,
    position: WorkspaceDropPosition
  ) => void
}

function ExplorerSidebar({
  workspaces,
  activeWorkspaceId,
  activity,
  addMenuOpen,
  displayedIds,
  collapsedFolderIds,
  siblingOrderByWorkspace,
  filePlacementsByWorkspace,
  onImport,
  onOpenFile,
  onCloseTab,
  onCloseProject,
  onToggleFolder,
  onToggleAddMenu,
  onAddFile,
  onReorderFile
}: ExplorerSidebarProps): React.JSX.Element {
  const [draggedFile, setDraggedFile] = useState<ExplorerDraggedFile | null>(null)
  const [dropTarget, setDropTarget] = useState<ExplorerDropTarget | null>(null)

  const beginFileDrag = (
    event: DragEvent<HTMLDivElement>,
    file: ExplorerDraggedFile
  ): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(EXPLORER_FILE_DRAG_TYPE, JSON.stringify({ fileId: file.fileId }))
    setDraggedFile(file)
    setDropTarget(null)
  }

  const fileDropPosition = (event: DragEvent<HTMLDivElement>): WorkspaceDropPosition => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
  }

  const updateFileDropTarget = (
    event: DragEvent<HTMLDivElement>,
    target: ExplorerDraggedFile
  ): void => {
    if (
      !draggedFile ||
      draggedFile.workspaceId !== target.workspaceId ||
      draggedFile.parentId !== target.parentId ||
      draggedFile.fileId === target.fileId
    ) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    setDropTarget({ ...target, position: fileDropPosition(event) })
  }

  const finishFileDrop = (
    event: DragEvent<HTMLDivElement>,
    target: ExplorerDraggedFile,
    siblingIds: string[]
  ): void => {
    if (!draggedFile) return
    event.preventDefault()
    event.stopPropagation()
    if (
      draggedFile.workspaceId === target.workspaceId &&
      draggedFile.parentId === target.parentId &&
      draggedFile.fileId !== target.fileId
    ) {
      onReorderFile(
        target.workspaceId,
        target.parentId,
        siblingIds,
        draggedFile.fileId,
        target.fileId,
        fileDropPosition(event)
      )
    }
    setDraggedFile(null)
    setDropTarget(null)
  }

  const endFileDrag = (): void => {
    setDraggedFile(null)
    setDropTarget(null)
  }

  if (activity !== 'explorer') {
    const label = activity === 'search' ? 'SEARCH' : 'SETTINGS'
    return <aside className="fp-sidebar" aria-label={label}>
      <header className="fp-sidebar-title"><span>{label}</span></header>
      <div className="fp-placeholder-sidebar">
        <VscodeIcon name={activity === 'search' ? 'search' : 'settings-gear'} />
        <span>{activity === 'search' ? 'Search' : 'Settings'} placeholder</span>
      </div>
    </aside>
  }

  return <aside className="fp-sidebar" aria-label="Explorer">
    <header className="fp-sidebar-title">
      <span>EXPLORER</span>
      <button type="button" aria-label="Add folder" title="Add folder" onClick={onImport}>
        <VscodeIcon name="new-folder" />
      </button>
    </header>
    <div className="fp-explorer-roots">
    {workspaces.map((workspace) => {
      const tabState = workspace.tabs
      const active = workspace.project.id === activeWorkspaceId
      const treeIds = workspaceEntryIds(workspace.root)
      const virtualFiles: WorkspaceFileEntry[] = tabState.tabs
        .filter((tab) => !treeIds.has(tab.id))
        .map((tab) => ({ type: 'file', id: tab.id, name: tab.name, fileKind: tab.kind }))
      const explorerRoot = insertVirtualWorkspaceFiles(
        workspace.root,
        virtualFiles,
        filePlacementsByWorkspace[workspace.project.id] ?? {}
      )
      const treeRows = visibleWorkspaceRows(
        explorerRoot,
        collapsedFolderIds,
        siblingOrderByWorkspace[workspace.project.id]
      )
      return <section className="fp-explorer-root" key={workspace.project.id} aria-label={workspace.root.name}>
      <div className={`fp-project-title ${active ? 'fp-project-title--active' : ''}`}>
        <button
          className="fp-project-disclosure"
          type="button"
          aria-expanded={!collapsedFolderIds.has(workspace.root.id)}
          title={collapsedFolderIds.has(workspace.root.id) ? 'Show folder contents' : 'Hide folder contents'}
          onClick={() => onToggleFolder(workspace.root.id)}
        >
          <VscodeIcon name={collapsedFolderIds.has(workspace.root.id) ? 'chevron-right' : 'chevron-down'} />
          <span>{workspace.root.name.toUpperCase()}</span>
        </button>
        <div className="fp-project-actions">
          <button
            type="button"
            aria-label="Add file"
            title="Add file"
            aria-expanded={active && addMenuOpen}
            aria-controls="fp-add-file-menu"
            onClick={() => onToggleAddMenu(workspace.project.id)}
          ><VscodeIcon name="new-file" /></button>
          <button
            type="button"
            aria-label={`Close ${workspace.root.name} project`}
            title="Close project"
            onClick={() => onCloseProject(workspace.project.id)}
          ><VscodeIcon name="close" /></button>
        </div>
      </div>
      {active && addMenuOpen && <div className="fp-add-file-menu" id="fp-add-file-menu" role="menu" aria-label="Add file">
        <button type="button" role="menuitem" onClick={() => onAddFile('upload', 'scratch')}><VscodeIcon name="package" />Open Scratch file</button>
        <button type="button" role="menuitem" onClick={() => onAddFile('upload', 'python')}><VscodeIcon name="file-code" />Open Python file</button>
        <button type="button" role="menuitem" onClick={() => onAddFile('new', 'scratch')}><VscodeIcon name="add" />New Scratch file</button>
        <button type="button" role="menuitem" onClick={() => onAddFile('new', 'python')}><VscodeIcon name="add" />New Python file</button>
      </div>}
      <div className="fp-file-tree">
        {treeRows.map(({ entry, depth, parentId, siblingIds }) => {
          if (entry.type === 'folder') {
            const expanded = !collapsedFolderIds.has(entry.id)
            return <div
              className="fp-folder-row"
              key={entry.id}
              style={{ '--fp-tree-depth': depth } as CSSProperties}
            >
              <button
                type="button"
                aria-expanded={expanded}
                title={expanded ? `Hide ${entry.name}` : `Show ${entry.name}`}
                onClick={() => onToggleFolder(entry.id)}
              >
                <VscodeIcon name={expanded ? 'chevron-down' : 'chevron-right'} />
                <span>{entry.name}</span>
              </button>
            </div>
          }
          const tab = tabState.tabs.find((candidate) => candidate.id === entry.id)
          const partner = connectedPartner(tabState, entry.id)
          const label = partner ? `Connected to ${partner.name}` : undefined
          const displayed = active && displayedIds.includes(entry.id)
          const fileDrag = { workspaceId: workspace.project.id, fileId: entry.id, parentId }
          const draggingThisFile = draggedFile?.workspaceId === fileDrag.workspaceId && draggedFile.fileId === fileDrag.fileId
          const dropPosition = dropTarget?.workspaceId === fileDrag.workspaceId && dropTarget.fileId === fileDrag.fileId
            ? dropTarget.position
            : null
          return <div
            className={`fp-tree-row ${displayed ? 'fp-tree-row--active' : ''} ${draggingThisFile ? 'fp-tree-row--dragging' : ''} ${dropPosition ? `fp-tree-row--drop-${dropPosition}` : ''}`}
            key={entry.id}
            style={{ '--fp-tree-depth': depth } as CSSProperties}
            draggable
            onDragStart={(event) => beginFileDrag(event, fileDrag)}
            onDragEnter={(event) => updateFileDropTarget(event, fileDrag)}
            onDragOver={(event) => updateFileDropTarget(event, fileDrag)}
            onDrop={(event) => finishFileDrop(event, fileDrag, siblingIds)}
            onDragEnd={endFileDrag}
          >
            <button
              className={`fp-tree-row__select ${entry.fileKind === 'other' ? 'fp-tree-row__select--unsupported' : ''}`}
              type="button"
              aria-pressed={displayed}
              aria-disabled={entry.fileKind === 'other'}
              title={entry.name}
              onClick={() => onOpenFile(workspace.project.id, entry)}
            >
              <VscodeIcon name={entry.fileKind === 'scratch' ? 'package' : entry.fileKind === 'python' ? 'file-code' : 'new-file'} />
              <span>{entry.name}</span>
              {tab?.connectionId && <i
                className="fp-connection-dot"
                style={{ backgroundColor: connectionColor(tab.connectionId) }}
                aria-label={label}
                title={label}
              />}
            </button>
            {tab && <button
              className="fp-tree-row__action fp-tree-row__close"
              type="button"
              aria-label={`Close ${entry.name}`}
              title={`Close ${entry.name}`}
              onClick={() => onCloseTab(workspace.project.id, entry.id)}
            ><VscodeIcon name="close" /></button>}
          </div>
        })}
      </div>
    </section>
    })}
    </div>
  </aside>
}

function RunChecklist({
  state,
  selectedIds,
  runningIds,
  pausedIds,
  busy,
  onSelectionChange,
  onRun,
  onStop,
  onClose
}: {
  state: ProjectTabsState
  selectedIds: string[]
  runningIds: string[]
  pausedIds: string[]
  busy: boolean
  onSelectionChange: (ids: string[]) => void
  onRun: () => void
  onStop: () => void
  onClose: () => void
}): React.JSX.Element {
  const pairs = connectedPairs(state)
  const standalone = unconnectedTabs(state)
  return <section className="fp-run-checklist" role="dialog" aria-modal="false" aria-labelledby="fp-run-title">
    <header>
      <VscodeIcon name="checklist" />
      <strong id="fp-run-title">Run files</strong>
      <button type="button" aria-label="Close run menu" onClick={onClose}><VscodeIcon name="close" /></button>
    </header>
    <div className="fp-run-list">
      {pairs.map((pair) => {
        const pairIds = [pair.scratch.id, pair.python.id]
        const checked = pairIds.every((id) => selectedIds.includes(id))
        return <div className="fp-run-group" key={pair.id}>
          <label className="fp-run-group-title">
            <input
              type="checkbox"
              checked={checked}
              disabled={busy}
              onChange={(event) => onSelectionChange(setSelectionGroup(selectedIds, pairIds, event.target.checked))}
            />
            <i className="fp-connection-dot" style={{ backgroundColor: connectionColor(pair.id) }} />
            <span>Connected pair</span>
          </label>
          {[pair.scratch, pair.python].map((tab) => <label className="fp-run-file" key={tab.id}>
            <input
              type="checkbox"
              checked={selectedIds.includes(tab.id)}
              disabled={busy}
              onChange={(event) => onSelectionChange(setSelectionGroup(selectedIds, [tab.id], event.target.checked))}
            />
            <VscodeIcon name={tab.kind === 'scratch' ? 'package' : 'file-code'} />
            <span>{tab.name}</span>
            {runningIds.includes(tab.id)
              ? <small>Running</small>
              : pausedIds.includes(tab.id) && <small>Paused</small>}
          </label>)}
        </div>
      })}
      {standalone.map((tab) => <label className="fp-run-file fp-run-file--standalone" key={tab.id}>
        <input
          type="checkbox"
          checked={selectedIds.includes(tab.id)}
          disabled={busy}
          onChange={(event) => onSelectionChange(setSelectionGroup(selectedIds, [tab.id], event.target.checked))}
        />
        <VscodeIcon name={tab.kind === 'scratch' ? 'package' : 'file-code'} />
        <span>{tab.name}</span>
        {runningIds.includes(tab.id)
          ? <small>Running</small>
          : pausedIds.includes(tab.id) && <small>Paused</small>}
      </label>)}
    </div>
    <footer>
      {runningIds.length + pausedIds.length > 0 && <button type="button" disabled={busy} onClick={onStop}><VscodeIcon name="debug-stop" />Stop all</button>}
      <button type="button" disabled={selectedIds.length === 0 || busy} onClick={onRun}><VscodeIcon name="debug-start" />Start running</button>
    </footer>
  </section>
}

interface ProjectWorkspaceProps {
  tabState: ProjectTabsState
  setTabState: React.Dispatch<React.SetStateAction<ProjectTabsState>>
  viewMode: WorkspaceViewMode
  runMenuOpen: boolean
  onCloseRunMenu: () => void
  onNotice: (message: string) => void
  onPlaceTabAfter: (sourceId: string, tabId: string) => void
}

function ProjectWorkspace({
  tabState,
  setTabState,
  viewMode,
  runMenuOpen,
  onCloseRunMenu,
  onNotice,
  onPlaceTabAfter
}: ProjectWorkspaceProps): React.JSX.Element {
  const stateRef = useRef(tabState)
  stateRef.current = tabState
  const sessions = useRef(new Map<string, ActiveTabSessionHandle>())
  const [runningIds, setRunningIds] = useState<string[]>([])
  const [pausedIds, setPausedIds] = useState<string[]>([])
  const [runtimeBusyIds, setRuntimeBusyIds] = useState<string[]>([])
  const [operationBusy, setOperationBusy] = useState(false)
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null)
  const outputScrollRef = useRef<HTMLDivElement>(null)
  const [canScrollOutputLeft, setCanScrollOutputLeft] = useState(false)
  const [canScrollOutputRight, setCanScrollOutputRight] = useState(false)
  const pairs = connectedPairs(tabState)
  const active = tabState.tabs.find((tab) => tab.id === tabState.activeId)
  const visibleSessionKey = active?.connectionId ?? active?.id ?? ''
  const outputGrid = outputViewGrid(Math.min(tabState.tabs.length, MAX_OUTPUT_VISIBLE_TABS))
  const outputGridStyle = {
    '--fp-output-columns': String(outputGrid.columns),
    '--fp-output-rows': String(outputGrid.rows)
  } as CSSProperties
  const outputPositions = Object.fromEntries(tabState.tabs.map((tab, index) => (
    [tab.id, outputViewPosition(index, tabState.tabs.length)]
  )))
  const pairById = new Map(pairs.map((pair) => [pair.id, pair]))
  const sessionKeys = new Set<string>()
  const orderedSessions = tabState.tabs.flatMap((tab) => {
    const pair = tab.connectionId ? pairById.get(tab.connectionId) : undefined
    // Keep the Scratch-owned session stable as files are linked and unlinked.
    // Remounting it would allocate another WebGL renderer for the same project.
    const key = pair?.scratch.id ?? tab.id
    if (sessionKeys.has(key)) return []
    sessionKeys.add(key)
    return [{ key, pair, tab: pair ? undefined : tab }]
  })
  const linkableTabIds = linkSourceId
    ? connectionTargets(tabState, linkSourceId).map((tab) => tab.id)
    : []

  useEffect(() => {
    if (!linkSourceId) return
    const source = tabState.tabs.find((tab) => tab.id === linkSourceId)
    if (!source || source.connectionId) setLinkSourceId(null)
  }, [linkSourceId, tabState.tabs])

  const updateOutputScroll = useCallback((): void => {
    const element = outputScrollRef.current
    if (!element) return
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth)
    setCanScrollOutputLeft(element.scrollLeft > 1)
    setCanScrollOutputRight(element.scrollLeft < maxScrollLeft - 1)
  }, [])

  useEffect(() => {
    if (viewMode !== 'output') return
    const element = outputScrollRef.current
    if (!element) return
    element.scrollLeft = 0
    const frame = window.requestAnimationFrame(updateOutputScroll)
    const observer = new ResizeObserver(updateOutputScroll)
    observer.observe(element)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [outputGrid.columns, tabState.tabs.length, updateOutputScroll, viewMode])

  const scrollOutput = (direction: -1 | 1): void => {
    const element = outputScrollRef.current
    if (!element) return
    const projectWidth = element.clientWidth / outputGrid.columns
    element.scrollTo({ left: element.scrollLeft + direction * projectWidth, behavior: 'auto' })
  }

  useEffect(() => {
    if (runMenuOpen) {
      const paused = new Set(pausedIds)
      setSelectedRunIds(
        runChecklistTabIds(stateRef.current, viewMode, runningIds).filter((id) => !paused.has(id))
      )
    }
  }, [runMenuOpen])

  const persist = useCallback((tab: ProjectTab): void => {
    setTabState((current) => replaceTab(current, tab))
  }, [setTabState])

  const persistEdited = useCallback((tab: ProjectTab): void => {
    setTabState((current) => replaceEditedTab(current, tab))
  }, [setTabState])

  const registerSession = useCallback((tabIds: string[], handle: ActiveTabSessionHandle | null): void => {
    for (const id of tabIds) {
      if (handle) sessions.current.set(id, handle)
      else sessions.current.delete(id)
    }
  }, [])

  const reportRuntime = useCallback((
    scope: string[],
    nextRunning: string[],
    nextBusy: string[],
    nextPaused: string[]
  ): void => {
    const replaceScope = (current: string[], next: string[]): string[] => {
      const scopeSet = new Set(scope)
      return [...current.filter((id) => !scopeSet.has(id)), ...next]
    }
    setRunningIds((current) => replaceScope(current, nextRunning))
    setRuntimeBusyIds((current) => replaceScope(current, nextBusy))
    setPausedIds((current) => replaceScope(current, nextPaused))
  }, [])

  const stopAll = useCallback(async (): Promise<void> => {
    setOperationBusy(true)
    try {
      await Promise.all([...new Set(sessions.current.values())].map((session) => session.stopAll()))
      setRunningIds([])
      setPausedIds([])
    } finally {
      setOperationBusy(false)
    }
  }, [])

  const applySessionAction = useCallback((
    tabIds: string[],
    action: 'pauseTabs' | 'resumeTabs'
  ): void => {
    const grouped = new Map<ActiveTabSessionHandle, string[]>()
    for (const tabId of tabIds) {
      const session = sessions.current.get(tabId)
      if (!session) continue
      grouped.set(session, [...(grouped.get(session) ?? []), tabId])
    }
    for (const [session, ids] of grouped) session[action](ids)
  }, [])

  const changeRunSelection = useCallback((nextSelectedIds: string[]): void => {
    const newlyUnchecked = uncheckedRunningTabIds(selectedRunIds, nextSelectedIds, runningIds)
    const newlyCheckedPaused = checkedPausedTabIds(selectedRunIds, nextSelectedIds, pausedIds)
    setSelectedRunIds(nextSelectedIds)
    if (newlyUnchecked.length > 0) {
      setPausedIds((current) => [...new Set([...current, ...newlyUnchecked])])
      applySessionAction(newlyUnchecked, 'pauseTabs')
    }
    if (newlyCheckedPaused.length > 0) {
      const resumed = new Set(newlyCheckedPaused)
      setPausedIds((current) => current.filter((id) => !resumed.has(id)))
      applySessionAction(newlyCheckedPaused, 'resumeTabs')
    }
  }, [applySessionAction, pausedIds, runningIds, selectedRunIds])

  const runSelected = useCallback(async (): Promise<void> => {
    const selected = new Set(selectedRunIds)
    if (selected.size === 0) return
    setOperationBusy(true)
    setPausedIds((current) => current.filter((id) => !selected.has(id)))
    onCloseRunMenu()
    try {
      const groups = selectedRunGroups(stateRef.current, [...selected])
      const started = (await Promise.all(groups.map((group) => {
        const session = sessions.current.get(group.tabIds[0]!)
        return session ? session.startTabs(group.tabIds) : Promise.resolve([])
      }))).flat()
      if (started.length === 0) onNotice('No selected file was ready to run.')
    } finally {
      setOperationBusy(false)
    }
  }, [onCloseRunMenu, onNotice, selectedRunIds])

  const updateConnection = useCallback(async (connectionId: string): Promise<void> => {
    if (!window.parrot || operationBusy) return
    const pair = connectedPairs(stateRef.current).find((item) => item.id === connectionId)
    if (!pair) return
    const session = sessions.current.get(pair.python.id)
    if (!session) return
    setOperationBusy(true)
    try {
      await session.stopPython()
      const snapshot = await session.snapshotScratch()
      if (!snapshot) throw new Error(`${pair.scratch.name} is not ready to update.`)
      const conversion = await window.parrot.updatePythonFromScratch(snapshot.projectBytes)
      setTabState((current) => {
        const liveScratch = current.tabs.find((tab): tab is ScratchProjectTab => (
          tab.id === pair.scratch.id && tab.kind === 'scratch'
        ))
        if (!liveScratch || liveScratch.connectionId !== connectionId) return current
        const withSnapshot = replaceTab(current, {
          ...liveScratch,
          projectBytes: snapshot.projectBytes,
          outputFrameDataUrl: snapshot.frameDataUrl || liveScratch.outputFrameDataUrl
        })
        return replaceConnectedPython(withSnapshot, [{
          connectionId,
          source: conversion.python,
          runtimeProjectId: conversion.runtimeProjectId
        }])
      })
      onNotice(`Updated ${pair.python.name} from ${pair.scratch.name}.`)
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : 'Parrot could not update the Python file.')
    } finally {
      setOperationBusy(false)
    }
  }, [onNotice, operationBusy, setTabState])

  const chooseLink = useCallback((tabId: string): void => {
    const current = stateRef.current
    const target = current.tabs.find((tab) => tab.id === tabId)
    if (!target || operationBusy) return

    if (!linkSourceId) {
      if (target.connectionId) return
      setLinkSourceId(tabId)
      onNotice(`Choose a ${target.kind === 'scratch' ? 'Python' : 'Scratch'} file to link with ${target.name}.`)
      return
    }
    if (linkSourceId === tabId) {
      setLinkSourceId(null)
      onNotice('Linking cancelled.')
      return
    }
    if (!connectionTargets(current, linkSourceId).some((tab) => tab.id === tabId)) return

    const source = current.tabs.find((tab) => tab.id === linkSourceId)
    setTabState(connectTabs(current, linkSourceId, tabId))
    setLinkSourceId(null)
    onNotice(`Linked ${source?.name ?? 'file'} and ${target.name}.`)
  }, [linkSourceId, onNotice, operationBusy, setTabState])

  const breakLink = useCallback((tabId: string): void => {
    const current = stateRef.current
    const tab = current.tabs.find((candidate) => candidate.id === tabId)
    const partner = connectedPartner(current, tabId)
    if (!tab?.connectionId || !partner || operationBusy) return
    setTabState(disconnectTab(current, tabId))
    setLinkSourceId(null)
    onNotice(`Unlinked ${tab.name} and ${partner.name}.`)
  }, [onNotice, operationBusy, setTabState])

  const duplicateFile = useCallback(async (tabId: string): Promise<void> => {
    if (operationBusy || stateRef.current.tabs.length >= MAX_OPEN_TABS) return
    const source = stateRef.current.tabs.find((tab) => tab.id === tabId)
    if (!source) return
    setOperationBusy(true)
    try {
      if (source.kind === 'scratch') {
        const snapshot = await sessions.current.get(tabId)?.snapshotScratch()
        if (!snapshot) throw new Error(`${source.name} is not ready to duplicate.`)
        const current = stateRef.current
        const liveScratch = current.tabs.find((tab): tab is ScratchProjectTab => (
          tab.id === tabId && tab.kind === 'scratch'
        ))
        if (!liveScratch) throw new Error(`${source.name} is no longer open.`)
        const withSnapshot = replaceTab(current, {
          ...liveScratch,
          projectBytes: snapshot.projectBytes,
          outputFrameDataUrl: snapshot.frameDataUrl || liveScratch.outputFrameDataUrl
        })
        const next = duplicateTab(withSnapshot, tabId, new Date(), snapshot.projectBytes)
        if (next.tabs.length === current.tabs.length) throw new Error(`${source.name} could not be duplicated.`)
        setTabState(next)
        onPlaceTabAfter(tabId, next.activeId)
      } else {
        const current = stateRef.current
        const next = duplicateTab(current, tabId, new Date())
        if (next.tabs.length === current.tabs.length) throw new Error(`${source.name} could not be duplicated.`)
        setTabState(next)
        onPlaceTabAfter(tabId, next.activeId)
      }
      onNotice(`Duplicated ${source.name}.`)
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : `Parrot could not duplicate ${source.name}.`)
    } finally {
      setOperationBusy(false)
    }
  }, [onNotice, onPlaceTabAfter, operationBusy, setTabState])

  const generateAdjacentPython = useCallback(async (tabId: string): Promise<void> => {
    if (!window.parrot || operationBusy || stateRef.current.tabs.length >= MAX_OPEN_TABS) return
    const source = stateRef.current.tabs.find((tab): tab is ScratchProjectTab => (
      tab.id === tabId && tab.kind === 'scratch'
    ))
    if (!source || source.connectionId) return
    setOperationBusy(true)
    try {
      const snapshot = await sessions.current.get(tabId)?.snapshotScratch()
      if (!snapshot) throw new Error(`${source.name} is not ready to convert.`)
      const conversion = await window.parrot.updatePythonFromScratch(snapshot.projectBytes)
      const current = stateRef.current
      const liveScratch = current.tabs.find((tab): tab is ScratchProjectTab => (
        tab.id === tabId && tab.kind === 'scratch'
      ))
      if (!liveScratch || liveScratch.connectionId) throw new Error(`${source.name} is no longer available for conversion.`)
      const withSnapshot = replaceTab(current, {
        ...liveScratch,
        projectBytes: snapshot.projectBytes,
        outputFrameDataUrl: snapshot.frameDataUrl || liveScratch.outputFrameDataUrl
      })
      const next = appendGeneratedPythonTab(
        withSnapshot,
        tabId,
        conversion.python,
        conversion.runtimeProjectId
      )
      if (next.tabs.length === current.tabs.length) {
        throw new Error(`Parrot could not add a Python file for ${source.name}.`)
      }
      setTabState(next)
      onPlaceTabAfter(tabId, next.activeId)
      setLinkSourceId(null)
      onNotice(`Created and linked an adjacent Python file for ${source.name}.`)
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : `Parrot could not convert ${source.name}.`)
    } finally {
      setOperationBusy(false)
    }
  }, [onNotice, onPlaceTabAfter, operationBusy, setTabState])

  const closeFile = useCallback(async (tabId: string): Promise<void> => {
    const session = sessions.current.get(tabId)
    if (session) await session.stopAll()
    setLinkSourceId((current) => current === tabId ? null : current)
    setTabState((current) => closeTab(current, tabId))
  }, [setTabState])

  const commonProps = {
    activeId: tabState.activeId,
    onActivate: (id: string) => setTabState((current) => selectTab(current, id)),
    onRegisterPane: () => {},
    onPersist: persist,
    onEdited: persistEdited,
    onParityStatus: () => {},
    onRuntimeState: reportRuntime,
    onRuntimeMessage: onNotice,
    busyTabIds: operationBusy ? tabState.tabs.map((tab) => tab.id) : [],
    connectableTabIds: linkableTabIds,
    linkSourceId,
    onConnect: chooseLink,
    onDisconnect: breakLink,
    onDuplicate: (id: string) => void duplicateFile(id),
    onGenerate: (id: string) => void generateAdjacentPython(id),
    onOpenInEditor: (id: string) => setTabState((current) => selectTab(current, id)),
    onClose: (id: string) => void closeFile(id),
    closeDisabledTabIds: operationBusy
      ? tabState.tabs.map((tab) => tab.id)
      : runtimeBusyIds,
    atTabLimit: tabState.tabs.length >= MAX_OPEN_TABS,
    focused: true,
    focusedView: viewMode,
    outputPositions,
    onUpdateConnection: (id: string) => void updateConnection(id)
  }

  return <div className="fp-project-workspace">
    <div
      className={`fp-program-sessions fp-program-sessions--${viewMode}`}
      ref={outputScrollRef}
      style={viewMode === 'output' ? outputGridStyle : undefined}
      onScroll={viewMode === 'output' ? updateOutputScroll : undefined}
    >
      {orderedSessions.map(({ key, pair, tab }) => pair ? <div
        className={`fp-session fp-session--pair ${viewMode === 'output' ? 'fp-session--output' : visibleSessionKey === pair.id ? '' : 'fp-session--hidden'}`}
        key={key}
      >
        <ActiveTabSession
          {...commonProps}
          ref={(handle) => registerSession([pair.scratch.id, pair.python.id], handle)}
          activeTab={pair.scratch}
          importedScratch={pair.scratch}
          importedPython={pair.python}
          paired
        />
      </div> : tab ? <div
        className={`fp-session fp-session--single ${viewMode === 'output' ? 'fp-session--output' : visibleSessionKey === tab.id ? '' : 'fp-session--hidden'}`}
        key={key}
      >
        <ActiveTabSession
          {...commonProps}
          ref={(handle) => registerSession([tab.id], handle)}
          activeTab={tab}
        />
      </div> : null)}
      {tabState.tabs.length === 0 && <div className="fp-empty-workspace" />}
    </div>
    {viewMode === 'output' && canScrollOutputLeft && <button
      className="fp-output-scroll-button fp-output-scroll-button--left"
      type="button"
      aria-label="Show previous project output"
      title="Previous project output"
      onClick={() => scrollOutput(-1)}
    ><VscodeIcon name="chevron-left" /></button>}
    {viewMode === 'output' && canScrollOutputRight && <button
      className="fp-output-scroll-button fp-output-scroll-button--right"
      type="button"
      aria-label="Show next project output"
      title="Next project output"
      onClick={() => scrollOutput(1)}
    ><VscodeIcon name="chevron-right" /></button>}
    {runMenuOpen && <RunChecklist
      state={tabState}
      selectedIds={selectedRunIds}
      runningIds={runningIds}
      pausedIds={pausedIds}
      busy={operationBusy || runtimeBusyIds.length > 0}
      onSelectionChange={changeRunSelection}
      onRun={() => void runSelected()}
      onStop={() => { onCloseRunMenu(); void stopAll() }}
      onClose={onCloseRunMenu}
    />}
  </div>
}

interface FocusedShellProps {
  workspaces: RendererWorkspace[]
  error: string
  dragging: boolean
  onImport: () => void
  onCloseProject: (workspaceId: string) => void
  onWorkspaceTabsChange: (
    workspaceId: string,
    update: React.SetStateAction<ProjectTabsState>
  ) => void
  onDropProject: (event: DragEvent<HTMLElement>) => void
  onDragState: (dragging: boolean) => void
}

function FocusedShell({
  workspaces,
  error,
  dragging,
  onImport,
  onCloseProject,
  onWorkspaceTabsChange,
  onDropProject,
  onDragState
}: FocusedShellProps): React.JSX.Element {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => workspaces.at(-1)?.project.id ?? '')
  const previousWorkspaceCountRef = useRef(workspaces.length)
  const workspace = workspaces.find((candidate) => candidate.project.id === activeWorkspaceId) ?? null
  const tabState = workspace?.tabs ?? null
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('editor')
  const [activity, setActivity] = useState<FocusedActivity>('explorer')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const editorSidebarOpenRef = useRef(true)
  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [notice, setNotice] = useState('')
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set())
  const [siblingOrderByWorkspace, setSiblingOrderByWorkspace] = useState<Record<string, WorkspaceSiblingOrder>>({})
  const [filePlacementsByWorkspace, setFilePlacementsByWorkspace] = useState<Record<string, WorkspaceFilePlacements>>({})
  const noticeTimerRef = useRef<number | null>(null)
  const explorerDisplayedIds = tabState ? displayedTabIds(tabState, viewMode) : []

  useEffect(() => {
    setActiveWorkspaceId((current) => {
      const stillAvailable = workspaces.some((candidate) => candidate.project.id === current)
      const addedWorkspace = workspaces.length > previousWorkspaceCountRef.current
      return stillAvailable && !addedWorkspace
        ? current
        : workspaces.at(-1)?.project.id ?? ''
    })
    previousWorkspaceCountRef.current = workspaces.length
  }, [workspaces])

  const setTabState = useCallback<React.Dispatch<React.SetStateAction<ProjectTabsState>>>((update) => {
    if (!activeWorkspaceId) return
    onWorkspaceTabsChange(activeWorkspaceId, update)
  }, [activeWorkspaceId, onWorkspaceTabsChange])

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const showNotice = useCallback((message: string): void => {
    setNotice(message)
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 3_000)
  }, [])

  useEffect(() => {
    const api = window.parrot
    if (!api?.getWindowFullscreen || !api.onWindowFullscreenChange) return
    let active = true
    void api.getWindowFullscreen().then((next) => { if (active) setFullscreen(next) })
    const removeListener = api.onWindowFullscreenChange(setFullscreen)
    return () => { active = false; removeListener() }
  }, [])

  const selectActivity = (next: FocusedActivity): void => {
    if (next !== 'explorer') showNotice(`${next === 'search' ? 'Search' : 'Settings'} is a placeholder in this phase.`)
    setAddMenuOpen(false)
    setSidebarOpen((open) => {
      const nextOpen = activity === next ? !open : true
      if (viewMode === 'editor') editorSidebarOpenRef.current = nextOpen
      return nextOpen
    })
    setActivity(next)
  }

  const toggleView = (): void => {
    setAddMenuOpen(false)
    setRunMenuOpen(false)
    if (viewMode === 'editor') {
      editorSidebarOpenRef.current = sidebarOpen
      setSidebarOpen(false)
      setViewMode('output')
      return
    }
    setViewMode('editor')
    setSidebarOpen(editorSidebarOpenRef.current)
  }

  const addFile = async (source: 'new' | 'upload', kind: 'scratch' | 'python'): Promise<void> => {
    if (!tabState || tabState.tabs.length >= MAX_OPEN_TABS) {
      showNotice(`A project can contain up to ${MAX_OPEN_TABS} open programs in this phase.`)
      return
    }
    setAddMenuOpen(false)
    try {
      if (kind === 'python') {
        if (!window.parrot) throw new Error('Python files can be added in the Electron app.')
        const file = source === 'upload'
          ? await window.parrot.selectPythonTabFile()
          : await window.parrot.createPythonTab()
        if (!file) return
        const requestedName = 'name' in file && typeof file.name === 'string' ? file.name : undefined
        setTabState((current) => current
          ? appendPythonTab(current, file.python, file.runtimeProjectId, requestedName)
          : current)
      } else if (source === 'upload') {
        if (!window.parrot) throw new Error('Scratch files can be added in the Electron app.')
        const file = await window.parrot.selectScratchTabFile()
        if (!file) return
        setTabState((current) => current ? appendScratchTab(current, file) : current)
      } else {
        setTabState((current) => current ? appendScratchTab(current) : current)
      }
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : 'Parrot could not add that file.')
    }
  }

  const openExplorerFile = async (workspaceId: string, file: WorkspaceFileEntry): Promise<void> => {
    const target = workspaces.find((candidate) => candidate.project.id === workspaceId)
    if (!target) return
    setActiveWorkspaceId(workspaceId)
    setAddMenuOpen(false)
    setRunMenuOpen(false)
    const existing = target.tabs.tabs.find((tab) => tab.id === file.id)
    if (existing) {
      onWorkspaceTabsChange(workspaceId, selectTab(target.tabs, existing.id))
      return
    }
    if (file.fileKind === 'other') {
      showNotice('Parrot can currently open Scratch .sb3 and Python .py files.')
      return
    }
    if (!window.parrot) {
      showNotice('Folder files can be opened in the Electron app.')
      return
    }
    if (target.tabs.tabs.length >= MAX_OPEN_TABS) {
      showNotice(`Close a program before opening another. The current limit is ${MAX_OPEN_TABS}.`)
      return
    }
    try {
      const opened = await window.parrot.openWorkspaceFile(workspaceId, file.id)
      const next = openWorkspacePrograms(target.tabs, opened)
      onWorkspaceTabsChange(workspaceId, next)
      const missing = opened.programs.filter((program) => !next.tabs.some((tab) => tab.id === program.id))
      if (missing.length > 0) showNotice(`Close a program to open ${missing.map((program) => program.name).join(', ')}.`)
    } catch (reason) {
      showNotice(reason instanceof Error ? reason.message : `Parrot could not open ${file.name}.`)
    }
  }

  const toggleFolder = (folderId: string): void => {
    setCollapsedFolderIds((current) => toggleCollapsedFolder(current, folderId))
  }

  const reorderExplorerFile = (
    workspaceId: string,
    parentId: string,
    siblingIds: string[],
    sourceId: string,
    targetId: string,
    position: WorkspaceDropPosition
  ): void => {
    setSiblingOrderByWorkspace((current) => {
      const workspaceOrder = current[workspaceId] ?? {}
      const nextOrder = reorderWorkspaceSiblings(
        workspaceOrder,
        parentId,
        siblingIds,
        sourceId,
        targetId,
        position
      )
      return nextOrder === workspaceOrder ? current : { ...current, [workspaceId]: nextOrder }
    })
  }

  const placeExplorerTabAfter = useCallback((sourceId: string, tabId: string): void => {
    if (!activeWorkspaceId || sourceId === tabId) return
    const activeWorkspace = workspaces.find((candidate) => candidate.project.id === activeWorkspaceId)
    if (!activeWorkspace) return
    const existingPlacements = filePlacementsByWorkspace[activeWorkspaceId] ?? {}
    const parentId = workspaceFileParentId(activeWorkspace.root, sourceId) ??
      existingPlacements[sourceId]?.parentId ??
      activeWorkspace.root.id

    setFilePlacementsByWorkspace((current) => ({
      ...current,
      [activeWorkspaceId]: {
        ...(current[activeWorkspaceId] ?? {}),
        [tabId]: { parentId, afterId: sourceId }
      }
    }))
    setSiblingOrderByWorkspace((current) => {
      const workspaceOrder = current[activeWorkspaceId]
      const siblingIds = workspaceOrder?.[parentId]
      if (!workspaceOrder || !siblingIds?.includes(sourceId)) return current
      const nextIds = siblingIds.filter((id) => id !== tabId)
      nextIds.splice(nextIds.indexOf(sourceId) + 1, 0, tabId)
      return {
        ...current,
        [activeWorkspaceId]: { ...workspaceOrder, [parentId]: nextIds }
      }
    })
  }, [activeWorkspaceId, filePlacementsByWorkspace, workspaces])

  const closeExplorerProject = (workspaceId: string): void => {
    setSiblingOrderByWorkspace((current) => {
      if (!(workspaceId in current)) return current
      const next = { ...current }
      delete next[workspaceId]
      return next
    })
    setFilePlacementsByWorkspace((current) => {
      if (!(workspaceId in current)) return current
      const next = { ...current }
      delete next[workspaceId]
      return next
    })
    onCloseProject(workspaceId)
  }

  return <main
    className={`fp-shell ${fullscreen ? 'fp-shell--fullscreen' : ''} ${dragging ? 'fp-shell--dragging' : ''}`}
    onDragEnter={(event) => {
      if (isExplorerFileDrag(event)) {
        event.preventDefault()
        return
      }
      onDragState(true)
    }}
    onDragOver={(event) => event.preventDefault()}
    onDragLeave={(event) => {
      if (isExplorerFileDrag(event)) return
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragState(false)
    }}
    onDrop={(event) => {
      if (isExplorerFileDrag(event)) {
        event.preventDefault()
        return
      }
      onDropProject(event)
    }}
  >
    <header className={`fp-titlebar ${fullscreen ? 'fp-titlebar--fullscreen' : ''}`}>
      {!fullscreen && <div className="fp-titlebar-spacer" aria-hidden="true" />}
      <button
        className={`fp-menu-button ${viewMode === 'output' ? 'fp-menu-button--active' : ''}`}
        type="button"
        aria-pressed={viewMode === 'output'}
        aria-label={viewMode === 'editor' ? 'Switch to Output View' : 'Switch to Editor View'}
        title={viewMode === 'editor' ? 'Output View' : 'Editor View'}
        onClick={toggleView}
      >View</button>
      <button
        className={`fp-menu-button ${runMenuOpen ? 'fp-menu-button--active' : ''}`}
        type="button"
        disabled={!tabState?.tabs.length}
        aria-expanded={runMenuOpen}
        onClick={() => setRunMenuOpen((open) => !open)}
      >Run</button>
    </header>

    <div className={`fp-body ${sidebarOpen ? '' : 'fp-body--sidebar-closed'}`}>
      <nav className="fp-activity" aria-label="Activity bar">
        <div>
          <ActivityButton activity="explorer" current={activity} sidebarOpen={sidebarOpen} label="Explorer" icon="files" onSelect={selectActivity} />
          <ActivityButton activity="search" current={activity} sidebarOpen={sidebarOpen} label="Search" icon="search" onSelect={selectActivity} />
        </div>
        <ActivityButton activity="settings" current={activity} sidebarOpen={sidebarOpen} label="Settings" icon="settings-gear" onSelect={selectActivity} />
      </nav>

      {sidebarOpen && <ExplorerSidebar
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activity={activity}
        addMenuOpen={addMenuOpen}
        displayedIds={explorerDisplayedIds}
        collapsedFolderIds={collapsedFolderIds}
        siblingOrderByWorkspace={siblingOrderByWorkspace}
        filePlacementsByWorkspace={filePlacementsByWorkspace}
        onImport={onImport}
        onOpenFile={(workspaceId, file) => void openExplorerFile(workspaceId, file)}
        onCloseTab={(workspaceId, id) => {
          setAddMenuOpen(false)
          const target = workspaces.find((candidate) => candidate.project.id === workspaceId)
          if (target) onWorkspaceTabsChange(workspaceId, closeTab(target.tabs, id))
        }}
        onCloseProject={closeExplorerProject}
        onToggleFolder={toggleFolder}
        onToggleAddMenu={(workspaceId) => {
          const switching = activeWorkspaceId !== workspaceId
          setActiveWorkspaceId(workspaceId)
          setAddMenuOpen((open) => switching ? true : !open)
        }}
        onAddFile={(source, kind) => void addFile(source, kind)}
        onReorderFile={reorderExplorerFile}
      />}

      <section className="fp-main" aria-label={workspace ? 'Project editor' : 'Empty editor'}>
        {tabState
          ? <ProjectWorkspace
              tabState={tabState}
              setTabState={setTabState}
              viewMode={viewMode}
              runMenuOpen={runMenuOpen}
              onCloseRunMenu={() => setRunMenuOpen(false)}
              onNotice={showNotice}
              onPlaceTabAfter={placeExplorerTabAfter}
            />
          : <div className="fp-empty-workspace" />}
      </section>
    </div>

    {dragging && <div className="fp-drop-overlay"><strong>Drop a folder to add it</strong></div>}
    {(error || notice) && <div className={`fp-toast ${error ? 'fp-toast--error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}
  </main>
}

export default function FocusedAppV04(): React.JSX.Element {
  const [workspaces, setWorkspaces] = useState<RendererWorkspace[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  const openWorkspace = useCallback(async (selection: WorkspaceSelection): Promise<void> => {
    setError('')
    try {
      const hydrated = await hydrateWorkspace(selection)
      setWorkspaces((current) => [...current, hydrated.workspace])
      if (hydrated.warnings.length > 0) setError(hydrated.warnings[0]!)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parrot could not add that folder.')
    }
  }, [])

  const chooseImport = useCallback(async (): Promise<void> => {
    if (!window.parrot) {
      setError('Folder import is available in the Parrot desktop app.')
      return
    }
    setError('')
    try {
      const selection = await window.parrot.selectWorkspaceItem()
      if (selection) await openWorkspace(selection)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parrot could not add that folder.')
    }
  }, [openWorkspace])

  const dropProject = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (!file) return
    if (!window.parrot) {
      setError('Folder import is available in the Parrot desktop app.')
      return
    }
    setError('')
    void window.parrot.registerDroppedWorkspaceItem(file)
      .then(openWorkspace)
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Parrot could not add that folder.'))
  }

  return <>
    <FocusedShell
      workspaces={workspaces}
      error={error}
      dragging={dragging}
      onImport={() => void chooseImport()}
      onCloseProject={(workspaceId) => {
        void window.parrot?.closeWorkspace(workspaceId)
        setWorkspaces((current) => current.filter((workspace) => workspace.project.id !== workspaceId))
        setError('')
      }}
      onWorkspaceTabsChange={(workspaceId, update) => {
        setWorkspaces((current) => current.map((workspace) => {
          if (workspace.project.id !== workspaceId) return workspace
          const tabs = typeof update === 'function' ? update(workspace.tabs) : update
          return { ...workspace, tabs }
        }))
      }}
      onDropProject={dropProject}
      onDragState={setDragging}
    />
  </>
}
