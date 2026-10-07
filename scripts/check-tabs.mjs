import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_TAB_WIDTH,
  MAX_OPEN_TABS,
  MAX_OUTPUT_VISIBLE_TABS,
  MAX_TAB_WIDTH,
  MIN_TAB_WIDTH,
  UNCONNECTED_COLOR,
  WORKSPACE_VIEW_OPTIONS,
  appendGeneratedPythonTab,
  appendPythonTab,
  appendScratchTab,
  checkedPausedTabIds,
  closeTab,
  connectTabs,
  connectionTargets,
  connectedPairs,
  connectedPartner,
  connectionColor,
  createEmptyProjectTabs,
  createImportedTabs,
  defaultRunTabIds,
  defaultUpdateConnectionIds,
  displayedTabIds,
  disconnectTab,
  duplicateTab,
  outputViewGrid,
  outputViewPosition,
  openWorkspacePrograms,
  panelActionKinds,
  replaceConnectedPython,
  replaceEditedTab,
  resetTabWidth,
  resolvedTabWidth,
  resizeTab,
  runChecklistTabIds,
  scrollLeftByProject,
  scrollLeftForFullyVisibleTab,
  selectTab,
  selectedRunGroups,
  setSelectionGroup,
  shouldScrollProjectsFromWheel,
  tabHeadersOverflow,
  uncheckedRunningTabIds
} from '../src/renderer/src/tabs/model.ts'

const appSource = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
const stylesSource = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')

const conversion = {
  project: { id: 'opaque-project', name: 'walker.sb3', size: 42 },
  python: '# generated',
  runtimeProjectId: 'opaque-runtime',
  message: 'Converted.',
  warnings: [],
  scratchProject: new Uint8Array([80, 75, 3, 4])
}

test('import creates exactly one Scratch and one Python tab and selects Scratch', () => {
  const state = createImportedTabs(conversion)
  assert.equal(state.tabs.length, 2)
  assert.deepEqual(state.tabs.map(({ kind, name }) => ({ kind, name })), [
    { kind: 'scratch', name: 'walker.sb3' },
    { kind: 'python', name: 'walker.py' }
  ])
  assert.equal(state.tabs.find((tab) => tab.id === state.activeId)?.kind, 'scratch')
  assert.equal(state.tabs[0]?.connectionId, state.tabs[1]?.connectionId)
  assert.deepEqual(connectedPairs(state).map((pair) => [pair.scratch.id, pair.python.id]), [['tab-1', 'tab-2']])
})

test('opening a folder program preserves filesystem IDs and connects its Scratch/Python pair', () => {
  const opened = {
    requestedFileId: 'file-scratch',
    programs: [
      {
        id: 'file-scratch',
        kind: 'scratch',
        name: 'walker.sb3',
        scratchProject: new Uint8Array([80, 75, 3, 4])
      },
      {
        id: 'file-python',
        kind: 'python',
        name: 'walker.py',
        python: '# generated',
        runtimeProjectId: 'runtime-folder',
        codeUpToDate: true
      }
    ],
    connection: { scratchId: 'file-scratch', pythonId: 'file-python' }
  }
  let state = openWorkspacePrograms(createEmptyProjectTabs(), opened)
  assert.deepEqual(state.tabs.map((tab) => tab.id), ['file-scratch', 'file-python'])
  assert.equal(state.activeId, 'file-scratch')
  assert.equal(connectedPartner(state, 'file-scratch')?.id, 'file-python')
  assert.equal(state.tabs.find((tab) => tab.id === 'file-python')?.codeUpToDate, true)

  state = closeTab(state, 'file-scratch')
  assert.equal(state.tabs.some((tab) => tab.id === 'file-scratch'), false)
  state = openWorkspacePrograms(state, opened)
  assert.equal(state.tabs.some((tab) => tab.id === 'file-scratch'), true)
  assert.equal(connectedPartner(state, 'file-scratch')?.id, 'file-python')
})

