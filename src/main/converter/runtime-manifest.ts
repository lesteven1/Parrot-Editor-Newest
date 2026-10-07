import type {
  RuntimeAsset,
  RuntimeAssetReference,
  RuntimeBundle,
  RuntimeTarget,
  RuntimeVariable,
  ScratchProject
} from './types.ts'

const MAX_RUNTIME_ASSET_BYTES = 24 * 1024 * 1024

function assetExtension(value: string | undefined): string {
  const normalized = String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized.slice(0, 8) || 'bin'
}

export function buildRuntimeBundle(
  project: ScratchProject,
  files: Record<string, Uint8Array>,
  warnings: Set<string>
): RuntimeBundle {
  let runtimeAssetBytes = 0
  const assets: RuntimeAsset[] = []
  const targets = project.targets.map((target, index): RuntimeTarget => {
    const costume = target.costumes?.[target.currentCostume ?? 0]
    const sourceName = costume?.md5ext || (costume?.assetId && costume?.dataFormat
      ? `${costume.assetId}.${costume.dataFormat}`
      : '')
    const bytes = sourceName ? files[sourceName] : undefined
    let asset: RuntimeAssetReference | null = null
    if (bytes && runtimeAssetBytes + bytes.byteLength <= MAX_RUNTIME_ASSET_BYTES) {
      runtimeAssetBytes += bytes.byteLength
      const file = `asset-${index}.${assetExtension(costume?.dataFormat)}`
      assets.push({ file, data: new Uint8Array(bytes) })
      asset = { file, sourceName }
    } else if (sourceName) {
      warnings.add(bytes
        ? `Asset loading stopped at the ${MAX_RUNTIME_ASSET_BYTES / 1024 / 1024} MB V0.3.1.motion limit.`
        : `The current costume asset for ${target.name} is missing.`)
    }

    return {
      name: target.name,
      isStage: target.isStage,
      layerOrder: Number(target.layerOrder ?? 0),
      visible: target.visible !== false,
      x: Number(target.x ?? 0),
      y: Number(target.y ?? 0),
      size: Number(target.size ?? 100),
      direction: Number(target.direction ?? 90),
      rotationStyle: String(target.rotationStyle ?? 'all around'),
      bitmapResolution: Math.max(1, Number(costume?.bitmapResolution ?? 1)),
      rotationCenterX: Number(costume?.rotationCenterX ?? 0),
      rotationCenterY: Number(costume?.rotationCenterY ?? 0),
      asset
    }
  })

  const variables: RuntimeVariable[] = []
  const seenVariableIds = new Set<string>()
  for (const target of project.targets) {
    for (const [id, definition] of Object.entries(target.variables ?? {})) {
      if (seenVariableIds.has(id)) continue
      seenVariableIds.add(id)
      variables.push({ id, name: String(definition[0] ?? id), owner: target.name, value: definition[1] ?? 0 })
    }
  }
  return { manifest: { version: 1, targets, variables }, assets }
}
