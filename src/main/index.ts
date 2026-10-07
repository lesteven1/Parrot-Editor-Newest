import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type {
  ConversionResult,
  ImportedPythonTab,
  ImportedScratchTab,
  NewPythonTab,
  ProjectSelection,
  PythonConversion,
  PythonExportResult,
  PythonRunRequest,
  PythonRuntimeStart,
  WorkspaceFileOpenResult,
  WorkspaceSelection
} from '../shared/project'
import { convertScratchToPython } from './converter'
import { clearScratchProjects, registerScratchProject, resolveScratchProject } from './project-store'
import { PythonRuntimeManager } from './python-runtime'
import { RuntimeProjectStore } from './runtime-project-store'
import { WorkspaceStore } from './workspace-store'

let mainWindow: BrowserWindow | null = null
const pythonRuntime = new PythonRuntimeManager()
const runtimeProjects = new RuntimeProjectStore()
const workspaces = new WorkspaceStore()
const MAX_SCRATCH_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_PYTHON_SOURCE_BYTES = 8 * 1024 * 1024
const NEW_PYTHON_SOURCE = `# New Parrot Base V0.3.1.motion project.
# Requires the bundled Parrot runtime.

from parrot import Project

project = Project()

@project.when_green_flag
async def when_green_flag():
    # Add readable project logic here.
    pass

project.run()
`

function assertTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== event.sender.mainFrame) {
    throw new Error('Parrot rejected an unexpected renderer request.')
  }
}