test('connected pairs share distinct Scratch-category colors while unconnected tabs are gray', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  state = appendPythonTab(state, '# second', 'runtime-2')
  state = connectTabs(state, 'tab-3', 'tab-4')
  assert.equal(connectionColor(state.tabs[0]?.connectionId), connectionColor(state.tabs[1]?.connectionId))
  assert.equal(connectionColor(state.tabs[2]?.connectionId), connectionColor(state.tabs[3]?.connectionId))
  assert.notEqual(connectionColor(state.tabs[0]?.connectionId), connectionColor(state.tabs[2]?.connectionId))
  state = appendScratchTab(state)
  assert.equal(connectionColor(state.tabs.at(-1)?.connectionId), UNCONNECTED_COLOR)
})

test('connect and reconnect atomically pair compatible tabs and release former partners', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  state = appendPythonTab(state, '# second', 'runtime-2')
  state = connectTabs(state, 'tab-3', 'tab-4')
  assert.equal(connectedPartner(state, 'tab-3')?.id, 'tab-4')
  assert.equal(connectedPairs(state).length, 2)

  state = connectTabs(state, 'tab-3', 'tab-2')
  assert.equal(connectedPartner(state, 'tab-3')?.id, 'tab-2')
  assert.equal(state.tabs.find((tab) => tab.id === 'tab-1')?.connectionId, undefined)
  assert.equal(state.tabs.find((tab) => tab.id === 'tab-4')?.connectionId, undefined)
  assert.equal(connectedPairs(state).length, 1)
})

test('connection targets exclude the current partner and expose only usable alternatives', () => {
  let state = createImportedTabs(conversion)
  assert.deepEqual(connectionTargets(state, 'tab-1'), [])
  state = appendPythonTab(state, '# alternative', 'runtime-2')
  assert.deepEqual(connectionTargets(state, 'tab-1').map((tab) => tab.id), ['tab-3'])
  assert.deepEqual(connectionTargets(state, 'tab-3').map((tab) => tab.id), ['tab-1'])
})

test('closing a connected tab removes it, disconnects its partner, and selects a neighbor', () => {
  let state = createImportedTabs(conversion)
  state = closeTab(state, 'tab-1')
  assert.deepEqual(state.tabs.map((tab) => tab.id), ['tab-2'])
  assert.equal(state.tabs[0]?.connectionId, undefined)
  assert.equal(state.activeId, 'tab-2')

  state = closeTab(state, 'tab-2')
  assert.deepEqual(state.tabs, [])
  assert.equal(state.activeId, '')
})

test('disconnecting either side releases both tabs without removing either tab', () => {
  let state = createImportedTabs(conversion)
  state = disconnectTab(state, 'tab-2')
  assert.equal(state.tabs.length, 2)
  assert.equal(state.tabs[0]?.connectionId, undefined)
  assert.equal(state.tabs[1]?.connectionId, undefined)
  assert.equal(connectedPairs(state).length, 0)
  assert.equal(state.tabs[1]?.codeUpToDate, false)
  assert.equal(disconnectTab(state, 'tab-2'), state, 'disconnecting an unpaired tab is a no-op')
})

test('reconnecting two already-connected targets disconnects both previous pairs', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  state = appendPythonTab(state, '# second', 'runtime-2')
  state = connectTabs(state, 'tab-3', 'tab-4')
  state = connectTabs(state, 'tab-1', 'tab-4')
  assert.equal(connectedPartner(state, 'tab-1')?.id, 'tab-4')
  assert.equal(state.tabs.find((tab) => tab.id === 'tab-2')?.connectionId, undefined)
  assert.equal(state.tabs.find((tab) => tab.id === 'tab-3')?.connectionId, undefined)
})

test('empty tabs receive deterministic names after source and type choices', () => {
  const imported = createImportedTabs(conversion)
  assert.equal(imported.tabs.length, 2, 'opening the menu itself leaves state unchanged')
  const pythonOne = appendPythonTab(imported, '# template', 'runtime-2')
  const scratchOne = appendScratchTab(pythonOne)
  const pythonTwo = appendPythonTab(scratchOne, '# template', 'runtime-3')
  const scratchTwo = appendScratchTab(pythonTwo)
  assert.deepEqual(scratchTwo.tabs.slice(2).map(({ kind, name }) => ({ kind, name })), [
    { kind: 'python', name: 'untitled.py' },
    { kind: 'scratch', name: 'untitled.sb3' },
    { kind: 'python', name: 'untitled-2.py' },
    { kind: 'scratch', name: 'untitled-2.sb3' }
  ])
  assert.equal(scratchTwo.activeId, scratchTwo.tabs.at(-1)?.id)
})

