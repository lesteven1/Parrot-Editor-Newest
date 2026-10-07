import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import VirtualMachine from '@scratch/scratch-vm'
import ScratchRender from '@scratch/scratch-render'
import { BitmapAdapter } from '@scratch/scratch-svg-renderer'
import { ScratchStorage } from '@scratch/scratch-storage'
import AudioEngine from 'scratch-audio'
import { buildBlankProject } from './defaultProject'
import { selectScratchTarget, type ScratchVmEditorContract } from './editor-model'
import type { PythonFrameState, ScratchMotionGeometry } from '../../../shared/project'
import type { CoordinatedInputSnapshot, CoordinatedScratchFrame } from '../runtime/frame-coordinator'
import { configureLocalScratchLibrary } from './library-assets'

export interface ScratchTargetInfo {
  id: string
  name: string
  isStage: boolean
}

export interface ScratchRuntimeController {
  outputCanvasRef: RefObject<HTMLCanvasElement>
  vm: VirtualMachine | null
  storage: ScratchStorage | null
  ready: boolean
  running: boolean
  paused: boolean
  status: string
  error: string
  initialFrameDataUrl: string
  blockCount: number
  targets: ScratchTargetInfo[]
  editingTargetId: string | null
  run: () => void
  startCoordinated: () => boolean
  continueStandalone: () => void
  pause: () => void
  resume: () => void
  captureInput: () => CoordinatedInputSnapshot
  stepCoordinated: (sequence: number, input: CoordinatedInputSnapshot) => CoordinatedScratchFrame
  stop: () => void
  selectTarget: (targetId: string) => void
  snapshot: () => Promise<{ projectBytes: Uint8Array; frameDataUrl: string }>
  save: () => Promise<void>
}

interface ScratchTargetBaseline {
  id: string
  x: number
  y: number
  direction: number
  rotationStyle: string
  visible: boolean
  variables: Record<string, unknown>
}

interface RuntimeTarget {
  id: string
  isStage: boolean
  isOriginal?: boolean
  x: number
  y: number
  direction: number
  rotationStyle: string
  visible: boolean
  drawableID: number | null
  variables: Record<string, { value: unknown }>
  blocks?: { _blocks?: Record<string, { shadow?: boolean }> }
  getName: () => string
  setXY: (x: number, y: number, force?: boolean) => void
  setDirection: (direction: number) => void
  setRotationStyle: (style: string) => void
  setVisible: (visible: boolean) => void
}

interface RuntimeAdapter {
  targets: RuntimeTarget[]
  _step: () => void
  requestTargetsUpdate: (target: unknown) => void
  getTargetForStage: () => RuntimeTarget | null
  sequencer?: { timer?: { nowObj: { now: () => number } } }
}

interface VmAdapter {
  initialized?: boolean
  editingTarget?: RuntimeTarget | null
  postIOData: (device: string, data: Record<string, unknown>) => void
  setCompatibilityMode: (enabled: boolean) => void
  emitTargetsUpdate: (triggerProjectChange: boolean) => void
  refreshWorkspace: () => void
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void
}

function runtimeFor(vm: VirtualMachine): RuntimeAdapter {
  return vm.runtime as unknown as RuntimeAdapter
}

function captureMotionState(vm: VirtualMachine): PythonFrameState {
  return {
    sprites: runtimeFor(vm).targets
      .filter((target) => !target.isStage && target.isOriginal !== false)
      .map((target) => ({
        name: target.getName(),
        x: target.x,
        y: target.y,
        direction: target.direction
      }))
  }
}

function captureMotionGeometry(vm: VirtualMachine, renderer: ScratchRender): ScratchMotionGeometry {
  const privateRenderer = renderer as unknown as {
    getBounds: (drawableId: number) => unknown
    _allDrawables: Record<number, {
      skin: { size: ArrayLike<number>; rotationCenter: ArrayLike<number> }
      _convexHullPoints: Array<[number, number]> | null
    }>
  }
  return {
    sprites: runtimeFor(vm).targets.flatMap((target) => {
      if (target.isStage || target.isOriginal === false || target.drawableID === null) return []
      privateRenderer.getBounds(target.drawableID)
      const drawable = privateRenderer._allDrawables[target.drawableID]
      if (!drawable?.skin) return []
      const skinSize: [number, number] = [Number(drawable.skin.size[0]), Number(drawable.skin.size[1])]
      const rotationCenter: [number, number] = [
        Number(drawable.skin.rotationCenter[0]), Number(drawable.skin.rotationCenter[1])
      ]
      const hullPoints = (drawable._convexHullPoints ?? [])
        .slice(0, 8_192)
        .map(([x, y]): [number, number] => [Number(x), Number(y)])
      return [{ name: target.getName(), skinSize, rotationCenter, hullPoints }]
    })
  }
}

