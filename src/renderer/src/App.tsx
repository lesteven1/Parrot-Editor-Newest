import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent
} from 'react'
import Editor from '@monaco-editor/react'
import type { ConversionResult, ProjectSelection } from '../../shared/project'
import { usePythonRuntime, type PythonRuntimeController } from './python/usePythonRuntime'
import { useScratchRuntime, type ScratchRuntimeController } from './scratch/useScratchRuntime'
import type { ScratchTargetInfo } from './scratch/useScratchRuntime'
import { ScratchGuiAdapter } from './scratch/ScratchGuiAdapter'
import { VscodeIcon } from './components/VscodeIcon'
import scratchGreenFlag from './assets/scratch-controls/green-flag.svg'
import scratchStop from './assets/scratch-controls/stop.svg'
import { shouldOpenEditorViewAfterFileOpen } from './scratch/editor-model'
import {
  UniversalFrameCoordinator,
  type FrameCoordinatorParityStatus
} from './runtime/frame-coordinator'
import {
  DEFAULT_TAB_WIDTH,
  MAX_OPEN_TABS,
  WORKSPACE_VIEW_OPTIONS,
  appendGeneratedPythonTab,
  appendPythonTab,
  appendScratchTab,
  closeTab,
  connectTabs,
  connectionTargets,
  connectedPairs,
  connectedPartner,
  connectionColor,
  createImportedTabs,
  defaultRunTabIds,
  defaultUpdateConnectionIds,
  disconnectTab,
  duplicateTab,
  outputViewGrid,
  panelActionKinds,
  replaceEditedTab,
  replaceTab,
  replaceConnectedPython,
  resetTabWidth,
  resizeTab,
  scrollLeftByProject,
  scrollLeftForFullyVisibleTab,
  selectTab,
  setSelectionGroup,
  shouldScrollProjectsFromWheel,
  unconnectedTabs,
  type ProjectTab,
  type ProjectTabsState,
  type PythonProjectTab,
  type ScratchProjectTab,
  type WorkspaceViewMode
} from './tabs/model'

const FALLBACK_PYTHON = `import pygame

pygame.init()
screen = pygame.display.set_mode((480, 360))
pygame.display.set_caption("Parrot Python output")
running = True

while running:
    for event in pygame.event.get():
        if event.type == pygame.QUIT:
            running = False

    screen.fill("#eaf2ff")
    pygame.display.flip()
    pygame.time.Clock().tick(60)

pygame.quit()
`

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function browserProject(file: File): ProjectSelection {
  return { id: `browser-${file.name}-${file.size}`, name: file.name, size: file.size }
}