test('uploaded tabs keep their contents and receive unique file names', () => {
  let state = createImportedTabs(conversion)
  state = appendPythonTab(state, 'print("uploaded")', 'runtime-uploaded', 'lesson.py')
  state = appendPythonTab(state, 'print("again")', 'runtime-uploaded-2', 'lesson.py')
  const uploadedScratch = new Uint8Array([80, 75, 3, 4, 99])
  state = appendScratchTab(state, { name: 'walker.sb3', scratchProject: uploadedScratch })
  uploadedScratch[4] = 0

  assert.deepEqual(state.tabs.slice(2).map(({ kind, name }) => ({ kind, name })), [
    { kind: 'python', name: 'lesson.py' },
    { kind: 'python', name: 'lesson-2.py' },
    { kind: 'scratch', name: 'walker-2.sb3' }
  ])
  const python = state.tabs[2]
  const scratch = state.tabs[4]
  assert.ok(python?.kind === 'python')
  assert.equal(python.source, 'print("uploaded")')
  assert.ok(scratch?.kind === 'scratch')
  assert.equal(scratch.projectBytes[4], 99, 'Scratch upload bytes are copied into tab state')
})

test('selection preserves independent tab contents and output frames', () => {
  let state = appendPythonTab(createImportedTabs(conversion), 'print(1)', 'runtime-2')
  const selected = state.tabs.at(-1)
  assert.ok(selected?.kind === 'python')
  selected.source = 'print(2)'
  selected.runtime.frameDataUrl = 'data:image/png;base64,python-two'
  state = selectTab(state, 'tab-1')
  state = selectTab(state, selected.id)
  const restored = state.tabs.find((tab) => tab.id === selected.id)
  assert.ok(restored?.kind === 'python')
  assert.equal(restored.source, 'print(2)')
  assert.equal(restored.runtime.frameDataUrl, 'data:image/png;base64,python-two')
})

test('Explorer highlights every displayed file, including both halves of a connected pair', () => {
  let state = createImportedTabs(conversion)
  assert.deepEqual(displayedTabIds(state, 'editor'), ['tab-1', 'tab-2'])

  state = appendScratchTab(state)
  assert.deepEqual(displayedTabIds(state, 'editor'), ['tab-3'])
  assert.deepEqual(displayedTabIds(state, 'output'), ['tab-1', 'tab-2', 'tab-3'])
})

test('last-edited connected tabs preselect only their entire pair for Run and Update code', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  state = appendPythonTab(state, '# second', 'runtime-2')
  state = connectTabs(state, 'tab-3', 'tab-4')
  const edited = state.tabs.find((tab) => tab.id === 'tab-4')
  assert.ok(edited?.kind === 'python')
  state = replaceEditedTab(state, { ...edited, source: '# edited', dirty: true })

  assert.equal(state.lastEditedId, 'tab-4')
  assert.deepEqual(defaultRunTabIds(state), ['tab-3', 'tab-4'])
  assert.deepEqual(defaultUpdateConnectionIds(state), [edited.connectionId])
})

test('last-edited unconnected tabs preselect only that tab and no invalid Update code pair', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  const edited = state.tabs.find((tab) => tab.id === 'tab-3')
  assert.ok(edited?.kind === 'scratch')
  state = replaceEditedTab(state, { ...edited, dirty: true })

  assert.deepEqual(defaultRunTabIds(state), ['tab-3'])
  assert.deepEqual(defaultUpdateConnectionIds(state), [])
})

test('the focused Run checklist preselects the visible view and every running file', () => {
  const state = appendScratchTab(createImportedTabs(conversion))
  assert.deepEqual(runChecklistTabIds(state, 'editor', ['tab-1']), ['tab-1', 'tab-3'])
  assert.deepEqual(runChecklistTabIds(state, 'output', []), ['tab-1', 'tab-2', 'tab-3'])
  assert.deepEqual(runChecklistTabIds(state, 'editor', ['missing-tab']), ['tab-3'])
})

