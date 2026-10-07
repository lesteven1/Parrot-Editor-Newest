declare module '@scratch/scratch-vm' {
  export default class VirtualMachine {
    runtime: {
      getTargetForStage: () => ScratchTarget
    }
    editingTarget: ScratchTarget | null
    blockListener: (event: unknown) => void
    attachAudioEngine: (audio: unknown) => void
    attachRenderer: (renderer: unknown) => void
    attachStorage: (storage: unknown) => void
    attachV2BitmapAdapter: (adapter: unknown) => void
    greenFlag: () => void
    loadProject: (project: ArrayBuffer | Uint8Array | object) => Promise<void>
    off: (event: string, listener: (...args: unknown[]) => void) => void
    on: (event: string, listener: (...args: never[]) => void) => void
    quit: () => void
    refreshWorkspace: () => void
    saveProjectSb3: () => Promise<Blob>
    setEditingTarget: (targetId: string) => void
    start: () => void
    stopAll: () => void
  }

  interface ScratchTarget {
    id: string
    isStage: boolean
    variables: Record<string, unknown>
    createVariable: (id: string, name: string, type: string) => void
  }
}

declare module '@scratch/scratch-render' {
  export default class ScratchRender {
    constructor(canvas: HTMLCanvasElement)
    dispose?: () => void
    resize: (width: number, height: number) => void
  }
}

declare module '@scratch/scratch-svg-renderer' {
  export class BitmapAdapter {
    constructor()
  }
}

declare module 'scratch-audio' {
  export default class AudioEngine {
    constructor()
  }
}
