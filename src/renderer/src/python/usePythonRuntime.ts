import { useCallback, useEffect, useRef, useState } from 'react'
import type { PythonFrameState, PythonRuntimeEvent } from '../../../shared/project'
import type {
  CoordinatedInputSnapshot,
  CoordinatedPythonFrame
} from '../runtime/frame-coordinator'

export type PythonRuntimeStatus = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error'
type PythonClockMode = 'internal' | 'scratch' | 'paused'

export interface PythonRuntimeController {
  status: PythonRuntimeStatus
  statusLabel: string
  running: boolean
  paused: boolean
  frameDataUrl: string
  frameState: PythonFrameState | null
  output: string[]
  error: string
  exportMessage: string
  run: (source: string, clockMode?: 'internal' | 'scratch') => Promise<boolean>
  requestCoordinatedFrame: (
    sequence: number,
    input: CoordinatedInputSnapshot
  ) => Promise<CoordinatedPythonFrame>
  presentCoordinatedFrame: (frame: CoordinatedPythonFrame) => void
  continueInternally: () => void
  pause: () => void
  resume: () => void
  updatePointer: (x: number, y: number, isDown: boolean) => void
  stop: () => Promise<void>
  exportSource: (source: string) => Promise<void>
}

export interface PythonRuntimeInitialState {
  frameDataUrl: string
  frameState: PythonFrameState | null
  output: string[]
  error: string
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    Boolean(target.closest('.monaco-editor'))
}

function scratchKeyName(key: string): string {
  const names: Record<string, string> = {
    ArrowRight: 'right arrow',
    ArrowLeft: 'left arrow',
    ArrowUp: 'up arrow',
    ArrowDown: 'down arrow',
    ' ': 'space',
    Enter: 'enter'
  }
  return names[key] ?? key.toLowerCase()
}

function statusText(status: PythonRuntimeStatus, clockMode: PythonClockMode): string {
  switch (status) {
    case 'starting': return 'Starting Python…'
    case 'running': return clockMode === 'scratch' ? 'Following coordinated frames' : 'Python running'
    case 'paused': return 'Python paused'
    case 'stopping': return 'Stopping Python…'
    case 'stopped': return 'Python stopped'
    case 'error': return 'Python error'
    default: return 'Ready'
  }
}