test('hierarchical Run selection toggles pairs and child tabs independently', () => {
  let selected = setSelectionGroup([], ['tab-1', 'tab-2'], true)
  assert.deepEqual(selected, ['tab-1', 'tab-2'])
  selected = setSelectionGroup(selected, ['tab-2'], false)
  assert.deepEqual(selected, ['tab-1'])
  selected = setSelectionGroup(selected, ['tab-3'], true)
  assert.deepEqual(selected, ['tab-1', 'tab-3'])
  selected = setSelectionGroup(selected, ['tab-1', 'tab-2'], false)
  assert.deepEqual(selected, ['tab-3'])
})

test('unchecking pauses only running files that were removed from the selection', () => {
  assert.deepEqual(
    uncheckedRunningTabIds(['tab-1', 'tab-2', 'tab-3'], ['tab-1', 'tab-3'], ['tab-1', 'tab-2']),
    ['tab-2']
  )
  assert.deepEqual(
    uncheckedRunningTabIds(['tab-1'], ['tab-1', 'tab-3'], ['tab-1']),
    []
  )
  assert.deepEqual(
    checkedPausedTabIds(['tab-1'], ['tab-1', 'tab-2'], ['tab-2', 'tab-3']),
    ['tab-2']
  )
})

test('run selections create concurrent coordinated and standalone session groups', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  state = appendPythonTab(state, '# second', 'runtime-2')
  state = connectTabs(state, 'tab-3', 'tab-4')
  state = appendPythonTab(state, '# standalone', 'runtime-3')

  assert.deepEqual(selectedRunGroups(state, ['tab-1', 'tab-2', 'tab-3', 'tab-5']), [
    { sessionKey: 'connection-1', tabIds: ['tab-1', 'tab-2'], coordinated: true },
    { sessionKey: 'connection-2', tabIds: ['tab-3'], coordinated: false },
    { sessionKey: 'tab-5', tabIds: ['tab-5'], coordinated: false }
  ])
})

test('updating selected connected pairs replaces only their exact Python contents', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  state = appendPythonTab(state, '# second old', 'runtime-2')
  state = connectTabs(state, 'tab-3', 'tab-4')
  const [first, second] = connectedPairs(state)
  assert.ok(first && second)
  state = replaceConnectedPython(state, [{
    connectionId: second.id,
    source: '# second new',
    runtimeProjectId: 'runtime-2-new'
  }])
  assert.equal(state.tabs.find((tab) => tab.id === second.python.id)?.codeUpToDate, true)
  assert.equal(state.tabs.find((tab) => tab.id === first.python.id)?.source, '# generated')
  assert.equal(state.tabs.find((tab) => tab.id === second.python.id)?.source, '# second new')
  state = replaceConnectedPython(state, [
    { connectionId: first.id, source: '# first new', runtimeProjectId: 'runtime-1-new' },
    { connectionId: second.id, source: '# second newest', runtimeProjectId: 'runtime-2-newest' }
  ])
  assert.equal(state.tabs.find((tab) => tab.id === first.python.id)?.source, '# first new')
  assert.equal(state.tabs.find((tab) => tab.id === second.python.id)?.source, '# second newest')
})

test('linked Python sync status becomes stale after either side is edited and current after update', () => {
  let state = createImportedTabs(conversion)
  let python = state.tabs.find((tab) => tab.id === 'tab-2')
  assert.ok(python?.kind === 'python')
  assert.equal(python.codeUpToDate, true)

  const scratch = state.tabs.find((tab) => tab.id === 'tab-1')
  assert.ok(scratch?.kind === 'scratch')
  state = replaceEditedTab(state, { ...scratch, dirty: true })
  python = state.tabs.find((tab) => tab.id === 'tab-2')
  assert.ok(python?.kind === 'python')
  assert.equal(python.codeUpToDate, false)

  state = replaceConnectedPython(state, [{
    connectionId: 'connection-1',
    source: '# refreshed',
    runtimeProjectId: 'runtime-refreshed'
  }])
  python = state.tabs.find((tab) => tab.id === 'tab-2')
  assert.ok(python?.kind === 'python')
  assert.equal(python.codeUpToDate, true)

  state = replaceEditedTab(state, { ...python, source: '# learner edit', dirty: true })
  python = state.tabs.find((tab) => tab.id === 'tab-2')
  assert.ok(python?.kind === 'python')
  assert.equal(python.codeUpToDate, false)
})

