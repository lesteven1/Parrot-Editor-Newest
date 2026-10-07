export type ScratchInput = unknown[]

export interface ScratchBlock {
  opcode: string
  next: string | null
  inputs: Record<string, ScratchInput>
  fields: Record<string, unknown[]>
  shadow: boolean
  topLevel: boolean
}

export interface ScratchCostume {
  dataFormat?: string
  assetId?: string
  md5ext?: string
  bitmapResolution?: number
  rotationCenterX?: number
  rotationCenterY?: number
}

export interface ScratchTarget {
  isStage: boolean
  name: string
  variables: Record<string, unknown[]>
  blocks: Record<string, ScratchBlock>
  costumes: ScratchCostume[]
  currentCostume: number
  layerOrder?: number
  visible?: boolean
  x?: number
  y?: number
  size?: number
  direction?: number
  rotationStyle?: string
}

export interface ScratchProject {
  targets: ScratchTarget[]
}

export interface ParsedScratchArchive {
  project: ScratchProject
  files: Record<string, Uint8Array>
}

export interface RuntimeAssetReference {
  file: string
  sourceName: string
}

export interface RuntimeAsset {
  file: string
  data: Uint8Array
}

export interface RuntimeTarget {
  name: string
  isStage: boolean
  layerOrder: number
  visible: boolean
  x: number
  y: number
  size: number
  direction: number
  rotationStyle: string
  bitmapResolution: number
  rotationCenterX: number
  rotationCenterY: number
  asset: RuntimeAssetReference | null
}

export interface RuntimeVariable {
  id: string
  name: string
  owner: string
  value: unknown
}

export interface RuntimeManifest {
  version: 1
  targets: RuntimeTarget[]
  variables: RuntimeVariable[]
}

export interface RuntimeBundle {
  manifest: RuntimeManifest
  assets: RuntimeAsset[]
}

export interface ScratchConversion {
  python: string
  warnings: string[]
  convertedBlockCount: number
  runtime: RuntimeBundle
}