export function usePythonRuntime(
  projectName: string,
  runtimeProjectId: string,
  enabled = true,
  initialState?: PythonRuntimeInitialState
): PythonRuntimeController {
  const sessionIdRef = useRef<string | null>(null)
  const tickSequenceRef = useRef(0)
  const keysDownRef = useRef(new Set<string>())
  const pendingEventsRef = useRef(new Map<string, PythonRuntimeEvent[]>())
  const pendingFramesRef = useRef(new Map<number, {
    resolve: (frame: CoordinatedPythonFrame) => void
    reject: (error: Error) => void
  }>())
  const clockModeRef = useRef<PythonClockMode>('internal')
  const statusRef = useRef<PythonRuntimeStatus>('idle')
  const lastPresentedSequenceRef = useRef(0)
  const [status, setStatus] = useState<PythonRuntimeStatus>('idle')
  const [presentedFrame, setPresentedFrame] = useState<{
    dataUrl: string
    state: PythonFrameState
  } | null>(initialState?.frameDataUrl && initialState.frameState
    ? { dataUrl: initialState.frameDataUrl, state: initialState.frameState }
    : null)
  const [output, setOutput] = useState<string[]>(initialState?.output ?? [])
  const [error, setError] = useState(initialState?.error ?? '')
  const [exportMessage, setExportMessage] = useState('')
  const [clockMode, setClockMode] = useState<PythonClockMode>('internal')

  const applyEvent = useCallback((event: PythonRuntimeEvent): void => {
    if (event.type === 'started') {
      // Electron can deliver the child-process "started" event after the Run
      // checklist has already paused the new session. The clock mode is the
      // authoritative execution state, so a late event must not erase pause.
      if (clockModeRef.current === 'paused') {
        statusRef.current = 'paused'
        setStatus('paused')
        return
      }
      statusRef.current = 'running'
      setStatus('running')
    } else if (event.type === 'frame') {
      if (clockModeRef.current === 'scratch') {
        const pending = pendingFramesRef.current.get(event.sequence)
        if (pending) {
          pendingFramesRef.current.delete(event.sequence)
          pending.resolve({ sequence: event.sequence, dataUrl: event.dataUrl, state: event.state })
        }
      } else {
        lastPresentedSequenceRef.current = event.sequence
        setPresentedFrame({ dataUrl: event.dataUrl, state: event.state })
      }
    } else if (event.type === 'output') {
      setOutput((current) => [...current, ...event.text.split(/\r?\n/).filter(Boolean)].slice(-24))
    } else if (event.type === 'stopped') {
      sessionIdRef.current = null
      tickSequenceRef.current = 0
      clockModeRef.current = 'internal'
      setClockMode('internal')
      keysDownRef.current.clear()
      for (const pending of pendingFramesRef.current.values()) {
        pending.reject(new Error(event.error || 'Python stopped before completing the coordinated frame.'))
      }
      pendingFramesRef.current.clear()
      if (event.error) {
        setError(event.error)
        statusRef.current = 'error'
        setStatus('error')
      } else {
        statusRef.current = 'stopped'
        setStatus('stopped')
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled || !window.parrot) return
    return window.parrot.onPythonEvent((event) => {
      if (event.sessionId === sessionIdRef.current) {
        applyEvent(event)
        return
      }
      if (statusRef.current !== 'starting') return
      const pending = pendingEventsRef.current.get(event.sessionId) ?? []
      pendingEventsRef.current.set(event.sessionId, [...pending, event].slice(-8))
    })
  }, [applyEvent, enabled])

  useEffect(() => {
    if (!enabled) return
    const postKey = (event: KeyboardEvent, isDown: boolean): void => {
      const sessionId = sessionIdRef.current
      if (!sessionId || isEditableElement(event.target)) return
      const key = scratchKeyName(event.key)
      if (isDown) keysDownRef.current.add(key)
      else keysDownRef.current.delete(key)
      if (clockModeRef.current !== 'scratch') window.parrot?.sendPythonKey(sessionId, key, isDown)
    }
    const keyDown = (event: KeyboardEvent): void => postKey(event, true)
    const keyUp = (event: KeyboardEvent): void => postKey(event, false)
    const releaseKeys = (): void => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      if (clockModeRef.current !== 'scratch') {
        for (const key of keysDownRef.current) window.parrot?.sendPythonKey(sessionId, key, false)
      }
      keysDownRef.current.clear()
    }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', releaseKeys)
    return () => {
      releaseKeys()
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', releaseKeys)
    }
  }, [enabled])

  useEffect(() => () => {
    const sessionId = sessionIdRef.current
    if (sessionId) void window.parrot?.stopPython(sessionId)
  }, [])

  const run = useCallback(async (
    source: string,
    nextClockMode: 'internal' | 'scratch' = 'internal'
  ): Promise<boolean> => {
    if (!enabled || !window.parrot) {
      setError('Python execution is available in the Electron app.')
      setStatus('error')
      return false
    }
    setStatus('starting')
    statusRef.current = 'starting'
    setClockMode(nextClockMode)
    clockModeRef.current = nextClockMode
    tickSequenceRef.current = 0
    lastPresentedSequenceRef.current = 0
    setError('')
    setOutput([])
    pendingEventsRef.current.clear()
    for (const pending of pendingFramesRef.current.values()) {
      pending.reject(new Error('A new Python run replaced the pending coordinated frame.'))
    }
    pendingFramesRef.current.clear()
    try {
      const session = await window.parrot.startPython({ source, projectName, runtimeProjectId, clockMode: nextClockMode })
      sessionIdRef.current = session.sessionId
      statusRef.current = 'running'
      setStatus('running')
      const pending = pendingEventsRef.current.get(session.sessionId) ?? []
      pendingEventsRef.current.delete(session.sessionId)
      pending.forEach(applyEvent)
      return true
    } catch (reason) {
      sessionIdRef.current = null
      clockModeRef.current = 'internal'
      setClockMode('internal')
      statusRef.current = 'error'
      setError(reason instanceof Error ? reason.message : 'Parrot could not start Python.')
      setStatus('error')
      return false
    }
  }, [applyEvent, enabled, projectName, runtimeProjectId])

  const requestCoordinatedFrame = useCallback((
    sequence: number,
    input: CoordinatedInputSnapshot
  ): Promise<CoordinatedPythonFrame> => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !window.parrot) {
      return Promise.reject(new Error('Python is not ready for a coordinated frame.'))
    }
    if (!Number.isSafeInteger(sequence) || sequence !== tickSequenceRef.current + 1) {
      return Promise.reject(new Error(`Invalid coordinated frame sequence ${sequence}.`))
    }

    tickSequenceRef.current = sequence
    const keysDown = input.keys.map(({ key }) => scratchKeyName(key))
    return new Promise<CoordinatedPythonFrame>((resolve, reject) => {
      pendingFramesRef.current.set(sequence, { resolve, reject })
      window.parrot?.sendPythonTick(sessionId, sequence, keysDown, input.pointer, input.motionGeometry)
    })
  }, [])

  const presentCoordinatedFrame = useCallback((frame: CoordinatedPythonFrame): void => {
    if (frame.sequence <= lastPresentedSequenceRef.current) return
    lastPresentedSequenceRef.current = frame.sequence
    setPresentedFrame({ dataUrl: frame.dataUrl, state: frame.state })
  }, [])

  const continueInternally = useCallback((): void => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !window.parrot || clockModeRef.current !== 'scratch') return
    clockModeRef.current = 'internal'
    setClockMode('internal')
    for (const pending of pendingFramesRef.current.values()) {
      pending.reject(new Error('The coordinated run changed to standalone Python.'))
    }
    pendingFramesRef.current.clear()
    window.parrot.setPythonClockMode(sessionId, 'internal')
  }, [])

  const pause = useCallback((): void => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !window.parrot || statusRef.current !== 'running') return
    clockModeRef.current = 'paused'
    setClockMode('paused')
    statusRef.current = 'paused'
    setStatus('paused')
    for (const pending of pendingFramesRef.current.values()) {
      pending.reject(new Error('Python was paused during a coordinated frame.'))
    }
    pendingFramesRef.current.clear()
    window.parrot.setPythonClockMode(sessionId, 'paused')
  }, [])

  const resume = useCallback((): void => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !window.parrot || clockModeRef.current !== 'paused') return
    clockModeRef.current = 'internal'
    setClockMode('internal')
    statusRef.current = 'running'
    setStatus('running')
    window.parrot.setPythonClockMode(sessionId, 'internal')
  }, [])

  const updatePointer = useCallback((x: number, y: number, isDown: boolean): void => {
    const sessionId = sessionIdRef.current
    if (!sessionId || clockModeRef.current === 'scratch') return
    window.parrot?.sendPythonMouse(sessionId, x, y, isDown)
  }, [])

  const stop = useCallback(async (): Promise<void> => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !window.parrot) return
    statusRef.current = 'stopping'
    setStatus('stopping')
    try {
      await window.parrot.stopPython(sessionId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Parrot could not stop Python.')
      statusRef.current = 'error'
      setStatus('error')
    }
  }, [])

  const exportSource = useCallback(async (source: string): Promise<void> => {
    if (!window.parrot) {
      setExportMessage('Export is available in the Electron app.')
      return
    }
    setExportMessage('Choosing export location…')
    try {
      const result = await window.parrot.exportPython(projectName, source)
      setExportMessage(result.saved ? `Saved ${result.name}` : '')
    } catch (reason) {
      setExportMessage(reason instanceof Error ? reason.message : 'Parrot could not export Python.')
    }
  }, [projectName])

  return {
    status,
    statusLabel: statusText(status, clockMode),
    running: clockMode !== 'paused' && (status === 'starting' || status === 'running'),
    paused: clockMode === 'paused',
    frameDataUrl: presentedFrame?.dataUrl ?? '',
    frameState: presentedFrame?.state ?? null,
    output,
    error,
    exportMessage,
    run,
    requestCoordinatedFrame,
    presentCoordinatedFrame,
    continueInternally,
    pause,
    resume,
    updatePointer,
    stop,
    exportSource
  }
}
