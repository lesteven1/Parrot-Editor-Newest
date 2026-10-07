import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type DragEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import Editor from '@monaco-editor/react'
import type { ConversionResult, ProjectSelection } from '../../shared/project'
import { usePythonRuntime } from './python/usePythonRuntime'
import { UniversalFrameCoordinator } from './runtime/frame-coordinator'
import { ScratchGuiAdapter } from './scratch/ScratchGuiAdapter'
import { useScratchRuntime } from './scratch/useScratchRuntime'
import {
  createFocusedViewState,
  focusedViewReducer,
  projectFileNames,
  projectFolderName,
  type FocusedActivity,
  type FocusedFileKind,
  type FocusedViewAction,
  type FocusedViewState
} from './focused/model'
import { regeneratePythonFromScratch } from './focused/update'

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

type IconName =
  | 'chevron-down'
  | 'close'
  | 'explorer'
  | 'file-code'
  | 'file-plus'
  | 'folder-plus'
  | 'panel-left'
  | 'play'
  | 'refresh'
  | 'scratch'
  | 'search'
  | 'settings'
  | 'stop'

function Icon({ name }: { name: IconName }): React.JSX.Element {
  const paths: Record<IconName, React.ReactNode> = {
    'chevron-down': <path d="m6 9 6 6 6-6" />,
    close: <><path d="M6 6l12 12" /><path d="M18 6 6 18" /></>,
    explorer: <><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5" /><path d="M3 6v16h12" /></>,
    'file-code': <><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5" /><path d="m10 13-2 2 2 2" /><path d="m15 13 2 2-2 2" /></>,
    'file-plus': <><path d="M6 2h9l4 4v16H6z" /><path d="M14 2v5h5" /><path d="M12 11v7M8.5 14.5h7" /></>,
    'folder-plus': <><path d="M3 6h7l2 2h9v11H3z" /><path d="M12 11v6M9 14h6" /></>,
    'panel-left': <><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M9 4v16" /></>,
    play: <path d="m8 5 11 7-11 7z" />,
    refresh: <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8.5A7 7 0 0 1 18.5 7L20 12M4 12l1.5 5a7 7 0 0 0 12.4-1.5" /></>,
    scratch: <><path d="M7 5h9l3 4-2 10H8L5 9z" /><path d="m9 5 2-2 2 2M9 11h6M10 15h4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 5 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 5a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.13.38.34.72.6 1 .3.26.68.4 1.1.4h.1v4h-.1c-.42 0-.8.14-1.1.4-.26.28-.47.62-.6 1Z" /></>,
    stop: <rect x="7" y="7" width="10" height="10" rx="1" />
  }
  return <svg className="fp-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function browserProject(file: File): ProjectSelection {
  return { id: `browser-${file.name}-${file.size}`, name: file.name, size: file.size }
}

interface FocusedShellProps {
  result: ConversionResult | null
  loading: boolean
  error: string
  dragging: boolean
  onChooseProject: () => void
  onDropProject: (event: DragEvent<HTMLElement>) => void
  onDragState: (dragging: boolean) => void
}

function ActivityButton({
  activity,
  current,
  label,
  icon,
  onSelect
}: {
  activity: FocusedActivity
  current: FocusedActivity
  label: string
  icon: IconName
  onSelect: (activity: FocusedActivity) => void
}): React.JSX.Element {
  return <button
    className={`fp-activity-button ${current === activity ? 'fp-activity-button--active' : ''}`}
    type="button"
    aria-label={label}
    aria-pressed={current === activity}
    title={label}
    onClick={() => onSelect(activity)}
  ><Icon name={icon} /></button>
}

