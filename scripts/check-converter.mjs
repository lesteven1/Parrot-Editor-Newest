import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { convertScratchToPython } from '../src/main/converter.ts'
import {
  motionParityMismatch,
  UniversalFrameCoordinator
} from '../src/renderer/src/runtime/frame-coordinator.ts'

const examples = [
  'arrow-key-walker.sb3',
  'repeat-move.sb3',
  'target-visibility.sb3',
  'variables-and-operators.sb3',
  'edge-reset.sb3',
  'motion-complete.sb3',
  'available-blocks-showcase.sb3'
]

const requiredOpcodes = new Set([
  'event_whenflagclicked',
  'control_forever', 'control_repeat', 'control_if', 'control_if_else',
  'motion_movesteps', 'motion_turnright', 'motion_turnleft',
  'motion_goto', 'motion_goto_menu', 'motion_gotoxy',
  'motion_glideto', 'motion_glideto_menu', 'motion_glidesecstoxy',
  'motion_pointindirection', 'motion_pointtowards', 'motion_pointtowards_menu',
  'motion_setx', 'motion_sety', 'motion_changexby', 'motion_changeyby',
  'motion_ifonedgebounce', 'motion_setrotationstyle',
  'motion_xposition', 'motion_yposition', 'motion_direction',
  'sensing_keypressed', 'sensing_touchingobject',
  'operator_add', 'operator_subtract', 'operator_multiply', 'operator_divide',
  'operator_lt', 'operator_equals', 'operator_gt', 'operator_and', 'operator_or', 'operator_not',
  'data_variable', 'data_setvariableto', 'data_changevariableby',
  'looks_show', 'looks_hide'
])

const forbiddenLearnerSource = [
  'class Sprite', 'pygame.image.save', '__PARROT_FRAME__:', 'base64', 'threading.Condition',
  'PARROT_CLOCK_MODE', 'PARROT_PROJECT_MANIFEST', '"targets":', '"asset"'
]

const coveredOpcodes = new Set()
const parrotRuntime = await readFile(new URL('../src/main/python/parrot.py', import.meta.url), 'utf8')
const pythonLauncher = await readFile(new URL('../src/main/python/launcher.py', import.meta.url), 'utf8')

function parseFrameLine(line) {
  if (!line.startsWith('__PARROT_FRAME__:')) return null
  const payload = line.slice('__PARROT_FRAME__:'.length)
  const firstSeparator = payload.indexOf(':')
  const secondSeparator = payload.indexOf(':', firstSeparator + 1)
  const sequence = Number(payload.slice(0, firstSeparator))
  const encodedState = payload.slice(firstSeparator + 1, secondSeparator)
  const data = payload.slice(secondSeparator + 1)
  if (
    firstSeparator <= 0 || secondSeparator <= firstSeparator + 1 ||
    !Number.isSafeInteger(sequence) || sequence <= 0 || !data
  ) return null
  try {
    const state = JSON.parse(Buffer.from(encodedState, 'base64').toString('utf8'))
    if (!Array.isArray(state.sprites)) return null
    return { sequence, data, state }
  } catch {
    return null
  }
}

async function createSession(name, conversion) {
  const directory = await mkdtemp(join(tmpdir(), 'parrot-converter-check-'))
  const assetsDirectory = join(directory, 'assets')
  await mkdir(assetsDirectory)
  const sourcePath = join(directory, name.replace(/\.sb3$/i, '.py'))
  const launcherPath = join(directory, '_parrot_launcher.py')
  const manifestPath = join(directory, 'project.json')
  await Promise.all([
    writeFile(sourcePath, conversion.python),
    writeFile(join(directory, 'parrot.py'), parrotRuntime),
    writeFile(launcherPath, pythonLauncher),
    writeFile(manifestPath, JSON.stringify(conversion.runtime.manifest)),
    ...conversion.runtime.assets.map((asset) => writeFile(join(assetsDirectory, asset.file), asset.data))
  ])
  return { directory, sourcePath, launcherPath, manifestPath }
}

