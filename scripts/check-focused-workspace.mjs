import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createFocusedViewState,
  focusedViewReducer,
  projectFileNames,
  projectFolderName
} from '../src/renderer/src/focused/model.ts'
import {
  toggleCollapsedFolder,
  visibleWorkspaceRows,
  workspaceFiles
} from '../src/renderer/src/explorer/model.ts'
import { regeneratePythonFromScratch } from '../src/renderer/src/focused/update.ts'

const appSource = readFileSync(new URL('../src/renderer/src/FocusedAppV04.tsx', import.meta.url), 'utf8')
const sessionSource = readFileSync(new URL('../src/renderer/src/App.tsx', import.meta.url), 'utf8')
const pythonRuntimeSource = readFileSync(new URL('../src/renderer/src/python/usePythonRuntime.ts', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8')
const iconSource = readFileSync(new URL('../src/renderer/src/components/VscodeIcon.tsx', import.meta.url), 'utf8')
const focusedStyles = readFileSync(new URL('../src/renderer/src/focused.css', import.meta.url), 'utf8')
const baseStyles = readFileSync(new URL('../src/renderer/src/styles.css', import.meta.url), 'utf8')

test('the empty landing shell starts without open editors', () => {
  const state = createFocusedViewState(false)
  assert.equal(state.sidebarOpen, true)
  assert.equal(state.scratchOpen, false)
  assert.equal(state.pythonOpen, false)
})

test('the first imported project opens Scratch and Python side by side', () => {
  const state = createFocusedViewState(true)
  assert.equal(state.scratchOpen, true)
  assert.equal(state.pythonOpen, true)
  assert.equal(state.codeUpToDate, true)
})

test('the primary sidebar closes and reopens without changing the selected activity', () => {
  let state = createFocusedViewState(true)
  state = focusedViewReducer(state, { type: 'toggle-sidebar' })
  assert.equal(state.sidebarOpen, false)
  assert.equal(state.activity, 'explorer')
  state = focusedViewReducer(state, { type: 'toggle-sidebar' })
  assert.equal(state.sidebarOpen, true)
})

test('Search and Settings remain placeholder activities that can own the sidebar', () => {
  let state = createFocusedViewState(false)
  state = focusedViewReducer(state, { type: 'select-activity', activity: 'search' })
  assert.deepEqual([state.activity, state.sidebarOpen], ['search', true])
  state = focusedViewReducer(state, { type: 'select-activity', activity: 'settings' })
  assert.deepEqual([state.activity, state.sidebarOpen], ['settings', true])
  state = focusedViewReducer(state, { type: 'select-activity', activity: 'settings' })
  assert.equal(state.sidebarOpen, false)
})

test('closing an editor keeps its file available to reopen from Explorer', () => {
  let state = createFocusedViewState(true)
  state = focusedViewReducer(state, { type: 'close-file', file: 'scratch' })
  assert.deepEqual([state.scratchOpen, state.pythonOpen], [false, true])
  state = focusedViewReducer(state, { type: 'open-file', file: 'scratch' })
  assert.deepEqual([state.scratchOpen, state.pythonOpen, state.selectedFile], [true, true, 'scratch'])
})

test('Scratch or Monaco changes make Python stale until Update Code completes', () => {
  let state = createFocusedViewState(true)
  state = focusedViewReducer(state, { type: 'mark-code-stale' })
  assert.equal(state.codeUpToDate, false)
  state = focusedViewReducer(state, { type: 'mark-code-updated' })
  assert.equal(state.codeUpToDate, true)
})

test('project labels derive one folder and an adjacent Python filename', () => {
  assert.deepEqual(projectFileNames('walker.sb3'), { scratch: 'walker.sb3', python: 'walker.py' })
  assert.deepEqual(projectFileNames('lesson'), { scratch: 'lesson.sb3', python: 'lesson.py' })
  assert.equal(projectFolderName('walker.sb3'), 'walker')
})

test('Update Code stops execution, snapshots Scratch, then converts the exact snapshot', async () => {
  const calls = []
  const bytes = new Uint8Array([80, 75, 3, 4, 9])
  const conversion = {
    python: '# refreshed', runtimeProjectId: 'runtime-refreshed', message: 'Updated.', warnings: []
  }
  const result = await regeneratePythonFromScratch({
    scratchReady: true,
    stopAll: async () => { calls.push('stop') },
    snapshotScratch: async () => {
      calls.push('snapshot')
      return { projectBytes: bytes, frameDataUrl: 'data:image/png;base64,frame' }
    },
    convertScratch: async (projectBytes) => {
      calls.push('convert')
      assert.equal(projectBytes, bytes)
      return conversion
    }
  })
  assert.deepEqual(calls, ['stop', 'snapshot', 'convert'])
  assert.equal(result, conversion)
})

test('Update Code refuses to replace Python before Scratch is ready', async () => {
  let called = false
  await assert.rejects(() => regeneratePythonFromScratch({
    scratchReady: false,
    stopAll: async () => { called = true },
    snapshotScratch: async () => ({ projectBytes: new Uint8Array(), frameDataUrl: '' }),
    convertScratch: async () => ({
      python: '', runtimeProjectId: '', message: '', warnings: []
    })
  }), /not ready/i)
  assert.equal(called, false)
})

test('the V0.4 shell uses the file model, tab-level linking, and no Control Board copy', () => {
  assert.match(appSource, /openWorkspacePrograms/)
  assert.match(appSource, /const \[linkSourceId, setLinkSourceId\]/)
  assert.match(appSource, /connectionTargets\(current, linkSourceId\)/)
  assert.match(appSource, /setTabState\(connectTabs\(current, linkSourceId, tabId\)\)/)
  assert.match(sessionSource, />Link<\/button>/)
  assert.doesNotMatch(appSource, /className="fp-connect-menu"/)
  assert.doesNotMatch(appSource, /fp-dialog-backdrop|aria-modal="true"/)
  assert.match(appSource, /Run files/)
  assert.doesNotMatch(appSource, /Control Board/)
})

test('the Explorer activity button is the only primary sidebar toggle', () => {
  assert.match(appSource, /const nextOpen = activity === next \? !open : true/)
  assert.match(appSource, /setSidebarOpen\(\(open\) =>/)
  assert.match(appSource, /const active = sidebarOpen && current === activity/)
  assert.doesNotMatch(appSource, /fp-sidebar-toggle|Toggle primary sidebar/)
})

test('Explorer keeps Add File while file linking lives in each name tab', () => {
  assert.match(appSource, /aria-expanded=\{active && addMenuOpen\}/)
  assert.doesNotMatch(appSource, /aria-label="Connect two files"/)
  assert.doesNotMatch(appSource, /connectMenuOpen|connectIds|setConnectOpen/)
  assert.match(sessionSource, /aria-label=\{isLinkSource \? `Cancel linking/)
  assert.match(sessionSource, /aria-label=\{`Break link between/)
})

test('only connected Explorer files render a connection circle', () => {
  assert.match(appSource, /\{tab\?\.connectionId && <i/)
  assert.match(appSource, /connectionColor\(tab\.connectionId\)/)
})

test('Explorer selection blue represents every file displayed in the workspace', () => {
  assert.match(appSource, /const explorerDisplayedIds = tabState \? displayedTabIds\(tabState, viewMode\) : \[\]/)
  assert.match(appSource, /const displayed = active && displayedIds\.includes\(entry\.id\)/)
  assert.match(appSource, /fp-tree-row \$\{displayed \? 'fp-tree-row--active'/)
  assert.match(appSource, /aria-pressed=\{displayed\}/)
})

test('Explorer file and project rows expose working close actions without nested buttons', () => {
  assert.match(appSource, /className=\{`fp-tree-row__select/)
  assert.match(appSource, /className="fp-tree-row__action fp-tree-row__close"/)
  assert.match(appSource, /onClick=\{\(\) => onCloseTab\(workspace\.project\.id, entry\.id\)\}/)
  assert.match(appSource, /aria-label=\{`Close \$\{workspace\.root\.name\} project`\}/)
  assert.match(appSource, /setWorkspaces\(\(current\) => current\.filter/)
  assert.match(appSource, /return <div[\s\S]*className=\{`fp-tree-row[\s\S]*className=\{`fp-tree-row__select/)
  assert.doesNotMatch(appSource, /return <button\s+className=\{`fp-tree-row/)
})

test('Scratch duplicate and adjacent-Python actions live beside close in the name tab', () => {
  assert.doesNotMatch(appSource, /fp-tree-row__duplicate|onDuplicateScratch/)
  assert.match(sessionSource, /Make an adjacent Python file for/)
  assert.match(sessionSource, /VscodeIcon name="new-file"/)
  assert.match(sessionSource, /aria-label=\{`Duplicate \$\{tab\.name\}`\}/)
  assert.match(sessionSource, /VscodeIcon name="files"[\s\S]*VscodeIcon name="close"/)
  assert.match(appSource, /appendGeneratedPythonTab/)
  assert.match(appSource, /duplicateTab\(withSnapshot, tabId, new Date\(\), snapshot\.projectBytes\)/)
})

test('Explorer uses one plus control that only adds native folders', () => {
  assert.match(appSource, /aria-label="Add folder"/)
  assert.match(appSource, /<VscodeIcon name="new-folder" \/>/)
  assert.match(appSource, /selectWorkspaceItem\(\)/)
  assert.match(appSource, /registerDroppedWorkspaceItem\(file\)/)
  assert.match(mainSource, /title: 'Add a folder to Parrot'/)
  assert.match(mainSource, /properties: \['openDirectory'\]/)
  assert.doesNotMatch(mainSource, /properties: \['openFile', 'openDirectory'\]/)
  assert.match(mainSource, /Choose a folder to add to Parrot\./)
  assert.doesNotMatch(appSource, /aria-label="Open project folder"/)
})

test('the plus control appends multi-root projects and file selection activates its owner', () => {
  assert.match(appSource, /setWorkspaces\(\(current\) => \[\.\.\.current, hydrated\.workspace\]\)/)
  assert.match(appSource, /workspaces\.map\(\(workspace\) =>/)
  assert.match(appSource, /setActiveWorkspaceId\(workspaceId\)/)
  assert.match(appSource, /const workspace = workspaces\.find/)
  assert.match(appSource, /const tabState = workspace\?\.tabs \?\? null/)
  assert.match(appSource, /className="fp-explorer-roots"/)
  assert.match(focusedStyles, /\.fp-explorer-roots \{[\s\S]*overflow-y: auto;/)
})

test('collapsing a folder hides every nested descendant without losing the tree', () => {
  const root = {
    type: 'folder', id: 'root', name: 'Project', children: [{
      type: 'folder', id: 'src', name: 'src', children: [{
        type: 'folder', id: 'nested', name: 'nested', children: [
          { type: 'file', id: 'scratch', name: 'walker.sb3', fileKind: 'scratch' }
        ]
      }, { type: 'file', id: 'python', name: 'walker.py', fileKind: 'python' }]
    }]
  }
  assert.deepEqual(workspaceFiles(root).map((file) => file.id), ['scratch', 'python'])
  assert.deepEqual(visibleWorkspaceRows(root, new Set()).map(({ entry }) => entry.id), [
    'src', 'nested', 'scratch', 'python'
  ])
  const nestedCollapsed = toggleCollapsedFolder(new Set(), 'nested')
  assert.deepEqual(visibleWorkspaceRows(root, nestedCollapsed).map(({ entry }) => entry.id), [
    'src', 'nested', 'python'
  ])
  const rootCollapsed = toggleCollapsedFolder(nestedCollapsed, 'root')
  assert.deepEqual(visibleWorkspaceRows(root, rootCollapsed), [])
  assert.equal(workspaceFiles(root).length, 2, 'collapse changes visibility, not stored contents')
})

test('Explorer file rows drag-reorder locally without invoking filesystem moves', () => {
  assert.match(appSource, /EXPLORER_FILE_DRAG_TYPE = 'application\/x-parrot-explorer-file'/)
  assert.match(appSource, /draggable/)
  assert.match(appSource, /onDragStart=\{\(event\) => beginFileDrag/)
  assert.match(appSource, /onDrop=\{\(event\) => finishFileDrop/)
  assert.match(appSource, /reorderWorkspaceSiblings/)
  assert.match(appSource, /siblingOrderByWorkspace/)
  assert.doesNotMatch(appSource, /moveWorkspace|renameWorkspace|workspace:move|workspace:rename/)
  assert.match(focusedStyles, /\.fp-tree-row--drop-before::before/)
  assert.match(focusedStyles, /\.fp-tree-row--drop-after::after/)
})

test('copies and generated Python tabs inherit the source Explorer folder and position', () => {
  assert.match(appSource, /onPlaceTabAfter\(tabId, next\.activeId\)/)
  assert.match(appSource, /workspaceFileParentId\(activeWorkspace\.root, sourceId\)/)
  assert.match(appSource, /\[tabId\]: \{ parentId, afterId: sourceId \}/)
  assert.match(appSource, /insertVirtualWorkspaceFiles/)
  assert.match(appSource, /filePlacementsByWorkspace\[workspace\.project\.id\]/)
  assert.doesNotMatch(appSource, /moveWorkspace|renameWorkspace|workspace:move|workspace:rename/)
})

test('folder rows expose instant disclosure controls for root and nested folders', () => {
  assert.match(appSource, /className="fp-project-disclosure"/)
  assert.match(appSource, /className="fp-folder-row"/)
  assert.match(appSource, /aria-expanded=\{!collapsedFolderIds\.has\(workspace\.root\.id\)\}/)
  assert.match(appSource, /onToggleFolder\(entry\.id\)/)
  assert.match(focusedStyles, /padding: 0 4px 0 calc\(18px \+ var\(--fp-tree-depth, 0\) \* 14px\)/)
  assert.doesNotMatch(focusedStyles, /fp-folder-row[^}]*transition:/s)
})

test('the root folder disclosure keeps its chevron and name on one row', () => {
  assert.match(focusedStyles, /\.fp-project-disclosure \{[\s\S]*display: flex;[\s\S]*align-items: center;/)
  assert.match(focusedStyles, /\.fp-project-actions > button \{/)
  assert.doesNotMatch(focusedStyles, /\.fp-project-title button \{/)
  assert.doesNotMatch(focusedStyles, /\.fp-project-title > button \{/)
})

test('Explorer and adjacent file tabs share one height and one right action guide', () => {
  assert.match(focusedStyles, /--fp-panel-tab-height: 35px;/)
  assert.match(focusedStyles, /\.fp-sidebar-title \{[\s\S]*height: var\(--fp-panel-tab-height\);[\s\S]*padding: 0 7px 0 12px;/)
  assert.match(focusedStyles, /\.fp-project-title \{[\s\S]*padding: 0 7px 0 5px;/)
  assert.match(focusedStyles, /\.fp-tree-row \{[\s\S]*padding: 0 7px 0 0;/)
  assert.match(focusedStyles, /\.fp-tree-row__action \{[\s\S]*width: 25px;/)
})

test('the browser preview cannot bypass folder-only workspace import', () => {
  assert.match(appSource, /Folder import is available in the Parrot desktop app\./)
  assert.doesNotMatch(appSource, /type="file"/)
  assert.doesNotMatch(appSource, /openBrowserFile|browserWorkspace/)
})

test('every non-Scratch and non-Monaco shell surface inherits SF Pro Text', () => {
  assert.match(focusedStyles, /font-family: "SF Pro Text", -apple-system/)
  assert.match(baseStyles, /\.scratch-editor \{[^}]*font-family: "Helvetica Neue"/s)
})

test('Parrot interface icons resolve only through the vendored Microsoft VS Code set', () => {
  assert.match(iconSource, /assets\/vscode-icons\/files\.svg/)
  assert.match(iconSource, /assets\/vscode-icons\/checklist\.svg/)
  assert.match(iconSource, /assets\/vscode-icons\/debug-disconnect\.svg/)
  assert.match(iconSource, /assets\/vscode-icons\/screen-normal\.svg/)
  assert.doesNotMatch(appSource, /<svg|<path|<circle|<rect/)
})

test('the Scratch name tab meets the Scratch GUI without a gray divider', () => {
  assert.match(focusedStyles, /\.fp-session \.fp-session-file-header--scratch \{[\s\S]*border-bottom: 0;/)
})

test('the hidden Scratch extension control does not leave a short category rail', () => {
  assert.match(baseStyles, /button\[aria-label="Add Extension"\][\s\S]*display: none;/)
  assert.match(focusedStyles, /\.fp-session \.scratch-gui-surface \.blocklyToolbox,[\s\S]*\.blocklyToolboxDiv \{[\s\S]*height: 100% !important;/)
})

test('all connected pairs and standalone files mount independent runtime sessions', () => {
  assert.match(appSource, /orderedSessions\.map\(\(\{ key, pair, tab \}\)/)
  assert.match(appSource, /registerSession\(\[pair\.scratch\.id, pair\.python\.id\]/)
  assert.match(appSource, /registerSession\(\[tab\.id\]/)
  assert.match(appSource, /Promise\.all\(groups\.map/)
})

test('linking keeps the Scratch session key stable instead of remounting its WebGL renderer', () => {
  assert.match(appSource, /const key = pair\?\.scratch\.id \?\? tab\.id/)
  assert.doesNotMatch(appSource, /const key = pair\?\.id \?\? tab\.id/)
  assert.match(sessionSource, /scratchTab\?\.id \?\? 'scratch-disabled'/)
})

test('View switches between a two-file editor session and the full output grid', () => {
  assert.match(appSource, /fp-program-sessions fp-program-sessions--\$\{viewMode\}/)
  assert.match(appSource, /viewMode === 'output' \? 'fp-session--output'/)
  assert.match(appSource, /visibleSessionKey === pair\.id/)
  assert.match(sessionSource, /const outputOnly = focused && focusedView === 'output'/)
  assert.match(sessionSource, /!outputOnly && <section className="editor-pane python-editor"/)
  assert.match(sessionSource, /outputOnly[\s\S]*<ScratchOutputPane scratch=\{scratch\}/)
})

test('Output View pages past eight stages with VS Code chevrons and no grid gap', () => {
  assert.match(appSource, /MAX_OUTPUT_VISIBLE_TABS/)
  assert.match(appSource, /canScrollOutputRight/)
  assert.match(appSource, /scrollOutput\(1\)/)
  assert.match(iconSource, /assets\/vscode-icons\/chevron-right\.svg/)
  assert.match(focusedStyles, /\.fp-program-sessions--output \{[\s\S]*gap: 0;/)
  assert.match(focusedStyles, /grid-auto-columns: calc\(100% \/ var\(--fp-output-columns\)\)/)
  assert.match(appSource, /outputViewPosition\(index, tabState\.tabs\.length\)/)
  assert.match(sessionSource, /gridColumn: position\.column, gridRow: position\.row/)
})

test('Output tabs keep file controls, connection colors, and stage-only content', () => {
  assert.match(sessionSource, /fp-session-connection-dot/)
  assert.match(sessionSource, /scratchGreenFlag/)
  assert.match(sessionSource, /scratchStop/)
  assert.match(sessionSource, /debug-stop' : 'debug-start'/)
  assert.match(sessionSource, /fp-sync-dot--updated/)
  assert.match(sessionSource, /name="refresh"/)
  assert.match(focusedStyles, /\.fp-session > \.focused-program-pane--output/)
})

test('the Run checklist defaults to visible and running files with matching neutral actions', () => {
  assert.match(appSource, /runChecklistTabIds\(stateRef\.current, viewMode, runningIds\)/)
  assert.doesNotMatch(appSource, /className="fp-primary-button"[^>]*>[\s\S]*?Run selected/)
  assert.match(appSource, />Start running<\/button>/)
  assert.match(appSource, /uncheckedRunningTabIds\(selectedRunIds, nextSelectedIds, runningIds\)/)
  assert.match(sessionSource, /stopTabs: \(tabIds: string\[\]\) => Promise<void>/)
  assert.match(sessionSource, /pauseTabs: \(tabIds: string\[\]\) => void/)
  assert.match(sessionSource, /resumeTabs: \(tabIds: string\[\]\) => void/)
  assert.match(sessionSource, /pythonRuntime\.continueInternally\(\)/)
  assert.match(sessionSource, /scratch\.continueStandalone\(\)/)
  assert.match(pythonRuntimeSource, /if \(clockModeRef\.current === 'paused'\)[\s\S]*setStatus\('paused'\)/)
  assert.match(pythonRuntimeSource, /clockModeRef\.current !== 'paused'/)
  assert.match(pythonRuntimeSource, /running: clockMode !== 'paused'/)
  assert.match(pythonRuntimeSource, /paused: clockMode === 'paused'/)
  assert.match(pythonRuntimeSource, /event\.type === 'stopped'[\s\S]*clockModeRef\.current = 'internal'/)
  assert.match(appSource, /applySessionAction\(newlyUnchecked, 'pauseTabs'\)/)
  assert.match(appSource, /checkedPausedTabIds\(selectedRunIds, nextSelectedIds, pausedIds\)/)
  assert.match(appSource, /applySessionAction\(newlyCheckedPaused, 'resumeTabs'\)/)
  assert.match(focusedStyles, /\.fp-run-checklist > footer button,[\s\S]*background: #f7f9fc;/)
})

test('the top bar omits File and leaves importing to the Explorer plus control', () => {
  assert.doesNotMatch(appSource, /const chooseFromFileMenu|onClick=\{chooseFromFileMenu\}/)
  assert.doesNotMatch(appSource, />File<\/button>/)
  assert.match(appSource, /aria-label="Add folder"[\s\S]*onClick=\{onImport\}/)
})

test('native fullscreen removes the macOS traffic-light reserve and left-aligns View and Run', () => {
  assert.match(appSource, /fp-titlebar \$\{fullscreen \? 'fp-titlebar--fullscreen' : ''\}/)
  assert.match(appSource, /\{!fullscreen && <div className="fp-titlebar-spacer"/)
  assert.match(focusedStyles, /\.fp-titlebar--fullscreen \{[\s\S]*justify-content: flex-start;[\s\S]*padding-left: 0;/)
})
