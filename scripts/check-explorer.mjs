import assert from 'node:assert/strict'
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { WorkspaceStore } from '../src/main/workspace-store.ts'
import {
  insertVirtualWorkspaceFiles,
  reorderWorkspaceSiblings,
  visibleWorkspaceRows,
  workspaceFileParentId
} from '../src/renderer/src/explorer/model.ts'

function flatten(folder) {
  return folder.children.flatMap((entry) => entry.type === 'folder' ? [entry, ...flatten(entry)] : [entry])
}

test('a workspace import preserves nested folders, all file types, and existing adjacent program pairs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'parrot-explorer-'))
  const nested = join(directory, 'src', 'lessons')
  const store = new WorkspaceStore()
  try {
    await mkdir(nested, { recursive: true })
    await writeFile(join(directory, 'walker.sb3'), new Uint8Array([80, 75, 3, 4]))
    await writeFile(join(directory, 'notes.md'), '# Notes')
    await writeFile(join(directory, '.DS_Store'), 'finder metadata')
    await writeFile(join(directory, 'src', 'logic.py'), 'print("logic")\n')
    await writeFile(join(directory, 'src', '.DS_Store'), 'nested finder metadata')
    await writeFile(join(nested, 'fall.sb3'), new Uint8Array([80, 75, 3, 4]))
    await writeFile(join(nested, 'fall.py'), 'print("fall")\n')

    const selection = await store.register(directory)
    assert.equal(selection.project.name, basename(directory))
    assert.equal(selection.root.name, basename(directory))
    const entries = flatten(selection.root)
    assert.ok(entries.some((entry) => entry.type === 'folder' && entry.name === 'src'))
    assert.ok(entries.some((entry) => entry.type === 'folder' && entry.name === 'lessons'))
    assert.ok(entries.some((entry) => entry.type === 'file' && entry.name === 'notes.md' && entry.fileKind === 'other'))
    assert.ok(!entries.some((entry) => entry.name === '.DS_Store'))

    const walkerScratch = entries.find((entry) => entry.type === 'file' && entry.name === 'walker.sb3')
    const walkerPython = entries.find((entry) => entry.type === 'file' && entry.name === 'walker.py')
    assert.ok(walkerScratch)
    assert.equal(walkerPython, undefined)
    const standaloneScratch = await store.resolveProgramPair(selection.project.id, walkerScratch.id)
    assert.equal(standaloneScratch.scratch?.id, walkerScratch.id)
    assert.equal(standaloneScratch.python, undefined)

    const fallScratch = entries.find((entry) => entry.type === 'file' && entry.name === 'fall.sb3')
    const fallPython = entries.find((entry) => entry.type === 'file' && entry.name === 'fall.py')
    assert.ok(fallScratch && fallPython)
    const diskPair = await store.resolveProgramPair(selection.project.id, fallPython.id)
    assert.equal(diskPair.scratch?.id, fallScratch.id)
    assert.equal(diskPair.python?.id, fallPython.id)

    assert.doesNotMatch(JSON.stringify(selection), new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

    const logic = entries.find((entry) => entry.type === 'file' && entry.name === 'logic.py')
    assert.ok(logic)
    await appendFile(join(directory, 'src', 'logic.py'), '# changed\n')
    await assert.rejects(() => store.resolveFile(selection.project.id, logic.id), /changed on disk/i)
  } finally {
    store.clear()
    await rm(directory, { recursive: true, force: true })
  }
})

test('selecting .DS_Store directly is rejected as macOS metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'parrot-explorer-metadata-'))
  const metadataPath = join(directory, '.DS_Store')
  const store = new WorkspaceStore()
  try {
    await writeFile(metadataPath, 'finder metadata')
    await assert.rejects(() => store.register(metadataPath), /ignores macOS folder metadata/i)
  } finally {
    store.clear()
    await rm(directory, { recursive: true, force: true })
  }
})

