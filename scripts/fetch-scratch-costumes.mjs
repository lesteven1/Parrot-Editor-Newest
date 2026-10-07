import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve('resources/scratch-library')
const manifestPath = resolve('node_modules/@scratch/scratch-gui/dist/libraries/costumes.json')
const costumes = JSON.parse(await readFile(manifestPath, 'utf8'))
const files = [...new Set(costumes.map((costume) => costume.md5ext))].sort()

await mkdir(root, { recursive: true })
await writeFile(resolve(root, 'costumes.json'), `${JSON.stringify(costumes, null, 2)}\n`)

let cursor = 0
let downloaded = 0
let reused = 0

async function fetchAsset (file) {
  const destination = resolve(root, file)
  try {
    const existing = await readFile(destination)
    if (createHash('md5').update(existing).digest('hex') === file.split('.')[0]) {
      reused += 1
      return
    }
  } catch {
    // Missing assets are downloaded below.
  }

  const url = `https://cdn.assets.scratch.mit.edu/internalapi/asset/${file}/get/`
  let lastError
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      const digest = createHash('md5').update(bytes).digest('hex')
      if (digest !== file.split('.')[0]) throw new Error(`MD5 mismatch: expected ${file.split('.')[0]}, received ${digest}`)
      await writeFile(destination, bytes)
      downloaded += 1
      return
    } catch (error) {
      lastError = error
      if (attempt < 4) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 250))
    }
  }
  throw new Error(`Could not download ${file}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function worker () {
  while (cursor < files.length) {
    const index = cursor
    cursor += 1
    await fetchAsset(files[index])
    const complete = downloaded + reused
    if (complete % 50 === 0 || complete === files.length) {
      process.stdout.write(`Scratch costumes: ${complete}/${files.length}\n`)
    }
  }
}

await Promise.all(Array.from({ length: 12 }, worker))
process.stdout.write(`Scratch costume library ready: ${files.length} assets (${downloaded} downloaded, ${reused} reused).\n`)
