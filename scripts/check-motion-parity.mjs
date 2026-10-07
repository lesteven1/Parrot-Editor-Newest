import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertScratchToPython } from '../src/main/converter.ts'

const FRAME_PREFIX = '__PARROT_FRAME__:'
const LOGICAL_FRAMES = Number(process.env.PARROT_PARITY_FRAMES || 1_200)
const TOLERANCE = 1e-7
const parrotRuntime = await readFile(new URL('../src/main/python/parrot.py', import.meta.url), 'utf8')
const pythonLauncher = await readFile(new URL('../src/main/python/launcher.py', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)

function scratchDirection(value) {
  return value - Math.floor((value + 179) / 360) * 360
}

class ScratchRectangleReference {
  constructor(x, y, direction = 90) {
    this.x = x
    this.y = y
    this.direction = direction
  }

  transform() {
    const radians = (270 - this.direction) * Math.PI / 180
    const cosine = Math.fround(Math.cos(radians))
    const sine = Math.fround(Math.sin(radians))
    return {
      m0: Math.fround(64 * cosine),
      m1: Math.fround(64 * sine),
      m4: Math.fround(-56 * sine),
      m5: Math.fround(56 * cosine),
      m12: Math.fround(Math.round(this.x)),
      m13: Math.fround(Math.round(this.y))
    }
  }

  fenceBounds() {
    const transform = this.transform()
    const extentX = Math.abs(0.5 * transform.m0) + Math.abs(0.5 * transform.m4)
    const extentY = Math.abs(0.5 * transform.m1) + Math.abs(0.5 * transform.m5)
    return {
      left: transform.m12 - extentX,
      right: transform.m12 + extentX,
      top: transform.m13 + extentY,
      bottom: transform.m13 - extentY
    }
  }

  preciseBounds() {
    const transform = this.transform()
    const points = [[0, 0], [63, 0], [0, 55], [63, 55]].map(([x, y]) => {
      const localX = Math.fround(0.5 - (x / 64) - (0.5 / 64))
      const localY = Math.fround((y / 56) - 0.5 + (0.5 / 56))
      return [
        Math.fround(transform.m0 * localX + transform.m4 * localY + transform.m12),
        Math.fround(transform.m1 * localX + transform.m5 * localY + transform.m13)
      ]
    })
    return {
      left: Math.min(...points.map(([x]) => x)),
      right: Math.max(...points.map(([x]) => x)),
      top: Math.max(...points.map(([, y]) => y)),
      bottom: Math.min(...points.map(([, y]) => y))
    }
  }

  setXY(requestedX, requestedY) {
    let x = requestedX
    let y = requestedY
    const bounds = this.fenceBounds()
    const inset = Math.floor(Math.min(bounds.right - bounds.left, bounds.top - bounds.bottom) / 2)
    const stageX = 240 - Math.min(15, inset)
    const stageY = 180 - Math.min(15, inset)
    const renderX = Math.round(this.x)
    const renderY = Math.round(this.y)
    const dx = x - renderX
    const dy = y - renderY
    if (bounds.right + dx < -stageX) {
      x = Math.ceil(renderX - (stageX + bounds.right))
    } else if (bounds.left + dx > stageX) {
      x = Math.floor(renderX + (stageX - bounds.left))
    }
    if (bounds.top + dy < -stageY) {
      y = Math.ceil(renderY - (stageY + bounds.top))
    } else if (bounds.bottom + dy > stageY) {
      y = Math.floor(renderY + (stageY - bounds.bottom))
    }
    this.x = x
    this.y = y
  }

  setDirection(direction) {
    this.direction = scratchDirection(direction)
  }

  turnRight(degrees) {
    this.setDirection(this.direction + degrees)
  }

  move(steps) {
    const radians = (90 - this.direction) * Math.PI / 180
    this.setXY(this.x + steps * Math.cos(radians), this.y + steps * Math.sin(radians))
  }

  pointTowards(x, y) {
    this.setDirection(90 - Math.atan2(y - this.y, x - this.x) * 180 / Math.PI)
  }

  bounceIfOnEdge() {
    const bounds = this.preciseBounds()
    const distances = {
      left: Math.max(0, 240 + bounds.left),
      top: Math.max(0, 180 - bounds.top),
      right: Math.max(0, 240 - bounds.right),
      bottom: Math.max(0, 180 + bounds.bottom)
    }
    let nearestEdge = 'left'
    for (const edge of ['top', 'right', 'bottom']) {
      if (distances[edge] < distances[nearestEdge]) nearestEdge = edge
    }
    if (distances[nearestEdge] > 0) return

    const radians = (90 - this.direction) * Math.PI / 180
    let dx = Math.cos(radians)
    let dy = -Math.sin(radians)
    if (nearestEdge === 'left') dx = Math.max(0.2, Math.abs(dx))
    else if (nearestEdge === 'top') dy = Math.max(0.2, Math.abs(dy))
    else if (nearestEdge === 'right') dx = -Math.max(0.2, Math.abs(dx))
    else dy = -Math.max(0.2, Math.abs(dy))
    this.setDirection(Math.atan2(dy, dx) * 180 / Math.PI + 90)

    const fencedBounds = this.preciseBounds()
    let adjustX = 0
    let adjustY = 0
    if (fencedBounds.left < -240) adjustX += -240 - fencedBounds.left
    if (fencedBounds.right > 240) adjustX += 240 - fencedBounds.right
    if (fencedBounds.top > 180) adjustY += 180 - fencedBounds.top
    if (fencedBounds.bottom < -180) adjustY += -180 - fencedBounds.bottom
    this.setXY(this.x + adjustX, this.y + adjustY)
  }

  state() {
    return { name: 'Walker', x: this.x, y: this.y, direction: this.direction }
  }
}

const defaultFixtures = [
  {
    name: 'long-turn-move-bounce.sb3',
    reference: new ScratchRectangleReference(190, 130),
    step(sprite) {
      sprite.turnRight(15)
      sprite.move(20)
      sprite.bounceIfOnEdge()
    }
  },
  {
    name: 'long-vector-costume-bounce.sb3'
  },
  {
    name: 'long-coordinate-reporters.sb3',
    reference: new ScratchRectangleReference(0, 0),
    beforeFirstStep(sprite) {
      sprite.setXY(-200, sprite.y)
      sprite.setXY(sprite.x, -120)
    },
    step(sprite) {
      sprite.setXY(sprite.x + 7, sprite.y)
      sprite.setXY(sprite.x, sprite.y + 3)
      if (sprite.x > 200) sprite.setXY(-200, sprite.y)
      if (sprite.y > 150) sprite.setXY(sprite.x, -150)
    }
  },
  {
    name: 'long-target-rotation.sb3',
    reference: new ScratchRectangleReference(0, 0),
    step(sprite) {
      sprite.pointTowards(150, 0)
      sprite.turnRight(30)
      sprite.move(12)
      sprite.bounceIfOnEdge()
    }
  },
  {
    name: 'long-glide-cycle.sb3'
  },
  {
    name: 'long-target-glide.sb3'
  },
  {
    name: 'long-idle-key-loop.sb3',
    keyWindows: [
      { start: 101, end: 200, key: 'ArrowRight', keyCode: 39 },
      { start: 301, end: 400, key: 'ArrowLeft', keyCode: 37 }
    ]
  }
]

const requestedProject = process.env.PARROT_PARITY_PROJECT
const fixtures = requestedProject
  ? [{
      name: basename(requestedProject),
      path: resolve(requestedProject),
      keyWindows: [
        { start: 31, end: 60, key: 'ArrowRight', keyCode: 39 },
        { start: 91, end: 120, key: 'ArrowLeft', keyCode: 37 }
      ]
    }]
  : defaultFixtures.map((fixture) => ({
      ...fixture,
      path: fileURLToPath(new URL(`../examples/parity/${fixture.name}`, import.meta.url))
    }))

function captureScratchStates() {
  return new Promise((resolve, reject) => {
    const electronPath = require('electron')
    const child = spawn(electronPath, [fileURLToPath(new URL('./capture-scratch-motion.cjs', import.meta.url))], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PARROT_PARITY_FRAMES: String(LOGICAL_FRAMES),
        PARROT_PARITY_FIXTURES: fixtures.map((fixture) => fixture.name).join(','),
        PARROT_PARITY_FIXTURE_PATHS: JSON.stringify(
          fixtures.map((fixture) => ({
            name: fixture.name,
            path: fixture.path,
            keyWindows: fixture.keyWindows ?? []
          }))
        )
      }
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error, states) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      error ? reject(error) : resolve(states)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`Scratch VM parity capture timed out. ${stderr}`))
    }, Math.max(30_000, LOGICAL_FRAMES * 50))
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (code !== 0) {
        finish(new Error(`Scratch VM parity capture exited with code ${code}. ${stderr}`))
        return
      }
      const marker = '__PARROT_SCRATCH_STATES__'
      const line = stdout.split('\n').find((candidate) => candidate.startsWith(marker))
      if (!line) {
        finish(new Error(`Scratch VM parity capture returned no state. ${stderr || stdout}`))
        return
      }
      try {
        finish(undefined, JSON.parse(line.slice(marker.length)))
      } catch (error) {
        finish(error)
      }
    })
  })
}