test('selecting one Scratch file creates a synthetic root without generating Python', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'parrot-explorer-file-'))
  const scratchPath = join(directory, 'solo.sb3')
  const store = new WorkspaceStore()
  try {
    await writeFile(scratchPath, new Uint8Array([80, 75, 3, 4]))
    const selection = await store.register(scratchPath)
    assert.equal(selection.root.name, 'solo')
    assert.deepEqual(selection.root.children.map((entry) => entry.name), ['solo.sb3'])
    const scratch = selection.root.children.find((entry) => entry.type === 'file' && entry.fileKind === 'scratch')
    assert.ok(scratch)
    const pair = await store.resolveProgramPair(selection.project.id, scratch.id)
    assert.equal(pair.scratch?.name, 'solo.sb3')
    assert.equal(pair.python, undefined)
    store.close(selection.project.id)
    await assert.rejects(() => store.resolveFile(selection.project.id, scratch.id), /session has expired/i)
  } finally {
    store.clear()
    await rm(directory, { recursive: true, force: true })
  }
})

test('Explorer file reordering is renderer-only and remains inside one folder', () => {
  const root = {
    type: 'folder',
    id: 'root',
    name: 'Project',
    children: [
      { type: 'file', id: 'a', name: 'a.sb3', fileKind: 'scratch' },
      {
        type: 'folder',
        id: 'nested',
        name: 'nested',
        children: [
          { type: 'file', id: 'c', name: 'c.sb3', fileKind: 'scratch' },
          { type: 'file', id: 'd', name: 'd.py', fileKind: 'python' }
        ]
      },
      { type: 'file', id: 'b', name: 'b.py', fileKind: 'python' }
    ]
  }
  const rootSiblingIds = root.children.filter((entry) => entry.type === 'file').map((entry) => entry.id)
  let order = reorderWorkspaceSiblings({}, 'root', rootSiblingIds, 'b', 'a', 'before')
  assert.deepEqual(visibleWorkspaceRows(root, new Set(), order).map(({ entry }) => entry.id), [
    'b', 'nested', 'c', 'd', 'a'
  ])

  const nestedSiblingIds = root.children[1].children.map((entry) => entry.id)
  order = reorderWorkspaceSiblings(order, 'nested', nestedSiblingIds, 'd', 'c', 'before')
  assert.deepEqual(visibleWorkspaceRows(root, new Set(), order).map(({ entry }) => entry.id), [
    'b', 'nested', 'd', 'c', 'a'
  ])

  assert.equal(
    reorderWorkspaceSiblings(order, 'root', rootSiblingIds, 'a', 'c', 'after'),
    order,
    'a target from another folder cannot be reordered through the root sibling list'
  )
  assert.deepEqual(root.children.map((entry) => entry.id), ['a', 'nested', 'b'])
  assert.deepEqual(root.children[1].children.map((entry) => entry.id), ['c', 'd'])
})

test('copies and adjacent Python files render directly after their nested source', () => {
  const root = {
    type: 'folder',
    id: 'root',
    name: 'Project',
    children: [{
      type: 'folder',
      id: 'lessons',
      name: 'lessons',
      children: [
        { type: 'file', id: 'walker', name: 'walker.sb3', fileKind: 'scratch' },
        { type: 'file', id: 'notes', name: 'notes.md', fileKind: 'other' }
      ]
    }]
  }
  assert.equal(workspaceFileParentId(root, 'walker'), 'lessons')

  const copy = { type: 'file', id: 'walker-copy', name: 'walker copy.sb3', fileKind: 'scratch' }
  const withCopy = insertVirtualWorkspaceFiles(root, [copy], {
    [copy.id]: { parentId: 'lessons', afterId: 'walker' }
  })
  assert.deepEqual(visibleWorkspaceRows(withCopy, new Set()).map(({ entry }) => entry.id), [
    'lessons', 'walker', 'walker-copy', 'notes'
  ])

  const python = { type: 'file', id: 'walker-python', name: 'walker.py', fileKind: 'python' }
  const withPython = insertVirtualWorkspaceFiles(root, [python], {
    [python.id]: { parentId: 'lessons', afterId: 'walker' }
  })
  assert.deepEqual(visibleWorkspaceRows(withPython, new Set()).map(({ entry }) => entry.id), [
    'lessons', 'walker', 'walker-python', 'notes'
  ])
  assert.deepEqual(root.children[0].children.map((entry) => entry.id), ['walker', 'notes'])
})
