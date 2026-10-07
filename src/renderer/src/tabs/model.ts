import type { ConversionResult, PythonFrameState, WorkspaceFileOpenResult } from '../../../shared/project'

/** Zero means one half of the visible workspace; explicit widths are pixels. */
export const DEFAULT_TAB_WIDTH = 0
export const MIN_TAB_WIDTH = 280
export const MAX_TAB_WIDTH = 1_200
export const MAX_OPEN_TABS = 16
export const MAX_OUTPUT_VISIBLE_TABS = 8

export type WorkspaceViewMode = 'editor' | 'output'

export const WORKSPACE_VIEW_OPTIONS: ReadonlyArray<{
  mode: WorkspaceViewMode
  label: string
  tooltip: string
}> = [
  { mode: 'editor', label: 'Editor View', tooltip: 'Show file editors and their outputs' },
  { mode: 'output', label: 'Output View', tooltip: 'Show enlarged outputs for every open file' }
]

export interface OutputViewGrid {
  columns: number
  rows: number
}

export interface OutputViewPosition {
  column: number
  row: number
}

export interface PythonTabRuntimeState {
  frameDataUrl: string
  frameState: PythonFrameState | null
  output: string[]
  error: string
}

interface BaseProjectTab {
  id: string
  name: string
  width: number
  dirty: boolean
  connectionId?: string
  importedRole?: 'scratch' | 'python'
}

export interface ScratchProjectTab extends BaseProjectTab {
  kind: 'scratch'
  projectBytes: Uint8Array
  outputFrameDataUrl: string
}

export interface PythonProjectTab extends BaseProjectTab {
  kind: 'python'
  codeUpToDate: boolean
  source: string
  runtimeProjectId: string
  runtime: PythonTabRuntimeState
}

export type ProjectTab = ScratchProjectTab | PythonProjectTab

export interface ProjectTabsState {
  tabs: ProjectTab[]
  activeId: string
  lastEditedId?: string
  nextId: number
  nextConnectionId: number
}

export interface ConnectedTabPair {
  id: string
  scratch: ScratchProjectTab
  python: PythonProjectTab
}

export function createEmptyProjectTabs(): ProjectTabsState {
  return {
    tabs: [],
    activeId: '',
    nextId: 1,
    nextConnectionId: 1
  }
}

export function canAddProjectTab(state: ProjectTabsState): boolean {
  return state.tabs.length < MAX_OPEN_TABS
}

export function outputViewGrid(tabCount: number): OutputViewGrid {
  const count = Math.max(1, Math.min(MAX_OUTPUT_VISIBLE_TABS, Math.floor(tabCount)))
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : count <= 6 ? 3 : 4
  return { columns, rows: Math.ceil(count / columns) }
}

export function outputViewPosition(tabIndex: number, tabCount: number): OutputViewPosition {
  const index = Math.max(0, Math.floor(tabIndex))
  const grid = outputViewGrid(tabCount)
  const page = Math.floor(index / MAX_OUTPUT_VISIBLE_TABS)
  const positionOnPage = index % MAX_OUTPUT_VISIBLE_TABS
  return {
    column: page * grid.columns + (positionOnPage % grid.columns) + 1,
    row: Math.floor(positionOnPage / grid.columns) + 1
  }
}

export type PanelActionKind = 'connect' | 'reconnect' | 'disconnect' | 'generate' | 'duplicate' | 'export'

export const UNCONNECTED_COLOR = '#68758D'
export const CONNECTION_COLORS = [
  '#4C97FF',
  '#9966FF',
  '#CF63CF',
  '#FFBF00',
  '#FFAB19',
  '#5CB1D6',
  '#59C059',
  '#FF8C1A',
  '#0FBD8C',
  '#FF6680'
] as const

export function pythonNameForScratch(filename: string): string {
  return `${filename.replace(/\.sb3$/i, '')}.py`
}

