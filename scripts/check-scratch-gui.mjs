import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  SCRATCH_GUI_DESIGN_SIZE,
  SCRATCH_GUI_LAYOUT_PROFILES,
  SCRATCH_EDITOR_TABS,
  editScratchSprite,
  fitScratchGui,
  layoutScratchGui,
  restrictedToolboxForVm,
  scratchStageFit,
  selectScratchTarget,
  shareScratchGuiVmState,
  shouldOpenEditorViewAfterFileOpen
} from '../src/renderer/src/scratch/editor-model.ts'

const adapterSource = readFileSync(new URL('../src/renderer/src/scratch/ScratchGuiAdapter.tsx', import.meta.url), 'utf8')
const runtimeSource = readFileSync(new URL('../src/renderer/src/scratch/useScratchRuntime.ts', import.meta.url), 'utf8')
const storageSource = readFileSync(new URL('../src/renderer/src/scratch/library-assets.ts', import.meta.url), 'utf8')
const viteSource = readFileSync(new URL('../electron.vite.config.ts', import.meta.url), 'utf8')

test('Scratch GUI exposes the three local editor tabs', () => {
  assert.deepEqual([...SCRATCH_EDITOR_TABS], ['code', 'costumes', 'sounds'])
})

test('target selection and sprite property edits use the shared VM contract', () => {
  const calls = []
  const vm = {
    setEditingTarget: (id) => calls.push(['select', id]),
    postSpriteInfo: (properties) => calls.push(['edit', properties])
  }
  selectScratchTarget(vm, 'sprite-2')
  editScratchSprite(vm, {
    name: 'Walker', x: 42, y: -17, visible: false,
    size: 120, direction: -90, rotationStyle: 'left-right'
  })
  assert.deepEqual(calls, [
    ['select', 'sprite-2'],
    ['edit', {
      name: 'Walker', x: 42, y: -17, visible: false,
      size: 120, direction: -90, rotationStyle: 'left-right'
    }]
  ])
})

test('Scratch GUI state retains the exact Parrot VM instance', () => {
  const vm = {
    editingTarget: { isStage: false, variables: {} },
    setEditingTarget() {},
    postSpriteInfo() {}
  }
  const state = shareScratchGuiVmState({
    vmStatus: { started: false },
    projectState: { loadingState: 'NOT_LOADED' },
    toolbox: {}
  }, vm)
  assert.equal(state.vm, vm)
  assert.equal(state.vmStatus.started, true)
  assert.equal(state.projectState.loadingState, 'SHOWING_WITHOUT_ID')
})

test('the Parrot toolbox stays within supported conversion scope', () => {
  const spriteToolbox = restrictedToolboxForVm({
    editingTarget: {
      isStage: false,
      variables: { score: { name: 'score & time' } }
    }
  })
  assert.match(spriteToolbox, /type="motion_movesteps"/)
  assert.match(spriteToolbox, /type="event_whenflagclicked"/)
  assert.match(spriteToolbox, /score &amp; time/)
  assert.doesNotMatch(spriteToolbox, /category name="Sound"/)
  assert.doesNotMatch(spriteToolbox, /type="looks_say"/)

  const stageToolbox = restrictedToolboxForVm({
    editingTarget: { isStage: true, variables: {} }
  })
  assert.doesNotMatch(stageToolbox, /category name="Motion"/)
})

test('stage fitting always preserves Scratch 4:3 geometry', () => {
  assert.deepEqual(scratchStageFit(1000, 1000), { width: 1000, height: 750 })
  assert.deepEqual(scratchStageFit(400, 1000), { width: 400, height: 300 })
  const fitted = scratchStageFit(853, 419)
  assert.equal(fitted.width / fitted.height, 4 / 3)
})

test('the full editor scales into both required layout ranges', () => {
  assert.equal(fitScratchGui(1096, 650, 'large'), 1)
  assert.ok(fitScratchGui(1024, 650, 'large') < 1)
  assert.equal(fitScratchGui(856, 650, 'small'), 1)
  assert.equal(fitScratchGui(960, 650, 'small'), 1)
  assert.ok(fitScratchGui(600, 350) > 0 && fitScratchGui(600, 350) < 1)
  assert.ok(fitScratchGui(930, 520) > fitScratchGui(600, 350))
})

test('the full editor surface expands through tall and wide panes', () => {
  const tall = layoutScratchGui(1024, 1200)
  assert.deepEqual(tall, { scale: 1024 / 1096, width: 1096, height: 1284.375 })

  const compact = layoutScratchGui(600, 350)
  assert.ok(Math.abs(compact.width * compact.scale - 600) < 0.001)
  assert.ok(Math.abs(compact.height * compact.scale - 350) < 0.001)
  assert.ok(compact.width >= 1096)
  assert.ok(compact.height >= 650)
})

test('automatic fitting keeps the complete Scratch stage inside its tab', () => {
  assert.equal(SCRATCH_GUI_DESIGN_SIZE.width, 1096)
  assert.equal(SCRATCH_GUI_LAYOUT_PROFILES.small.width, 856)
  for (const mode of ['small', 'large']) {
    for (const [width, height] of [[540, 680], [600, 350], [930, 520], [1280, 720]]) {
      const fitted = layoutScratchGui(width, height, mode)
      assert.ok(fitted.width * fitted.scale <= width + 0.001)
      assert.ok(fitted.height * fitted.scale <= height + 0.001)
    }
  }
})

test('opening the first file explicitly requests Editor View', () => {
  assert.equal(shouldOpenEditorViewAfterFileOpen(0), true)
  assert.equal(shouldOpenEditorViewAfterFileOpen(1), false)
})

test('Scratch fullscreen always exposes a Parrot-owned normal-screen action', () => {
  assert.match(adapterSource, /scratch-gui\/mode\/SET_FULL_SCREEN/)
  assert.match(adapterSource, /aria-label="Exit Scratch fullscreen"/)
  assert.match(adapterSource, /VscodeIcon name="screen-normal"/)
})

test('Scratch runtimes release WebGL and do not reload for same-tab snapshots', () => {
  assert.match(runtimeSource, /getExtension\('WEBGL_lose_context'\)\?\.loseContext\(\)/)
  assert.match(runtimeSource, /projectBytesRef\.current = projectBytes/)
  assert.match(runtimeSource, /\}, \[enabled, projectKey\]\)/)
  assert.doesNotMatch(runtimeSource, /\}, \[enabled, projectBytes\]\)/)
})

test('the complete costume manifest and every unique costume asset are packaged and verified', () => {
  const manifestUrl = new URL('../resources/scratch-library/costumes.json', import.meta.url)
  const costumes = JSON.parse(readFileSync(manifestUrl, 'utf8'))
  assert.equal(costumes.length, 915)
  const files = [...new Set(costumes.map((costume) => costume.md5ext))]
  assert.equal(files.length, 912)
  for (const file of files) {
    const bytes = readFileSync(new URL(`../resources/scratch-library/${file}`, import.meta.url))
    assert.equal(createHash('md5').update(bytes).digest('hex'), file.split('.')[0], file)
  }
})

test('costume thumbnails and selected costumes use the same offline-first store in dev and production', () => {
  assert.match(adapterSource, /platform="DESKTOP"/)
  assert.match(storageSource, /stores\.unshift\(localStore\)/)
  assert.match(storageSource, /\.\/scratch-library\//)
  assert.match(viteSource, /pathname\.startsWith\('\/scratch-library\/'\)/)
  assert.match(viteSource, /fileName: `scratch-library\/\$\{relative\}`/)
})