const scratchStates = await captureScratchStates()

function keysForFrame(fixture, sequence) {
  return (fixture.keyWindows ?? [])
    .filter((window) => sequence >= window.start && sequence <= window.end)
    .map((window) => window.key)
}

function parseFrame(line) {
  if (!line.startsWith(FRAME_PREFIX)) return null
  const payload = line.slice(FRAME_PREFIX.length)
  const first = payload.indexOf(':')
  const second = payload.indexOf(':', first + 1)
  if (first < 1 || second < first + 2) return null
  const sequence = Number(payload.slice(0, first))
  const state = JSON.parse(Buffer.from(payload.slice(first + 1, second), 'base64').toString('utf8'))
  return { sequence, state }
}

async function createSession(fixture) {
  const archive = new Uint8Array(await readFile(fixture.path))
  const conversion = convertScratchToPython(archive)
  if (conversion.warnings.length) {
    throw new Error(`${fixture.name} converted with warnings: ${conversion.warnings.join('; ')}`)
  }
  const directory = await mkdtemp(join(tmpdir(), 'parrot-motion-parity-'))
  await mkdir(join(directory, 'assets'))
  const sourcePath = join(directory, 'program.py')
  const launcherPath = join(directory, 'launcher.py')
  const manifestPath = join(directory, 'project.json')
  await Promise.all([
    writeFile(sourcePath, conversion.python),
    writeFile(join(directory, 'parrot.py'), parrotRuntime),
    writeFile(launcherPath, pythonLauncher),
    writeFile(manifestPath, JSON.stringify(conversion.runtime.manifest)),
    ...conversion.runtime.assets.map((asset) => writeFile(join(directory, 'assets', asset.file), asset.data))
  ])
  return { directory, sourcePath, launcherPath, manifestPath }
}