export function createImportedTabs(result: ConversionResult): ProjectTabsState {
  const scratchId = 'tab-1'
  const pythonId = 'tab-2'
  return {
    activeId: scratchId,
    nextId: 3,
    nextConnectionId: 2,
    tabs: [
      {
        id: scratchId,
        kind: 'scratch',
        name: result.project.name,
        width: DEFAULT_TAB_WIDTH,
        dirty: false,
        connectionId: 'connection-1',
        importedRole: 'scratch',
        projectBytes: new Uint8Array(result.scratchProject),
        outputFrameDataUrl: ''
      },
      {
        id: pythonId,
        kind: 'python',
        name: pythonNameForScratch(result.project.name),
        width: DEFAULT_TAB_WIDTH,
        dirty: false,
        connectionId: 'connection-1',
        importedRole: 'python',
        codeUpToDate: true,
        source: result.python,
        runtimeProjectId: result.runtimeProjectId,
        runtime: emptyPythonRuntimeState()
      }
    ]
  }
}

export function openWorkspacePrograms(
  state: ProjectTabsState,
  opened: WorkspaceFileOpenResult
): ProjectTabsState {
  const existingIds = new Set(state.tabs.map((tab) => tab.id))
  const orderedPrograms = [...opened.programs].sort((first, second) => (
    first.id === opened.requestedFileId ? -1 : second.id === opened.requestedFileId ? 1 : 0
  ))
  const addedIds = new Set<string>()
  let next = state

  for (const program of orderedPrograms) {
    if (existingIds.has(program.id) || next.tabs.length >= MAX_OPEN_TABS) continue
    addedIds.add(program.id)
    existingIds.add(program.id)
    const tab: ProjectTab = program.kind === 'scratch'
      ? {
          id: program.id,
          kind: 'scratch',
          name: program.name,
          width: DEFAULT_TAB_WIDTH,
          dirty: false,
          projectBytes: new Uint8Array(program.scratchProject),
          outputFrameDataUrl: ''
        }
      : {
          id: program.id,
          kind: 'python',
          name: program.name,
          width: DEFAULT_TAB_WIDTH,
          dirty: false,
          codeUpToDate: program.codeUpToDate,
          source: program.python,
          runtimeProjectId: program.runtimeProjectId,
          runtime: emptyPythonRuntimeState()
        }
    next = { ...next, tabs: [...next.tabs, tab] }
  }

  if (
    opened.connection &&
    next.tabs.some((tab) => tab.id === opened.connection!.scratchId) &&
    next.tabs.some((tab) => tab.id === opened.connection!.pythonId)
  ) {
    next = connectTabs(next, opened.connection.scratchId, opened.connection.pythonId)
    const importedPython = opened.programs.find((program) => (
      program.kind === 'python' && program.id === opened.connection?.pythonId
    ))
    if (importedPython?.kind === 'python' && addedIds.has(importedPython.id)) {
      next = {
        ...next,
        tabs: next.tabs.map((tab) => tab.id === importedPython.id && tab.kind === 'python'
          ? { ...tab, codeUpToDate: importedPython.codeUpToDate }
          : tab)
      }
    }
  }

  const requestedIsOpen = next.tabs.some((tab) => tab.id === opened.requestedFileId)
  const fallbackId = orderedPrograms.find((program) => next.tabs.some((tab) => tab.id === program.id))?.id
  return {
    ...next,
    activeId: requestedIsOpen ? opened.requestedFileId : fallbackId ?? next.activeId
  }
}

export function connectionColor(connectionId?: string): string {
  if (!connectionId) return UNCONNECTED_COLOR
  const numericId = Number.parseInt(connectionId.replace(/^connection-/, ''), 10)
  const index = Number.isSafeInteger(numericId) && numericId > 0 ? numericId - 1 : 0
  return CONNECTION_COLORS[index % CONNECTION_COLORS.length] ?? CONNECTION_COLORS[0]
}

export function connectedPairs(state: ProjectTabsState): ConnectedTabPair[] {
  const byConnection = new Map<string, ProjectTab[]>()
  for (const tab of state.tabs) {
    if (!tab.connectionId) continue
    byConnection.set(tab.connectionId, [...(byConnection.get(tab.connectionId) ?? []), tab])
  }
  return [...byConnection.entries()].flatMap(([id, tabs]) => {
    const scratch = tabs.find((tab): tab is ScratchProjectTab => tab.kind === 'scratch')
    const python = tabs.find((tab): tab is PythonProjectTab => tab.kind === 'python')
    return scratch && python && tabs.length === 2 ? [{ id, scratch, python }] : []
  })
}