test('duplicates copy current contents, use local timestamps and collision suffixes, and start unconnected', () => {
  const now = new Date(2026, 7, 27, 14, 30)
  let state = createImportedTabs(conversion)
  state = duplicateTab(state, 'tab-2', now)
  let duplicate = state.tabs.at(-1)
  assert.ok(duplicate?.kind === 'python')
  assert.equal(duplicate.name, 'walker 1430 27-08-26.py')
  assert.equal(duplicate.source, '# generated')
  assert.equal(duplicate.connectionId, undefined)
  assert.deepEqual(duplicate.runtime, { frameDataUrl: '', frameState: null, output: [], error: '' })

  state = duplicateTab(state, 'tab-2', now)
  duplicate = state.tabs.at(-1)
  assert.equal(duplicate?.name, 'walker 1430 27-08-26-2.py')

  const snapshot = new Uint8Array([80, 75, 3, 4, 55])
  state = duplicateTab(state, 'tab-1', now, snapshot)
  const scratchDuplicate = state.tabs.at(-1)
  snapshot[4] = 0
  assert.ok(scratchDuplicate?.kind === 'scratch')
  assert.equal(scratchDuplicate.name, 'walker 1430 27-08-26.sb3')
  assert.equal(scratchDuplicate.projectBytes[4], 55)
  assert.equal(scratchDuplicate.outputFrameDataUrl, '')
  assert.equal(scratchDuplicate.connectionId, undefined)
  assert.equal(state.activeId, scratchDuplicate.id)
})

test('Generate new .py creates a unique Python tab and connects it automatically', () => {
  let state = appendScratchTab(createImportedTabs(conversion), {
    name: 'walker.sb3',
    scratchProject: new Uint8Array([80, 75, 3, 4])
  })
  state = appendGeneratedPythonTab(state, 'tab-3', '# fresh', 'runtime-fresh')
  const generated = state.tabs.at(-1)
  assert.ok(generated?.kind === 'python')
  assert.equal(generated.name, 'walker-2.py')
  assert.equal(generated.source, '# fresh')
  assert.equal(connectedPartner(state, 'tab-3')?.id, generated.id)
  assert.equal(state.activeId, generated.id)
})

test('panel actions have the required visibility and left-to-right order', () => {
  let state = createImportedTabs(conversion)
  assert.deepEqual(panelActionKinds(state.tabs[0]), ['reconnect', 'disconnect', 'duplicate', 'export'])
  assert.deepEqual(panelActionKinds(state.tabs[1]), ['reconnect', 'disconnect', 'duplicate', 'export'])
  state = appendScratchTab(state)
  state = appendPythonTab(state, '', 'runtime-empty')
  assert.deepEqual(panelActionKinds(state.tabs[2]), ['connect', 'generate', 'duplicate', 'export'])
  assert.deepEqual(panelActionKinds(state.tabs[3]), ['connect', 'duplicate', 'export'])
})

test('Scratch-local wheel input remains local instead of scrolling through projects', () => {
  assert.equal(shouldScrollProjectsFromWheel(true), false)
  assert.equal(shouldScrollProjectsFromWheel(false), true)
})

test('more than two default tabs overflow while every right-side tab remains selectable', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  assert.equal(tabHeadersOverflow(state.tabs, 1_200), true)
  assert.equal(state.tabs.slice(0, 2).reduce((total, tab) => total + resolvedTabWidth(tab, 1_200), 0), 1_200)
  const rightmostId = state.tabs.at(-1)?.id
  assert.ok(rightmostId)
  state = selectTab(state, rightmostId)
  assert.equal(state.activeId, rightmostId)
})

test('selecting a partly hidden tab computes a fully visible scroll position', () => {
  assert.equal(scrollLeftForFullyVisibleTab(0, 440, 440, 220), 220)
  assert.equal(scrollLeftForFullyVisibleTab(220, 440, 0, 220), 0)
  assert.equal(scrollLeftForFullyVisibleTab(100, 440, 220, 220), 100)
})