function captureTargetBaseline(vm: VirtualMachine): ScratchTargetBaseline[] {
  return runtimeFor(vm).targets.map((target) => ({
    id: target.id,
    x: target.x,
    y: target.y,
    direction: target.direction,
    rotationStyle: target.rotationStyle,
    visible: target.visible,
    variables: Object.fromEntries(
      Object.entries(target.variables).map(([id, variable]) => [id, variable.value])
    )
  }))
}

function restoreTargetBaseline(vm: VirtualMachine, baseline: ScratchTargetBaseline[]): void {
  const runtime = runtimeFor(vm)
  const baselineById = new Map(baseline.map((target) => [target.id, target]))
  for (const target of runtime.targets) {
    const initial = baselineById.get(target.id)
    if (!initial) continue
    if (!target.isStage) {
      target.setRotationStyle(initial.rotationStyle)
      target.setDirection(initial.direction)
      target.setXY(initial.x, initial.y, true)
      target.setVisible(initial.visible)
    }
    for (const [id, value] of Object.entries(initial.variables)) {
      if (target.variables[id]) target.variables[id].value = value
    }
    runtime.requestTargetsUpdate(target)
  }
}

function targetInfo(vm: VirtualMachine): ScratchTargetInfo[] {
  return runtimeFor(vm).targets
    .filter((target) => target.isOriginal !== false)
    .map((target) => ({ id: target.id, name: target.getName(), isStage: target.isStage }))
}

function blockCount(vm: VirtualMachine): number {
  return runtimeFor(vm).targets.reduce((count, target) => count + Object.values(
    target.blocks?._blocks ?? {}
  ).filter((block) => !block.shadow).length, 0)
}

function keyCodeFor(key: string): number {
  if (key.length === 1) return key.toUpperCase().charCodeAt(0)
  return ({
    ArrowLeft: 37,
    ArrowUp: 38,
    ArrowRight: 39,
    ArrowDown: 40,
    Enter: 13,
    ' ': 32
  } as Record<string, number>)[key] ?? 0
}

async function rendererSnapshot(renderer: ScratchRender | null): Promise<string> {
  const snapshotRenderer = renderer as unknown as {
    requestSnapshot?: (callback: (dataUrl: string) => void) => void
  } | null
  if (!snapshotRenderer?.requestSnapshot) return ''
  return new Promise<string>((resolve) => {
    const timeout = window.setTimeout(() => resolve(''), 1_000)
    snapshotRenderer.requestSnapshot?.((dataUrl) => {
      window.clearTimeout(timeout)
      resolve(dataUrl)
    })
  })
}

function releaseRendererContext(renderer: ScratchRender, canvas: HTMLCanvasElement): void {
  const gl = (renderer as unknown as {
    gl?: WebGLRenderingContext | WebGL2RenderingContext
  }).gl
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  canvas.width = 0
  canvas.height = 0
}