export function connectedPartner(state: ProjectTabsState, tabId: string): ProjectTab | undefined {
  const tab = state.tabs.find((candidate) => candidate.id === tabId)
  if (!tab?.connectionId) return undefined
  return state.tabs.find((candidate) => candidate.id !== tabId && candidate.connectionId === tab.connectionId)
}

/** Files represented by the current workspace surface. */
export function displayedTabIds(
  state: ProjectTabsState,
  viewMode: WorkspaceViewMode
): string[] {
  if (viewMode === 'output') return state.tabs.map((tab) => tab.id)
  const active = state.tabs.find((tab) => tab.id === state.activeId)
  if (!active) return []
  if (!active.connectionId) return [active.id]
  return state.tabs
    .filter((tab) => tab.connectionId === active.connectionId)
    .map((tab) => tab.id)
}

export function connectionTargets(state: ProjectTabsState, tabId: string): ProjectTab[] {
  const source = state.tabs.find((tab) => tab.id === tabId)
  if (!source) return []
  const partnerId = connectedPartner(state, tabId)?.id
  return state.tabs.filter((tab) => tab.kind !== source.kind && tab.id !== partnerId)
}

export function unconnectedTabs(state: ProjectTabsState): ProjectTab[] {
  return state.tabs.filter((tab) => !tab.connectionId)
}

export function defaultRunTabIds(state: ProjectTabsState): string[] {
  const preferredId = state.lastEditedId ?? state.activeId
  const preferred = state.tabs.find((tab) => tab.id === preferredId)
  if (!preferred) return []
  if (!preferred.connectionId) return [preferred.id]
  return state.tabs
    .filter((tab) => tab.connectionId === preferred.connectionId)
    .map((tab) => tab.id)
}

/** Preselect the visible surface plus any files that are already running. */
export function runChecklistTabIds(
  state: ProjectTabsState,
  viewMode: WorkspaceViewMode,
  runningIds: string[]
): string[] {
  const selected = new Set([...displayedTabIds(state, viewMode), ...runningIds])
  return state.tabs.filter((tab) => selected.has(tab.id)).map((tab) => tab.id)
}

/** Return only running files removed by the latest checklist change. */
export function uncheckedRunningTabIds(
  selectedIds: string[],
  nextSelectedIds: string[],
  runningIds: string[]
): string[] {
  const selected = new Set(selectedIds)
  const nextSelected = new Set(nextSelectedIds)
  return runningIds.filter((id) => selected.has(id) && !nextSelected.has(id))
}

/** Return paused files newly added by the latest checklist change. */
export function checkedPausedTabIds(
  selectedIds: string[],
  nextSelectedIds: string[],
  pausedIds: string[]
): string[] {
  const selected = new Set(selectedIds)
  const nextSelected = new Set(nextSelectedIds)
  return pausedIds.filter((id) => !selected.has(id) && nextSelected.has(id))
}

export interface SelectedRunGroup {
  sessionKey: string
  tabIds: string[]
  coordinated: boolean
}

/** Group a checklist selection by the runtime session that can execute it. */
export function selectedRunGroups(state: ProjectTabsState, selectedIds: string[]): SelectedRunGroup[] {
  const selected = new Set(selectedIds)
  const pairGroups = connectedPairs(state).flatMap((pair) => {
    const tabIds = [pair.scratch.id, pair.python.id].filter((id) => selected.has(id))
    return tabIds.length > 0
      ? [{ sessionKey: pair.id, tabIds, coordinated: tabIds.length === 2 }]
      : []
  })
  const standaloneGroups = unconnectedTabs(state)
    .filter((tab) => selected.has(tab.id))
    .map((tab) => ({ sessionKey: tab.id, tabIds: [tab.id], coordinated: false }))
  return [...pairGroups, ...standaloneGroups]
}

export function defaultUpdateConnectionIds(state: ProjectTabsState): string[] {
  const preferredId = state.lastEditedId ?? state.activeId
  const connectionId = state.tabs.find((tab) => tab.id === preferredId)?.connectionId
  return connectionId ? [connectionId] : []
}

