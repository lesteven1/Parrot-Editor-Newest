import type { PythonFrameState, ScratchMotionGeometry } from '../../../shared/project'

export interface CoordinatedInputKey {
  key: string
  keyCode: number
}

export interface CoordinatedPointerSnapshot {
  x: number
  y: number
  isDown: boolean
}

export interface CoordinatedInputSnapshot {
  keys: readonly CoordinatedInputKey[]
  pointer: CoordinatedPointerSnapshot
  motionGeometry?: ScratchMotionGeometry
}

export interface CoordinatedPythonFrame {
  sequence: number
  dataUrl: string
  state: PythonFrameState
}

export interface CoordinatedScratchFrame {
  running: boolean
  state: PythonFrameState
}

export interface FrameCoordinatorDiagnostics {
  running: boolean
  requestedFrames: number
  completedScratchFrames: number
  completedPythonFrames: number
  presentedFrames: number
  lastPresentedSequence: number
  maximumInFlight: number
  currentlyDiverged: boolean
  mismatchedFrames: number
  firstMismatchSequence: number | null
  latestMismatchSequence: number | null
  lastReconvergedSequence: number | null
  latestMismatch: string | null
}

export interface FrameCoordinatorParityStatus {
  currentlyDiverged: boolean
  mismatchedFrames: number
  firstMismatchSequence: number
  latestMismatchSequence: number
  lastReconvergedSequence: number | null
  latestMismatch: string
}

interface FrameCoordinatorDependencies {
  captureInput: () => CoordinatedInputSnapshot
  requestPythonFrame: (
    sequence: number,
    input: CoordinatedInputSnapshot
  ) => Promise<CoordinatedPythonFrame>
  stepScratch: (sequence: number, input: CoordinatedInputSnapshot) => CoordinatedScratchFrame
  presentPair: (frame: CoordinatedPythonFrame) => void
  onParityUpdate: (status: FrameCoordinatorParityStatus) => void
  onComplete: () => void
  onError: (error: Error) => void
}

interface FrameCoordinatorOptions {
  frameIntervalMs?: number
  frameTimeoutMs?: number
}

const DEFAULT_FRAME_INTERVAL_MS = 1_000 / 60
const DEFAULT_FRAME_TIMEOUT_MS = 3_000
const MOTION_TOLERANCE = 1e-7

function directionDistance(left: number, right: number): number {
  const distance = Math.abs(left - right) % 360
  return Math.min(distance, 360 - distance)
}

export function motionParityMismatch(
  sequence: number,
  scratchState: PythonFrameState,
  pythonState: PythonFrameState
): string | null {
  const scratchSprites = new Map(scratchState.sprites.map((sprite) => [sprite.name, sprite]))
  const pythonSprites = new Map(pythonState.sprites.map((sprite) => [sprite.name, sprite]))
  const names = new Set([...scratchSprites.keys(), ...pythonSprites.keys()])

  for (const name of names) {
    const scratch = scratchSprites.get(name)
    const python = pythonSprites.get(name)
    if (!scratch || !python) {
      return `Motion parity diverged at coordinated frame ${sequence}: sprite ${JSON.stringify(name)} ` +
        `is missing from ${scratch ? 'Python' : 'Scratch'} state.`
    }
    for (const property of ['x', 'y', 'direction'] as const) {
      const delta = property === 'direction'
        ? directionDistance(scratch[property], python[property])
        : Math.abs(scratch[property] - python[property])
      if (delta > MOTION_TOLERANCE) {
        return `Motion parity diverged at coordinated frame ${sequence}: ${name}.${property} ` +
          `is ${scratch[property]} in Scratch and ${python[property]} in Python (delta ${delta}).`
      }
    }
  }
  return null
}

/**
 * Owns the coordinated-pair logical clock. A new frame is never requested until the
 * previous Python frame has been acknowledged, stepped in Scratch, and
 * presented as a pair.
 */
export class UniversalFrameCoordinator {
  private readonly dependencies: FrameCoordinatorDependencies
  private readonly frameIntervalMs: number
  private readonly frameTimeoutMs: number
  private timer: ReturnType<typeof setTimeout> | null = null
  private generation = 0
  private nextDeadline = 0
  private sequence = 0
  private inFlight = 0
  private diagnosticsValue: FrameCoordinatorDiagnostics = this.emptyDiagnostics()

  constructor(
    dependencies: FrameCoordinatorDependencies,
    options: FrameCoordinatorOptions = {}
  ) {
    this.dependencies = dependencies
    this.frameIntervalMs = options.frameIntervalMs ?? DEFAULT_FRAME_INTERVAL_MS
    this.frameTimeoutMs = options.frameTimeoutMs ?? DEFAULT_FRAME_TIMEOUT_MS
  }

  get diagnostics(): FrameCoordinatorDiagnostics {
    return { ...this.diagnosticsValue }
  }

  start(): void {
    this.stop()
    this.sequence = 0
    this.inFlight = 0
    this.diagnosticsValue = { ...this.emptyDiagnostics(), running: true }
    this.nextDeadline = performance.now()
    const generation = this.generation
    this.schedule(generation, 0)
  }