function ExplorerSidebar({
  result,
  view,
  dispatch,
  onPlaceholder
}: {
  result: ConversionResult | null
  view: FocusedViewState
  dispatch: React.Dispatch<FocusedViewAction>
  onPlaceholder: (message: string) => void
}): React.JSX.Element {
  if (view.activity !== 'explorer') {
    const label = view.activity === 'search' ? 'SEARCH' : 'SETTINGS'
    return <aside className="fp-sidebar" aria-label={label}>
      <header className="fp-sidebar-title"><span>{label}</span></header>
      <div className="fp-placeholder-sidebar">
        <Icon name={view.activity} />
        <span>{view.activity === 'search' ? 'Search' : 'Settings'} placeholder</span>
      </div>
    </aside>
  }

  const names = result ? projectFileNames(result.project.name) : null
  return <aside className="fp-sidebar" aria-label="Explorer">
    <header className="fp-sidebar-title">
      <span>EXPLORER</span>
      <button
        type="button"
        aria-label="Add folder"
        title="Add folder (placeholder)"
        onClick={() => onPlaceholder('Add folder is reserved for the file-system phase.')}
      ><Icon name="folder-plus" /></button>
    </header>
    {result && names && <>
      <div className="fp-project-title">
        <Icon name="chevron-down" />
        <span>{projectFolderName(result.project.name).toUpperCase()}</span>
        <button
          type="button"
          aria-label="Add file"
          title="Add file (placeholder)"
          onClick={() => onPlaceholder('Add file is reserved for the file-system phase.')}
        ><Icon name="file-plus" /></button>
      </div>
      <button
        className={`fp-tree-row ${view.selectedFile === 'scratch' ? 'fp-tree-row--active' : ''}`}
        type="button"
        onClick={() => dispatch({ type: 'open-file', file: 'scratch' })}
      >
        <Icon name="scratch" />
        <span>{names.scratch}</span>
        <i className="fp-connection-dot fp-connection-dot--scratch" aria-label="Scratch file connected" />
      </button>
      <button
        className={`fp-tree-row ${view.selectedFile === 'python' ? 'fp-tree-row--active' : ''}`}
        type="button"
        onClick={() => dispatch({ type: 'open-file', file: 'python' })}
      >
        <Icon name="file-code" />
        <span>{names.python}</span>
        <i className="fp-connection-dot fp-connection-dot--python" aria-label="Python file connected" />
      </button>
    </>}
  </aside>
}