function compareState(name, sequence, expectedLabel, expected, actualLabel, actual) {
  for (const property of ['x', 'y', 'direction']) {
    const delta = Math.abs(expected[property] - actual[property])
    if (delta > TOLERANCE) {
      throw new Error(
        `${name} diverged at logical frame ${sequence}: Walker.${property} is ` +
        `${expected[property]} in ${expectedLabel} and ${actual[property]} in ${actualLabel} (delta ${delta}).`
      )
    }
  }
}

async function verifyFixture(fixture) {
  const session = await createSession(fixture)
  const child = spawn('python3', ['-I', '-u', session.launcherPath, session.sourcePath], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      PARROT_CAPTURE: '1',
      PARROT_CLOCK_MODE: 'scratch',
      PARROT_PROJECT_MANIFEST: session.manifestPath,
      PYGAME_HIDE_SUPPORT_PROMPT: '1',
      SDL_VIDEODRIVER: 'dummy',
      SDL_AUDIODRIVER: 'dummy',
      PYTHONUNBUFFERED: '1'
    }
  })

  let buffer = ''
  let stderr = ''
  let frames = 0
  let settled = false
  if (fixture.reference) fixture.beforeFirstStep?.(fixture.reference)
  const completion = new Promise((resolve, reject) => {
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`)
      else child.kill('SIGTERM')
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => finish(new Error(
      `${fixture.name} timed out after ${frames}/${LOGICAL_FRAMES} frames. ${stderr}`
    )), 20_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      try {
        for (const line of lines) {
          const frame = parseFrame(line)
          if (!frame) continue
          frames += 1
          if (frame.sequence !== frames) {
            throw new Error(`${fixture.name} returned frame ${frame.sequence}; expected ${frames}.`)
          }
          fixture.step?.(fixture.reference)
          const scratch = scratchStates[fixture.name]?.frames?.[frames - 1]
          if (!scratch) throw new Error(`${fixture.name} omitted authoritative Scratch state at frame ${frames}.`)
          const walker = frame.state.sprites.find((sprite) => sprite.name === 'Walker')
          if (!walker) throw new Error(`${fixture.name} omitted Walker state at frame ${frames}.`)
          compareState(fixture.name, frames, 'the Scratch VM', scratch, 'Python', walker)
          if (fixture.reference) {
            compareState(
              fixture.name, frames, 'Scratch reference semantics', fixture.reference.state(),
              'the Scratch VM', scratch
            )
          }
          if (frames === LOGICAL_FRAMES) finish()
          else child.stdin.write(`${JSON.stringify({
            type: 'tick',
            sequence: frames + 1,
            keysDown: keysForFrame(fixture, frames + 1),
            mouse: { x: 0, y: 0, isDown: false }
          })}\n`)
        }
      } catch (error) {
        finish(error)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('spawn', () => child.stdin.write(`${JSON.stringify({
      type: 'tick',
      sequence: 1,
      keysDown: keysForFrame(fixture, 1),
      mouse: { x: 0, y: 0, isDown: false },
      motionGeometry: scratchStates[fixture.name]?.motionGeometry
    })}\n`))
    child.once('error', finish)
    child.once('exit', (code) => {
      if (!settled) finish(new Error(`${fixture.name} exited at frame ${frames} (code ${code}). ${stderr}`))
    })
  })

  try {
    await completion
    console.log(`✓ ${fixture.name}: ${LOGICAL_FRAMES} frame-by-frame Scratch/Python motion states match.`)
  } finally {
    await rm(session.directory, { recursive: true, force: true })
  }
}

for (const fixture of fixtures) await verifyFixture(fixture)