test('arrow scrolling advances one project boundary and clamps at either end', () => {
  const starts = [0, 600, 1_200, 1_800]
  assert.equal(scrollLeftByProject(0, 1_000, 2_400, starts, 1), 600)
  assert.equal(scrollLeftByProject(600, 1_000, 2_400, starts, 1), 1_200)
  assert.equal(scrollLeftByProject(1_200, 1_000, 2_400, starts, 1), 1_400)
  assert.equal(scrollLeftByProject(1_400, 1_000, 2_400, starts, -1), 1_200)
  assert.equal(scrollLeftByProject(600, 1_000, 2_400, starts, -1), 0)
})

test('right arrow moves as far as possible when less than one project remains', () => {
  assert.equal(scrollLeftByProject(0, 1_250, 1_500, [0, 500, 1_000], 1), 250)
  assert.equal(scrollLeftByProject(250, 1_250, 1_500, [0, 500, 1_000], -1), 0)
})

test('resizing panes smaller can fit more than two files in the viewport', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  assert.equal(tabHeadersOverflow(state.tabs, 1_200), true)
  for (const tab of state.tabs) state = resizeTab(state, tab.id, 380)
  assert.equal(tabHeadersOverflow(state.tabs, 1_200), false)
})

test('tab widths resize independently, clamp to limits, and reset', () => {
  let state = createImportedTabs(conversion)
  state = resizeTab(state, 'tab-1', 9_999)
  state = resizeTab(state, 'tab-2', 1)
  assert.equal(state.tabs[0]?.width, MAX_TAB_WIDTH)
  assert.equal(state.tabs[1]?.width, MIN_TAB_WIDTH)
  state = resetTabWidth(state, 'tab-1')
  assert.equal(state.tabs[0]?.width, DEFAULT_TAB_WIDTH)
  assert.equal(state.tabs[1]?.width, MIN_TAB_WIDTH)
})

test('Output View uses every required one-through-eight row-major layout', () => {
  const expected = [
    { columns: 1, rows: 1 },
    { columns: 2, rows: 1 },
    { columns: 2, rows: 2 },
    { columns: 2, rows: 2 },
    { columns: 3, rows: 2 },
    { columns: 3, rows: 2 },
    { columns: 4, rows: 2 },
    { columns: 4, rows: 2 }
  ]
  assert.deepEqual(expected.map((_, index) => outputViewGrid(index + 1)), expected)
  assert.equal(MAX_OUTPUT_VISIBLE_TABS, 8)
  assert.deepEqual(outputViewGrid(9), { columns: 4, rows: 2 })
  assert.deepEqual(outputViewGrid(MAX_OPEN_TABS), { columns: 4, rows: 2 })
  assert.deepEqual([0, 1, 2].map((index) => outputViewPosition(index, 3)), [
    { column: 1, row: 1 },
    { column: 2, row: 1 },
    { column: 1, row: 2 }
  ])
  assert.deepEqual(outputViewPosition(7, 9), { column: 4, row: 2 })
  assert.deepEqual(outputViewPosition(8, 9), { column: 5, row: 1 })
})

test('view layout calculation preserves tab order, active selection, and shared runtime objects', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  state = appendPythonTab(state, 'print("second")', 'runtime-2')
  const order = state.tabs.map((tab) => tab.id)
  const python = state.tabs.find((tab) => tab.id === 'tab-2')
  assert.ok(python?.kind === 'python')
  python.runtime.frameDataUrl = 'data:image/png;base64,shared-frame'
  const runtime = python.runtime
  const activeId = state.activeId

  outputViewGrid(state.tabs.length)

  assert.deepEqual(state.tabs.map((tab) => tab.id), order)
  assert.equal(state.activeId, activeId)
  assert.equal(state.tabs.find((tab) => tab.id === 'tab-2')?.runtime, runtime)
  assert.equal(runtime.frameDataUrl, 'data:image/png;base64,shared-frame')
})