function FocusedShell({
  result,
  loading,
  error,
  dragging,
  onChooseProject,
  onDropProject,
  onDragState
}: FocusedShellProps): React.JSX.Element {
  const [view, dispatch] = useReducer(focusedViewReducer, Boolean(result), createFocusedViewState)
  const [controlBoardOpen, setControlBoardOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [notice, setNotice] = useState('')
  const noticeTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  const showNotice = useCallback((message: string): void => {
    setNotice(message)
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(''), 2_800)
  }, [])

  const selectActivity = (activity: FocusedActivity): void => {
    dispatch({ type: 'select-activity', activity })
    if (activity !== 'explorer') {
      showNotice(`${activity === 'search' ? 'Search' : 'Settings'} is a placeholder in this phase.`)
    }
  }

  useEffect(() => {
    const api = window.parrot
    if (!api?.getWindowFullscreen || !api.onWindowFullscreenChange) return
    let active = true
    void api.getWindowFullscreen().then((next) => {
      if (active) setFullscreen(next)
    })
    const removeListener = api.onWindowFullscreenChange(setFullscreen)
    return () => {
      active = false
      removeListener()
    }
  }, [])

  return <main
    className={`fp-shell ${fullscreen ? 'fp-shell--fullscreen' : ''} ${dragging ? 'fp-shell--dragging' : ''}`}
    onDragEnter={() => onDragState(true)}
    onDragOver={(event) => event.preventDefault()}
    onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDragState(false)
    }}
    onDrop={onDropProject}
  >
    <header className="fp-titlebar">
      <div className="fp-titlebar-spacer" aria-hidden="true" />
      <button className="fp-menu-button" type="button" disabled={loading} onClick={onChooseProject}>
        {loading ? 'Opening…' : 'File'}
      </button>
      <button className="fp-menu-button" type="button" onClick={() => showNotice('View options are a placeholder in this phase.')}>View</button>
      <button
        className={`fp-menu-button ${controlBoardOpen ? 'fp-menu-button--active' : ''}`}
        type="button"
        disabled={!result}
        aria-expanded={controlBoardOpen}
        onClick={() => setControlBoardOpen((open) => !open)}
      >Run</button>
      <button
        className="fp-sidebar-toggle"
        type="button"
        aria-label="Toggle primary sidebar"
        aria-pressed={view.sidebarOpen}
        title="Toggle primary sidebar"
        onClick={() => dispatch({ type: 'toggle-sidebar' })}
      ><Icon name="panel-left" /></button>
    </header>

    <div className={`fp-body ${view.sidebarOpen ? '' : 'fp-body--sidebar-closed'}`}>
      <nav className="fp-activity" aria-label="Activity bar">
        <div>
          <ActivityButton activity="explorer" current={view.activity} label="Explorer" icon="explorer" onSelect={selectActivity} />
          <ActivityButton activity="search" current={view.activity} label="Search" icon="search" onSelect={selectActivity} />
        </div>
        <ActivityButton activity="settings" current={view.activity} label="Settings" icon="settings" onSelect={selectActivity} />
      </nav>

      {view.sidebarOpen && <ExplorerSidebar result={result} view={view} dispatch={dispatch} onPlaceholder={showNotice} />}

      <section className="fp-main" aria-label={result ? 'Project editor' : 'Empty editor'}>
        {result
          ? <ProjectWorkspace
              result={result}
              view={view}
              dispatch={dispatch}
              controlBoardOpen={controlBoardOpen}
              onCloseControlBoard={() => setControlBoardOpen(false)}
              onNotice={showNotice}
            />
          : <div className="fp-empty-workspace" />}
      </section>
    </div>

    {dragging && <div className="fp-drop-overlay"><strong>Drop a Scratch .sb3 project</strong></div>}
    {(error || notice) && <div className={`fp-toast ${error ? 'fp-toast--error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}
  </main>
}

interface ProjectWorkspaceProps {
  result: ConversionResult
  view: FocusedViewState
  dispatch: React.Dispatch<FocusedViewAction>
  controlBoardOpen: boolean
  onCloseControlBoard: () => void
  onNotice: (message: string) => void
}

function ProjectWorkspace({
  result,
  view,
  dispatch,
  controlBoardOpen,
  onCloseControlBoard,
  onNotice
}: ProjectWorkspaceProps): React.JSX.Element {
  const names = projectFileNames(result.project.name)
  const [pythonSource, setPythonSource] = useState(result.python)
  const [runtimeProjectId, setRuntimeProjectId] = useState(result.runtimeProjectId)
  const [updatingCode, setUpdatingCode] = useState(false)
  const [runtimeMessage, setRuntimeMessage] = useState(result.message)
  const [coordinatedRunning, setCoordinatedRunning] = useState(false)
  const [coordinatedFrame, setCoordinatedFrame] = useState(0)
  const coordinatorRef = useRef<UniversalFrameCoordinator | null>(null)
  const generationRef = useRef(0)
  const startingBothRef = useRef(false)
  const pointerDownRef = useRef(false)

  const markCodeStale = useCallback((): void => {
    dispatch({ type: 'mark-code-stale' })
  }, [dispatch])

  const scratch = useScratchRuntime(
    result.scratchProject,
    result.project.name,
    result.project.id,
    true,
    markCodeStale
  )
  const pythonRuntime = usePythonRuntime(names.python, runtimeProjectId)

  const stopAll = useCallback(async (): Promise<void> => {
    generationRef.current += 1
    startingBothRef.current = false
    coordinatorRef.current?.stop()
    coordinatorRef.current = null
    setCoordinatedRunning(false)
    scratch.stop()
    await pythonRuntime.stop()
  }, [pythonRuntime, scratch])

  const finishCoordinator = useCallback((generation: number, message?: string): void => {
    if (generation !== generationRef.current) return
    generationRef.current += 1
    startingBothRef.current = false
    coordinatorRef.current = null
    setCoordinatedRunning(false)
    scratch.stop()
    void pythonRuntime.stop()
    if (message) {
      setRuntimeMessage(message)
      onNotice(message)
    }
  }, [onNotice, pythonRuntime, scratch])

  const startBoth = useCallback(async (): Promise<void> => {
    if (!scratch.ready || startingBothRef.current) return
    if (coordinatedRunning || pythonRuntime.running || scratch.running) await stopAll()

    const generation = generationRef.current + 1
    generationRef.current = generation
    startingBothRef.current = true
    const pythonStarted = await pythonRuntime.run(pythonSource, 'scratch')
    if (!pythonStarted || generation !== generationRef.current) {
      startingBothRef.current = false
      if (pythonStarted) await pythonRuntime.stop()
      else onNotice('Python could not start. Check the Python stage for details.')
      return
    }
    if (!scratch.startCoordinated()) {
      finishCoordinator(generation, 'Scratch was not ready for a coordinated run.')
      return
    }

    const coordinator = new UniversalFrameCoordinator({
      captureInput: scratch.captureInput,
      requestPythonFrame: pythonRuntime.requestCoordinatedFrame,
      stepScratch: scratch.stepCoordinated,
      presentPair: (frame) => {
        pythonRuntime.presentCoordinatedFrame(frame)
        setCoordinatedFrame(frame.sequence)
      },
      onParityUpdate: () => {},
      onComplete: () => finishCoordinator(generation),
      onError: (reason) => finishCoordinator(generation, reason.message)
    })
    coordinatorRef.current = coordinator
    startingBothRef.current = false
    setCoordinatedFrame(0)
    setCoordinatedRunning(true)
    coordinator.start()
  }, [
    coordinatedRunning,
    finishCoordinator,
    onNotice,
    pythonRuntime,
    pythonSource,
    scratch,
    scratch.ready,
    stopAll
  ])

  const togglePython = useCallback(async (): Promise<void> => {
    if (coordinatedRunning || startingBothRef.current) {
      await stopAll()
    } else if (pythonRuntime.running) {
      await pythonRuntime.stop()
    } else {
      await pythonRuntime.run(pythonSource)
    }
  }, [coordinatedRunning, pythonRuntime, pythonSource, stopAll])

  const toggleScratch = useCallback((): void => {
    if (coordinatedRunning || startingBothRef.current) {
      void stopAll()
    } else if (scratch.running) {
      scratch.stop()
    } else {
      scratch.run()
    }
  }, [coordinatedRunning, scratch, stopAll])

  const updatePython = useCallback(async (): Promise<void> => {
    if (updatingCode || !scratch.ready) return
    if (!window.parrot) {
      onNotice('Update Code is available in the Electron app.')
      return
    }
    setUpdatingCode(true)
    try {
      const conversion = await regeneratePythonFromScratch({
        scratchReady: scratch.ready,
        stopAll,
        snapshotScratch: scratch.snapshot,
        convertScratch: window.parrot.updatePythonFromScratch
      })
      setPythonSource(conversion.python)
      setRuntimeProjectId(conversion.runtimeProjectId)
      setRuntimeMessage(conversion.message)
      dispatch({ type: 'mark-code-updated' })
      onNotice('Python code updated from the connected Scratch project.')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Parrot could not update the Python code.'
      setRuntimeMessage(message)
      onNotice(message)
    } finally {
      setUpdatingCode(false)
    }
  }, [dispatch, onNotice, scratch, scratch.ready, stopAll, updatingCode])

  useEffect(() => () => {
    generationRef.current += 1
    coordinatorRef.current?.stop()
    scratch.stop()
    void pythonRuntime.stop()
    // Runtime controller callbacks are stable; only stop when this project leaves the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const postPythonPointer = (event: ReactPointerEvent<HTMLDivElement>, isDown = pointerDownRef.current): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = Math.max(-240, Math.min(240, ((event.clientX - rect.left) / rect.width) * 480 - 240))
    const y = Math.max(-180, Math.min(180, 180 - ((event.clientY - rect.top) / rect.height) * 360))
    pythonRuntime.updatePointer(x, y, isDown)
  }

  const openCount = Number(view.scratchOpen) + Number(view.pythonOpen)
  const displayedPythonFrame = pythonRuntime.frameDataUrl || scratch.initialFrameDataUrl
  const pythonErrorDetail = pythonRuntime.output.length > 0
    ? pythonRuntime.output.slice(-8).join('\n')
    : pythonRuntime.error
  const pythonBusy = updatingCode || pythonRuntime.status === 'starting' || pythonRuntime.status === 'stopping'
  const anyRunning = coordinatedRunning || startingBothRef.current || scratch.running || pythonRuntime.running

  return <div className="fp-project-workspace">
    <div className={`fp-editor-grid fp-editor-grid--${Math.max(1, openCount)}`}>
      {view.scratchOpen && <section className="fp-file-column fp-file-column--scratch" aria-label={`${names.scratch} editor`}>
        <div className="fp-editor-panel">
          <header className="fp-file-header" onPointerDown={() => dispatch({ type: 'open-file', file: 'scratch' })}>
            <Icon name="scratch" />
            <span>{names.scratch}</span>
            <div className="fp-file-actions">
              <button type="button" aria-label={`Close ${names.scratch}`} title="Close" onClick={() => dispatch({ type: 'close-file', file: 'scratch' })}><Icon name="close" /></button>
            </div>
          </header>
          <div className="fp-editor-surface fp-scratch-editor" data-project-wheel="local">
            {scratch.ready && scratch.vm && scratch.storage
              ? <ScratchGuiAdapter vm={scratch.vm} storage={scratch.storage} projectName={names.scratch} />
              : <div className={`fp-loading ${scratch.error ? 'fp-loading--error' : ''}`} role="status">
                  <span className="fp-loader" />
                  <strong>{scratch.error || scratch.status}</strong>
                </div>}
          </div>
        </div>
      </section>}

      {view.pythonOpen && <section className="fp-file-column" aria-label={`${names.python} editor and stage`}>
        <div className="fp-editor-panel">
          <header className="fp-file-header" onPointerDown={() => dispatch({ type: 'open-file', file: 'python' })}>
            <Icon name="file-code" />
            <span>{names.python}</span>
            <div className="fp-file-actions">
              <i
                className={`fp-sync-dot ${view.codeUpToDate ? 'fp-sync-dot--updated' : 'fp-sync-dot--stale'}`}
                aria-label={view.codeUpToDate ? 'Python code is updated' : 'Python code needs updating'}
                title={view.codeUpToDate ? 'Python code is updated' : 'Python code needs updating'}
              />
              <button type="button" disabled={pythonBusy} aria-label={`${pythonRuntime.running ? 'Stop' : 'Run'} ${names.python}`} title={`${pythonRuntime.running ? 'Stop' : 'Run'} ${names.python}`} onClick={() => void togglePython()}><Icon name={pythonRuntime.running ? 'stop' : 'play'} /></button>
              <button type="button" disabled={updatingCode || !scratch.ready} aria-label="Update Python code from connected Scratch project" title="Update code from connected Scratch project" onClick={() => void updatePython()}><Icon name="refresh" /></button>
              <button type="button" aria-label={`Close ${names.python}`} title="Close" onClick={() => dispatch({ type: 'close-file', file: 'python' })}><Icon name="close" /></button>
            </div>
          </header>
          <div className="fp-editor-surface fp-python-editor">
            <Editor
              height="100%"
              language="python"
              theme="vs"
              value={pythonSource}
              onChange={(value, event) => {
                setPythonSource(value ?? '')
                if (!event.isFlush) dispatch({ type: 'mark-code-stale' })
              }}
              options={{
                automaticLayout: true,
                fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
                fontSize: 13,
                lineHeight: 21,
                minimap: { enabled: false },
                padding: { top: 12 },
                scrollBeyondLastLine: false,
                renderLineHighlight: 'line',
                overviewRulerBorder: false
              }}
            />
          </div>
        </div>
        <div className="fp-stage-panel" aria-label="Python stage">
          <div className="fp-stage-fit">
            <div
              className="fp-stage-frame fp-stage-frame--python"
              tabIndex={0}
              aria-label="Python Pygame stage"
              onPointerMove={(event) => postPythonPointer(event)}
              onPointerDown={(event) => {
                pointerDownRef.current = true
                event.currentTarget.setPointerCapture(event.pointerId)
                event.currentTarget.focus()
                postPythonPointer(event, true)
              }}
              onPointerUp={(event) => {
                pointerDownRef.current = false
                postPythonPointer(event, false)
              }}
              onPointerCancel={(event) => {
                pointerDownRef.current = false
                postPythonPointer(event, false)
              }}
            >
              {displayedPythonFrame
                ? <img src={displayedPythonFrame} alt="Current Python stage frame" />
                : <div className="fp-python-placeholder"><span>PY</span></div>}
              {pythonRuntime.error && <div className="fp-stage-error" role="alert"><strong>Python stopped</strong><small>{pythonErrorDetail}</small></div>}
            </div>
          </div>
        </div>
      </section>}

      {openCount === 0 && <div className="fp-empty-workspace" />}
    </div>

    {controlBoardOpen && <section className="fp-control-board" role="dialog" aria-modal="false" aria-labelledby="fp-control-board-title">
      <header>
        <div><small>RUN</small><strong id="fp-control-board-title">Run files</strong></div>
        <button type="button" aria-label="Close Run checklist" onClick={onCloseControlBoard}><Icon name="close" /></button>
      </header>
      <p>Run the connected pair together, or control either side independently.</p>
      <div className="fp-control-status">
        <span><i className="fp-connection-dot fp-connection-dot--scratch" />Scratch · {scratch.status}</span>
        <span><i className="fp-connection-dot fp-connection-dot--python" />Python · {pythonRuntime.statusLabel}</span>
        {coordinatedRunning && <span>Coordinated frame {coordinatedFrame}</span>}
      </div>
      <div className="fp-control-actions">
        <button type="button" disabled={!scratch.ready || pythonBusy} onClick={() => void startBoth()}><Icon name="play" />Run both</button>
        <button type="button" disabled={!scratch.ready} onClick={toggleScratch}><Icon name={scratch.running ? 'stop' : 'play'} />{scratch.running ? 'Stop Scratch' : 'Run Scratch'}</button>
        <button type="button" disabled={pythonBusy} onClick={() => void togglePython()}><Icon name={pythonRuntime.running ? 'stop' : 'play'} />{pythonRuntime.running ? 'Stop Python' : 'Run Python'}</button>
        <button type="button" disabled={!anyRunning} onClick={() => void stopAll()}><Icon name="stop" />Stop all</button>
      </div>
      <footer title={result.warnings.join('\n')}>{runtimeMessage}</footer>
    </section>}
  </div>
}

export default function FocusedApp(): React.JSX.Element {
  const [result, setResult] = useState<ConversionResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const openProject = useCallback(async (project: ProjectSelection, browserFile?: File): Promise<void> => {
    setError('')
    setLoading(true)
    try {
      const next = window.parrot
        ? await window.parrot.openProject(project.id)
        : {
            project,
            python: FALLBACK_PYTHON,
            runtimeProjectId: 'browser-preview',
            message: 'Open this project in Electron to use conversion and Python execution.',
            warnings: [],
            scratchProject: browserFile ? new Uint8Array(await browserFile.arrayBuffer()) : new Uint8Array()
          }
      setResult(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parrot could not open that project.')
    } finally {
      setLoading(false)
    }
  }, [])

  const openFile = useCallback(async (file: File): Promise<void> => {
    if (!file.name.toLowerCase().endsWith('.sb3')) {
      setError('Choose a Scratch 3 project ending in .sb3.')
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
  }, [openProject])

  const chooseProject = useCallback(async (): Promise<void> => {
    if (!window.parrot) {
      inputRef.current?.click()
      return
    }
    setError('')
    try {
      const project = await window.parrot.selectScratchFile()
      if (project) await openProject(project)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parrot could not read that file.')
    }
  }, [openProject])

  const dropProject = (event: DragEvent<HTMLElement>): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void openFile(file)
  }

  return <>
    <input
      ref={inputRef}
      hidden
      type="file"
      accept=".sb3"
      onChange={(event) => {
        const file = event.target.files?.[0]
        if (file) void openFile(file)
        event.currentTarget.value = ''
      }}
    />
    <FocusedShell
      key={result?.project.id ?? 'empty'}
      result={result}
      loading={loading}
      error={error}
      dragging={dragging}
      onChooseProject={() => void chooseProject()}
      onDropProject={dropProject}
      onDragState={setDragging}
    />
  </>
}