export function setSelectionGroup(
  selectedIds: string[],
  groupIds: string[],
  selected: boolean
): string[] {
  const group = new Set(groupIds)
  return selected
    ? [...new Set([...selectedIds, ...groupIds])]
    : selectedIds.filter((id) => !group.has(id))
}

export function connectTabs(
  state: ProjectTabsState,
  firstId: string,
  secondId: string
): ProjectTabsState {
  const first = state.tabs.find((tab) => tab.id === firstId)
  const second = state.tabs.find((tab) => tab.id === secondId)
  if (!first || !second || first.kind === second.kind || first.id === second.id) return state
  if (first.connectionId && first.connectionId === second.connectionId) return state

  const disconnectedIds = new Set([first.connectionId, second.connectionId].filter(Boolean))
  const connectionId = `connection-${state.nextConnectionId}`
  return {
    ...state,
    nextConnectionId: state.nextConnectionId + 1,
    tabs: state.tabs.map((tab) => {
      if (tab.id === firstId || tab.id === secondId) {
        return tab.kind === 'python'
          ? { ...tab, connectionId, codeUpToDate: false }
          : { ...tab, connectionId }
      }
      if (tab.connectionId && disconnectedIds.has(tab.connectionId)) {
        return tab.kind === 'python'
          ? { ...tab, connectionId: undefined, codeUpToDate: false }
          : { ...tab, connectionId: undefined }
      }
      return tab
    })
  }
}

export function closeTab(state: ProjectTabsState, tabId: string): ProjectTabsState {
  const closingIndex = state.tabs.findIndex((tab) => tab.id === tabId)
  if (closingIndex < 0) return state
  const closing = state.tabs[closingIndex]
  const tabs = state.tabs
    .filter((tab) => tab.id !== tabId)
    .map((tab) => {
      if (!closing?.connectionId || tab.connectionId !== closing.connectionId) return tab
      return tab.kind === 'python'
        ? { ...tab, connectionId: undefined, codeUpToDate: false }
        : { ...tab, connectionId: undefined }
    })
  const nextActive = state.activeId === tabId
    ? tabs[Math.min(closingIndex, tabs.length - 1)]?.id ?? ''
    : state.activeId
  return {
    ...state,
    tabs,
    activeId: nextActive,
    lastEditedId: state.lastEditedId === tabId ? nextActive || undefined : state.lastEditedId
  }
}

export function disconnectTab(state: ProjectTabsState, tabId: string): ProjectTabsState {
  const connectionId = state.tabs.find((tab) => tab.id === tabId)?.connectionId
  if (!connectionId) return state
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.connectionId !== connectionId) return tab
      return tab.kind === 'python'
        ? { ...tab, connectionId: undefined, codeUpToDate: false }
        : { ...tab, connectionId: undefined }
    })
  }
}

export function panelActionKinds(tab: ProjectTab): PanelActionKind[] {
  return [
    tab.connectionId ? 'reconnect' : 'connect',
    ...(tab.connectionId ? ['disconnect' as const] : []),
    ...(tab.kind === 'scratch' && !tab.connectionId ? ['generate' as const] : []),
    'duplicate',
    'export'
  ]
}

export function emptyPythonRuntimeState(): PythonTabRuntimeState {
  return { frameDataUrl: '', frameState: null, output: [], error: '' }
}

export function uniqueUntitledName(tabs: ProjectTab[], kind: ProjectTab['kind']): string {
  const extension = kind === 'python' ? '.py' : '.sb3'
  const names = new Set(tabs.map((tab) => tab.name.toLowerCase()))
  let suffix = 1
  while (true) {
    const candidate = suffix === 1 ? `untitled${extension}` : `untitled-${suffix}${extension}`
    if (!names.has(candidate.toLowerCase())) return candidate
    suffix += 1
  }
}

export function uniqueTabName(
  tabs: ProjectTab[],
  requestedName: string,
  kind: ProjectTab['kind']
): string {
  const extension = kind === 'python' ? '.py' : '.sb3'
  const trimmed = requestedName.trim()
  const normalized = trimmed.toLowerCase().endsWith(extension)
    ? trimmed
    : `${trimmed || 'untitled'}${extension}`
  const base = normalized.slice(0, -extension.length) || 'untitled'
  const names = new Set(tabs.map((tab) => tab.name.toLowerCase()))
  if (!names.has(normalized.toLowerCase())) return normalized

  let suffix = 2
  while (names.has(`${base}-${suffix}${extension}`.toLowerCase())) suffix += 1
  return `${base}-${suffix}${extension}`
}