  stop(): void {
    this.generation += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.inFlight = 0
    this.diagnosticsValue = { ...this.diagnosticsValue, running: false }
  }

  private emptyDiagnostics(): FrameCoordinatorDiagnostics {
    return {
      running: false,
      requestedFrames: 0,
      completedScratchFrames: 0,
      completedPythonFrames: 0,
      presentedFrames: 0,
      lastPresentedSequence: 0,
      maximumInFlight: 0,
      currentlyDiverged: false,
      mismatchedFrames: 0,
      firstMismatchSequence: null,
      latestMismatchSequence: null,
      lastReconvergedSequence: null,
      latestMismatch: null
    }
  }

  private schedule(generation: number, delay: number): void {
    this.timer = setTimeout(() => void this.advance(generation), Math.max(0, delay))
  }

  private async advance(generation: number): Promise<void> {
    if (generation !== this.generation || !this.diagnosticsValue.running) return

    const sequence = this.sequence + 1
    this.sequence = sequence
    const capturedInput = this.dependencies.captureInput()
    const input = sequence === 1
      ? capturedInput
      : { ...capturedInput, motionGeometry: undefined }
    this.inFlight += 1
    this.diagnosticsValue = {
      ...this.diagnosticsValue,
      requestedFrames: sequence,
      maximumInFlight: Math.max(this.diagnosticsValue.maximumInFlight, this.inFlight)
    }

    try {
      const frame = await this.withTimeout(
        this.dependencies.requestPythonFrame(sequence, input),
        `Python did not complete coordinated frame ${sequence} within ${this.frameTimeoutMs} ms.`
      )
      if (generation !== this.generation || !this.diagnosticsValue.running) return
      if (frame.sequence !== sequence) {
        throw new Error(`Python returned frame ${frame.sequence} while frame ${sequence} was requested.`)
      }

      this.diagnosticsValue = {
        ...this.diagnosticsValue,
        completedPythonFrames: this.diagnosticsValue.completedPythonFrames + 1
      }
      const scratchFrame = this.dependencies.stepScratch(sequence, input)
      this.diagnosticsValue = {
        ...this.diagnosticsValue,
        completedScratchFrames: this.diagnosticsValue.completedScratchFrames + 1
      }
      const mismatch = motionParityMismatch(sequence, scratchFrame.state, frame.state)
      if (mismatch) {
        this.diagnosticsValue = {
          ...this.diagnosticsValue,
          currentlyDiverged: true,
          mismatchedFrames: this.diagnosticsValue.mismatchedFrames + 1,
          firstMismatchSequence: this.diagnosticsValue.firstMismatchSequence ?? sequence,
          latestMismatchSequence: sequence,
          latestMismatch: mismatch
        }
        this.dependencies.onParityUpdate(this.parityStatus())
      } else if (this.diagnosticsValue.currentlyDiverged) {
        this.diagnosticsValue = {
          ...this.diagnosticsValue,
          currentlyDiverged: false,
          lastReconvergedSequence: sequence
        }
        this.dependencies.onParityUpdate(this.parityStatus())
      }

      // Scratch Render draws synchronously inside its VM step. Publishing the
      // buffered Python frame immediately afterwards keeps both panes on N.
      this.dependencies.presentPair(frame)
      this.diagnosticsValue = {
        ...this.diagnosticsValue,
        presentedFrames: this.diagnosticsValue.presentedFrames + 1,
        lastPresentedSequence: sequence
      }

      if (!scratchFrame.running) {
        this.stop()
        this.dependencies.onComplete()
        return
      }

      this.nextDeadline = Math.max(this.nextDeadline + this.frameIntervalMs, performance.now())
      this.schedule(generation, this.nextDeadline - performance.now())
    } catch (reason) {
      if (generation !== this.generation || !this.diagnosticsValue.running) return
      this.stop()
      this.dependencies.onError(reason instanceof Error ? reason : new Error('Coordinated pair execution failed.'))
    } finally {
      if (generation === this.generation) this.inFlight = Math.max(0, this.inFlight - 1)
    }
  }

  private parityStatus(): FrameCoordinatorParityStatus {
    const diagnostics = this.diagnosticsValue
    if (
      diagnostics.firstMismatchSequence === null ||
      diagnostics.latestMismatchSequence === null ||
      diagnostics.latestMismatch === null
    ) {
      throw new Error('Coordinated parity status was requested before a mismatch was recorded.')
    }
    return {
      currentlyDiverged: diagnostics.currentlyDiverged,
      mismatchedFrames: diagnostics.mismatchedFrames,
      firstMismatchSequence: diagnostics.firstMismatchSequence,
      latestMismatchSequence: diagnostics.latestMismatchSequence,
      lastReconvergedSequence: diagnostics.lastReconvergedSequence,
      latestMismatch: diagnostics.latestMismatch
    }
  }

  private async withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), this.frameTimeoutMs)
        })
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
}