export function useScratchRuntime(
  projectBytes: Uint8Array,
  projectName: string,
  projectKey: string,
  enabled = true,
  onProjectChange?: () => void
): ScratchRuntimeController {
  const outputCanvasRef = useRef<HTMLCanvasElement>(null)
  const vmRef = useRef<VirtualMachine | null>(null)
  const rendererRef = useRef<ScratchRender | null>(null)
  const originalPostIODataRef = useRef<((device: string, data: Record<string, unknown>) => void) | null>(null)
  const coordinatedBaselineRef = useRef<ScratchTargetBaseline[]>([])
  const coordinatedGeometryRef = useRef<ScratchMotionGeometry | undefined>(undefined)
  const runningRef = useRef(false)
  const coordinatedRef = useRef(false)
  const pausedRef = useRef(false)
  const originalRuntimeStepRef = useRef<(() => void) | null>(null)
  const desiredKeysRef = useRef(new Map<string, number>())
  const postedKeysRef = useRef(new Map<string, number>())
  const desiredPointerRef = useRef({ x: 0, y: 0, isDown: false })
  const projectBytesRef = useRef(projectBytes)
  projectBytesRef.current = projectBytes
  const onProjectChangeRef = useRef(onProjectChange)
  onProjectChangeRef.current = onProjectChange
  const [vm, setVm] = useState<VirtualMachine | null>(null)
  const [storage, setStorage] = useState<ScratchStorage | null>(null)
  const [ready, setReady] = useState(false)
  const [running, setRunning] = useState(false)
  const [paused, setPaused] = useState(false)
  const [status, setStatus] = useState('Starting Scratch VM…')
  const [error, setError] = useState('')
  const [initialFrameDataUrl, setInitialFrameDataUrl] = useState('')
  const [visibleBlockCount, setVisibleBlockCount] = useState(0)
  const [targets, setTargets] = useState<ScratchTargetInfo[]>([])
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return

    setReady(false)
    setRunning(false)
    setPaused(false)
    setError('')
    setStatus('Starting Scratch VM…')
    setInitialFrameDataUrl('')
    setTargets([])
    setEditingTargetId(null)

    let disposed = false
    let projectLoaded = false
    const baseVm = new VirtualMachine()
    const scratchVm = baseVm as unknown as VmAdapter & VirtualMachine
    const rendererCanvas = document.createElement('canvas')
    rendererCanvas.width = 480
    rendererCanvas.height = 360
    const renderer = new ScratchRender(rendererCanvas)
    renderer.resize(480, 360)
    const drawableRenderer = renderer as unknown as {
      canvas?: HTMLCanvasElement
      draw: () => void
    }
    const drawRenderer = drawableRenderer.draw.bind(drawableRenderer)
    drawableRenderer.draw = (): void => {
      drawRenderer()
      const mirror = outputCanvasRef.current
      const source = drawableRenderer.canvas ?? rendererCanvas
      if (!mirror || source.width <= 0 || source.height <= 0) return
      const context = mirror.getContext('2d')
      if (!context) return
      context.clearRect(0, 0, mirror.width, mirror.height)
      context.drawImage(source, 0, 0, mirror.width, mirror.height)
    }
    const audioEngine = new AudioEngine()
    const scratchStorage = new ScratchStorage()
    configureLocalScratchLibrary(scratchStorage)

    scratchVm.attachRenderer(renderer)
    scratchVm.attachAudioEngine(audioEngine)
    scratchVm.attachStorage(scratchStorage)
    scratchVm.attachV2BitmapAdapter(new BitmapAdapter())
    scratchVm.setCompatibilityMode(true)
    scratchVm.initialized = true
    vmRef.current = baseVm
    rendererRef.current = renderer
    setVm(baseVm)
    setStorage(scratchStorage)

    const originalPostIOData = scratchVm.postIOData.bind(scratchVm)
    originalPostIODataRef.current = originalPostIOData
    scratchVm.postIOData = (device, data): void => {
      if (device === 'keyboard') {
        const key = typeof data.key === 'string' ? data.key : String(data.keyCode ?? '')
        const code = typeof data.keyCode === 'number' ? data.keyCode : keyCodeFor(key)
        if (data.isDown) desiredKeysRef.current.set(key, code)
        else desiredKeysRef.current.delete(key)
      } else if (device === 'mouse') {
        const width = Math.max(1, Number(data.canvasWidth ?? 480))
        const height = Math.max(1, Number(data.canvasHeight ?? 360))
        const x = Number(data.x ?? width / 2)
        const y = Number(data.y ?? height / 2)
        desiredPointerRef.current = {
          x: Math.max(-240, Math.min(240, (x / width) * 480 - 240)),
          y: Math.max(-180, Math.min(180, 180 - (y / height) * 360)),
          isDown: Boolean(data.isDown)
        }
      }
      if (!coordinatedRef.current) originalPostIOData(device, data)
    }

    const updateProjectUi = (): void => {
      if (disposed) return
      setTargets(targetInfo(baseVm))
      setEditingTargetId(scratchVm.editingTarget?.id ?? null)
      setVisibleBlockCount(blockCount(baseVm))
    }
    const workspaceUpdate = (): void => updateProjectUi()
    const targetsUpdate = (): void => updateProjectUi()
    const projectChanged = (): void => {
      if (!projectLoaded || disposed) return
      updateProjectUi()
      if (!runningRef.current) coordinatedBaselineRef.current = captureTargetBaseline(baseVm)
      onProjectChangeRef.current?.()
    }
    const runStart = (): void => {
      runningRef.current = true
      pausedRef.current = false
      setPaused(false)
      setRunning(true)
    }
    const runStop = (): void => {
      runningRef.current = false
      pausedRef.current = false
      setPaused(false)
      setRunning(false)
    }

    scratchVm.on('workspaceUpdate', workspaceUpdate)
    scratchVm.on('targetsUpdate', targetsUpdate)
    scratchVm.on('PROJECT_CHANGED', projectChanged)
    scratchVm.on('PROJECT_RUN_START', runStart)
    scratchVm.on('PROJECT_RUN_STOP', runStop)

    // The runtime interval drives Scratch-only runs. During Run Both, the
    // universal frame coordinator invokes this bound step exactly once itself.
    const runtime = runtimeFor(baseVm)
    const originalRuntimeStep = runtime._step.bind(runtime)
    originalRuntimeStepRef.current = originalRuntimeStep
    runtime._step = (): void => {
      if (!coordinatedRef.current && !pausedRef.current) originalRuntimeStep()
    }
    scratchVm.start()

    const load = async (): Promise<void> => {
      setStatus('Loading Scratch project…')
      try {
        const initialProjectBytes = projectBytesRef.current
        await scratchVm.loadProject(
          initialProjectBytes.byteLength > 0 ? initialProjectBytes : buildBlankProject(scratchStorage)
        )
        const stage = runtime.getTargetForStage()
        if (stage && !stage.variables['parrot-score']) {
          ;(stage as unknown as {
            createVariable: (id: string, name: string, type: string) => void
          }).createVariable('parrot-score', 'score', '')
        }
        ;(renderer as unknown as { draw: () => void }).draw()
        coordinatedBaselineRef.current = captureTargetBaseline(baseVm)
        projectLoaded = true
        updateProjectUi()
        scratchVm.emitTargetsUpdate(false)
        scratchVm.refreshWorkspace()
        const initialFrame = await rendererSnapshot(renderer)
        if (!disposed) {
          setInitialFrameDataUrl(initialFrame)
          setReady(true)
          setStatus('Ready')
        }
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : 'Scratch VM could not load this project.')
          setStatus('Scratch project failed to load')
        }
      }
    }
    void load()

    return () => {
      disposed = true
      scratchVm.removeListener('workspaceUpdate', workspaceUpdate)
      scratchVm.removeListener('targetsUpdate', targetsUpdate)
      scratchVm.removeListener('PROJECT_CHANGED', projectChanged)
      scratchVm.removeListener('PROJECT_RUN_START', runStart)
      scratchVm.removeListener('PROJECT_RUN_STOP', runStop)
      scratchVm.postIOData = originalPostIOData
      runtime._step = originalRuntimeStep
      runningRef.current = false
      coordinatedRef.current = false
      pausedRef.current = false
      originalRuntimeStepRef.current = null
      originalPostIODataRef.current = null
      desiredKeysRef.current.clear()
      postedKeysRef.current.clear()
      desiredPointerRef.current = { x: 0, y: 0, isDown: false }
      coordinatedBaselineRef.current = []
      coordinatedGeometryRef.current = undefined
      scratchVm.stopAll()
      scratchVm.quit()
      vmRef.current = null
      rendererRef.current = null
      setVm(null)
      setStorage(null)
      setReady(false)
      setRunning(false)
      setPaused(false)
      releaseRendererContext(renderer, rendererCanvas)
    }
  }, [enabled, projectKey])

  const run = useCallback(() => {
    if (!ready) return
    coordinatedRef.current = false
    pausedRef.current = false
    runningRef.current = true
    vmRef.current?.greenFlag()
    setPaused(false)
    setRunning(true)
  }, [ready])

  const startCoordinated = useCallback((): boolean => {
    if (!ready || !vmRef.current || !rendererRef.current || !originalRuntimeStepRef.current) return false
    restoreTargetBaseline(vmRef.current, coordinatedBaselineRef.current)
    coordinatedGeometryRef.current = captureMotionGeometry(vmRef.current, rendererRef.current)
    coordinatedRef.current = true
    pausedRef.current = false
    runningRef.current = true
    vmRef.current.greenFlag()
    setPaused(false)
    setRunning(true)
    return true
  }, [ready])

  const continueStandalone = useCallback((): void => {
    if (!ready || !vmRef.current || !runningRef.current) return
    coordinatedRef.current = false
    pausedRef.current = false
    setPaused(false)
    setRunning(true)
  }, [ready])

  const pause = useCallback((): void => {
    if (!ready || !vmRef.current || !runningRef.current || pausedRef.current) return
    coordinatedRef.current = false
    pausedRef.current = true
    setPaused(true)
    setRunning(false)
    setStatus('Scratch paused')
  }, [ready])

  const resume = useCallback((): void => {
    if (!ready || !vmRef.current || !runningRef.current || !pausedRef.current) return
    pausedRef.current = false
    setPaused(false)
    setRunning(true)
    setStatus('Scratch running')
  }, [ready])

  const captureInput = useCallback((): CoordinatedInputSnapshot => ({
    keys: [...desiredKeysRef.current].map(([key, keyCode]) => ({ key, keyCode })),
    pointer: { ...desiredPointerRef.current },
    motionGeometry: coordinatedGeometryRef.current
  }), [])

  const stepCoordinated = useCallback((
    sequence: number,
    input: CoordinatedInputSnapshot
  ): CoordinatedScratchFrame => {
    const scratchVm = vmRef.current
    const step = originalRuntimeStepRef.current
    const postIOData = originalPostIODataRef.current
    if (!scratchVm || !step || !postIOData || !coordinatedRef.current || !runningRef.current) {
      return { running: false, state: { sprites: [] } }
    }

    const nextKeys = new Map(input.keys.map(({ key, keyCode }) => [key, keyCode]))
    for (const [key, keyCode] of postedKeysRef.current) {
      if (!nextKeys.has(key)) postIOData('keyboard', { key, keyCode, isDown: false })
    }
    for (const [key, keyCode] of nextKeys) {
      postIOData('keyboard', { key, keyCode, isDown: true })
    }
    postedKeysRef.current = nextKeys
    postIOData('mouse', {
      x: input.pointer.x + 240,
      y: 180 - input.pointer.y,
      canvasWidth: 480,
      canvasHeight: 360,
      isDown: input.pointer.isDown
    })
    const originalDateNow = Date.now
    const schedulerTimer = runtimeFor(scratchVm).sequencer?.timer
    const originalSchedulerNow = schedulerTimer?.nowObj
    if (schedulerTimer) schedulerTimer.nowObj = { now: originalDateNow }
    Date.now = () => Math.round(sequence * (1_000 / 60))
    try {
      step()
    } finally {
      Date.now = originalDateNow
      if (schedulerTimer && originalSchedulerNow) schedulerTimer.nowObj = originalSchedulerNow
    }
    return { running: runningRef.current, state: captureMotionState(scratchVm) }
  }, [])

  const stop = useCallback(() => {
    runningRef.current = false
    coordinatedRef.current = false
    pausedRef.current = false
    const scratchVm = vmRef.current
    const postIOData = originalPostIODataRef.current
    if (scratchVm && postIOData) {
      for (const [key, keyCode] of postedKeysRef.current) {
        postIOData('keyboard', { key, keyCode, isDown: false })
      }
      postIOData('mouse', {
        x: desiredPointerRef.current.x + 240,
        y: 180 - desiredPointerRef.current.y,
        canvasWidth: 480,
        canvasHeight: 360,
        isDown: false
      })
      scratchVm.stopAll()
    }
    postedKeysRef.current.clear()
    desiredKeysRef.current.clear()
    desiredPointerRef.current = { ...desiredPointerRef.current, isDown: false }
    coordinatedGeometryRef.current = undefined
    setPaused(false)
    setRunning(false)
  }, [])

  const selectTarget = useCallback((targetId: string) => {
    const scratchVm = vmRef.current
    if (scratchVm) selectScratchTarget(scratchVm as unknown as ScratchVmEditorContract, targetId)
  }, [])

  const snapshot = useCallback(async (): Promise<{ projectBytes: Uint8Array; frameDataUrl: string }> => {
    const scratchVm = vmRef.current
    if (!scratchVm) throw new Error('The Scratch project is not ready to update yet.')
    coordinatedBaselineRef.current = captureTargetBaseline(scratchVm)
    const blob = await scratchVm.saveProjectSb3()
    const frameDataUrl = await rendererSnapshot(rendererRef.current)
    if (frameDataUrl) setInitialFrameDataUrl(frameDataUrl)
    return { projectBytes: new Uint8Array(await blob.arrayBuffer()), frameDataUrl }
  }, [])

  const save = useCallback(async () => {
    const scratchVm = vmRef.current
    if (!scratchVm) return
    const blob = await scratchVm.saveProjectSb3()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = projectName.toLowerCase().endsWith('.sb3') ? projectName : `${projectName}.sb3`
    link.click()
    URL.revokeObjectURL(url)
  }, [projectName])

  return {
    outputCanvasRef,
    vm,
    storage,
    ready,
    running,
    paused,
    status,
    error,
    initialFrameDataUrl,
    blockCount: visibleBlockCount,
    targets,
    editingTargetId,
    run,
    startCoordinated,
    continueStandalone,
    pause,
    resume,
    captureInput,
    stepCoordinated,
    stop,
    selectTarget,
    snapshot,
    save
  }
}