export function appendPythonTab(
  state: ProjectTabsState,
  source: string,
  runtimeProjectId: string,
  requestedName?: string
): ProjectTabsState {
  if (!canAddProjectTab(state)) return state
  const id = `tab-${state.nextId}`
  return {
    ...state,
    activeId: id,
    nextId: state.nextId + 1,
    tabs: [...state.tabs, {
      id,
      kind: 'python',
      name: requestedName
        ? uniqueTabName(state.tabs, requestedName, 'python')
        : uniqueUntitledName(state.tabs, 'python'),
      width: DEFAULT_TAB_WIDTH,
      dirty: false,
      codeUpToDate: false,
      source,
      runtimeProjectId,
      runtime: emptyPythonRuntimeState()
    }]
  }
}

export function appendGeneratedPythonTab(
  state: ProjectTabsState,
  scratchId: string,
  source: string,
  runtimeProjectId: string
): ProjectTabsState {
  if (!canAddProjectTab(state)) return state
  const scratch = state.tabs.find((tab): tab is ScratchProjectTab => tab.id === scratchId && tab.kind === 'scratch')
  if (!scratch || scratch.connectionId) return state
  const id = `tab-${state.nextId}`
  const connectionId = `connection-${state.nextConnectionId}`
  return {
    ...state,
    activeId: id,
    nextId: state.nextId + 1,
    nextConnectionId: state.nextConnectionId + 1,
    tabs: [
      ...state.tabs.map((tab) => tab.id === scratchId ? { ...tab, connectionId } : tab),
      {
        id,
        kind: 'python',
        name: uniqueTabName(state.tabs, pythonNameForScratch(scratch.name), 'python'),
        width: DEFAULT_TAB_WIDTH,
        dirty: false,
        connectionId,
        codeUpToDate: true,
        source,
        runtimeProjectId,
        runtime: emptyPythonRuntimeState()
      }
    ]
  }
}

export function appendScratchTab(
  state: ProjectTabsState,
  imported?: { name: string; scratchProject: Uint8Array }
): ProjectTabsState {
  if (!canAddProjectTab(state)) return state
  const id = `tab-${state.nextId}`
  return {
    ...state,
    activeId: id,
    nextId: state.nextId + 1,
    tabs: [...state.tabs, {
      id,
      kind: 'scratch',
      name: imported
        ? uniqueTabName(state.tabs, imported.name, 'scratch')
        : uniqueUntitledName(state.tabs, 'scratch'),
      width: DEFAULT_TAB_WIDTH,
      dirty: false,
      projectBytes: imported ? new Uint8Array(imported.scratchProject) : new Uint8Array(),
      outputFrameDataUrl: ''
    }]
  }
}

export function duplicateFilename(tabs: ProjectTab[], tab: ProjectTab, now: Date): string {
  const extension = tab.kind === 'python' ? '.py' : '.sb3'
  const base = tab.name.replace(new RegExp(`${extension.replace('.', '\\.')}$`, 'i'), '') || 'untitled'
  const pad = (value: number): string => String(value).padStart(2, '0')
  const timestamp = `${pad(now.getHours())}${pad(now.getMinutes())} ${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${pad(now.getFullYear() % 100)}`
  return uniqueTabName(tabs, `${base} ${timestamp}${extension}`, tab.kind)
}

export function duplicateTab(
  state: ProjectTabsState,
  tabId: string,
  now: Date,
  scratchProject?: Uint8Array
): ProjectTabsState {
  if (!canAddProjectTab(state)) return state
  const source = state.tabs.find((tab) => tab.id === tabId)
  if (!source || (source.kind === 'scratch' && !scratchProject)) return state
  const id = `tab-${state.nextId}`
  const common = {
    id,
    name: duplicateFilename(state.tabs, source, now),
    width: DEFAULT_TAB_WIDTH,
    dirty: false
  }
  const duplicate: ProjectTab = source.kind === 'python'
    ? {
        ...common,
        kind: 'python',
        codeUpToDate: false,
        source: source.source,
        runtimeProjectId: source.runtimeProjectId,
        runtime: emptyPythonRuntimeState()
      }
    : {
        ...common,
        kind: 'scratch',
        projectBytes: new Uint8Array(scratchProject!),
        outputFrameDataUrl: ''
      }
  return {
    ...state,
    activeId: id,
    nextId: state.nextId + 1,
    tabs: [...state.tabs, duplicate]
  }
}