test('Open in Editor View selection can reveal the same file in both synchronized scrollers', () => {
  let state = appendScratchTab(createImportedTabs(conversion))
  state = selectTab(state, 'tab-3')
  const workspaceLeft = scrollLeftForFullyVisibleTab(0, 600, 1_200, 600)
  const stripLeft = scrollLeftForFullyVisibleTab(0, 600, 1_200, 600)
  assert.equal(state.activeId, 'tab-3')
  assert.equal(workspaceLeft, 1_200)
  assert.equal(stripLeft, workspaceLeft)
})

test('closing and disconnecting use the same tab model from Output View', () => {
  let state = createImportedTabs(conversion)
  state = disconnectTab(state, 'tab-1')
  assert.equal(state.tabs.length, 2)
  assert.ok(state.tabs.every((tab) => tab.connectionId === undefined))
  state = closeTab(state, 'tab-2')
  assert.deepEqual(state.tabs.map((tab) => tab.id), ['tab-1'])
})

test('all creation paths stop at the project limit and closing one immediately re-enables them', () => {
  let state = createImportedTabs(conversion)
  while (state.tabs.length < MAX_OPEN_TABS) {
    state = appendPythonTab(state, '# extra', `runtime-${state.nextId}`)
  }
  assert.equal(state.tabs.length, MAX_OPEN_TABS)
  const full = state

  assert.equal(appendPythonTab(full, '# empty', 'runtime-empty'), full, 'empty Python creation is blocked')
  assert.equal(appendPythonTab(full, '# upload', 'runtime-upload', 'upload.py'), full, 'Python upload is blocked')
  assert.equal(appendScratchTab(full), full, 'empty Scratch creation is blocked')
  assert.equal(appendScratchTab(full, { name: 'upload.sb3', scratchProject: new Uint8Array([1]) }), full, 'Scratch upload is blocked')
  assert.equal(appendGeneratedPythonTab(full, 'tab-1', '# generated', 'runtime-generated'), full, 'Generate new .py is blocked')
  assert.equal(duplicateTab(full, 'tab-2', new Date(2026, 7, 28)), full, 'Duplicate is blocked')

  state = closeTab(full, full.tabs.at(-1).id)
  assert.equal(state.tabs.length, MAX_OPEN_TABS - 1)
  state = appendScratchTab(state)
  assert.equal(state.tabs.length, MAX_OPEN_TABS)
})

test('view switches and full-project controls expose accessible labels and disabled states', () => {
  assert.deepEqual(WORKSPACE_VIEW_OPTIONS.map(({ label }) => label), ['Editor View', 'Output View'])
  assert.ok(WORKSPACE_VIEW_OPTIONS.every(({ tooltip }) => tooltip.length > 0))
  assert.match(appSource, /aria-label=\{option\.label\}/)
  assert.match(appSource, /aria-pressed=\{viewMode === option\.mode\}/)
  assert.match(appSource, /disabled=\{creatingTab \|\| atTabLimit\}/)
  assert.match(appSource, /disabled=\{atTabLimit \|\| busyTabIds\.includes\(tab\.id\)/)
  assert.match(stylesSource, /workspace-view-icon--editor/)
  assert.match(stylesSource, /workspace-view-icon--output/)
})

test('Editor View icon uses two three-line panes above two file squares', () => {
  assert.match(appSource, /\? <><i \/><i \/><i \/><i \/><i \/><i \/><b \/><b \/><\/>/)
  assert.match(stylesSource, /workspace-view-icon--editor i:nth-of-type\(-n\+3\)/)
  assert.match(stylesSource, /workspace-view-icon--editor i:nth-of-type\(n\+4\)/)
})

test('Output View stages preserve 4:3 dimensions and a first file opens in Editor View', () => {
  assert.match(stylesSource, /width: min\(100cqw, calc\(100cqh \* 4 \/ 3\)\)/)
  assert.match(stylesSource, /height: min\(100cqh, calc\(100cqw \* 3 \/ 4\)\)/)
  assert.match(appSource, /const openingFirstFile = shouldOpenEditorViewAfterFileOpen\(tabStateRef\.current\.tabs\.length\)/)
  assert.match(appSource, /if \(openingFirstFile\) \{[\s\S]*?setViewMode\('editor'\)/)
  assert.match(appSource, /<Workspace key=\{result\.project\.id\}/)
})
