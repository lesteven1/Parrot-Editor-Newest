import { ScratchStorage } from '@scratch/scratch-storage'

const encoder = new TextEncoder()

function cacheSvg(storage: ScratchStorage, svg: string): string {
  return String(storage.builtinHelper.store(
    storage.AssetType.ImageVector,
    storage.DataFormat.SVG,
    encoder.encode(svg),
    ''
  ))
}

function costume(name: string, assetId: string, centerX: number, centerY: number) {
  return {
    name,
    bitmapResolution: 1,
    dataFormat: 'svg',
    assetId,
    md5ext: `${assetId}.svg`,
    rotationCenterX: centerX,
    rotationCenterY: centerY
  }
}

export function buildStarterProject(storage: ScratchStorage): object {
  const backdropId = cacheSvg(storage, `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#eef5ff"/><stop offset="1" stop-color="#d8e7ff"/></linearGradient><pattern id="p" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#cbdcf3" stroke-width="1"/></pattern></defs><rect width="480" height="360" fill="url(#g)"/><rect width="480" height="360" fill="url(#p)"/></svg>`)
  const walkerId = cacheSvg(storage, `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="56"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#61d5eb"/><stop offset="1" stop-color="#806ff0"/></linearGradient></defs><path d="M8 32C8 13 22 4 39 8c12 3 19 13 17 27-2 13-13 19-28 17C15 50 8 43 8 32Z" fill="url(#b)"/><path d="m55 23 9 6-10 5Z" fill="#f5b83b"/><circle cx="45" cy="20" r="3" fill="#101827"/><path d="M13 38c9-8 19-8 28 1-10 9-20 10-28-1Z" fill="#fff" opacity=".25"/></svg>`)
  const targetId = cacheSvg(storage, `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="21" fill="#ff7a59"/><circle cx="24" cy="24" r="13" fill="#fff"/><circle cx="24" cy="24" r="6" fill="#ff7a59"/></svg>`)

  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: { 'parrot-score': ['score', 0] },
        lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0,
        costumes: [costume('Parrot backdrop', backdropId, 240, 180)],
        sounds: [], volume: 100, layerOrder: 0, tempo: 60,
        videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null
      },
      {
        isStage: false,
        name: 'Walker',
        variables: {}, lists: {}, broadcasts: {},
        blocks: {
          flag: { opcode: 'event_whenflagclicked', next: 'set-x', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
          'set-x': { opcode: 'motion_setx', next: 'set-y', parent: 'flag', inputs: { X: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
          'set-y': { opcode: 'motion_sety', next: 'show', parent: 'set-x', inputs: { Y: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
          show: { opcode: 'looks_show', next: 'forever', parent: 'set-y', inputs: {}, fields: {}, shadow: false, topLevel: false },
          forever: { opcode: 'control_forever', next: null, parent: 'show', inputs: { SUBSTACK: [2, 'if-right'] }, fields: {}, shadow: false, topLevel: false },
          'if-right': { opcode: 'control_if', next: 'if-left', parent: 'forever', inputs: { CONDITION: [2, 'right-key'], SUBSTACK: [2, 'move-right'] }, fields: {}, shadow: false, topLevel: false },
          'right-key': { opcode: 'sensing_keypressed', next: null, parent: 'if-right', inputs: { KEY_OPTION: [1, 'right-menu'] }, fields: {}, shadow: false, topLevel: false },
          'right-menu': { opcode: 'sensing_keyoptions', next: null, parent: 'right-key', inputs: {}, fields: { KEY_OPTION: ['right arrow', null] }, shadow: true, topLevel: false },
          'move-right': { opcode: 'motion_changexby', next: null, parent: 'if-right', inputs: { DX: [1, [4, '5']] }, fields: {}, shadow: false, topLevel: false },
          'if-left': { opcode: 'control_if', next: null, parent: 'if-right', inputs: { CONDITION: [2, 'left-key'], SUBSTACK: [2, 'move-left'] }, fields: {}, shadow: false, topLevel: false },
          'left-key': { opcode: 'sensing_keypressed', next: null, parent: 'if-left', inputs: { KEY_OPTION: [1, 'left-menu'] }, fields: {}, shadow: false, topLevel: false },
          'left-menu': { opcode: 'sensing_keyoptions', next: null, parent: 'left-key', inputs: {}, fields: { KEY_OPTION: ['left arrow', null] }, shadow: true, topLevel: false },
          'move-left': { opcode: 'motion_changexby', next: null, parent: 'if-left', inputs: { DX: [1, [4, '-5']] }, fields: {}, shadow: false, topLevel: false }
        },
        comments: {}, currentCostume: 0,
        costumes: [costume('Parrot', walkerId, 32, 28)],
        sounds: [], volume: 100, layerOrder: 1, visible: true,
        x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
      },
      {
        isStage: false,
        name: 'Target',
        variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0, costumes: [costume('Target', targetId, 24, 24)],
        sounds: [], volume: 100, layerOrder: 2, visible: true,
        x: 150, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
      }
    ],
    monitors: [], extensions: [],
    meta: { semver: '3.0.0', vm: '15.0.1', agent: 'Parrot Base V0.3.1.motion' }
  }
}

/** A dependency-free equivalent of Scratch's new-project Stage + Sprite1. */
export function buildBlankProject(storage: ScratchStorage): object {
  const backdropId = cacheSvg(storage, '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="white"/></svg>')
  const spriteId = cacheSvg(storage, `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="84" viewBox="0 0 96 84"><path fill="#ff9f1a" stroke="#cc6f00" stroke-width="3" d="M18 24 12 5l22 12c9-4 20-4 29 0L84 5l-6 23c7 8 9 19 5 30-6 17-24 23-42 19C22 74 11 63 12 48c0-10 2-17 6-24Z"/><ellipse cx="37" cy="39" rx="5" ry="7" fill="white"/><ellipse cx="61" cy="39" rx="5" ry="7" fill="white"/><circle cx="38" cy="40" r="2"/><circle cx="60" cy="40" r="2"/><path d="m49 47-5 4h10Z" fill="#6b3900"/><path d="M49 52c-4 7-11 6-14 3m14-3c4 7 11 6 14 3" fill="none" stroke="#6b3900" stroke-width="2" stroke-linecap="round"/></svg>`)
  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0,
        costumes: [costume('backdrop1', backdropId, 240, 180)],
        sounds: [], volume: 100, layerOrder: 0, tempo: 60,
        videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null
      },
      {
        isStage: false,
        name: 'Sprite1',
        variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0,
        costumes: [costume('costume1', spriteId, 48, 42)],
        sounds: [], volume: 100, layerOrder: 1, visible: true,
        x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
      }
    ],
    monitors: [], extensions: [],
    meta: { semver: '3.0.0', vm: '15.0.1', agent: 'Parrot Base V0.3.1.motion' }
  }
}