export function replaceConnectedPython(
  state: ProjectTabsState,
  updates: Array<{ connectionId: string; source: string; runtimeProjectId: string }>
): ProjectTabsState {
  const byConnection = new Map(updates.map((update) => [update.connectionId, update]))
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.kind !== 'python' || !tab.connectionId) return tab
      const update = byConnection.get(tab.connectionId)
      return update
        ? {
            ...tab,
            source: update.source,
            runtimeProjectId: update.runtimeProjectId,
            runtime: emptyPythonRuntimeState(),
            dirty: false,
            codeUpToDate: true
          }
        : tab
    })
  }
}

export function replaceTab(state: ProjectTabsState, nextTab: ProjectTab): ProjectTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === nextTab.id ? nextTab : tab)
  }
}

export function replaceEditedTab(state: ProjectTabsState, nextTab: ProjectTab): ProjectTabsState {
  const editedTab = nextTab.kind === 'python'
    ? { ...nextTab, codeUpToDate: false }
    : nextTab
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.id === editedTab.id) return editedTab
      if (
        editedTab.kind === 'scratch' && editedTab.connectionId &&
        tab.kind === 'python' && tab.connectionId === editedTab.connectionId
      ) {
        return { ...tab, codeUpToDate: false }
      }
      return tab
    }),
    lastEditedId: nextTab.id
  }
}

export function resizeTab(state: ProjectTabsState, id: string, requestedWidth: number): ProjectTabsState {
  const width = Math.min(MAX_TAB_WIDTH, Math.max(MIN_TAB_WIDTH, Math.round(requestedWidth)))
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, width } : tab)
  }
}

export function resetTabWidth(state: ProjectTabsState, id: string): ProjectTabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, width: DEFAULT_TAB_WIDTH } : tab)
  }
}

export function selectTab(state: ProjectTabsState, id: string): ProjectTabsState {
  return state.tabs.some((tab) => tab.id === id) ? { ...state, activeId: id } : state
}

export function resolvedTabWidth(tab: ProjectTab, viewportWidth: number): number {
  return tab.width || viewportWidth / 2
}

export function tabHeadersOverflow(tabs: ProjectTab[], stripWidth: number): boolean {
  return tabs.reduce((total, tab) => total + resolvedTabWidth(tab, stripWidth), 0) > stripWidth
}

export function shouldScrollProjectsFromWheel(targetIsProjectLocal: boolean): boolean {
  return !targetIsProjectLocal
}

export function scrollLeftForFullyVisibleTab(
  currentScrollLeft: number,
  viewportWidth: number,
  tabLeft: number,
  tabWidth: number
): number {
  if (tabLeft < currentScrollLeft) return tabLeft
  const tabRight = tabLeft + tabWidth
  const viewportRight = currentScrollLeft + viewportWidth
  return tabRight > viewportRight ? tabRight - viewportWidth : currentScrollLeft
}

export function scrollLeftByProject(
  currentScrollLeft: number,
  viewportWidth: number,
  contentWidth: number,
  paneStarts: number[],
  direction: -1 | 1
): number {
  const maxScrollLeft = Math.max(0, contentWidth - viewportWidth)
  const current = Math.min(maxScrollLeft, Math.max(0, currentScrollLeft))
  const starts = [...new Set(
    paneStarts
      .filter((start) => Number.isFinite(start))
      .map((start) => Math.max(0, start))
  )].sort((left, right) => left - right)
  const threshold = 1

  if (direction === 1) {
    const next = starts.find((start) => start > current + threshold)
    return Math.min(maxScrollLeft, next ?? maxScrollLeft)
  }

  for (let index = starts.length - 1; index >= 0; index -= 1) {
    const previous = starts[index]
    if (previous !== undefined && previous < current - threshold) return Math.max(0, previous)
  }
  return 0
}