function pythonFilename(projectName: string): string {
  const base = projectName.replace(/\.sb3$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'parrot-project'
  return `${base}.py`
}

function convertProject(scratchProject: Uint8Array): PythonConversion {
  const conversion = convertScratchToPython(scratchProject)
  return {
    python: conversion.python,
    runtimeProjectId: runtimeProjects.register(conversion.runtime),
    message: conversion.warnings.length
      ? `Converted ${conversion.convertedBlockCount} blocks with ${conversion.warnings.length} warning${conversion.warnings.length === 1 ? '' : 's'}.`
      : `Converted ${conversion.convertedBlockCount} supported blocks to Python.`,
    warnings: conversion.warnings
  }
}

function registerEmptyRuntimeProject(): string {
  return runtimeProjects.register({
    manifest: { version: 1, targets: [], variables: [] },
    assets: []
  })
}

async function registerWorkspaceFolder(path: string): Promise<WorkspaceSelection> {
  let item: Awaited<ReturnType<typeof stat>>
  try {
    item = await stat(path)
  } catch {
    throw new Error('Parrot could not access that folder.')
  }
  if (!item.isDirectory()) throw new Error('Choose a folder to add to Parrot.')
  return workspaces.register(path)
}

async function readPythonSource(path: string, name: string): Promise<string> {
  let file: Awaited<ReturnType<typeof stat>>
  try {
    file = await stat(path)
  } catch {
    throw new Error(`Parrot could not access ${name}.`)
  }
  if (!file.isFile()) throw new Error(`Choose a Python .py file, not a folder.`)
  if (file.size > MAX_PYTHON_SOURCE_BYTES) throw new Error('Python source must be smaller than 8 MB.')
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    throw new Error(`Parrot could not read ${name}.`)
  }
  if (bytes.byteLength > MAX_PYTHON_SOURCE_BYTES) {
    throw new Error('Python source must be smaller than 8 MB.')
  }
  let python: string
  try {
    python = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${name} is not valid UTF-8 text.`)
  }
  if (python.includes('\0')) throw new Error(`${name} contains unsupported null bytes.`)
  return python
}

function validateScratchArchiveBytes(value: unknown): Uint8Array {
  let scratchProject: Uint8Array
  if (value instanceof Uint8Array) {
    scratchProject = new Uint8Array(value)
  } else if (value instanceof ArrayBuffer) {
    scratchProject = new Uint8Array(value.slice(0))
  } else if (ArrayBuffer.isView(value)) {
    scratchProject = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
  } else {
    throw new Error('Parrot received an invalid Scratch project snapshot.')
  }

  if (scratchProject.byteLength < 4) throw new Error('The Scratch project snapshot is empty.')
  if (scratchProject.byteLength > MAX_SCRATCH_ARCHIVE_BYTES) {
    throw new Error('Scratch project snapshots must be smaller than 100 MB.')
  }
  if (scratchProject[0] !== 0x50 || scratchProject[1] !== 0x4b) {
    throw new Error('That file has an .sb3 extension but is not a Scratch project archive.')
  }
  return scratchProject
}

function createWindow(): void {
  nativeTheme.themeSource = 'light'
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#f7f8fa',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 12, y: 10 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      zoomFactor: 1
    }
  })

  const lockRendererZoom = (): void => {
    mainWindow?.webContents.setZoomFactor(1)
  }
  lockRendererZoom()
  mainWindow.webContents.on('did-finish-load', lockRendererZoom)
  mainWindow.webContents.on('zoom-changed', (event) => {
    event.preventDefault()
    lockRendererZoom()
  })
  void mainWindow.webContents.setVisualZoomLevelLimits(1, 1)

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreenChanged', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreenChanged', false)
  })

  mainWindow.on('closed', () => {
    void pythonRuntime.stopActive()
    clearScratchProjects()
    workspaces.clear()
    runtimeProjects.clear()
    mainWindow = null
  })
}

ipcMain.handle('window:isFullscreen', (event): boolean => {
  assertTrustedSender(event)
  return mainWindow?.isFullScreen() ?? false
})

ipcMain.handle('project:selectScratchFile', async (event): Promise<ProjectSelection | null> => {
  assertTrustedSender(event)
  const result = await dialog.showOpenDialog({
    title: 'Open a Scratch project',
    properties: ['openFile'],
    filters: [{ name: 'Scratch 3 project', extensions: ['sb3'] }]
  })

  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  return registerScratchProject(path)
})

ipcMain.handle(
  'project:registerDroppedScratchFile',
  async (event, path: unknown): Promise<ProjectSelection> => {
    assertTrustedSender(event)
    if (typeof path !== 'string') throw new Error('Parrot could not identify that dropped file.')
    return registerScratchProject(path)
  }
)

ipcMain.handle(
  'project:open',
  async (event, projectId: unknown): Promise<ConversionResult> => {
    assertTrustedSender(event)
    if (typeof projectId !== 'string') throw new Error('Choose a Scratch project before opening it.')
    const stored = await resolveScratchProject(projectId)
    const scratchProject = new Uint8Array(await readFile(stored.path))
    const conversion = convertProject(scratchProject)
    return {
      project: { id: stored.id, name: stored.name, size: stored.size },
      ...conversion,
      scratchProject
    }
  }
)

ipcMain.handle(
  'project:updatePython',
  async (event, archive: unknown): Promise<PythonConversion> => {
    assertTrustedSender(event)
    return convertProject(validateScratchArchiveBytes(archive))
  }
)

ipcMain.handle('project:createPythonTab', (event): NewPythonTab => {
  assertTrustedSender(event)
  return {
    python: NEW_PYTHON_SOURCE,
    runtimeProjectId: registerEmptyRuntimeProject()
  }
})

ipcMain.handle('workspace:selectItem', async (event): Promise<WorkspaceSelection | null> => {
  assertTrustedSender(event)
  const options = {
    title: 'Add a folder to Parrot',
    buttonLabel: 'Add Folder',
    properties: ['openDirectory'] as Array<'openDirectory'>
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  return registerWorkspaceFolder(path)
})

ipcMain.handle(
  'workspace:registerDroppedItem',
  async (event, path: unknown): Promise<WorkspaceSelection> => {
    assertTrustedSender(event)
    if (typeof path !== 'string' || !path) throw new Error('Parrot could not identify that dropped folder.')
    return registerWorkspaceFolder(path)
  }
)

ipcMain.handle(
  'workspace:openFile',
  async (event, workspaceId: unknown, fileId: unknown): Promise<WorkspaceFileOpenResult> => {
    assertTrustedSender(event)
    if (typeof workspaceId !== 'string' || typeof fileId !== 'string') {
      throw new Error('Parrot received an invalid folder file reference.')
    }
    const pair = await workspaces.resolveProgramPair(workspaceId, fileId)
    let scratchProject: Uint8Array | undefined
    let conversion: PythonConversion | undefined
    if (pair.scratch?.path) {
      let bytes: Buffer
      try {
        bytes = await readFile(pair.scratch.path)
      } catch {
        throw new Error(`Parrot could not read ${pair.scratch.name}.`)
      }
      scratchProject = validateScratchArchiveBytes(bytes)
      if (pair.python) conversion = convertProject(scratchProject)
    }

    const programs: WorkspaceFileOpenResult['programs'] = []
    if (pair.scratch && scratchProject) {
      programs.push({
        id: pair.scratch.id,
        kind: 'scratch',
        name: pair.scratch.name,
        scratchProject
      })
    }
    if (pair.python) {
      const python = pair.python.path
        ? await readPythonSource(pair.python.path, pair.python.name)
        : undefined
      if (python === undefined) throw new Error(`Parrot could not open ${pair.python.name}.`)
      programs.push({
        id: pair.python.id,
        kind: 'python',
        name: pair.python.name,
        python,
        runtimeProjectId: conversion?.runtimeProjectId ?? registerEmptyRuntimeProject(),
        codeUpToDate: false
      })
    }

    return {
      requestedFileId: fileId,
      programs,
      connection: pair.scratch && pair.python
        ? { scratchId: pair.scratch.id, pythonId: pair.python.id }
        : undefined
    }
  }
)

ipcMain.handle('workspace:close', (event, workspaceId: unknown): void => {
  assertTrustedSender(event)
  if (typeof workspaceId === 'string') workspaces.close(workspaceId)
})

ipcMain.handle('project:selectPythonTabFile', async (event): Promise<ImportedPythonTab | null> => {
  assertTrustedSender(event)
  const result = await dialog.showOpenDialog({
    title: 'Upload Python into a new tab',
    properties: ['openFile'],
    filters: [{ name: 'Python source', extensions: ['py'] }]
  })
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  if (extname(path).toLowerCase() !== '.py') throw new Error('Parrot can only upload Python .py files.')

  let file: Awaited<ReturnType<typeof stat>>
  try {
    file = await stat(path)
  } catch {
    throw new Error('Parrot could not access that Python file.')
  }
  if (!file.isFile()) throw new Error('Choose a Python .py file, not a folder.')
  if (file.size > MAX_PYTHON_SOURCE_BYTES) throw new Error('Python source must be smaller than 8 MB.')
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    throw new Error('Parrot could not read that Python file.')
  }
  if (bytes.byteLength > MAX_PYTHON_SOURCE_BYTES) {
    throw new Error('Python source must be smaller than 8 MB.')
  }
  let python: string
  try {
    python = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('That Python file is not valid UTF-8 text.')
  }
  if (python.includes('\0')) throw new Error('That Python file contains unsupported null bytes.')
  return { name: basename(path), python, runtimeProjectId: registerEmptyRuntimeProject() }
})

ipcMain.handle('project:selectScratchTabFile', async (event): Promise<ImportedScratchTab | null> => {
  assertTrustedSender(event)
  const result = await dialog.showOpenDialog({
    title: 'Upload Scratch into a new tab',
    properties: ['openFile'],
    filters: [{ name: 'Scratch 3 project', extensions: ['sb3'] }]
  })
  const path = result.filePaths[0]
  if (result.canceled || !path) return null
  if (extname(path).toLowerCase() !== '.sb3') throw new Error('Parrot can only upload Scratch .sb3 files.')

  let file: Awaited<ReturnType<typeof stat>>
  try {
    file = await stat(path)
  } catch {
    throw new Error('Parrot could not access that Scratch project.')
  }
  if (!file.isFile()) throw new Error('Choose a Scratch .sb3 file, not a folder.')
  if (file.size > MAX_SCRATCH_ARCHIVE_BYTES) {
    throw new Error('Scratch project snapshots must be smaller than 100 MB.')
  }
  let bytes: Buffer
  try {
    bytes = await readFile(path)
  } catch {
    throw new Error('Parrot could not read that Scratch project.')
  }
  const scratchProject = validateScratchArchiveBytes(bytes)
  return { name: basename(path), scratchProject }
})

ipcMain.handle('python:start', async (event, request: unknown): Promise<PythonRuntimeStart> => {
  assertTrustedSender(event)
  const candidate = request as Partial<PythonRunRequest> | null
  if (!candidate || typeof candidate.runtimeProjectId !== 'string') {
    throw new Error('Parrot received an invalid Python project reference.')
  }
  return pythonRuntime.start(event.sender, candidate as PythonRunRequest, runtimeProjects.resolve(candidate.runtimeProjectId))
})

ipcMain.handle('python:stop', async (event, sessionId: unknown): Promise<void> => {
  assertTrustedSender(event)
  if (typeof sessionId !== 'string') return
  await pythonRuntime.stop(sessionId)
})

ipcMain.on('python:key', (event, sessionId: unknown, key: unknown, isDown: unknown) => {
  assertTrustedSender(event)
  if (typeof sessionId === 'string' && typeof key === 'string' && typeof isDown === 'boolean') {
    pythonRuntime.sendKey(sessionId, key, isDown)
  }
})

ipcMain.on('python:mouse', (event, sessionId: unknown, x: unknown, y: unknown, isDown: unknown) => {
  assertTrustedSender(event)
  if (
    typeof sessionId === 'string' && typeof x === 'number' && typeof y === 'number' &&
    Number.isFinite(x) && Number.isFinite(y) && typeof isDown === 'boolean'
  ) {
    pythonRuntime.sendMouse(sessionId, x, y, isDown)
  }
})

ipcMain.on('python:tick', (
  event,
  sessionId: unknown,
  sequence: unknown,
  keysDown: unknown,
  mouse: unknown,
  motionGeometry: unknown
) => {
  assertTrustedSender(event)
  const pointer = mouse as { x?: unknown; y?: unknown; isDown?: unknown } | null
  if (
    typeof sessionId === 'string' && typeof sequence === 'number' && Number.isSafeInteger(sequence) &&
    Array.isArray(keysDown) && keysDown.length <= 64 && keysDown.every((key) => typeof key === 'string') &&
    pointer && typeof pointer.x === 'number' && Number.isFinite(pointer.x) &&
    typeof pointer.y === 'number' && Number.isFinite(pointer.y) && typeof pointer.isDown === 'boolean'
  ) {
    pythonRuntime.sendTick(sessionId, sequence, keysDown, {
      x: pointer.x, y: pointer.y, isDown: pointer.isDown
    }, motionGeometry)
  }
})

ipcMain.on('python:clockMode', (event, sessionId: unknown, clockMode: unknown) => {
  assertTrustedSender(event)
  if (typeof sessionId === 'string' && (clockMode === 'internal' || clockMode === 'paused')) {
    pythonRuntime.setClockMode(sessionId, clockMode)
  }
})

ipcMain.handle(
  'python:export',
  async (event, projectName: unknown, source: unknown): Promise<PythonExportResult> => {
    assertTrustedSender(event)
    if (typeof projectName !== 'string' || typeof source !== 'string') {
      throw new Error('Parrot received an invalid Python export request.')
    }
    if (Buffer.byteLength(source, 'utf8') > 8 * 1024 * 1024) {
      throw new Error('Python source must be smaller than 8 MB.')
    }
    const options = {
      title: 'Export Python project',
      defaultPath: pythonFilename(projectName),
      filters: [{ name: 'Python source', extensions: ['py'] }]
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false }
    const path = extname(result.filePath).toLowerCase() === '.py' ? result.filePath : `${result.filePath}.py`
    await writeFile(path, source, { encoding: 'utf8', mode: 0o600 })
    return { saved: true, name: basename(path) }
  }
)

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  runtimeProjects.clear()
  if (process.platform !== 'darwin') app.quit()
})