function Logo({ compact = false }: { compact?: boolean }): React.JSX.Element {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`} aria-label="Parrot">
      <span className="brand__mark" aria-hidden="true">
        <span className="brand__eye" />
      </span>
      {!compact && <span>Parrot</span>}
    </div>
  )
}

function UploadScreen({ onReady }: { onReady: (result: ConversionResult) => void }): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const openProject = async (project: ProjectSelection, browserFile?: File): Promise<void> => {
    if (!project.name.toLowerCase().endsWith('.sb3')) {
      setError('That does not look like a Scratch 3 project. Choose a file ending in .sb3.')
      return
    }

    setError('')
    setLoading(true)
    try {
      const result = window.parrot
        ? await window.parrot.openProject(project.id)
        : {
            project,
            python: FALLBACK_PYTHON,
            runtimeProjectId: 'browser-preview',
            message: 'Open this project in Electron to use conversion and Python execution.',
            warnings: [],
            scratchProject: browserFile ? new Uint8Array(await browserFile.arrayBuffer()) : new Uint8Array()
          }
      onReady(result)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parrot could not open that project.')
    } finally {
      setLoading(false)
    }
  }

  const openFile = async (file: File): Promise<void> => {
    if (!file.name.toLowerCase().endsWith('.sb3')) {
      setError('That does not look like a Scratch 3 project. Choose a file ending in .sb3.')
      return
    }
    try {
      const project = window.parrot
        ? await window.parrot.registerDroppedScratchFile(file)
        : browserProject(file)
      await openProject(project, file)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parrot could not read that file.')
    }
  }

  const chooseProject = async (): Promise<void> => {
    if (!window.parrot) {
      inputRef.current?.click()
      return
    }
    try {
      const project = await window.parrot.selectScratchFile()
      if (project) await openProject(project)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parrot could not read that file.')
    }
  }

  const dropProject = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void openFile(file)
  }

  return (
    <main className="upload-shell">
      <header className="landing-nav">
        <Logo />
        <span className="landing-nav__badge">Base V0.3.1 · Motion</span>
      </header>

      <section className="upload-hero">
        <div className="eyebrow"><span /> From blocks to Python</div>
        <h1>Bring your Scratch<br />project into focus.</h1>
        <p className="upload-hero__lede">
          Convert Scratch blocks, edit their Python, and run both versions side by side.
        </p>

        <div
          className={`drop-zone ${dragging ? 'drop-zone--active' : ''}`}
          onDragEnter={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropProject}
        >
          <div className="file-orbit" aria-hidden="true">
            <span className="file-card"><b>SB3</b><i /></span>
          </div>
          <h2>{loading ? 'Preparing your workspace…' : 'Drop a Scratch project here'}</h2>
          <p>or choose a file from your computer</p>
          <button className="primary-button" type="button" disabled={loading} onClick={() => void chooseProject()}>
            {loading ? <span className="spinner" /> : <span className="button-icon">＋</span>}
            {loading ? 'Opening project' : 'Choose .sb3 file'}
          </button>
          <input
            ref={inputRef}
            hidden
            type="file"
            accept=".sb3"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void openFile(file)
            }}
          />
          {error && <div className="upload-error" role="alert">{error}</div>}
        </div>

        <div className="upload-footnote">
          <span className="shield">✓</span>
          <span><b>Your project stays on this device.</b><small>Parrot only opens Scratch 3 (.sb3) files.</small></span>
        </div>
      </section>
      <div className="landing-glow landing-glow--one" />
      <div className="landing-glow landing-glow--two" />
    </main>
  )
}

type WorkspaceProps = {
  result: ConversionResult
  onNewProject: () => void
}

type NewTabMenuStep = null | 'source' | 'upload' | 'empty'

function tabWidthStyle(tab: ProjectTab): CSSProperties {
  return tab.width > 0
    ? { width: tab.width, flexBasis: tab.width }
    : { width: 'calc((100vw - 58px) / 2)', flexBasis: 'calc((100vw - 58px) / 2)' }
}

function Workspace({ result, onNewProject }: WorkspaceProps): React.JSX.Element {
  const [tabState, setTabState] = useState<ProjectTabsState>(() => createImportedTabs(result))
  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('editor')
  const [conversion, setConversion] = useState({ message: result.message, warnings: result.warnings })
  const [updatingCode, setUpdatingCode] = useState(false)
  const [creatingTab, setCreatingTab] = useState(false)
  const [busyTabIds, setBusyTabIds] = useState<string[]>([])
  const [newTabMenuStep, setNewTabMenuStep] = useState<NewTabMenuStep>(null)
  const [connectPickerTabId, setConnectPickerTabId] = useState<string | null>(null)
  const [updatePickerOpen, setUpdatePickerOpen] = useState(false)
  const [selectedUpdateIds, setSelectedUpdateIds] = useState<string[]>([])
  const [runPickerOpen, setRunPickerOpen] = useState(false)
  const [selectedRunTabIds, setSelectedRunTabIds] = useState<string[]>([])
  const [runningTabIds, setRunningTabIds] = useState<string[]>([])
  const [runtimeBusyTabIds, setRuntimeBusyTabIds] = useState<string[]>([])
  const [runningMultipleOperation, setRunningMultipleOperation] = useState(false)
  const [parityStatus, setParityStatus] = useState<FrameCoordinatorParityStatus | null>(null)
  const sessionRefs = useRef(new Map<string, ActiveTabSessionHandle>())
  const tabStateRef = useRef(tabState)
  tabStateRef.current = tabState
  const tabStripRef = useRef<HTMLDivElement>(null)
  const tabWorkspaceRef = useRef<HTMLDivElement>(null)
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const tabPaneRefs = useRef(new Map<string, HTMLElement>())
  const previousViewModeRef = useRef<WorkspaceViewMode>('editor')
  const pendingEditorRevealRef = useRef(false)
  const editorWorkspaceScrollLeftRef = useRef(0)
  const editorTabStripScrollLeftRef = useRef(0)
  const outputScrollTopRef = useRef(0)
  const [tabOverflow, setTabOverflow] = useState(false)
  const [canScrollTabsLeft, setCanScrollTabsLeft] = useState(false)
  const [canScrollTabsRight, setCanScrollTabsRight] = useState(false)
  const importedScratch = tabState.tabs.find((tab): tab is ScratchProjectTab => tab.importedRole === 'scratch')
  const importedPython = tabState.tabs.find((tab): tab is PythonProjectTab => tab.importedRole === 'python')
  const pairs = connectedPairs(tabState)
  const standaloneTabs = unconnectedTabs(tabState)
  const connectPickerTab = connectPickerTabId
    ? tabState.tabs.find((tab) => tab.id === connectPickerTabId)
    : undefined
  const connectPickerTargets = connectPickerTab
    ? connectionTargets(tabState, connectPickerTab.id)
    : []
  const connectableTabIds = tabState.tabs
    .filter((tab) => connectionTargets(tabState, tab.id).length > 0)
    .map((tab) => tab.id)
  const atTabLimit = tabState.tabs.length >= MAX_OPEN_TABS
  const outputGrid = outputViewGrid(tabState.tabs.length)
  const outputGridStyle = {
    '--output-columns': String(outputGrid.columns),
    '--output-rows': String(outputGrid.rows)
  } as CSSProperties
  const tabLayoutSignature = tabState.tabs.map((tab) => `${tab.id}:${tab.width}`).join('|')
  const headerMessage = parityStatus
    ? parityStatus.currentlyDiverged
      ? `Outputs differ · ${parityStatus.mismatchedFrames} frame${parityStatus.mismatchedFrames === 1 ? '' : 's'}`
      : `Outputs matched again · frame ${parityStatus.lastReconvergedSequence}`
    : conversion.message
  const headerTitle = parityStatus
    ? [
        `First differing frame: ${parityStatus.firstMismatchSequence}`,
        `Latest differing frame: ${parityStatus.latestMismatchSequence}`,
        `Differing frames: ${parityStatus.mismatchedFrames}`,
        parityStatus.lastReconvergedSequence === null
          ? null
          : `Last matched again at frame: ${parityStatus.lastReconvergedSequence}`,
        parityStatus.latestMismatch
      ].filter(Boolean).join('\n')
    : conversion.warnings.join('\n')

  useEffect(() => {
    if (atTabLimit) setNewTabMenuStep(null)
  }, [atTabLimit])

  const persistTab = useCallback((nextTab: ProjectTab): void => {
    setTabState((current) => replaceTab(current, nextTab))
  }, [])

  const persistEditedTab = useCallback((nextTab: ProjectTab): void => {
    setTabState((current) => replaceEditedTab(current, nextTab))
  }, [])

  const registerSession = useCallback((tabIds: string[], handle: ActiveTabSessionHandle | null): void => {
    for (const tabId of tabIds) {
      if (handle) sessionRefs.current.set(tabId, handle)
      else sessionRefs.current.delete(tabId)
    }
  }, [])

  const registerImportedSession = useCallback((handle: ActiveTabSessionHandle | null): void => {
    const importedIds = [importedScratch?.id, importedPython?.id]
      .filter((id): id is string => typeof id === 'string')
    registerSession(importedIds, handle)
  }, [importedPython?.id, importedScratch?.id, registerSession])

  const reportSessionRuntime = useCallback((
    sessionTabIds: string[],
    nextRunningIds: string[],
    nextBusyIds: string[]
  ): void => {
    const replaceScope = (current: string[], next: string[]): string[] => {
      const scope = new Set(sessionTabIds)
      const result = [...current.filter((id) => !scope.has(id)), ...next]
      return result.length === current.length && result.every((id, index) => id === current[index])
        ? current
        : result
    }
    setRunningTabIds((current) => replaceScope(current, nextRunningIds))
    setRuntimeBusyTabIds((current) => replaceScope(current, nextBusyIds))
  }, [])

  const setTabsBusy = useCallback((tabIds: string[], busy: boolean): void => {
    setBusyTabIds((current) => busy
      ? [...new Set([...current, ...tabIds])]
      : current.filter((id) => !tabIds.includes(id)))
  }, [])

  const updateOverflow = useCallback((): void => {
    if (viewMode !== 'editor') {
      setTabOverflow(false)
      setCanScrollTabsLeft(false)
      setCanScrollTabsRight(false)
      return
    }
    const workspace = tabWorkspaceRef.current
    if (!workspace) return
    const maxScrollLeft = Math.max(0, workspace.scrollWidth - workspace.clientWidth)
    setTabOverflow(maxScrollLeft > 1)
    setCanScrollTabsLeft(workspace.scrollLeft > 1)
    setCanScrollTabsRight(workspace.scrollLeft < maxScrollLeft - 1)
  }, [viewMode])

  const revealEditorTab = useCallback((id: string, behavior: ScrollBehavior = 'smooth'): void => {
    const pane = tabPaneRefs.current.get(id)
    const workspace = tabWorkspaceRef.current
    if (pane && workspace) {
      const workspaceRect = workspace.getBoundingClientRect()
      const paneRect = pane.getBoundingClientRect()
      const paneLeft = paneRect.left - workspaceRect.left + workspace.scrollLeft
      const left = scrollLeftForFullyVisibleTab(
        workspace.scrollLeft,
        workspace.clientWidth,
        paneLeft,
        paneRect.width
      )
      workspace.scrollTo({ left, behavior })
      editorWorkspaceScrollLeftRef.current = left
    }

    const button = tabButtonRefs.current.get(id)
    const strip = tabStripRef.current
    const header = button?.parentElement
    if (header && strip) {
      const stripRect = strip.getBoundingClientRect()
      const headerRect = header.getBoundingClientRect()
      const headerLeft = headerRect.left - stripRect.left + strip.scrollLeft
      const left = scrollLeftForFullyVisibleTab(
        strip.scrollLeft,
        strip.clientWidth,
        headerLeft,
        headerRect.width
      )
      strip.scrollTo({ left, behavior })
      editorTabStripScrollLeftRef.current = left
    }
  }, [])

  useEffect(() => {
    updateOverflow()
    const workspace = tabWorkspaceRef.current
    if (!workspace) return
    const observer = new ResizeObserver(updateOverflow)
    observer.observe(workspace)
    return () => observer.disconnect()
  }, [tabLayoutSignature, updateOverflow])

  useEffect(() => {
    const previousView = previousViewModeRef.current
    const switchedToEditor = previousView !== 'editor' && viewMode === 'editor'
    previousViewModeRef.current = viewMode
    if (viewMode !== 'editor') return

    const frame = window.requestAnimationFrame(() => {
      if (pendingEditorRevealRef.current || !switchedToEditor) {
        pendingEditorRevealRef.current = false
        revealEditorTab(tabState.activeId)
        return
      }
      if (tabWorkspaceRef.current) {
        tabWorkspaceRef.current.scrollLeft = editorWorkspaceScrollLeftRef.current
      }
      if (tabStripRef.current) {
        tabStripRef.current.scrollLeft = editorTabStripScrollLeftRef.current
      }
      updateOverflow()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [revealEditorTab, tabState.activeId, tabState.tabs.length, updateOverflow, viewMode])

  useEffect(() => {
    if (viewMode !== 'output') return
    const frame = window.requestAnimationFrame(() => {
      if (tabWorkspaceRef.current) tabWorkspaceRef.current.scrollTop = outputScrollTopRef.current
    })
    return () => window.cancelAnimationFrame(frame)
  }, [viewMode])

  const selectAndRevealTab = useCallback((id: string): void => {
    setTabState((current) => selectTab(current, id))
    if (viewMode === 'editor' && tabStateRef.current.activeId === id) revealEditorTab(id)
  }, [revealEditorTab, viewMode])

  const switchWorkspaceView = useCallback((nextView: WorkspaceViewMode): void => {
    if (nextView === viewMode) return
    const workspace = tabWorkspaceRef.current
    const strip = tabStripRef.current
    if (viewMode === 'editor') {
      editorWorkspaceScrollLeftRef.current = workspace?.scrollLeft ?? editorWorkspaceScrollLeftRef.current
      editorTabStripScrollLeftRef.current = strip?.scrollLeft ?? editorTabStripScrollLeftRef.current
    } else {
      outputScrollTopRef.current = workspace?.scrollTop ?? outputScrollTopRef.current
    }
    pendingEditorRevealRef.current = false
    setViewMode(nextView)
  }, [viewMode])

  const openInEditorView = useCallback((id: string): void => {
    outputScrollTopRef.current = tabWorkspaceRef.current?.scrollTop ?? outputScrollTopRef.current
    pendingEditorRevealRef.current = true
    setViewMode('editor')
    setTabState((current) => selectTab(current, id))
  }, [])

  const registerPane = useCallback((id: string, element: HTMLElement | null): void => {
    if (element) tabPaneRefs.current.set(id, element)
    else tabPaneRefs.current.delete(id)
  }, [])

  const scrollByProject = useCallback((direction: -1 | 1): void => {
    const workspace = tabWorkspaceRef.current
    if (!workspace) return
    const workspaceRect = workspace.getBoundingClientRect()
    const paneStarts = tabState.tabs.flatMap((tab) => {
      const pane = tabPaneRefs.current.get(tab.id)
      if (!pane) return []
      return [pane.getBoundingClientRect().left - workspaceRect.left + workspace.scrollLeft]
    })
    const left = scrollLeftByProject(
      workspace.scrollLeft,
      workspace.clientWidth,
      workspace.scrollWidth,
      paneStarts,
      direction
    )
    workspace.scrollTo({ left, behavior: 'smooth' })
  }, [tabState.tabs])

  const reportRuntimeMessage = useCallback((message: string): void => {
    setConversion((current) => ({ message, warnings: [...current.warnings, message].slice(-8) }))
  }, [])

  const ignoreParityStatus = useCallback((): void => {}, [])

  const createTab = async (
    source: 'upload' | 'empty',
    kind: 'python' | 'scratch'
  ): Promise<void> => {
    if (creatingTab || tabStateRef.current.tabs.length >= MAX_OPEN_TABS) return
    const openingFirstFile = shouldOpenEditorViewAfterFileOpen(tabStateRef.current.tabs.length)
    setNewTabMenuStep(null)
    setCreatingTab(true)
    try {
      if (source === 'upload') {
        if (!window.parrot) throw new Error('File uploads are available in the Electron app.')
        if (kind === 'python') {
          const imported = await window.parrot.selectPythonTabFile()
          if (!imported) return
          setTabState((current) => appendPythonTab(
            current,
            imported.python,
            imported.runtimeProjectId,
            imported.name
          ))
        } else {
          const imported = await window.parrot.selectScratchTabFile()
          if (!imported) return
          setTabState((current) => appendScratchTab(current, imported))
        }
      } else if (kind === 'python') {
        if (!window.parrot) throw new Error('New Python tabs are available in the Electron app.')
        const created = await window.parrot.createPythonTab()
        setTabState((current) => appendPythonTab(current, created.python, created.runtimeProjectId))
      } else {
        setTabState((current) => appendScratchTab(current))
      }
      if (openingFirstFile) {
        pendingEditorRevealRef.current = true
        setViewMode('editor')
      }
      setParityStatus(null)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Parrot could not add the tab.'
      setConversion({ message, warnings: [message] })
    } finally {
      setCreatingTab(false)
    }
  }

  const duplicateProjectTab = async (tabId: string): Promise<void> => {
    if (busyTabIds.includes(tabId) || tabStateRef.current.tabs.length >= MAX_OPEN_TABS) return
    const source = tabStateRef.current.tabs.find((tab) => tab.id === tabId)
    if (!source) return
    setTabsBusy([tabId], true)
    try {
      if (source.kind === 'scratch') {
        const snapshot = await sessionRefs.current.get(tabId)?.snapshotScratch()
        if (!snapshot) throw new Error(`${source.name} is not ready to duplicate yet.`)
        setTabState((current) => {
          const live = current.tabs.find((tab) => tab.id === tabId)
          if (!live || live.kind !== 'scratch') return current
          const snapshotted = replaceTab(current, {
            ...live,
            projectBytes: snapshot.projectBytes,
            outputFrameDataUrl: snapshot.frameDataUrl || live.outputFrameDataUrl
          })
          return duplicateTab(snapshotted, tabId, new Date(), snapshot.projectBytes)
        })
      } else {
        setTabState((current) => duplicateTab(current, tabId, new Date()))
      }
      setParityStatus(null)
      setConversion((current) => ({ ...current, message: `Duplicated ${source.name}.` }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Parrot could not duplicate that tab.'
      setConversion({ message, warnings: [message] })
    } finally {
      setTabsBusy([tabId], false)
    }
  }

  const generatePython = async (tabId: string): Promise<void> => {
    if (tabStateRef.current.tabs.length >= MAX_OPEN_TABS) return
    if (!window.parrot) {
      setConversion({
        message: 'Open this project in Electron to generate Python.',
        warnings: ['The browser preview cannot run the local Scratch-to-Python converter.']
      })
      return
    }
    const source = tabStateRef.current.tabs.find((tab): tab is ScratchProjectTab =>
      tab.id === tabId && tab.kind === 'scratch')
    if (!source || source.connectionId || busyTabIds.includes(tabId)) return
    setTabsBusy([tabId], true)
    try {
      const snapshot = await sessionRefs.current.get(tabId)?.snapshotScratch()
      if (!snapshot) throw new Error(`${source.name} is not ready to generate Python yet.`)
      const nextConversion = await window.parrot.updatePythonFromScratch(snapshot.projectBytes)
      const latest = tabStateRef.current.tabs.find((tab) => tab.id === tabId)
      if (!latest || latest.connectionId) {
        throw new Error(`${source.name} was connected before Python generation finished. No new tab was created.`)
      }
      setTabState((current) => {
        const live = current.tabs.find((tab) => tab.id === tabId)
        if (!live || live.kind !== 'scratch' || live.connectionId) return current
        const snapshotted = replaceTab(current, {
          ...live,
          projectBytes: snapshot.projectBytes,
          outputFrameDataUrl: snapshot.frameDataUrl || live.outputFrameDataUrl
        })
        return appendGeneratedPythonTab(
          snapshotted,
          tabId,
          nextConversion.python,
          nextConversion.runtimeProjectId
        )
      })
      setParityStatus(null)
      setConversion({
        message: `Generated and connected a new Python tab. ${nextConversion.message}`,
        warnings: nextConversion.warnings
      })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Parrot could not generate the Python tab.'
      setConversion({ message, warnings: [message] })
    } finally {
      setTabsBusy([tabId], false)
    }
  }

  const updateCode = async (connectionIds: string[]): Promise<void> => {
    if (!window.parrot) {
      setConversion({
        message: 'Open this project in Electron to update generated Python.',
        warnings: ['The browser preview cannot run the local Scratch-to-Python converter.']
      })
      return
    }

    setUpdatingCode(true)
    setUpdatePickerOpen(false)
    try {
      setParityStatus(null)
      const selectedPairs = connectedPairs(tabStateRef.current)
        .filter((pair) => connectionIds.includes(pair.id))
      if (selectedPairs.length === 0) throw new Error('Choose at least one connected pair to update.')
      const affectedIds = selectedPairs.flatMap((pair) => [pair.scratch.id, pair.python.id])
      setTabsBusy(affectedIds, true)

      await Promise.all(selectedPairs.map(async (pair) => {
        const session = sessionRefs.current.get(pair.python.id)
        if (!session) throw new Error(`${pair.python.name} is not ready to update yet.`)
        await session.stopPython()
      }))
      const snapshots = await Promise.all(selectedPairs.map(async (pair) => {
        const snapshot = await sessionRefs.current.get(pair.scratch.id)?.snapshotScratch()
        if (!snapshot) throw new Error(`${pair.scratch.name} is not ready to update yet.`)
        return { pair, snapshot }
      }))
      const conversions = await Promise.all(snapshots.map(async ({ pair, snapshot }) => ({
        pair,
        snapshot,
        conversion: await window.parrot!.updatePythonFromScratch(snapshot.projectBytes)
      })))
      setTabState((current) => {
        const snapshotted = {
          ...current,
          tabs: current.tabs.map((tab) => {
            const item = conversions.find(({ pair }) => pair.scratch.id === tab.id)
            return item && tab.kind === 'scratch'
              ? {
                  ...tab,
                  projectBytes: item.snapshot.projectBytes,
                  outputFrameDataUrl: item.snapshot.frameDataUrl || tab.outputFrameDataUrl
                }
              : tab
          })
        }
        return replaceConnectedPython(snapshotted, conversions.map(({ pair, conversion: item }) => ({
          connectionId: pair.id,
          source: item.python,
          runtimeProjectId: item.runtimeProjectId
        })))
      })
      const warningList = conversions.flatMap(({ pair, conversion: item }) =>
        item.warnings.map((warning) => `${pair.scratch.name}: ${warning}`)).slice(-8)
      setConversion({
        message: `${conversions.length} connected pair${conversions.length === 1 ? '' : 's'} updated; selected Python editor contents replaced.`,
        warnings: warningList
      })
      setTabsBusy(affectedIds, false)
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Parrot could not update the Python code.'
      setConversion({ message, warnings: [message] })
      setBusyTabIds([])
    } finally {
      setUpdatingCode(false)
    }
  }

  const requestUpdateCode = (): void => {
    const current = tabStateRef.current
    const currentPairs = connectedPairs(current)
    if (currentPairs.length === 1) {
      void updateCode([currentPairs[0]!.id])
      return
    }
    setSelectedUpdateIds(defaultUpdateConnectionIds(current))
    setUpdatePickerOpen(true)
  }

  const stopAllRunningTabs = async (): Promise<void> => {
    if (runningMultipleOperation) return
    setRunningMultipleOperation(true)
    try {
      await Promise.all([...new Set(sessionRefs.current.values())].map((session) => session.stopAll()))
      setParityStatus(null)
      setConversion((current) => ({ ...current, message: 'Stopped all running tabs.' }))
    } finally {
      setRunningMultipleOperation(false)
    }
  }

  const runMultiple = async (tabIds: string[]): Promise<void> => {
    if (runningMultipleOperation || tabIds.length === 0) return
    setRunPickerOpen(false)
    setRunningMultipleOperation(true)
    try {
      const sessions = [...new Set(sessionRefs.current.values())]
      await Promise.all(sessions.map((session) => session.stopAll()))
      setParityStatus(null)

      const selectedBySession = new Map<ActiveTabSessionHandle, string[]>()
      for (const tabId of tabIds) {
        const session = sessionRefs.current.get(tabId)
        if (!session) continue
        selectedBySession.set(session, [...(selectedBySession.get(session) ?? []), tabId])
      }
      const started = (await Promise.all([...selectedBySession.entries()].map(
        ([session, selectedIds]) => session.startTabs(selectedIds)
      ))).flat()
      if (started.length === 0) throw new Error('The selected tabs are not ready to run yet.')
      setConversion((current) => ({
        ...current,
        message: `Running ${started.length} selected tab${started.length === 1 ? '' : 's'}.`
      }))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Parrot could not run the selected tabs.'
      setConversion({ message, warnings: [message] })
    } finally {
      setRunningMultipleOperation(false)
    }
  }

  const requestRunMultiple = (): void => {
    setSelectedRunTabIds(defaultRunTabIds(tabStateRef.current))
    setRunPickerOpen(true)
  }

  const connectPickedTab = (targetId: string): void => {
    if (!connectPickerTabId) return
    if (busyTabIds.includes(connectPickerTabId) || busyTabIds.includes(targetId)) return
    const source = tabStateRef.current.tabs.find((tab) => tab.id === connectPickerTabId)
    const target = tabStateRef.current.tabs.find((tab) => tab.id === targetId)
    setTabState((current) => connectTabs(current, connectPickerTabId, targetId))
    setConnectPickerTabId(null)
    setParityStatus(null)
    if (source && target) {
      setConversion((current) => ({
        ...current,
        message: `Paired ${source.name} and ${target.name}.`
      }))
    }
  }

  const disconnectProjectTab = async (tabId: string): Promise<void> => {
    if (busyTabIds.includes(tabId) || runtimeBusyTabIds.includes(tabId)) return
    const current = tabStateRef.current
    const source = current.tabs.find((tab) => tab.id === tabId)
    const partner = connectedPartner(current, tabId)
    if (!source?.connectionId || !partner) return
    const affectedIds = [source.id, partner.id]
    const sessions = [...new Set(affectedIds
      .map((id) => sessionRefs.current.get(id))
      .filter((session): session is ActiveTabSessionHandle => Boolean(session)))]
    setTabsBusy(affectedIds, true)
    try {
      await Promise.all(sessions.map((session) => session.stopAll()))
      setRunningTabIds((ids) => ids.filter((id) => !affectedIds.includes(id)))
      setRuntimeBusyTabIds((ids) => ids.filter((id) => !affectedIds.includes(id)))
      setSelectedUpdateIds((ids) => ids.filter((id) => id !== source.connectionId))
      setTabState((state) => disconnectTab(state, tabId))
      setParityStatus(null)
      setConversion((status) => ({
        ...status,
        message: `Disconnected ${source.name} and ${partner.name}.`
      }))
    } finally {
      setTabsBusy(affectedIds, false)
    }
  }

  const closeProjectTab = async (tabId: string): Promise<void> => {
    if (busyTabIds.includes(tabId) || runtimeBusyTabIds.includes(tabId)) return
    const current = tabStateRef.current
    const closing = current.tabs.find((tab) => tab.id === tabId)
    if (!closing) return
    const partner = connectedPartner(current, tabId)
    const session = sessionRefs.current.get(tabId)
    const stoppedIds = session
      ? current.tabs.filter((tab) => sessionRefs.current.get(tab.id) === session).map((tab) => tab.id)
      : [tabId]
    setTabsBusy([tabId], true)
    try {
      await session?.stopAll()
      setRunningTabIds((ids) => ids.filter((id) => !stoppedIds.includes(id)))
      setRuntimeBusyTabIds((ids) => ids.filter((id) => !stoppedIds.includes(id)))
      setSelectedRunTabIds((ids) => ids.filter((id) => id !== tabId))
      if (closing.connectionId) {
        setSelectedUpdateIds((ids) => ids.filter((id) => id !== closing.connectionId))
      }
      setConnectPickerTabId((id) => id === tabId ? null : id)
      setTabState((state) => closeTab(state, tabId))
      setParityStatus(null)
      setConversion((status) => ({
        ...status,
        message: partner
          ? `Closed ${closing.name}; ${partner.name} is now unconnected.`
          : `Closed ${closing.name}.`
      }))
    } finally {
      setTabsBusy([tabId], false)
    }
  }

  return (
    <main className={`workspace-shell workspace-shell--${viewMode}`} data-workspace-view={viewMode}>
      <header className="workspace-tabs">
        <div className="window-brand"><Logo compact /></div>
        <div className="project-tab project-tab--active">
          <span className="project-dot" />
          <span>{result.project.name.replace(/\.sb3$/i, '')}</span>
          <button aria-label="Close project" onClick={onNewProject}>×</button>
        </div>
        <button className="new-tab" onClick={onNewProject}>＋ New project</button>
        <div
          className={`conversion-pill ${parityStatus
            ? parityStatus.currentlyDiverged
              ? 'conversion-pill--diverged'
              : 'conversion-pill--reconverged'
            : ''}`}
          title={headerTitle}
        >
          <span>{parityStatus?.currentlyDiverged || (!parityStatus && conversion.warnings.length) ? '!' : '✓'}</span>
          {headerMessage}
        </div>
        <button
          className="update-code"
          disabled={pairs.length === 0 || updatingCode || runtimeBusyTabIds.length > 0 || busyTabIds.length > 0}
          onClick={requestUpdateCode}
          type="button"
          title="Regenerate selected connected Python tabs from their Scratch partners"
        >
          <span>{updatingCode ? <span className="spinner" /> : '↻'}</span>
          {updatingCode ? 'Updating…' : 'Update code'}
        </button>
        <div className="new-project-tab">
          <button
            className="new-project-tab__button"
            type="button"
            disabled={creatingTab || atTabLimit}
            aria-expanded={newTabMenuStep !== null}
            aria-haspopup="menu"
            aria-controls="new-tab-menu"
            title={atTabLimit ? `A project can contain up to ${MAX_OPEN_TABS} open file tabs` : 'Add a file tab'}
            onClick={() => setNewTabMenuStep((step) => step === null ? 'source' : null)}
          >＋ {creatingTab ? 'Adding…' : 'New tab'}</button>
          {newTabMenuStep && <div className="new-project-tab__menu" id="new-tab-menu" role="menu">
            {newTabMenuStep === 'source' ? <>
              <div className="new-project-tab__prompt">Start a new tab with</div>
              <button type="button" role="menuitem" onClick={() => setNewTabMenuStep('upload')}><span>↑</span>Upload new</button>
              <button type="button" role="menuitem" onClick={() => setNewTabMenuStep('empty')}><span>＋</span>Create empty</button>
            </> : <>
              <button className="new-project-tab__back" type="button" role="menuitem" onClick={() => setNewTabMenuStep('source')}><span>‹</span>{newTabMenuStep === 'upload' ? 'Upload new' : 'Create empty'}</button>
              <div className="new-project-tab__prompt">Choose a file type</div>
              <button type="button" role="menuitem" onClick={() => void createTab(newTabMenuStep, 'scratch')}><span>SB3</span>Scratch</button>
              <button type="button" role="menuitem" onClick={() => void createTab(newTabMenuStep, 'python')}><span>PY</span>Python</button>
            </>}
          </div>}
        </div>
        <button
          className="run-multiple"
          disabled={tabState.tabs.length === 0 || runningMultipleOperation || runtimeBusyTabIds.length > 0}
          onClick={requestRunMultiple}
          type="button"
          title="Choose connected pairs or individual tabs to run"
        >
          <span>{runningTabIds.length > 0 ? '■' : '▶'}</span>
          {runningTabIds.length > 0 ? `Run files · ${runningTabIds.length}` : 'Run files'}
        </button>
        <div className="workspace-view-switch" role="group" aria-label="Workspace view">
          {WORKSPACE_VIEW_OPTIONS.map((option) => <button
            className={`workspace-view-switch__button workspace-view-switch__button--${option.mode}`}
            type="button"
            key={option.mode}
            aria-label={option.label}
            aria-pressed={viewMode === option.mode}
            title={option.tooltip}
            onClick={() => switchWorkspaceView(option.mode)}
          >
            <span className={`workspace-view-icon workspace-view-icon--${option.mode}`} aria-hidden="true">
              {option.mode === 'editor'
                ? <><i /><i /><i /><i /><i /><i /><b /><b /></>
                : <><i /><i /><i /><i /></>}
            </span>
          </button>)}
        </div>
      </header>

      {connectPickerTab && <div className="picker-backdrop" role="presentation" onMouseDown={() => setConnectPickerTabId(null)}>
        <section className="workspace-picker" role="dialog" aria-modal="true" aria-labelledby="connect-picker-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><small>{connectPickerTab.connectionId ? 'Pair to Other' : 'Pair'}</small><h2 id="connect-picker-title">Choose a {connectPickerTab.kind === 'scratch' ? 'Python' : 'Scratch'} tab</h2></div>
            <button type="button" aria-label="Close connection picker" onClick={() => setConnectPickerTabId(null)}>×</button>
          </header>
          <p>{connectPickerTab.name} will pair with exactly one opposite-type tab. Existing partners will become unconnected.</p>
          <div className="workspace-picker__options">
            {connectPickerTargets.map((tab) => {
              const partner = connectedPartner(tabState, tab.id)
              return <button type="button" key={tab.id} disabled={busyTabIds.includes(tab.id)} onClick={() => connectPickedTab(tab.id)}>
                <span className="picker-color" style={{ backgroundColor: connectionColor(tab.connectionId) }} />
                <b>{tab.name}</b>
                <small>{partner ? `Connected to ${partner.name}` : 'Unconnected'}</small>
              </button>
            })}
            {connectPickerTargets.length === 0 && <div className="workspace-picker__empty">Add a compatible tab before pairing this file.</div>}
          </div>
        </section>
      </div>}

      {updatePickerOpen && <div className="picker-backdrop" role="presentation" onMouseDown={() => setUpdatePickerOpen(false)}>
        <section className="workspace-picker" role="dialog" aria-modal="true" aria-labelledby="update-picker-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><small>Update code</small><h2 id="update-picker-title">Choose connected pairs</h2></div>
            <button type="button" aria-label="Close update picker" onClick={() => setUpdatePickerOpen(false)}>×</button>
          </header>
          <p>Selected Scratch tabs will replace the exact editor contents of their Python partners.</p>
          <div className="workspace-picker__checks">
            {pairs.map((pair) => <label key={pair.id}>
              <input
                type="checkbox"
                checked={selectedUpdateIds.includes(pair.id)}
                style={{ accentColor: connectionColor(pair.id) }}
                onChange={(event) => setSelectedUpdateIds((current) => event.target.checked
                  ? [...current, pair.id]
                  : current.filter((id) => id !== pair.id))}
              />
              <span className="picker-color" style={{ backgroundColor: connectionColor(pair.id) }} />
              <span><b>{pair.scratch.name}</b><small>{pair.python.name}</small></span>
            </label>)}
          </div>
          <footer>
            <button type="button" onClick={() => setUpdatePickerOpen(false)}>Cancel</button>
            <button className="workspace-picker__primary" type="button" disabled={selectedUpdateIds.length === 0} onClick={() => void updateCode(selectedUpdateIds)}>Update selected</button>
          </footer>
        </section>
      </div>}

      {runPickerOpen && <div className="picker-backdrop" role="presentation" onMouseDown={() => setRunPickerOpen(false)}>
        <section className="workspace-picker workspace-picker--run" role="dialog" aria-modal="true" aria-labelledby="run-picker-title" onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><small>RUN</small><h2 id="run-picker-title">Choose files to run</h2></div>
            <button type="button" aria-label="Close Run checklist" onClick={() => setRunPickerOpen(false)}>×</button>
          </header>
          <p>Choose a whole connected color or use its Scratch and Python checkboxes independently.</p>
          <div className="run-selection-groups">
            {pairs.map((pair) => {
              const pairIds = [pair.scratch.id, pair.python.id]
              const selectedCount = pairIds.filter((id) => selectedRunTabIds.includes(id)).length
              const color = connectionColor(pair.id)
              return <section className="run-selection-group" key={pair.id} style={{ borderColor: color }}>
                <label className="run-selection-group__heading">
                  <HierarchyCheckbox
                    label={`Select connected pair ${pair.scratch.name} and ${pair.python.name}`}
                    checked={selectedCount === pairIds.length}
                    indeterminate={selectedCount > 0 && selectedCount < pairIds.length}
                    color={color}
                    onChange={(checked) => setSelectedRunTabIds((current) =>
                      setSelectionGroup(current, pairIds, checked))}
                  />
                  <span className="picker-color" style={{ backgroundColor: color }} />
                  <span><b>Connected pair</b><small>{pair.scratch.name} · {pair.python.name}</small></span>
                </label>
                <div className="run-selection-group__children">
                  {[pair.scratch, pair.python].map((tab) => <label key={tab.id}>
                    <input
                      type="checkbox"
                      aria-label={`Run ${tab.name}`}
                      checked={selectedRunTabIds.includes(tab.id)}
                      style={{ accentColor: color }}
                      onChange={(event) => setSelectedRunTabIds((current) =>
                        setSelectionGroup(current, [tab.id], event.target.checked))}
                    />
                    <span className={`project-subtab__kind project-subtab__kind--${tab.kind}`}>{tab.kind === 'scratch' ? 'SB3' : 'PY'}</span>
                    <span>{tab.name}</span>
                  </label>)}
                </div>
              </section>
            })}
            {standaloneTabs.length > 0 && <section className="run-selection-group run-selection-group--unconnected">
              <label className="run-selection-group__heading">
                <HierarchyCheckbox
                  label="Select all unconnected tabs"
                  checked={standaloneTabs.every((tab) => selectedRunTabIds.includes(tab.id))}
                  indeterminate={standaloneTabs.some((tab) => selectedRunTabIds.includes(tab.id)) && !standaloneTabs.every((tab) => selectedRunTabIds.includes(tab.id))}
                  color={connectionColor()}
                  onChange={(checked) => setSelectedRunTabIds((current) =>
                    setSelectionGroup(current, standaloneTabs.map((tab) => tab.id), checked))}
                />
                <span className="picker-color" style={{ backgroundColor: connectionColor() }} />
                <span><b>Unconnected</b><small>{standaloneTabs.length} independent tab{standaloneTabs.length === 1 ? '' : 's'}</small></span>
              </label>
              <div className="run-selection-group__children">
                {standaloneTabs.map((tab) => <label key={tab.id}>
                  <input
                    type="checkbox"
                    aria-label={`Run ${tab.name}`}
                    checked={selectedRunTabIds.includes(tab.id)}
                    style={{ accentColor: connectionColor() }}
                    onChange={(event) => setSelectedRunTabIds((current) =>
                      setSelectionGroup(current, [tab.id], event.target.checked))}
                  />
                  <span className={`project-subtab__kind project-subtab__kind--${tab.kind}`}>{tab.kind === 'scratch' ? 'SB3' : 'PY'}</span>
                  <span>{tab.name}</span>
                </label>)}
              </div>
            </section>}
          </div>
          <footer>
            <button type="button" onClick={() => setRunPickerOpen(false)}>Cancel</button>
            {runningTabIds.length > 0 && <button type="button" onClick={() => { setRunPickerOpen(false); void stopAllRunningTabs() }}>Stop all</button>}
            <button className="workspace-picker__primary" type="button" disabled={selectedRunTabIds.length === 0 || runningMultipleOperation} onClick={() => void runMultiple(selectedRunTabIds)}>Run selected</button>
          </footer>
        </section>
      </div>}

      <nav className="project-subtabs" aria-label="Project tabs">
        {tabOverflow && canScrollTabsLeft && <button className="tab-scroll-button tab-scroll-button--left" type="button" aria-label="Scroll files left by one project" onClick={() => scrollByProject(-1)}>‹</button>}
        <div className="project-subtabs__scroll">
          <div
            className="project-subtabs__track"
            ref={tabStripRef}
            onWheel={(event) => {
              const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
              if (tabWorkspaceRef.current) {
                tabWorkspaceRef.current.scrollLeft += delta
                event.currentTarget.scrollLeft = tabWorkspaceRef.current.scrollLeft
              }
              event.preventDefault()
            }}
          >
            {tabState.tabs.map((tab) => {
              const partner = connectedPartner(tabState, tab.id)
              const connectionLabel = partner
                ? `Connected pair: ${tab.name} and ${partner.name}`
                : `${tab.name} is unconnected`
              const syncLabel = tab.kind === 'python' && partner
                ? tab.codeUpToDate ? 'Code is updated' : 'Code needs updating'
                : ''
              return <div
                className={`project-subtab ${tab.id === tabState.activeId ? 'project-subtab--active' : ''}`}
                key={tab.id}
                style={tabWidthStyle(tab)}
                title={`${tab.name}\n${connectionLabel}`}
              >
                <button
                  className="project-subtab__select"
                  ref={(element) => {
                    if (element) tabButtonRefs.current.set(tab.id, element)
                    else tabButtonRefs.current.delete(tab.id)
                  }}
                  type="button"
                  onClick={() => selectAndRevealTab(tab.id)}
                >
                  <span className={`project-subtab__kind project-subtab__kind--${tab.kind}`}>{tab.kind === 'python' ? 'PY' : 'SB3'}</span>
                  <span className="project-subtab__name">{tab.name}</span>
                  <span
                    className="project-subtab__connection"
                    style={{ backgroundColor: connectionColor(tab.connectionId) }}
                    aria-label={connectionLabel}
                    title={connectionLabel}
                  />
                  {tab.kind === 'python' && partner && <span
                    className={`project-subtab__sync ${tab.codeUpToDate ? 'project-subtab__sync--updated' : 'project-subtab__sync--stale'}`}
                    aria-label={syncLabel}
                    title={syncLabel}
                  >{tab.codeUpToDate ? '✓' : '—'}</span>}
                  {tab.kind === 'python' && !partner && tab.dirty && <span className="project-subtab__dirty" aria-label="Unsaved changes">●</span>}
                </button>
                <button
                  className="project-subtab__close"
                  type="button"
                  aria-label={`Close ${tab.name}`}
                  disabled={busyTabIds.includes(tab.id) || runtimeBusyTabIds.includes(tab.id)}
                  onClick={() => void closeProjectTab(tab.id)}
                >×</button>
                <span
                  className="project-subtab__resize"
                  role="separator"
                  aria-label={`Resize ${tab.name}`}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    setTabState((current) => resetTabWidth(current, tab.id))
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                    const startX = event.clientX
                    const startWidth = event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0
                    const move = (moveEvent: PointerEvent): void => {
                      setTabState((current) => resizeTab(current, tab.id, startWidth + moveEvent.clientX - startX))
                    }
                    const finish = (): void => {
                      window.removeEventListener('pointermove', move)
                      window.removeEventListener('pointerup', finish)
                      updateOverflow()
                    }
                    window.addEventListener('pointermove', move)
                    window.addEventListener('pointerup', finish, { once: true })
                  }}
                />
              </div>
            })}
          </div>
        </div>
        {tabOverflow && canScrollTabsRight && <button className="tab-scroll-button tab-scroll-button--right" type="button" aria-label="Scroll files right by one project" onClick={() => scrollByProject(1)}>›</button>}
      </nav>

      <aside className="rail">
        <button className="rail__button rail__button--active" aria-label="Compare view">⌘</button>
        <button className="rail__button" aria-label="Ideas">✦</button>
        <span className="rail__spacer" />
        <button className="rail__button" aria-label="Files">▱</button>
        <button className="rail__button" aria-label="Settings">⚙</button>
      </aside>

      <div
        className="tab-workspace-scroll"
      >
        <div
          className="tab-workspace-track"
          ref={tabWorkspaceRef}
          style={outputGridStyle}
          onScroll={(event) => {
            if (viewMode === 'output') {
              outputScrollTopRef.current = event.currentTarget.scrollTop
              return
            }
            editorWorkspaceScrollLeftRef.current = event.currentTarget.scrollLeft
            if (tabStripRef.current && Math.abs(tabStripRef.current.scrollLeft - event.currentTarget.scrollLeft) > 1) {
              tabStripRef.current.scrollLeft = event.currentTarget.scrollLeft
              editorTabStripScrollLeftRef.current = event.currentTarget.scrollLeft
            }
            updateOverflow()
          }}
          onWheel={(event) => {
            if (viewMode !== 'editor') return
            const target = event.target
            if (!shouldScrollProjectsFromWheel(
              target instanceof Element && Boolean(target.closest('[data-project-wheel="local"]'))
            )) return
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX) && (event.shiftKey || Math.abs(event.deltaY) > 0)) {
              event.currentTarget.scrollLeft += event.deltaY
            }
          }}
        >
          {importedScratch && importedPython && <ActiveTabSession
            ref={registerImportedSession}
            activeTab={importedScratch}
            importedScratch={importedScratch}
            importedPython={importedPython}
            paired
            activeId={tabState.activeId}
            onActivate={selectAndRevealTab}
            onRegisterPane={registerPane}
            onPersist={persistTab}
            onEdited={persistEditedTab}
            onParityStatus={setParityStatus}
            onRuntimeState={reportSessionRuntime}
            onRuntimeMessage={reportRuntimeMessage}
            busyTabIds={busyTabIds}
            connectableTabIds={connectableTabIds}
            onConnect={setConnectPickerTabId}
            onDisconnect={(id) => void disconnectProjectTab(id)}
            onDuplicate={(id) => void duplicateProjectTab(id)}
            onGenerate={(id) => void generatePython(id)}
            onOpenInEditor={openInEditorView}
            onClose={(id) => void closeProjectTab(id)}
            closeDisabledTabIds={[...busyTabIds, ...runtimeBusyTabIds]}
            atTabLimit={atTabLimit}
          />}
          {tabState.tabs.filter((tab) => !(importedScratch && importedPython) || !tab.importedRole).map((tab) => <ActiveTabSession
            key={tab.id}
            ref={(handle) => registerSession([tab.id], handle)}
            activeTab={tab}
            activeId={tabState.activeId}
            onActivate={selectAndRevealTab}
            onRegisterPane={registerPane}
            onPersist={persistTab}
            onEdited={persistEditedTab}
            onParityStatus={ignoreParityStatus}
            onRuntimeState={reportSessionRuntime}
            onRuntimeMessage={reportRuntimeMessage}
            busyTabIds={busyTabIds}
            connectableTabIds={connectableTabIds}
            onConnect={setConnectPickerTabId}
            onDisconnect={(id) => void disconnectProjectTab(id)}
            onDuplicate={(id) => void duplicateProjectTab(id)}
            onGenerate={(id) => void generatePython(id)}
            onOpenInEditor={openInEditorView}
            onClose={(id) => void closeProjectTab(id)}
            closeDisabledTabIds={[...busyTabIds, ...runtimeBusyTabIds]}
            atTabLimit={atTabLimit}
          />)}
        </div>
      </div>
    </main>
  )
}

function HierarchyCheckbox({ label, checked, indeterminate, color, onChange }: {
  label: string
  checked: boolean
  indeterminate: boolean
  color: string
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate
  }, [indeterminate])
  return <input
    ref={inputRef}
    type="checkbox"
    aria-label={label}
    aria-checked={indeterminate ? 'mixed' : checked}
    checked={checked}
    style={{ accentColor: color }}
    onChange={(event) => onChange(event.target.checked)}
  />
}

export interface ActiveTabSessionHandle {
  startTabs: (tabIds: string[]) => Promise<string[]>
  stopTabs: (tabIds: string[]) => Promise<void>
  pauseTabs: (tabIds: string[]) => void
  resumeTabs: (tabIds: string[]) => void
  stopAll: () => Promise<void>
  stopPython: () => Promise<void>
  snapshotScratch: () => Promise<{ projectBytes: Uint8Array; frameDataUrl: string } | null>
}

export interface ActiveTabSessionProps {
  activeTab: ProjectTab
  importedScratch?: ScratchProjectTab
  importedPython?: PythonProjectTab
  paired?: boolean
  activeId: string
  onActivate: (id: string) => void
  onRegisterPane: (id: string, element: HTMLElement | null) => void
  onPersist: (tab: ProjectTab) => void
  onEdited: (tab: ProjectTab) => void
  onParityStatus: (status: FrameCoordinatorParityStatus | null) => void
  onRuntimeState: (
    sessionTabIds: string[],
    runningTabIds: string[],
    busyTabIds: string[],
    pausedTabIds: string[]
  ) => void
  onRuntimeMessage: (message: string) => void
  busyTabIds: string[]
  connectableTabIds: string[]
  linkSourceId?: string | null
  onConnect: (tabId: string) => void
  onDisconnect: (tabId: string) => void
  onDuplicate: (tabId: string) => void
  onGenerate: (tabId: string) => void
  onOpenInEditor: (tabId: string) => void
  onClose: (tabId: string) => void
  closeDisabledTabIds: string[]
  atTabLimit: boolean
  focused?: boolean
  focusedView?: WorkspaceViewMode
  outputPositions?: Record<string, { column: number; row: number }>
  onUpdateConnection?: (connectionId: string) => void
}

const EMPTY_PROJECT_BYTES = new Uint8Array()

export const ActiveTabSession = forwardRef<ActiveTabSessionHandle, ActiveTabSessionProps>(function ActiveTabSession({
  activeTab,
  importedScratch,
  importedPython,
  paired = false,
  activeId,
  onActivate,
  onRegisterPane,
  onPersist,
  onEdited,
  onParityStatus,
  onRuntimeState,
  onRuntimeMessage,
  busyTabIds,
  connectableTabIds,
  linkSourceId = null,
  onConnect,
  onDisconnect,
  onDuplicate,
  onGenerate,
  onOpenInEditor,
  onClose,
  closeDisabledTabIds,
  atTabLimit,
  focused = false,
  focusedView = 'editor',
  outputPositions,
  onUpdateConnection
}, ref): React.JSX.Element {
  const [coordinatedRunning, setCoordinatedRunning] = useState(false)
  const [coordinatedFrame, setCoordinatedFrame] = useState(0)
  const coordinatorRef = useRef<UniversalFrameCoordinator | null>(null)
  const generationRef = useRef(0)
  const startingBothRef = useRef(false)
  const pairActive = Boolean(
    paired && importedScratch?.connectionId &&
    importedScratch.connectionId === importedPython?.connectionId
  )
  const scratchTab = paired ? importedScratch : activeTab.kind === 'scratch' ? activeTab : undefined
  const pythonTab = paired ? importedPython : activeTab.kind === 'python' ? activeTab : undefined
  const scratchEnabled = Boolean(scratchTab)
  const pythonEnabled = Boolean(pythonTab)
  const scratchTabRef = useRef(scratchTab)
  const pythonTabRef = useRef(pythonTab)
  scratchTabRef.current = scratchTab
  pythonTabRef.current = pythonTab

  const markScratchDirty = useCallback((): void => {
    const current = scratchTabRef.current
    if (current) onEdited({ ...current, dirty: true })
  }, [onEdited])

  const scratch = useScratchRuntime(
    scratchTab?.projectBytes ?? EMPTY_PROJECT_BYTES,
    scratchTab?.name ?? 'untitled.sb3',
    scratchTab?.id ?? 'scratch-disabled',
    scratchEnabled,
    markScratchDirty
  )
  const pythonRuntime = usePythonRuntime(
    pythonTab?.name ?? 'untitled.py',
    pythonTab?.runtimeProjectId ?? '',
    pythonEnabled,
    pythonTab?.runtime
  )

  useEffect(() => {
    const current = pythonTabRef.current
    if (!current || !pythonEnabled) return
    onPersist({
      ...current,
      runtime: {
        frameDataUrl: pythonRuntime.frameDataUrl,
        frameState: pythonRuntime.frameState,
        output: pythonRuntime.output,
        error: pythonRuntime.error
      }
    })
  }, [
    onPersist,
    pythonEnabled,
    pythonRuntime.error,
    pythonRuntime.frameDataUrl,
    pythonRuntime.frameState,
    pythonRuntime.output
  ])

  useEffect(() => {
    const current = scratchTabRef.current
    if (!current || !scratchEnabled || !scratch.initialFrameDataUrl) return
    if (current.outputFrameDataUrl !== scratch.initialFrameDataUrl) {
      onPersist({ ...current, outputFrameDataUrl: scratch.initialFrameDataUrl })
    }
  }, [onPersist, scratch.initialFrameDataUrl, scratchEnabled])

  const releaseCoordinator = useCallback((): void => {
    generationRef.current += 1
    startingBothRef.current = false
    coordinatorRef.current?.stop()
    coordinatorRef.current = null
    setCoordinatedRunning(false)
    onParityStatus(null)
  }, [onParityStatus])

  const stopExecution = useCallback(async (): Promise<void> => {
    releaseCoordinator()
    scratch.stop()
    await pythonRuntime.stop()
  }, [pythonRuntime, releaseCoordinator, scratch])

  const snapshotScratch = useCallback(async (): Promise<{ projectBytes: Uint8Array; frameDataUrl: string } | null> => {
    const current = scratchTabRef.current
    if (!current || !scratchEnabled || !scratch.ready) return null
    return scratch.snapshot()
  }, [scratch, scratchEnabled])

  const stopTabs = useCallback(async (tabIds: string[]): Promise<void> => {
    const selected = new Set(tabIds)
    const currentScratch = scratchTabRef.current
    const currentPython = pythonTabRef.current
    const stopScratch = Boolean(currentScratch && selected.has(currentScratch.id))
    const stopPythonTab = Boolean(currentPython && selected.has(currentPython.id))
    if (!stopScratch && !stopPythonTab) return

    if (startingBothRef.current) {
      await stopExecution()
      return
    }

    if (coordinatedRunning) {
      releaseCoordinator()
      if (stopScratch && stopPythonTab) {
        scratch.stop()
        await pythonRuntime.stop()
      } else if (stopScratch) {
        scratch.stop()
        pythonRuntime.continueInternally()
      } else {
        scratch.continueStandalone()
        await pythonRuntime.stop()
      }
      return
    }

    if (stopScratch) scratch.stop()
    if (stopPythonTab) await pythonRuntime.stop()
  }, [coordinatedRunning, pythonRuntime, releaseCoordinator, scratch, stopExecution])

  const pauseTabs = useCallback((tabIds: string[]): void => {
    if (startingBothRef.current) return
    const selected = new Set(tabIds)
    const currentScratch = scratchTabRef.current
    const currentPython = pythonTabRef.current
    const pauseScratch = Boolean(currentScratch && selected.has(currentScratch.id))
    const pausePython = Boolean(currentPython && selected.has(currentPython.id))
    if (!pauseScratch && !pausePython) return

    if (coordinatedRunning) {
      releaseCoordinator()
      if (pauseScratch) scratch.pause()
      else scratch.continueStandalone()
      if (pausePython) pythonRuntime.pause()
      else pythonRuntime.continueInternally()
      return
    }

    if (pauseScratch) scratch.pause()
    if (pausePython) pythonRuntime.pause()
  }, [coordinatedRunning, pythonRuntime, releaseCoordinator, scratch])

  const resumeTabs = useCallback((tabIds: string[]): void => {
    const selected = new Set(tabIds)
    const currentScratch = scratchTabRef.current
    const currentPython = pythonTabRef.current
    if (currentScratch && selected.has(currentScratch.id)) scratch.resume()
    if (currentPython && selected.has(currentPython.id)) pythonRuntime.resume()
  }, [pythonRuntime, scratch])

  const stopPython = useCallback(async (): Promise<void> => {
    const current = pythonTabRef.current
    if (current) await stopTabs([current.id])
  }, [stopTabs])

  const finishCoordinator = useCallback((generation: number, message?: string): void => {
    if (generation !== generationRef.current) return
    generationRef.current += 1
    coordinatorRef.current = null
    startingBothRef.current = false
    setCoordinatedRunning(false)
    scratch.stop()
    void pythonRuntime.stop()
    if (message) {
      onParityStatus(null)
      onRuntimeMessage(message)
    }
  }, [onParityStatus, onRuntimeMessage, pythonRuntime, scratch])

  const startBoth = useCallback(async (): Promise<boolean> => {
    if (!pairActive || !scratch.ready) return false
    if (coordinatedRunning || startingBothRef.current || pythonRuntime.running || scratch.running) {
      await stopExecution()
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    startingBothRef.current = true
    onParityStatus(null)
    const started = await pythonRuntime.run(pythonTabRef.current?.source ?? '', 'scratch')
    if (!started || generation !== generationRef.current) {
      startingBothRef.current = false
      if (started) await pythonRuntime.stop()
      else onRuntimeMessage('The coordinated run could not start Python. See the Python output for details.')
      return false
    }
    if (!scratch.startCoordinated()) {
      finishCoordinator(generation, 'The coordinated run could not start because Scratch was not ready.')
      return false
    }

    const coordinator = new UniversalFrameCoordinator({
      captureInput: scratch.captureInput,
      requestPythonFrame: pythonRuntime.requestCoordinatedFrame,
      stepScratch: scratch.stepCoordinated,
      presentPair: (frame) => {
        pythonRuntime.presentCoordinatedFrame(frame)
        setCoordinatedFrame(frame.sequence)
      },
      onParityUpdate: onParityStatus,
      onComplete: () => finishCoordinator(generation),
      onError: (reason) => finishCoordinator(generation, reason.message)
    })
    coordinatorRef.current = coordinator
    startingBothRef.current = false
    setCoordinatedFrame(0)
    setCoordinatedRunning(true)
    coordinator.start()
    return true
  }, [
    coordinatedRunning,
    finishCoordinator,
    onParityStatus,
    onRuntimeMessage,
    pairActive,
    pythonRuntime,
    scratch,
    scratch.ready,
    stopExecution
  ])

  const startTabs = useCallback(async (tabIds: string[]): Promise<string[]> => {
    const selected = new Set(tabIds)
    const wantsScratch = Boolean(scratchTabRef.current && selected.has(scratchTabRef.current.id))
    const wantsPython = Boolean(pythonTabRef.current && selected.has(pythonTabRef.current.id))

    if (pairActive && wantsScratch && wantsPython) {
      await stopTabs([scratchTabRef.current!.id, pythonTabRef.current!.id])
      return await startBoth()
        ? [scratchTabRef.current!.id, pythonTabRef.current!.id]
        : []
    }

    const startedIds: string[] = []
    if (wantsScratch && scratch.ready && scratchTabRef.current) {
      await stopTabs([scratchTabRef.current.id])
      scratch.run()
      startedIds.push(scratchTabRef.current.id)
    }
    if (wantsPython && pythonTabRef.current) {
      await stopTabs([pythonTabRef.current.id])
      const started = await pythonRuntime.run(pythonTabRef.current.source)
      if (started) startedIds.push(pythonTabRef.current.id)
    }
    return startedIds
  }, [pairActive, pythonRuntime, scratch, scratch.ready, startBoth, stopTabs])

  useImperativeHandle(
    ref,
    () => ({
      snapshotScratch,
      startTabs,
      stopTabs,
      pauseTabs,
      resumeTabs,
      stopAll: stopExecution,
      stopPython
    }),
    [pauseTabs, resumeTabs, snapshotScratch, startTabs, stopExecution, stopPython, stopTabs]
  )

  useEffect(() => {
    const sessionTabIds = [scratchTab?.id, pythonTab?.id]
      .filter((id): id is string => typeof id === 'string')
    const coordinated = startingBothRef.current || coordinatedRunning
    const runningIds = coordinated
      ? sessionTabIds
      : [scratch.running ? scratchTab?.id : undefined, pythonRuntime.running ? pythonTab?.id : undefined]
          .filter((id): id is string => typeof id === 'string')
    const busyIds = startingBothRef.current
      ? sessionTabIds
      : pythonRuntime.status === 'starting' || pythonRuntime.status === 'stopping'
        ? [pythonTab?.id].filter((id): id is string => typeof id === 'string')
        : []
    const pausedIds = [
      scratch.paused ? scratchTab?.id : undefined,
      pythonRuntime.paused ? pythonTab?.id : undefined
    ].filter((id): id is string => typeof id === 'string')
    onRuntimeState(sessionTabIds, runningIds, busyIds, pausedIds)
  }, [
    coordinatedRunning,
    onRuntimeState,
    pythonRuntime.running,
    pythonRuntime.paused,
    pythonRuntime.status,
    pythonTab?.id,
    scratch.running,
    scratch.paused,
    scratchTab?.id
  ])

  useEffect(() => () => {
    generationRef.current += 1
    coordinatorRef.current?.stop()
    scratch.stop()
    void pythonRuntime.stop()
    // The controller methods are stable callbacks; this cleanup must run only
    // when the active tab session actually unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const coordinatedStatus = coordinatedRunning
    ? `Coordinated · frame ${coordinatedFrame}`
    : ''

  const togglePython = (): void => {
    if (!pythonTab) return
    if (startingBothRef.current || coordinatedRunning) void stopTabs([pythonTab.id])
    else if (pythonRuntime.paused) pythonRuntime.resume()
    else if (pythonRuntime.running) void pythonRuntime.stop()
    else {
      onParityStatus(null)
      void pythonRuntime.run(pythonTab.source)
    }
  }

  const toggleScratch = (): void => {
    if (!scratchTab) return
    if (startingBothRef.current || coordinatedRunning) void stopTabs([scratchTab.id])
    else if (scratch.paused) scratch.resume()
    else if (scratch.running) scratch.stop()
    else {
      onParityStatus(null)
      scratch.run()
    }
  }

  const panelActions = (
    tab: ProjectTab,
    exportAction: () => void,
    exportDisabled = false
  ): React.ReactNode => (
    <div className="panel-actions" aria-label={`${tab.name} actions`}>
      {panelActionKinds(tab).map((action) => {
        switch (action) {
          case 'connect':
          case 'reconnect':
            return <button
              className="panel-action"
              type="button"
              key={action}
              disabled={busyTabIds.includes(tab.id) || !connectableTabIds.includes(tab.id)}
              onClick={() => onConnect(tab.id)}
            >{action === 'connect' ? 'Pair' : 'Pair to Other'}</button>
          case 'disconnect':
            return <button
              className="panel-action"
              type="button"
              key={action}
              disabled={busyTabIds.includes(tab.id)}
              onClick={() => onDisconnect(tab.id)}
            >Disconnect</button>
          case 'generate':
            return <button className="panel-action" type="button" key={action} disabled={atTabLimit || busyTabIds.includes(tab.id) || !scratch.ready} onClick={() => onGenerate(tab.id)}>Generate new .py</button>
          case 'duplicate':
            return <button className="panel-action" type="button" key={action} disabled={atTabLimit || busyTabIds.includes(tab.id) || (tab.kind === 'scratch' && !scratch.ready)} onClick={() => onDuplicate(tab.id)}>Duplicate</button>
          case 'export':
            return <button className="panel-action" type="button" key={action} disabled={exportDisabled} onClick={exportAction}>Export</button>
        }
      })}
    </div>
  )

  const outputOnly = focused && focusedView === 'output'
  const paneStyle = (tab: ProjectTab): CSSProperties => {
    const position = outputOnly ? outputPositions?.[tab.id] : undefined
    return position
      ? { ...tabWidthStyle(tab), gridColumn: position.column, gridRow: position.row }
      : tabWidthStyle(tab)
  }

  const renderPythonPane = (tab: PythonProjectTab): React.JSX.Element => (
    <section
      className={`single-tab-grid tab-pane ${focused ? 'focused-program-pane' : ''} ${outputOnly ? 'focused-program-pane--output' : ''} ${activeId === tab.id ? 'tab-pane--active' : ''}`}
      data-tab-id={tab.id}
      key={tab.id}
      ref={(element) => onRegisterPane(tab.id, element)}
      style={paneStyle(tab)}
      onPointerDown={() => onActivate(tab.id)}
    >
      <OutputCardTabHeader
        tab={tab}
        focused={focused}
        focusedView={focusedView}
        running={pythonRuntime.running}
        runDisabled={pythonRuntime.status === 'starting' || pythonRuntime.status === 'stopping'}
        onRun={togglePython}
        onUpdateConnection={onUpdateConnection}
        connectableTabIds={connectableTabIds}
        linkSourceId={linkSourceId}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onDuplicate={onDuplicate}
        onGenerate={onGenerate}
        atTabLimit={atTabLimit}
        onOpenInEditor={onOpenInEditor}
        onClose={onClose}
        closeDisabled={closeDisabledTabIds.includes(tab.id)}
      />
      {!focused && <PanelHeader
        title="Python + Pygame-CE"
        tone="green"
        running={pythonRuntime.running}
        disabled={pythonRuntime.status === 'starting' || pythonRuntime.status === 'stopping'}
        status={coordinatedRunning ? coordinatedStatus : pythonRuntime.statusLabel}
        onRun={togglePython}
        actions={panelActions(tab, () => void pythonRuntime.exportSource(tab.source))}
      />}
      {!outputOnly && <section className="editor-pane python-editor" aria-label={`Python editor for ${tab.name}`}>
        <Editor
          height="100%"
          language="python"
          theme={focused ? 'vs' : 'vs-dark'}
          value={tab.source}
          onChange={(value, event) => {
            if (!event.isFlush) onEdited({ ...tab, source: value ?? '', dirty: true })
          }}
          options={{
            automaticLayout: true,
            fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
            fontSize: 14,
            lineHeight: 23,
            minimap: { enabled: false },
            padding: { top: 18 },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'line',
            overviewRulerBorder: false
          }}
        />
      </section>}
      <PythonOutputPane
        runtime={pythonRuntime}
        initialFrameDataUrl={scratchTab?.outputFrameDataUrl ?? ''}
        targets={scratch.targets}
      />
    </section>
  )

  const renderScratchPane = (tab: ScratchProjectTab): React.JSX.Element => (
    <section
      className={`single-tab-grid tab-pane ${focused ? 'focused-program-pane focused-program-pane--scratch' : ''} ${outputOnly ? 'focused-program-pane--output' : ''} ${activeId === tab.id ? 'tab-pane--active' : ''}`}
      data-tab-id={tab.id}
      key={tab.id}
      ref={(element) => onRegisterPane(tab.id, element)}
      style={paneStyle(tab)}
      onPointerDown={() => onActivate(tab.id)}
    >
      <OutputCardTabHeader
        tab={tab}
        focused={focused}
        focusedView={focusedView}
        running={scratch.running}
        runDisabled={!scratch.ready}
        onRun={toggleScratch}
        onUpdateConnection={onUpdateConnection}
        connectableTabIds={connectableTabIds}
        linkSourceId={linkSourceId}
        onConnect={onConnect}
        onDisconnect={onDisconnect}
        onDuplicate={onDuplicate}
        onGenerate={onGenerate}
        atTabLimit={atTabLimit}
        onOpenInEditor={onOpenInEditor}
        onClose={onClose}
        closeDisabled={closeDisabledTabIds.includes(tab.id)}
      />
      {!focused && <PanelHeader
        title="Scratch"
        tone="orange"
        running={scratch.running}
        disabled={!scratch.ready}
        status={coordinatedRunning ? coordinatedStatus : scratch.status}
        onRun={toggleScratch}
        actions={panelActions(tab, () => void scratch.save(), !scratch.ready)}
      />}
      {outputOnly
        ? <ScratchOutputPane scratch={scratch} />
        : <ScratchWorkspace scratch={scratch} projectName={tab.name} />}
      {!focused && <ScratchOutputPane scratch={scratch} />}
    </section>
  )

  if (paired && scratchTab && pythonTab) {
    return <>{renderScratchPane(scratchTab)}{renderPythonPane(pythonTab)}</>
  }
  if (pythonTab) return renderPythonPane(pythonTab)
  if (scratchTab) return renderScratchPane(scratchTab)
  return <section className="tab-pane tab-pane--error">Tab unavailable</section>
})

function OutputCardTabHeader({
  tab,
  focused = false,
  focusedView = 'editor',
  running = false,
  runDisabled = false,
  onRun,
  onUpdateConnection,
  connectableTabIds,
  linkSourceId,
  onConnect,
  onDisconnect,
  onDuplicate,
  onGenerate,
  atTabLimit,
  onOpenInEditor,
  onClose,
  closeDisabled
}: {
  tab: ProjectTab
  focused?: boolean
  focusedView?: WorkspaceViewMode
  running?: boolean
  runDisabled?: boolean
  onRun?: () => void
  onUpdateConnection?: (connectionId: string) => void
  connectableTabIds: string[]
  linkSourceId: string | null
  onConnect: (tabId: string) => void
  onDisconnect: (tabId: string) => void
  onDuplicate: (tabId: string) => void
  onGenerate: (tabId: string) => void
  atTabLimit: boolean
  onOpenInEditor: (tabId: string) => void
  onClose: (tabId: string) => void
  closeDisabled: boolean
}): React.JSX.Element {
  const connectionLabel = tab.connectionId ? `${tab.name} is connected` : `${tab.name} is unconnected`
  const syncLabel = tab.kind === 'python' && tab.connectionId
    ? tab.codeUpToDate ? 'Code is updated' : 'Code needs updating'
    : ''
  const isLinkSource = linkSourceId === tab.id
  const isLinkTarget = Boolean(linkSourceId && linkSourceId !== tab.id && connectableTabIds.includes(tab.id))
  const linkChoiceDisabled = closeDisabled || Boolean(linkSourceId && !isLinkSource && !isLinkTarget)
  if (focused) return (
    <header className={`output-card-tab fp-session-file-header ${tab.kind === 'scratch' ? 'fp-session-file-header--scratch' : ''}`}>
      <VscodeIcon name={tab.kind === 'scratch' ? 'package' : 'file-code'} />
      <strong className="output-card-tab__name" title={tab.name}>{tab.name}</strong>
      {focusedView === 'output' && tab.connectionId && <i
        className="fp-connection-dot fp-session-connection-dot"
        style={{ backgroundColor: connectionColor(tab.connectionId) }}
        aria-label={connectionLabel}
        title={connectionLabel}
      />}
      <div className="fp-session-file-actions">
        {isLinkTarget
          ? <button
              className="fp-session-link-target"
              type="button"
              disabled={closeDisabled}
              aria-label={`Link selected file with ${tab.name}`}
              title={`Link with ${tab.name}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onConnect(tab.id)}
            >Link</button>
          : tab.connectionId
            ? <button
              type="button"
              disabled={closeDisabled}
              aria-label={`Break link between ${tab.name} and its connected file`}
              title="Break link"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onDisconnect(tab.id)}
            ><VscodeIcon name="debug-disconnect" /></button>
            : <button
                className={isLinkSource ? 'fp-session-link-source' : undefined}
                type="button"
                disabled={linkChoiceDisabled}
                aria-label={isLinkSource ? `Cancel linking ${tab.name}` : `Link ${tab.name} to another file`}
                aria-pressed={isLinkSource}
                title={isLinkSource ? 'Cancel linking' : 'Link file'}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onConnect(tab.id)}
              ><VscodeIcon name="link" /></button>}
        {tab.kind === 'python' && tab.connectionId && <i
          className={`fp-sync-dot ${tab.codeUpToDate ? 'fp-sync-dot--updated' : 'fp-sync-dot--stale'}`}
          aria-label={syncLabel}
          title={syncLabel}
        />}
        {tab.kind === 'python' && <button
          type="button"
          disabled={runDisabled}
          aria-label={`${running ? 'Stop' : 'Run'} ${tab.name}`}
          title={`${running ? 'Stop' : 'Run'} ${tab.name}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onRun}
        ><VscodeIcon name={running ? 'debug-stop' : 'debug-start'} /></button>}
        {tab.kind === 'scratch' && focusedView === 'output' && <>
          <button
            type="button"
            disabled={runDisabled || running}
            aria-label={`Start ${tab.name}`}
            title={`Start ${tab.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRun}
          ><img className="fp-scratch-control-icon" src={scratchGreenFlag} alt="" aria-hidden="true" /></button>
          <button
            type="button"
            disabled={runDisabled || !running}
            aria-label={`Stop ${tab.name}`}
            title={`Stop ${tab.name}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRun}
          ><img className="fp-scratch-control-icon" src={scratchStop} alt="" aria-hidden="true" /></button>
        </>}
        {tab.kind === 'python' && tab.connectionId && <button
          type="button"
          disabled={closeDisabled}
          aria-label={`Update ${tab.name} from connected Scratch project`}
          title="Update code from connected Scratch project"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onUpdateConnection?.(tab.connectionId!)}
        ><VscodeIcon name="refresh" /></button>}
        {tab.kind === 'scratch' && <button
          type="button"
          disabled={closeDisabled || runDisabled || atTabLimit || Boolean(tab.connectionId)}
          aria-label={`Make an adjacent Python file for ${tab.name}`}
          title={tab.connectionId ? 'Break the current link before making an adjacent Python file' : 'Make adjacent Python file'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onGenerate(tab.id)}
        ><VscodeIcon name="new-file" /></button>}
        {tab.kind === 'scratch' && <button
          type="button"
          disabled={closeDisabled || runDisabled || atTabLimit}
          aria-label={`Duplicate ${tab.name}`}
          title="Duplicate file"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onDuplicate(tab.id)}
        ><VscodeIcon name="files" /></button>}
        <button
          type="button"
          aria-label={`Close ${tab.name}`}
          title="Close"
          disabled={closeDisabled}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => onClose(tab.id)}
        ><VscodeIcon name="close" /></button>
      </div>
    </header>
  )
  return (
    <header className="output-card-tab">
      <span className={`project-subtab__kind project-subtab__kind--${tab.kind}`}>
        {tab.kind === 'python' ? 'PY' : 'SB3'}
      </span>
      <strong className="output-card-tab__name" title={tab.name}>{tab.name}</strong>
      <span
        className="project-subtab__connection"
        style={{ backgroundColor: connectionColor(tab.connectionId) }}
        aria-label={connectionLabel}
        title={connectionLabel}
      />
      {tab.kind === 'python' && tab.connectionId && <span
        className={`project-subtab__sync ${tab.codeUpToDate ? 'project-subtab__sync--updated' : 'project-subtab__sync--stale'}`}
        aria-label={syncLabel}
        title={syncLabel}
      >{tab.codeUpToDate ? '✓' : '—'}</span>}
      {tab.kind === 'python' && !tab.connectionId && tab.dirty && <span className="project-subtab__dirty" aria-label="Unsaved changes">●</span>}
      <button
        className="output-card-tab__open"
        type="button"
        title={`Open ${tab.name} in Editor View`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onOpenInEditor(tab.id)}
      >Open in Editor View</button>
      <button
        className="project-subtab__close"
        type="button"
        aria-label={`Close ${tab.name}`}
        disabled={closeDisabled}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onClose(tab.id)}
      >×</button>
    </header>
  )
}

function PanelHeader({ title, tone, running, disabled = false, status, actions, onRun }: {
  title: string
  tone: 'green' | 'orange'
  running: boolean
  disabled?: boolean
  status: string
  actions?: React.ReactNode
  onRun: () => void
}): React.JSX.Element {
  return (
    <header className="panel-header">
      <button className={`run-button run-button--${tone}`} disabled={disabled} onClick={onRun} aria-label={`${running ? 'Stop' : 'Run'} ${title}`}>
        {running ? '■' : '▶'}
      </button>
      <span className="panel-divider" />
      <strong>{title}</strong>
      <span className={`run-state ${running ? 'run-state--live' : ''}`}>{status}</span>
      {actions}
    </header>
  )
}

function ScratchWorkspace({ scratch, projectName }: {
  scratch: ScratchRuntimeController
  projectName: string
}): React.JSX.Element {
  return (
    <section
      className="editor-pane scratch-editor"
      aria-label="Scratch project editor"
      data-project-wheel="local"
    >
      {scratch.ready && scratch.vm && scratch.storage && <ScratchGuiAdapter
        vm={scratch.vm}
        storage={scratch.storage}
        projectName={projectName}
      />}
      {!scratch.ready && <div className={`scratch-loading ${scratch.error ? 'scratch-loading--error' : ''}`} role="status">
        <span className={scratch.error ? 'scratch-error-mark' : 'spinner'} />
        <strong>{scratch.error || scratch.status}</strong>
      </div>}
    </section>
  )
}

function PythonOutputPane({ runtime, initialFrameDataUrl, targets }: {
  runtime: PythonRuntimeController
  initialFrameDataUrl: string
  targets: ScratchTargetInfo[]
}): React.JSX.Element {
  const sprites = targets.filter((target) => !target.isStage)
  const [selectedSprite, setSelectedSprite] = useState('')
  const [motionPanelOpen, setMotionPanelOpen] = useState(true)
  const [shownValues, setShownValues] = useState({ x: false, y: false, direction: false })
  const pointerDownRef = useRef(false)
  const lastOutput = runtime.output.at(-1)
  const displayedFrame = runtime.frameDataUrl || initialFrameDataUrl
  const showConsole = Boolean(lastOutput || runtime.exportMessage)
  const selectedState = runtime.frameState?.sprites.find((sprite) => sprite.name === selectedSprite)

  useEffect(() => {
    if (!sprites.some((sprite) => sprite.name === selectedSprite)) {
      setSelectedSprite(sprites[0]?.name ?? '')
    }
  }, [selectedSprite, sprites])

  const postPointer = (event: React.PointerEvent<HTMLDivElement>, isDown = pointerDownRef.current): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(-240, Math.min(240, ((event.clientX - rect.left) / rect.width) * 480 - 240))
    const y = Math.max(-180, Math.min(180, 180 - ((event.clientY - rect.top) / rect.height) * 360))
    runtime.updatePointer(x, y, isDown)
  }

  const formatMotionValue = (value: number | undefined): string => {
    if (value === undefined || !Number.isFinite(value)) return '—'
    if (Math.abs(value - Math.round(value)) < 1e-9) return String(Math.round(value))
    return String(Number(value.toFixed(2)))
  }

  const motionRows = [
    { key: 'x' as const, label: 'x position', value: selectedState?.x },
    { key: 'y' as const, label: 'y position', value: selectedState?.y },
    { key: 'direction' as const, label: 'direction', value: selectedState?.direction }
  ]

  return (
    <section className="output-pane">
      <header><strong>Python output</strong><span>{runtime.statusLabel}</span></header>
      <div className={`python-output-body ${showConsole ? '' : 'python-output-body--stage-only'}`}>
        <div className="python-output-stage-row">
          <aside className={`motion-values ${motionPanelOpen ? '' : 'motion-values--collapsed'}`} aria-label="Python Motion values">
            <button
              className="motion-values__heading"
              type="button"
              aria-expanded={motionPanelOpen}
              onClick={() => setMotionPanelOpen((open) => !open)}
            >
              <span>{motionPanelOpen ? '‹' : '›'}</span>
              {motionPanelOpen && <strong>Motion values</strong>}
            </button>
            {motionPanelOpen && (
              <div className="motion-values__body">
                {sprites.length === 0 ? (
                  <p>No sprites</p>
                ) : (
                  <>
                    {sprites.length > 1 ? (
                      <label className="motion-values__sprite">
                        <span>Sprite</span>
                        <select value={selectedSprite} onChange={(event) => setSelectedSprite(event.target.value)}>
                          {sprites.map((sprite) => <option key={sprite.id} value={sprite.name}>{sprite.name}</option>)}
                        </select>
                      </label>
                    ) : <span className="motion-values__single-sprite">{sprites[0]?.name}</span>}
                    <div className="motion-values__toggles">
                      {motionRows.map((row) => (
                        <label key={row.key} className={shownValues[row.key] ? 'motion-value motion-value--shown' : 'motion-value'}>
                          <input
                            type="checkbox"
                            checked={shownValues[row.key]}
                            aria-label={`Show ${row.label} for ${selectedSprite}`}
                            onChange={(event) => setShownValues((current) => ({
                              ...current,
                              [row.key]: event.target.checked
                            }))}
                          />
                          <span>{row.label}</span>
                          {shownValues[row.key] && <output>{formatMotionValue(row.value)}</output>}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </aside>
          <div className="stage-fit">
            <div
              className="python-stage-frame"
              tabIndex={0}
              aria-label="Python Pygame output"
              onPointerMove={(event) => postPointer(event)}
              onPointerDown={(event) => {
                pointerDownRef.current = true
                event.currentTarget.setPointerCapture(event.pointerId)
                event.currentTarget.focus()
                postPointer(event, true)
              }}
              onPointerUp={(event) => {
                pointerDownRef.current = false
                postPointer(event, false)
              }}
              onPointerCancel={(event) => {
                pointerDownRef.current = false
                postPointer(event, false)
              }}
            >
              {displayedFrame
                ? <img src={displayedFrame} alt={runtime.frameDataUrl ? 'Current Python Pygame frame' : 'Imported project initial frame'} />
                : <div className="python-stage-placeholder"><span>PY</span></div>}
              {!runtime.running && !displayedFrame && !runtime.error && (
                <div className="stage-overlay"><span>▶</span><small>Run this file from its header or the Run checklist</small></div>
              )}
              {runtime.error && (
                <div className="python-runtime-error" role="alert">
                  <b>Python stopped</b><small>{runtime.error}</small>
                </div>
              )}
            </div>
          </div>
        </div>
        {showConsole && (
          <div className="python-console" title={runtime.output.join('\n')}>
            <span>{runtime.error ? '!' : '›'}</span>{runtime.exportMessage || lastOutput}
          </div>
        )}
      </div>
    </section>
  )
}

function ScratchOutputPane({ scratch }: { scratch: ScratchRuntimeController }): React.JSX.Element {
  return (
    <section className="output-pane scratch-output-pane">
      <header><strong>Scratch output</strong><span>{scratch.status}</span></header>
      <div className="scratch-output-body">
        <div className="stage-fit">
          <div className="scratch-stage-frame">
            {scratch.initialFrameDataUrl && <img
              className="scratch-stage-initial"
              src={scratch.initialFrameDataUrl}
              alt="Imported Scratch stage"
            />}
            <canvas ref={scratch.outputCanvasRef} className="scratch-stage-canvas" width="480" height="360" role="img" aria-label="Live Scratch stage output" />
            {!scratch.ready && <div className="scratch-stage-hint"><span>{scratch.error ? '!' : '…'}</span><small>{scratch.error || 'Loading Scratch Render'}</small></div>}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function App(): React.JSX.Element {
  const [result, setResult] = useState<ConversionResult | null>(null)
  return result
    ? <Workspace key={result.project.id} result={result} onNewProject={() => setResult(null)} />
    : <UploadScreen onReady={setResult} />
}
