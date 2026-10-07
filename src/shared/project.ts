export interface ProjectSelection {
  id: string
  name: string
  size: number
}

export type WorkspaceFileKind = 'scratch' | 'python' | 'other'

export interface WorkspaceFileEntry {
  type: 'file'
  id: string
  name: string
  fileKind: WorkspaceFileKind
}

export interface WorkspaceFolderEntry {
  type: 'folder'
  id: string
  name: string
  children: WorkspaceEntry[]
}

export type WorkspaceEntry = WorkspaceFileEntry | WorkspaceFolderEntry

export interface WorkspaceSelection {
  project: ProjectSelection
  root: WorkspaceFolderEntry
}

export interface PythonConversion {
  python: string
  runtimeProjectId: string
  message: string
  warnings: string[]
}

export interface NewPythonTab {
  python: string
  runtimeProjectId: string
}

export interface ImportedPythonTab extends NewPythonTab {
  name: string
}

export interface ImportedScratchTab {
  name: string
  scratchProject: Uint8Array
}

export type WorkspaceProgram =
  | {
      id: string
      kind: 'scratch'
      name: string
      scratchProject: Uint8Array
    }
  | {
      id: string
      kind: 'python'
      name: string
      python: string
      runtimeProjectId: string
      codeUpToDate: boolean
    }

export interface WorkspaceFileOpenResult {
  requestedFileId: string
  programs: WorkspaceProgram[]
  connection?: {
    scratchId: string
    pythonId: string
  }
}

export interface ConversionResult extends PythonConversion {
  project: ProjectSelection
  scratchProject: Uint8Array
}

export interface PythonRunRequest {
  source: string
  projectName: string
  runtimeProjectId: string
  clockMode: 'internal' | 'scratch'
}

export interface PythonRuntimeStart {
  sessionId: string
}

export interface PythonSpriteMotionState {
  name: string
  x: number
  y: number
  direction: number
}

export interface PythonFrameState {
  sprites: PythonSpriteMotionState[]
}

export interface ScratchMotionGeometrySprite {
  name: string
  skinSize: [number, number]
  rotationCenter: [number, number]
  hullPoints: Array<[number, number]>
}

export interface ScratchMotionGeometry {
  sprites: ScratchMotionGeometrySprite[]
}

export type PythonRuntimeEvent =
  | { sessionId: string; type: 'started' }
  | { sessionId: string; type: 'frame'; sequence: number; dataUrl: string; state: PythonFrameState }
  | { sessionId: string; type: 'output'; text: string; stream: 'stdout' | 'stderr' }
  | { sessionId: string; type: 'stopped'; exitCode: number | null; error?: string }

export interface PythonExportResult {
  saved: boolean
  name?: string
}

export interface ParrotApi {
  getWindowFullscreen: () => Promise<boolean>
  onWindowFullscreenChange: (listener: (fullscreen: boolean) => void) => () => void
  selectScratchFile: () => Promise<ProjectSelection | null>
  registerDroppedScratchFile: (file: File) => Promise<ProjectSelection>
  openProject: (projectId: string) => Promise<ConversionResult>
  updatePythonFromScratch: (scratchProject: Uint8Array) => Promise<PythonConversion>
  createPythonTab: () => Promise<NewPythonTab>
  selectPythonTabFile: () => Promise<ImportedPythonTab | null>
  selectScratchTabFile: () => Promise<ImportedScratchTab | null>
  selectWorkspaceItem: () => Promise<WorkspaceSelection | null>
  registerDroppedWorkspaceItem: (file: File) => Promise<WorkspaceSelection>
  openWorkspaceFile: (workspaceId: string, fileId: string) => Promise<WorkspaceFileOpenResult>
  closeWorkspace: (workspaceId: string) => Promise<void>
  startPython: (request: PythonRunRequest) => Promise<PythonRuntimeStart>
  stopPython: (sessionId: string) => Promise<void>
  sendPythonKey: (sessionId: string, key: string, isDown: boolean) => void
  sendPythonMouse: (sessionId: string, x: number, y: number, isDown: boolean) => void
  sendPythonTick: (
    sessionId: string,
    sequence: number,
    keysDown: string[],
    mouse: { x: number; y: number; isDown: boolean },
    motionGeometry?: ScratchMotionGeometry
  ) => void
  setPythonClockMode: (sessionId: string, clockMode: 'internal' | 'paused') => void
  exportPython: (projectName: string, source: string) => Promise<PythonExportResult>
  onPythonEvent: (listener: (event: PythonRuntimeEvent) => void) => () => void
}