function pythonProcess(session, clockMode = 'internal') {
  return spawn('python3', ['-I', '-u', session.launcherPath, session.sourcePath], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      PARROT_CAPTURE: '1',
      PARROT_CLOCK_MODE: clockMode,
      PARROT_PROJECT_MANIFEST: session.manifestPath,
      PYGAME_HIDE_SUPPORT_PROMPT: '1',
      SDL_VIDEODRIVER: 'dummy',
      SDL_AUDIODRIVER: 'dummy',
      PYTHONUNBUFFERED: '1'
    }
  })
}

function waitForFrames(name, session, requiredFrames = 30) {
  return new Promise((resolve, reject) => {
    const child = pythonProcess(session)
    let frames = 0
    let stdout = ''
    let stderr = ''
    let complete = false
    let firstFrameAt = 0
    let lastFrameAt = 0
    let firstFrame = ''
    let lastState = null
    const finish = (error, frameRate) => {
      if (complete) return
      complete = true
      clearTimeout(timer)
      if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`)
      else child.kill('SIGTERM')
      error ? reject(error) : resolve(frameRate)
    }
    const timer = setTimeout(() => finish(new Error(`${name} did not render in time. ${stderr}`)), 8_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        const frame = parseFrameLine(line)
        if (frame) {
          lastState = frame.state
          lastFrameAt = performance.now()
          if (frames === 0) {
            firstFrameAt = lastFrameAt
            firstFrame = frame.data
          }
          frames += 1
        }
        if (frames >= requiredFrames) {
          finish(undefined, {
            frameRate: (frames - 1) / ((lastFrameAt - firstFrameAt) / 1_000),
            firstFrame,
            lastState
          })
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (!complete) finish(new Error(`${name} exited before rendering (code ${code}). ${stderr}`))
    })
  })
}

function waitForFirstFrame(name, session) {
  return new Promise((resolve, reject) => {
    const child = pythonProcess(session)
    let stdout = ''
    let stderr = ''
    let complete = false
    const finish = (error, frame) => {
      if (complete) return
      complete = true
      clearTimeout(timer)
      if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`)
      else child.kill('SIGTERM')
      error ? reject(error) : resolve(frame)
    }
    const timer = setTimeout(() => finish(new Error(`${name} edit did not render in time. ${stderr}`)), 5_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      const frame = lines.map(parseFrameLine).find(Boolean)
      if (frame) finish(undefined, frame.data)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (!complete) finish(new Error(`${name} edit exited before rendering (code ${code}). ${stderr}`))
    })
  })
}

