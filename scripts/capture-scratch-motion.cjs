const { app, BrowserWindow } = require('electron')
const { existsSync, readFileSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const FRAME_COUNT = Number(process.env.PARROT_PARITY_FRAMES || 1200)
const FIXTURES = (process.env.PARROT_PARITY_FIXTURES || '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
const FIXTURE_PATHS = process.env.PARROT_PARITY_FIXTURE_PATHS
  ? JSON.parse(process.env.PARROT_PARITY_FIXTURE_PATHS)
  : []
const DEBUG = process.env.PARROT_PARITY_DEBUG === '1'
const debug = (message) => { if (DEBUG) console.error(`[motion-parity] ${message}`) }

app.commandLine.appendSwitch('headless')

function packageRoot(name) {
  let directory = dirname(require.resolve(name))
  while (directory !== dirname(directory)) {
    const packagePath = join(directory, 'package.json')
    if (existsSync(packagePath)) {
      const packageData = JSON.parse(readFileSync(packagePath, 'utf8'))
      if (packageData.name === name) return directory
    }
    directory = dirname(directory)
  }
  throw new Error(`Could not locate ${name}.`)
}

app.whenReady().then(async () => {
  debug('Electron ready')
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false
    }
  })
  if (DEBUG) {
    window.webContents.on('console-message', (_event, level, message) => {
      debug(`renderer ${level}: ${message}`)
    })
  }

  try {
    await window.loadURL('data:text/html,<canvas id="stage" width="480" height="360"></canvas>')
    debug('Harness page loaded')
    const paths = {
      vm: join(packageRoot('@scratch/scratch-vm'), 'dist/web/scratch-vm.js'),
      render: join(packageRoot('@scratch/scratch-render'), 'dist/web/scratch-render.js'),
      storage: join(packageRoot('@scratch/scratch-storage'), 'dist/web/scratch-storage.js'),
      bitmapAdapter: join(packageRoot('@scratch/scratch-svg-renderer'), 'dist/web/scratch-svg-renderer.js')
    }
    const fixtures = FIXTURE_PATHS.length
      ? FIXTURE_PATHS
      : FIXTURES.map((name) => ({ name, path: resolve('examples/parity', name) }))
    const states = await window.webContents.executeJavaScript(`(async () => {
      const fs = require('node:fs')
      const VirtualMachine = require(${JSON.stringify(paths.vm)})
      const ScratchRender = require(${JSON.stringify(paths.render)})
      const ScratchStorageModule = require(${JSON.stringify(paths.storage)})
      const ScratchSvgRenderer = require(${JSON.stringify(paths.bitmapAdapter)})
      const BitmapAdapter = ScratchSvgRenderer.BitmapAdapter || ScratchSvgRenderer.default?.BitmapAdapter
      const ScratchStorage = ScratchStorageModule.ScratchStorage || ScratchStorageModule
      const results = {}
      const debug = ${DEBUG ? 'console.error.bind(console)' : '() => {}'}

      for (const fixture of ${JSON.stringify(fixtures)}) {
        debug('[motion-parity] loading ' + fixture.name)
        const canvas = document.getElementById('stage')
        const vm = new VirtualMachine()
        const renderer = new ScratchRender(canvas)
        renderer.resize(480, 360)
        vm.attachRenderer(renderer)
        vm.attachStorage(new ScratchStorage())
        vm.attachV2BitmapAdapter(new BitmapAdapter())
        await vm.loadProject(fs.readFileSync(fixture.path))
        debug('[motion-parity] project loaded ' + fixture.name)
        await new Promise((resolve, reject) => {
          const deadline = performance.now() + 5000
          const checkSkins = () => {
            const ready = vm.runtime.targets.every((target) => {
              if (target.drawableID === null) return true
              const skin = renderer._allDrawables[target.drawableID]?.skin
              return !skin || skin._svgImageLoaded !== false
            })
            if (ready) resolve()
            else if (performance.now() > deadline) reject(new Error('Scratch SVG skins did not finish loading.'))
            else requestAnimationFrame(checkSkins)
          }
          checkSkins()
        })
        renderer.draw()
        debug('[motion-parity] skins ready ' + fixture.name)

        const motionGeometry = {
          sprites: vm.runtime.targets.flatMap((target) => {
            if (target.isStage || target.isOriginal === false || target.drawableID === null) return []
            renderer.getBounds(target.drawableID)
            const drawable = renderer._allDrawables[target.drawableID]
            if (!drawable?.skin) return []
            return [{
              name: target.getName(),
              skinSize: [Number(drawable.skin.size[0]), Number(drawable.skin.size[1])],
              rotationCenter: [
                Number(drawable.skin.rotationCenter[0]),
                Number(drawable.skin.rotationCenter[1])
              ],
              hullPoints: (drawable._convexHullPoints || []).slice(0, 8192).map((point) => [
                Number(point[0]), Number(point[1])
              ])
            }]
          })
        }

        const runtimeStep = vm.runtime._step.bind(vm.runtime)
        vm.runtime._step = () => {}
        vm.start()
        vm.greenFlag()
        debug('[motion-parity] green flag ' + fixture.name)
        const frames = []
        let postedKeys = new Map()
        for (let sequence = 1; sequence <= ${FRAME_COUNT}; sequence += 1) {
          const nextKeys = new Map((fixture.keyWindows || [])
            .filter((window) => sequence >= window.start && sequence <= window.end)
            .map((window) => [window.key, window.keyCode]))
          for (const [key, keyCode] of postedKeys) {
            if (!nextKeys.has(key)) vm.postIOData('keyboard', { key, keyCode, isDown: false })
          }
          for (const [key, keyCode] of nextKeys) {
            if (!postedKeys.has(key)) vm.postIOData('keyboard', { key, keyCode, isDown: true })
          }
          postedKeys = nextKeys
          const originalDateNow = Date.now
          const schedulerTimer = vm.runtime.sequencer?.timer
          const originalSchedulerNow = schedulerTimer?.nowObj
          if (schedulerTimer) schedulerTimer.nowObj = { now: originalDateNow }
          Date.now = () => Math.round(sequence * (1000 / 60))
          try {
            runtimeStep()
          } finally {
            Date.now = originalDateNow
            if (schedulerTimer && originalSchedulerNow) schedulerTimer.nowObj = originalSchedulerNow
          }
          const walker = vm.runtime.getSpriteTargetByName('Walker')
          frames.push({
            name: walker.getName(),
            x: walker.x,
            y: walker.y,
            direction: walker.direction
          })
        }
        results[fixture.name] = { frames, motionGeometry }
        debug('[motion-parity] captured ' + fixture.name)
        vm.quit()
        renderer.dispose?.()
      }
      return results
    })()`)
    await new Promise((resolve, reject) => {
      process.stdout.write(`__PARROT_SCRATCH_STATES__${JSON.stringify(states)}\n`, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  } finally {
    window.destroy()
    app.quit()
  }
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
  app.quit()
})
