import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ConversionResult,
  ImportedPythonTab,
  ImportedScratchTab,
  NewPythonTab,
  ParrotApi,
  ProjectSelection,
  PythonConversion,
  PythonExportResult,
  PythonRunRequest,
  PythonRuntimeEvent,
  PythonRuntimeStart,
  ScratchMotionGeometry
} from '../shared/project'

const api: ParrotApi = {
  getWindowFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:isFullscreen'),
  onWindowFullscreenChange: (listener: (fullscreen: boolean) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, fullscreen: boolean): void => listener(fullscreen)
    ipcRenderer.on('window:fullscreenChanged', handler)
    return () => ipcRenderer.removeListener('window:fullscreenChanged', handler)
  },
  selectScratchFile: () => ipcRenderer.invoke('project:selectScratchFile'),
  registerDroppedScratchFile: (file: File): Promise<ProjectSelection> => {
    const path = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('project:registerDroppedScratchFile', path)
  },
  openProject: (projectId: string): Promise<ConversionResult> =>
    ipcRenderer.invoke('project:open', projectId),
  updatePythonFromScratch: (scratchProject: Uint8Array): Promise<PythonConversion> =>
    ipcRenderer.invoke('project:updatePython', scratchProject),
  createPythonTab: (): Promise<NewPythonTab> => ipcRenderer.invoke('project:createPythonTab'),
  selectPythonTabFile: (): Promise<ImportedPythonTab | null> =>
    ipcRenderer.invoke('project:selectPythonTabFile'),
  selectScratchTabFile: (): Promise<ImportedScratchTab | null> =>
    ipcRenderer.invoke('project:selectScratchTabFile'),
  selectWorkspaceItem: () => ipcRenderer.invoke('workspace:selectItem'),
  registerDroppedWorkspaceItem: (file: File) => {
    const path = webUtils.getPathForFile(file)
    return ipcRenderer.invoke('workspace:registerDroppedItem', path)
  },
  openWorkspaceFile: (workspaceId: string, fileId: string) =>
    ipcRenderer.invoke('workspace:openFile', workspaceId, fileId),
  closeWorkspace: (workspaceId: string): Promise<void> =>
    ipcRenderer.invoke('workspace:close', workspaceId),
  startPython: (request: PythonRunRequest): Promise<PythonRuntimeStart> =>
    ipcRenderer.invoke('python:start', request),
  stopPython: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke('python:stop', sessionId),
  sendPythonKey: (sessionId: string, key: string, isDown: boolean): void =>
    ipcRenderer.send('python:key', sessionId, key, isDown),
  sendPythonMouse: (sessionId: string, x: number, y: number, isDown: boolean): void =>
    ipcRenderer.send('python:mouse', sessionId, x, y, isDown),
  sendPythonTick: (
    sessionId: string,
    sequence: number,
    keysDown: string[],
    mouse: { x: number; y: number; isDown: boolean },
    motionGeometry?: ScratchMotionGeometry
  ): void => ipcRenderer.send('python:tick', sessionId, sequence, keysDown, mouse, motionGeometry),
  setPythonClockMode: (sessionId: string, clockMode: 'internal' | 'paused'): void =>
    ipcRenderer.send('python:clockMode', sessionId, clockMode),
  exportPython: (projectName: string, source: string): Promise<PythonExportResult> =>
    ipcRenderer.invoke('python:export', projectName, source),
  onPythonEvent: (listener: (event: PythonRuntimeEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PythonRuntimeEvent): void => listener(payload)
    ipcRenderer.on('python:event', handler)
    return () => ipcRenderer.removeListener('python:event', handler)
  }
}

contextBridge.exposeInMainWorld('parrot', api)
