import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebContents } from 'electron'
import type {
  PythonFrameState,
  PythonRunRequest,
  PythonRuntimeEvent,
  PythonRuntimeStart,
  ScratchMotionGeometry
} from '../shared/project'
import type { RuntimeBundle } from './converter/types'
import { resolvePythonExecutable } from './python-executable'
import PARROT_RUNTIME_SOURCE from './python/parrot.py?raw'
import PYTHON_LAUNCHER_SOURCE from './python/launcher.py?raw'

const FRAME_PREFIX = '__PARROT_FRAME__:'
const MAX_PYTHON_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_FRAME_BASE64_LENGTH = 4 * 1024 * 1024
const MAX_STATE_BASE64_LENGTH = 256 * 1024
const MAX_OUTPUT_CHARS = 4_000
const MAX_STATE_SPRITES = 256
const MAX_SPRITE_NAME_LENGTH = 100
const MAX_MOTION_VALUE = 1_000_000_000
const MAX_GEOMETRY_SPRITES = 256
const MAX_HULL_POINTS_PER_SPRITE = 8_192
const MAX_TOTAL_HULL_POINTS = 16_384
const MAX_GEOMETRY_VALUE = 1_000_000

interface RuntimeSession {
  id: string
  owner: WebContents
  child: ChildProcessWithoutNullStreams
  directory: string
  redactedDirectories: string[]
  stdoutBuffer: string
  finalized: boolean
}

function send(owner: WebContents, event: PythonRuntimeEvent): void {
  if (!owner.isDestroyed()) owner.send('python:event', event)
}

function cleanProjectName(name: string): string {
  return name.replace(/\.(?:sb3|py)$/i, '').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80) || 'parrot-project'
}

function boundedMotionGeometry(candidate: unknown): ScratchMotionGeometry | undefined {
  if (!candidate || typeof candidate !== 'object') return undefined
  const sprites = (candidate as { sprites?: unknown }).sprites
  if (!Array.isArray(sprites) || sprites.length > MAX_GEOMETRY_SPRITES) return undefined

  let totalHullPoints = 0
  const boundedSprites: ScratchMotionGeometry['sprites'] = []
  for (const candidateSprite of sprites) {
    if (!candidateSprite || typeof candidateSprite !== 'object') return undefined
    const sprite = candidateSprite as Record<string, unknown>
    const name = sprite.name
    const skinSize = sprite.skinSize
    const rotationCenter = sprite.rotationCenter
    const hullPoints = sprite.hullPoints
    if (
      typeof name !== 'string' || name.length === 0 || name.length > MAX_SPRITE_NAME_LENGTH ||
      !Array.isArray(skinSize) || skinSize.length !== 2 ||
      !skinSize.every((value) => typeof value === 'number' && Number.isFinite(value) &&
        value > 0 && value <= MAX_GEOMETRY_VALUE) ||
      !Array.isArray(rotationCenter) || rotationCenter.length !== 2 ||
      !rotationCenter.every((value) => typeof value === 'number' && Number.isFinite(value) &&
        Math.abs(value) <= MAX_GEOMETRY_VALUE) ||
      !Array.isArray(hullPoints) || hullPoints.length > MAX_HULL_POINTS_PER_SPRITE
    ) return undefined
    totalHullPoints += hullPoints.length
    if (totalHullPoints > MAX_TOTAL_HULL_POINTS) return undefined
    const boundedHullPoints: Array<[number, number]> = []
    for (const point of hullPoints) {
      if (
        !Array.isArray(point) || point.length !== 2 ||
        !point.every((value) => typeof value === 'number' && Number.isFinite(value) &&
          Math.abs(value) <= MAX_GEOMETRY_VALUE)
      ) return undefined
      boundedHullPoints.push([point[0] as number, point[1] as number])
    }
    boundedSprites.push({
      name,
      skinSize: [skinSize[0] as number, skinSize[1] as number],
      rotationCenter: [rotationCenter[0] as number, rotationCenter[1] as number],
      hullPoints: boundedHullPoints
    })
  }
  return { sprites: boundedSprites }
}

export class PythonRuntimeManager {
  private readonly sessions = new Map<string, RuntimeSession>()

