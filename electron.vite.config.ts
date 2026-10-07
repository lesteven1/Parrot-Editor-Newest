import { resolve } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'

const scratchGuiDist = resolve('node_modules/@scratch/scratch-gui/dist')
const scratchLibraryRoot = resolve('resources/scratch-library')

function filesBelow(root: string, relative = ''): string[] {
  const directory = resolve(root, relative)
  return readdirSync(directory).flatMap((name) => {
    const child = relative ? `${relative}/${name}` : name
    return statSync(resolve(root, child)).isDirectory() ? filesBelow(root, child) : [child]
  })
}

function scratchGuiAssets(): Plugin {
  const blocksRoot = resolve(scratchGuiDist, 'static/blocks-media')
  const staticAssetsRoot = resolve(scratchGuiDist, 'static/assets')
  const chunksRoot = resolve(scratchGuiDist, 'chunks')
  return {
    name: 'parrot-scratch-gui-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = decodeURIComponent((request.url ?? '').split('?')[0])
        let source = ''
        if (pathname.startsWith('/scratch-gui/static/blocks-media/')) {
          const relative = pathname.slice('/scratch-gui/static/blocks-media/'.length)
          if (!relative.includes('..')) source = resolve(blocksRoot, relative)
        } else if (pathname.startsWith('/scratch-library/')) {
          const relative = pathname.slice('/scratch-library/'.length)
          if (!relative.includes('..')) source = resolve(scratchLibraryRoot, relative)
        } else if (pathname.startsWith('/assets/static/assets/')) {
          const relative = pathname.slice('/assets/static/assets/'.length)
          if (!relative.includes('..')) source = resolve(staticAssetsRoot, relative)
        } else if (pathname.includes('/chunks/')) {
          const relative = pathname.slice(pathname.lastIndexOf('/chunks/') + '/chunks/'.length)
          if (!relative.includes('..')) source = resolve(chunksRoot, relative)
        }
        try {
          if (!source || !statSync(source).isFile()) return next()
          const extension = source.slice(source.lastIndexOf('.') + 1)
          response.setHeader('Content-Type', ({
            js: 'text/javascript',
            svg: 'image/svg+xml',
            png: 'image/png',
            gif: 'image/gif',
            wav: 'audio/wav',
            mp3: 'audio/mpeg',
            ogg: 'audio/ogg',
            cur: 'image/x-icon',
            json: 'application/json'
          } as Record<string, string>)[extension] ?? 'application/octet-stream')
          response.end(readFileSync(source))
        } catch {
          next()
        }
      })
    },
    generateBundle() {
      for (const relative of filesBelow(blocksRoot)) {
        this.emitFile({
          type: 'asset',
          fileName: `scratch-gui/static/blocks-media/${relative}`,
          source: readFileSync(resolve(blocksRoot, relative))
        })
      }
      for (const relative of filesBelow(scratchLibraryRoot)) {
        this.emitFile({
          type: 'asset',
          fileName: `scratch-library/${relative}`,
          source: readFileSync(resolve(scratchLibraryRoot, relative))
        })
      }
      for (const relative of filesBelow(chunksRoot).filter((name) => name.endsWith('.js'))) {
        const source = readFileSync(resolve(chunksRoot, relative))
        for (const fileName of [`assets/chunks/${relative}`, `chunks/${relative}`]) {
          this.emitFile({ type: 'asset', fileName, source })
        }
      }
      for (const relative of filesBelow(staticAssetsRoot).filter((name) => /^icon--.*\.svg$/.test(name))) {
        this.emitFile({
          type: 'asset',
          fileName: `assets/static/assets/${relative}`,
          source: readFileSync(resolve(staticAssetsRoot, relative))
        })
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    publicDir: false,
    plugins: [scratchGuiAssets()],
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        events: resolve('node_modules/events/events.js')
      }
    }
  }
})