function verifyScratchClock(name, session, tickCount = 12) {
  return new Promise((resolve, reject) => {
    const child = pythonProcess(session, 'scratch')
    let frames = 0
    let stdout = ''
    let stderr = ''
    let complete = false
    let quietTimer
    const finish = (error) => {
      if (complete) return
      complete = true
      clearTimeout(startTimer)
      clearTimeout(timeoutTimer)
      clearTimeout(quietTimer)
      if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`)
      else child.kill('SIGTERM')
      error ? reject(error) : resolve()
    }
    const timeoutTimer = setTimeout(() => {
      finish(new Error(`${name} did not follow Scratch ticks in time (${frames}/${tickCount} frames). ${stderr}`))
    }, 5_000)
    const startTimer = setTimeout(() => {
      if (frames !== 0) {
        finish(new Error(`${name} rendered before receiving a Scratch tick.`))
        return
      }
      child.stdin.write(`${JSON.stringify({
        type: 'tick', sequence: 1, keysDown: [], mouse: { x: 12, y: -8, isDown: true }
      })}\n`)
    }, 200)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        const frame = parseFrameLine(line)
        if (!frame) continue
        frames += 1
        if (frame.sequence !== frames) {
          finish(new Error(`${name} returned coordinated frame ${frame.sequence}; expected ${frames}.`))
        } else if (frames > tickCount) {
          finish(new Error(`${name} rendered more than one frame per Scratch tick.`))
        } else if (frames === tickCount) {
          quietTimer = setTimeout(() => finish(), 120)
        } else {
          const sequence = frames + 1
          child.stdin.write(`${JSON.stringify({
            type: 'tick', sequence, keysDown: [], mouse: { x: 12, y: -8, isDown: true }
          })}\n`)
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (!complete) finish(new Error(`${name} exited during Scratch-clock verification (code ${code}). ${stderr}`))
    })
  })
}

function verifyClockHandoff(name, session) {
  return new Promise((resolve, reject) => {
    const child = pythonProcess(session, 'scratch')
    let stdout = ''
    let stderr = ''
    let phase = 'coordinated'
    let frames = 0
    let pausedFrames = 0
    let complete = false
    let settleTimer
    let quietTimer
    const finish = (error) => {
      if (complete) return
      complete = true
      clearTimeout(timer)
      clearTimeout(settleTimer)
      clearTimeout(quietTimer)
      if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`)
      else child.kill('SIGTERM')
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(() => {
      finish(new Error(`${name} did not continue after leaving the coordinated clock. ${stderr}`))
    }, 5_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      for (const line of lines) {
        const frame = parseFrameLine(line)
        if (!frame) continue
        frames += 1
        if (phase === 'coordinated') {
          if (frame.sequence !== 1) {
            finish(new Error(`${name} returned ${frame.sequence} before the clock handoff.`))
            return
          }
          phase = 'settling'
          child.stdin.write(`${JSON.stringify({ type: 'clockMode', clockMode: 'paused' })}\n`)
          settleTimer = setTimeout(() => {
            pausedFrames = frames
            phase = 'paused'
            quietTimer = setTimeout(() => {
              if (frames !== pausedFrames) {
                finish(new Error(`${name} continued rendering while paused.`))
                return
              }
              phase = 'resumed'
              child.stdin.write(`${JSON.stringify({ type: 'clockMode', clockMode: 'internal' })}\n`)
            }, 150)
          }, 100)
        } else if (phase === 'resumed') {
          finish()
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('spawn', () => {
      child.stdin.write(`${JSON.stringify({
        type: 'tick', sequence: 1, keysDown: [], mouse: { x: 0, y: 0, isDown: false }
      })}\n`)
    })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (!complete) finish(new Error(`${name} exited during clock handoff (code ${code}). ${stderr}`))
    })
  })
}

function waitForCoordinatedFrame(name, session, mouse) {
  return new Promise((resolve, reject) => {
    const child = pythonProcess(session, 'scratch')
    let stdout = ''
    let stderr = ''
    let complete = false
    const finish = (error, frame) => {
      if (complete) return
      complete = true
      clearTimeout(timer)
      if (child.stdin.writable) child.stdin.end(`${JSON.stringify({ type: 'stop' })}\n`)
      else child.kill('SIGTERM')
      error ? reject(error) : resolve(frame)
    }
    const timer = setTimeout(() => finish(new Error(`${name} did not return pointer state. ${stderr}`)), 5_000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      const lines = stdout.split('\n')
      stdout = lines.pop() ?? ''
      const frame = lines.map(parseFrameLine).find(Boolean)
      if (frame) finish(undefined, frame)
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.once('spawn', () => {
      child.stdin.write(`${JSON.stringify({ type: 'tick', sequence: 1, keysDown: [], mouse })}\n`)
    })
    child.once('error', finish)
    child.once('exit', (code) => {
      if (!complete) finish(new Error(`${name} exited before returning pointer state (code ${code}). ${stderr}`))
    })
  })
}

async function verifyUniversalCoordinator() {
  const presentedByRun = [[], []]
  const parityByRun = [[], []]
  let currentRun = 0
  let requestsInFlight = 0
  let maximumRequestsInFlight = 0
  let coordinator
  const motionGeometry = {
    sprites: [{
      name: 'Walker',
      skinSize: [64, 56],
      rotationCenter: [32, 28],
      hullPoints: [[0, 0], [63, 55]]
    }]
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The universal frame coordinator test timed out.')), 2_000)
    coordinator = new UniversalFrameCoordinator({
      captureInput: () => ({
        keys: [{ key: 'ArrowRight', keyCode: 39 }],
        pointer: { x: 24, y: -12, isDown: true },
        motionGeometry
      }),
      requestPythonFrame: (sequence, input) => {
        if (
          input.keys.length !== 1 || input.keys[0].key !== 'ArrowRight' ||
          input.pointer.x !== 24 || input.pointer.y !== -12 || !input.pointer.isDown ||
          (sequence === 1 ? input.motionGeometry !== motionGeometry : input.motionGeometry !== undefined)
        ) {
          return Promise.reject(new Error('The coordinator did not preserve the frame input snapshot.'))
        }
        requestsInFlight += 1
        maximumRequestsInFlight = Math.max(maximumRequestsInFlight, requestsInFlight)
        return new Promise((resolveFrame) => {
          setTimeout(() => {
            requestsInFlight -= 1
            resolveFrame({
              sequence,
              dataUrl: `frame-${sequence}`,
              state: { sprites: [{ name: 'Walker', x: sequence, y: 0, direction: 90 }] }
            })
          }, 2)
        })
      },
      stepScratch: (sequence) => ({
        running: sequence < 4,
        state: {
          sprites: [{
            name: 'Walker',
            x: sequence === 2 || sequence === 3 ? sequence + 10 : sequence,
            y: 0,
            direction: 90
          }]
        }
      }),
      presentPair: (frame) => presentedByRun[currentRun].push(frame.sequence),
      onParityUpdate: (status) => parityByRun[currentRun].push(status),
      onComplete: () => {
        currentRun += 1
        if (currentRun === 1) {
          coordinator.start()
        } else {
          clearTimeout(timeout)
          resolve()
        }
      },
      onError: (error) => {
        clearTimeout(timeout)
        reject(error)
      }
    }, { frameIntervalMs: 0, frameTimeoutMs: 500 })
    coordinator.start()
  })

  const expected = '1,2,3,4'
  if (presentedByRun.some((frames) => frames.join(',') !== expected)) {
    throw new Error(`The coordinator did not present ordered reset sequences: ${JSON.stringify(presentedByRun)}.`)
  }
  if (maximumRequestsInFlight !== 1 || coordinator.diagnostics.maximumInFlight !== 1) {
    throw new Error('The coordinator allowed more than one frame request in flight.')
  }
  for (const updates of parityByRun) {
    if (
      updates.length !== 3 ||
      !updates[0].currentlyDiverged || updates[0].mismatchedFrames !== 1 ||
      updates[0].firstMismatchSequence !== 2 || updates[0].latestMismatchSequence !== 2 ||
      !updates[1].currentlyDiverged || updates[1].mismatchedFrames !== 2 ||
      updates[1].firstMismatchSequence !== 2 || updates[1].latestMismatchSequence !== 3 ||
      updates[2].currentlyDiverged || updates[2].mismatchedFrames !== 2 ||
      updates[2].lastReconvergedSequence !== 4
    ) {
      throw new Error(`The coordinator did not aggregate divergence and reconvergence: ${JSON.stringify(parityByRun)}.`)
    }
  }
  if (
    coordinator.diagnostics.currentlyDiverged ||
    coordinator.diagnostics.mismatchedFrames !== 2 ||
    coordinator.diagnostics.firstMismatchSequence !== 2 ||
    coordinator.diagnostics.latestMismatchSequence !== 3 ||
    coordinator.diagnostics.lastReconvergedSequence !== 4
  ) {
    throw new Error(`The coordinator diagnostics did not retain the completed run's parity history: ${JSON.stringify(coordinator.diagnostics)}.`)
  }
  const wrappedDirectionMatch = motionParityMismatch(
    7,
    { sprites: [{ name: 'Walker', x: 10, y: -5, direction: -180 }] },
    { sprites: [{ name: 'Walker', x: 10, y: -5, direction: 180 }] }
  )
  const positionMismatch = motionParityMismatch(
    8,
    { sprites: [{ name: 'Walker', x: 10, y: -5, direction: 90 }] },
    { sprites: [{ name: 'Walker', x: 10.5, y: -5, direction: 90 }] }
  )
  if (wrappedDirectionMatch || !positionMismatch?.includes('frame 8: Walker.x')) {
    throw new Error('The coordinator motion-state comparator did not apply circular directions and exact diagnostics.')
  }
  console.log(
    '✓ Universal frame coordinator applies backpressure, records nonfatal Motion divergence, sends geometry once, and resets cleanly.'
  )
}

await verifyUniversalCoordinator()

for (const name of examples) {
  const archive = new Uint8Array(await readFile(new URL(`../examples/${name}`, import.meta.url)))
  const files = unzipSync(archive)
  const project = JSON.parse(new TextDecoder().decode(files['project.json']))
  if (name === 'available-blocks-showcase.sb3') {
    const showcaseOpcodes = new Set(project.targets.flatMap((target) => (
      Object.values(target.blocks).map((block) => block.opcode)
    )))
    const missingOpcodes = [...requiredOpcodes].filter((opcode) => !showcaseOpcodes.has(opcode))
    if (missingOpcodes.length) {
      throw new Error(`The all-blocks showcase omitted: ${missingOpcodes.join(', ')}.`)
    }
    const assetIds = new Set(project.targets.flatMap((target) => target.costumes.map((item) => item.assetId)))
    for (const requiredAsset of [
      'cd21514d0531fdffb22204e0ec5ed84a',
      'bcf454acf82e4504149f7ffe07081dbc',
      '0fb9be3e8397c983338cb71dc84d0b25'
    ]) {
      if (!assetIds.has(requiredAsset)) {
        throw new Error(`The all-blocks showcase omitted default Scratch asset ${requiredAsset}.`)
      }
    }
    const sprite = project.targets.find((target) => target.name === 'Sprite1')
    const movingTarget = project.targets.find((target) => target.name === 'Target')
    const keyOptions = new Set(Object.values(sprite?.blocks ?? {}).flatMap((block) => (
      block.opcode === 'sensing_keyoptions' ? [block.fields.KEY_OPTION?.[0]] : []
    )))
    for (const arrow of ['left arrow', 'right arrow', 'up arrow', 'down arrow']) {
      if (!keyOptions.has(arrow)) throw new Error(`The interactive showcase omitted the ${arrow} control.`)
    }
    const targetOpcodes = new Set(Object.values(movingTarget?.blocks ?? {}).map((block) => block.opcode))
    for (const opcode of ['event_whenflagclicked', 'control_forever', 'motion_movesteps', 'motion_ifonedgebounce']) {
      if (!targetOpcodes.has(opcode)) throw new Error(`The moving target omitted ${opcode}.`)
    }
    if (!project.monitors.some((monitor) => monitor.id === 'parrot-score' && monitor.visible)) {
      throw new Error('The interactive showcase score monitor is not visible.')
    }
  }
  for (const target of project.targets) {
    for (const block of Object.values(target.blocks)) {
      coveredOpcodes.add(block.opcode)
    }
  }

  const conversion = convertScratchToPython(archive)
  if (!conversion.python.includes('from parrot import')) {
    throw new Error(`${name} did not import the reusable Parrot runtime.`)
  }
  const forbidden = forbiddenLearnerSource.find((text) => conversion.python.includes(text))
  if (forbidden) throw new Error(`${name} leaked ${JSON.stringify(forbidden)} into learner source.`)
  if (conversion.warnings.length) {
    throw new Error(`${name} converted with warnings: ${conversion.warnings.join('; ')}`)
  }

  const session = await createSession(name, conversion)
  try {
    const { frameRate, firstFrame, lastState } = await waitForFrames(name, session)
    if (frameRate < 57 || frameRate > 63) {
      throw new Error(`${name} rendered at ${frameRate.toFixed(1)} FPS instead of 60 FPS.`)
    }
    await verifyScratchClock(name, session)
    if (name === 'arrow-key-walker.sb3') await verifyClockHandoff(name, session)
    if (!lastState || !Array.isArray(lastState.sprites) || !lastState.sprites.length) {
      throw new Error(`${name} did not attach bounded sprite state to its Python frame.`)
    }
    for (const sprite of lastState.sprites) {
      if (
        typeof sprite.name !== 'string' ||
        ![sprite.x, sprite.y, sprite.direction].every(Number.isFinite)
      ) throw new Error(`${name} emitted invalid sprite motion state.`)
    }
    if (name === 'arrow-key-walker.sb3') {
      const editedSource = conversion.python.replace('walker.set_x(0)', 'walker.set_x(80)')
      if (editedSource === conversion.python) throw new Error('The editable example marker was not generated.')
      const editedSession = await createSession(name, { ...conversion, python: editedSource })
      try {
        const editedFrame = await waitForFirstFrame(name, editedSession)
        if (editedFrame === firstFrame) throw new Error('Editing learner source did not change the rendered output.')
      } finally {
        await rm(editedSession.directory, { recursive: true, force: true })
      }
    }
    if (name === 'motion-complete.sb3') {
      const walkerState = lastState.sprites.find((sprite) => sprite.name === 'Walker')
      if (!walkerState) throw new Error('The complete Motion example omitted Walker state.')
      if (walkerState.x < 200 || walkerState.x > 220 || Math.abs(walkerState.y) > 0.001) {
        throw new Error(`Edge bounce did not fence Walker correctly: ${JSON.stringify(walkerState)}.`)
      }
      if (Math.abs(walkerState.direction - (-90)) > 0.001) {
        throw new Error(`Direction wrapping/bounce produced ${walkerState.direction}, expected -90.`)
      }
      for (const marker of [
        'walker.move(', 'walker.turn_right(', 'walker.turn_left(', 'walker.go_to_target(',
        'await walker.glide_to_target(', 'await walker.glide_to(', 'walker.point_towards(',
        'walker.bounce_if_on_edge()', 'walker.set_rotation_style(', 'walker.direction'
      ]) {
        if (!conversion.python.includes(marker)) {
          throw new Error(`The complete Motion example did not generate readable ${marker} code.`)
        }
      }
      const pointerSource = [
        'from parrot import Project',
        '',
        'project = Project()',
        'walker = project.sprite("Walker")',
        'target = project.sprite("Target")',
        '',
        '@project.when_green_flag',
        'async def pointer_motion():',
        '    walker.go_to_target("_mouse_")',
        '    target.go_to(0, 0)',
        '    target.point_towards("_mouse_")',
        '    while True:',
        '        await project.next_frame()',
        '',
        'project.run()',
        ''
      ].join('\n')
      const pointerSession = await createSession(name, { ...conversion, python: pointerSource })
      try {
        const pointer = { x: 37, y: -24, isDown: true }
        const pointerFrame = await waitForCoordinatedFrame(name, pointerSession, pointer)
        const pointerWalker = pointerFrame.state.sprites.find((sprite) => sprite.name === 'Walker')
        const pointerTarget = pointerFrame.state.sprites.find((sprite) => sprite.name === 'Target')
        const expectedDirection = 90 - (Math.atan2(pointer.y, pointer.x) * 180 / Math.PI)
        if (!pointerWalker || pointerWalker.x !== pointer.x || pointerWalker.y !== pointer.y) {
          throw new Error(`go to mouse did not consume the coordinated pointer: ${JSON.stringify(pointerWalker)}.`)
        }
        if (!pointerTarget || Math.abs(pointerTarget.direction - expectedDirection) > 0.001) {
          throw new Error(`point towards mouse did not consume the coordinated pointer: ${JSON.stringify(pointerTarget)}.`)
        }
      } finally {
        await rm(pointerSession.directory, { recursive: true, force: true })
      }
    }
    console.log(
      `✓ ${name}: ${conversion.convertedBlockCount} blocks, ${Buffer.byteLength(conversion.python)} source bytes, ` +
      `${frameRate.toFixed(1)} FPS alone, and numbered coordinated-frame protocol`
    )
  } finally {
    await rm(session.directory, { recursive: true, force: true })
  }
}

const missing = [...requiredOpcodes].filter((opcode) => !coveredOpcodes.has(opcode))
if (missing.length) throw new Error(`Example coverage is missing: ${missing.join(', ')}`)
console.log(`✓ All ${requiredOpcodes.size} Base V0.3.1.motion opcodes are covered by the examples.`)