  async start(owner: WebContents, request: PythonRunRequest, runtime: RuntimeBundle): Promise<PythonRuntimeStart> {
    if (
      !request || typeof request.source !== 'string' || typeof request.projectName !== 'string' ||
      typeof request.runtimeProjectId !== 'string'
    ) {
      throw new Error('Parrot received an invalid Python run request.')
    }
    if (Buffer.byteLength(request.source, 'utf8') > MAX_PYTHON_SOURCE_BYTES) {
      throw new Error('Python source must be smaller than 8 MB.')
    }
    if (request.source.includes('\0')) throw new Error('Python source cannot contain null bytes.')
    if (request.clockMode !== 'internal' && request.clockMode !== 'scratch') {
      throw new Error('Parrot received an invalid Python clock mode.')
    }

    if (this.sessions.size >= 8) {
      throw new Error('Stop another Python tab before starting more than eight runtimes.')
    }
    const pythonExecutable = await resolvePythonExecutable()
    const directory = await mkdtemp(join(tmpdir(), 'parrot-python-'))
    const canonicalDirectory = await realpath(directory)
    const scriptPath = join(directory, `${cleanProjectName(request.projectName)}.py`)
    const launcherPath = join(directory, '_parrot_launcher.py')
    const runtimePath = join(directory, 'parrot.py')
    const manifestPath = join(directory, 'project.json')
    const assetsDirectory = join(directory, 'assets')
    try {
      await mkdir(assetsDirectory, { mode: 0o700 })
      await Promise.all([
        writeFile(scriptPath, request.source, { encoding: 'utf8', mode: 0o600 }),
        writeFile(launcherPath, PYTHON_LAUNCHER_SOURCE, { encoding: 'utf8', mode: 0o600 }),
        writeFile(runtimePath, PARROT_RUNTIME_SOURCE, { encoding: 'utf8', mode: 0o600 }),
        writeFile(manifestPath, JSON.stringify(runtime.manifest), { encoding: 'utf8', mode: 0o600 }),
        ...runtime.assets.map((asset) => {
          if (!/^asset-\d+\.[a-z0-9]+$/.test(asset.file)) {
            throw new Error('Parrot rejected an invalid private asset name.')
          }
          return writeFile(join(assetsDirectory, asset.file), asset.data, { mode: 0o600 })
        })
      ])
    } catch {
      await rm(directory, { recursive: true, force: true })
      throw new Error('Parrot could not prepare the private Python runtime session.')
    }

    const child = spawn(pythonExecutable, ['-I', '-u', launcherPath, scriptPath], {
      cwd: directory,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TMPDIR: directory,
        TEMP: directory,
        TMP: directory,
        PARROT_CAPTURE: '1',
        PYGAME_HIDE_SUPPORT_PROMPT: '1',
        SDL_VIDEODRIVER: 'dummy',
        SDL_AUDIODRIVER: 'dummy',
        PARROT_CLOCK_MODE: request.clockMode,
        PARROT_PROJECT_MANIFEST: manifestPath,
        PYTHONUNBUFFERED: '1'
      }
    })
    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', () => reject(new Error('Parrot could not launch python3.')))
    })

    const session: RuntimeSession = {
      id: randomUUID(),
      owner,
      child,
      directory,
      redactedDirectories: [...new Set([directory, canonicalDirectory])],
      stdoutBuffer: '',
      finalized: false
    }
    this.sessions.set(session.id, session)

    child.once('spawn', () => send(owner, { sessionId: session.id, type: 'started' }))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.consumeStdout(session, chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      send(owner, {
        sessionId: session.id,
        type: 'output',
        stream: 'stderr',
        text: this.cleanOutput(session, chunk).slice(0, MAX_OUTPUT_CHARS)
      })
    })
    child.once('error', () => {
      void this.finalize(session, null, 'Parrot could not launch python3.')
    })
    child.once('close', (exitCode) => {
      void this.finalize(session, exitCode, exitCode && exitCode !== 0
        ? 'Python stopped with an error. See the output log for details.'
        : undefined)
    })

    await spawned
    return { sessionId: session.id }
  }

  sendKey(sessionId: string, key: string, isDown: boolean): void {
    const session = this.sessions.get(sessionId)
    if (!session || !session.child.stdin.writable) return
    const normalizedKey = key.slice(0, 40)
    session.child.stdin.write(`${JSON.stringify({ type: 'key', key: normalizedKey, isDown })}\n`)
  }

  sendMouse(sessionId: string, x: number, y: number, isDown: boolean): void {
    const session = this.sessions.get(sessionId)
    if (!session || !session.child.stdin.writable) return
    if (![x, y].every((value) => Number.isFinite(value))) return
    session.child.stdin.write(`${JSON.stringify({
      type: 'mouse',
      x: Math.max(-240, Math.min(240, x)),
      y: Math.max(-180, Math.min(180, y)),
      isDown
    })}\n`)
  }

  sendTick(
    sessionId: string,
    sequence: number,
    keysDown: string[],
    mouse: { x: number; y: number; isDown: boolean },
    motionGeometry?: unknown
  ): void {
    const session = this.sessions.get(sessionId)
    if (!session || !session.child.stdin.writable) return
    if (!Number.isSafeInteger(sequence) || sequence <= 0) return
    const boundedKeys = keysDown.slice(0, 64).map((key) => key.slice(0, 40))
    const boundedMouse = {
      x: Math.max(-240, Math.min(240, Number.isFinite(mouse.x) ? mouse.x : 0)),
      y: Math.max(-180, Math.min(180, Number.isFinite(mouse.y) ? mouse.y : 0)),
      isDown: Boolean(mouse.isDown)
    }
    const boundedGeometry = boundedMotionGeometry(motionGeometry)
    session.child.stdin.write(`${JSON.stringify({
      type: 'tick', sequence, keysDown: boundedKeys, mouse: boundedMouse,
      ...(boundedGeometry ? { motionGeometry: boundedGeometry } : {})
    })}\n`)
  }

  setClockMode(sessionId: string, clockMode: 'internal' | 'paused'): void {
    const session = this.sessions.get(sessionId)
    if (
      !session || !session.child.stdin.writable ||
      (clockMode !== 'internal' && clockMode !== 'paused')
    ) return
    session.child.stdin.write(`${JSON.stringify({ type: 'clockMode', clockMode })}\n`)
  }

  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    await this.stopSession(session)
  }

  async stopActive(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => this.stopSession(session)))
  }

  private async stopSession(session: RuntimeSession): Promise<void> {
    if (!session || session.finalized) return
    if (session.child.stdin.writable) {
      session.child.stdin.write(`${JSON.stringify({ type: 'stop' })}\n`)
    }
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      session.child.once('close', finish)
      setTimeout(() => {
        if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGTERM')
        setTimeout(() => {
          if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill('SIGKILL')
          finish()
        }, 350)
      }, 350)
    })
  }

  private consumeStdout(session: RuntimeSession, chunk: string): void {
    session.stdoutBuffer += chunk
    if (session.stdoutBuffer.length > MAX_FRAME_BASE64_LENGTH + MAX_STATE_BASE64_LENGTH + MAX_OUTPUT_CHARS) {
      session.stdoutBuffer = session.stdoutBuffer.slice(-(
        MAX_FRAME_BASE64_LENGTH + MAX_STATE_BASE64_LENGTH + MAX_OUTPUT_CHARS
      ))
    }
    let newline = session.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = session.stdoutBuffer.slice(0, newline).replace(/\r$/, '')
      session.stdoutBuffer = session.stdoutBuffer.slice(newline + 1)
      if (line.startsWith(FRAME_PREFIX)) {
        const payload = line.slice(FRAME_PREFIX.length)
        const firstSeparator = payload.indexOf(':')
        const secondSeparator = payload.indexOf(':', firstSeparator + 1)
        const sequence = Number(payload.slice(0, firstSeparator))
        const encodedState = payload.slice(firstSeparator + 1, secondSeparator)
        const frame = payload.slice(secondSeparator + 1)
        const state = this.parseFrameState(encodedState)
        if (
          firstSeparator > 0 && secondSeparator > firstSeparator + 1 &&
          Number.isSafeInteger(sequence) && sequence > 0 && state &&
          frame.length <= MAX_FRAME_BASE64_LENGTH && /^[a-zA-Z0-9+/=]+$/.test(frame)
        ) {
          send(session.owner, {
            sessionId: session.id,
            type: 'frame',
            sequence,
            dataUrl: `data:image/png;base64,${frame}`,
            state
          })
        }
      } else if (line) {
        send(session.owner, {
          sessionId: session.id,
          type: 'output',
          stream: 'stdout',
          text: this.cleanOutput(session, line).slice(0, MAX_OUTPUT_CHARS)
        })
      }
      newline = session.stdoutBuffer.indexOf('\n')
    }
  }

  private parseFrameState(encoded: string): PythonFrameState | null {
    if (
      encoded.length === 0 || encoded.length > MAX_STATE_BASE64_LENGTH ||
      !/^[a-zA-Z0-9+/=]+$/.test(encoded)
    ) return null
    try {
      const value = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as unknown
      if (!value || typeof value !== 'object') return null
      const sprites = (value as { sprites?: unknown }).sprites
      if (!Array.isArray(sprites) || sprites.length > MAX_STATE_SPRITES) return null
      const seen = new Set<string>()
      const validated = sprites.map((candidate) => {
        if (!candidate || typeof candidate !== 'object') throw new Error('Invalid sprite state')
        const sprite = candidate as Record<string, unknown>
        if (
          typeof sprite.name !== 'string' || sprite.name.length === 0 ||
          sprite.name.length > MAX_SPRITE_NAME_LENGTH || seen.has(sprite.name)
        ) throw new Error('Invalid sprite name')
        const values = [sprite.x, sprite.y, sprite.direction]
        if (values.some((item) => (
          typeof item !== 'number' || !Number.isFinite(item) || Math.abs(item) > MAX_MOTION_VALUE
        ))) throw new Error('Invalid motion value')
        seen.add(sprite.name)
        return {
          name: sprite.name,
          x: sprite.x as number,
          y: sprite.y as number,
          direction: sprite.direction as number
        }
      })
      return { sprites: validated }
    } catch {
      return null
    }
  }

  private cleanOutput(session: RuntimeSession, text: string): string {
    return session.redactedDirectories.reduce(
      (output, directory) => output.replaceAll(directory, '<parrot-session>'),
      text
    )
  }

  private async finalize(session: RuntimeSession, exitCode: number | null, error?: string): Promise<void> {
    if (session.finalized) return
    session.finalized = true
    this.sessions.delete(session.id)
    send(session.owner, { sessionId: session.id, type: 'stopped', exitCode, ...(error ? { error } : {}) })
    try {
      await rm(session.directory, { recursive: true, force: true })
    } catch {
      // The operating system can clean a locked temporary directory later.
    }
  }
}
