import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'

const BACKDROP = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360"><rect width="480" height="360" fill="#eaf2ff"/><path d="M0 180h480M240 0v360" stroke="#ccdcf2"/><path d="M0 60h480M0 120h480M0 240h480M0 300h480M60 0v360M120 0v360M180 0v360M300 0v360M360 0v360M420 0v360" stroke="#dbe7f7"/></svg>`
const WALKER = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="56" viewBox="0 0 64 56"><defs><linearGradient id="b" x2="1" y2="1"><stop stop-color="#61d5eb"/><stop offset="1" stop-color="#806ff0"/></linearGradient></defs><path d="M8 32C8 13 22 4 39 8c12 3 19 13 17 27-2 13-13 19-28 17C15 50 8 43 8 32Z" fill="url(#b)"/><path d="m55 23 9 6-10 5Z" fill="#f5b83b"/><circle cx="45" cy="20" r="3" fill="#101827"/><path d="M13 38c9-8 19-8 28 1-10 9-20 10-28-1Z" fill="#fff" opacity=".25"/></svg>`
const TARGET = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><circle cx="24" cy="24" r="21" fill="#ff7a59"/><circle cx="24" cy="24" r="13" fill="#fff"/><circle cx="24" cy="24" r="6" fill="#ff7a59"/></svg>`
const PARITY_WALKER = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="56" viewBox="0 0 64 56"><rect width="64" height="56" fill="#4c97ff"/></svg>`
const DEFAULT_BACKDROP = `<svg version="1.1" width="2" height="2" viewBox="-1 -1 2 2" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <!-- Exported by Scratch - http://scratch.mit.edu/ -->
</svg>`

function asset(svg) {
  const id = createHash('md5').update(svg).digest('hex')
  return { id, name: `${id}.svg`, bytes: strToU8(svg) }
}

function scratchLibraryAsset(id) {
  const name = `${id}.svg`
  return { id, name, bytes: readFileSync(resolve('resources', 'scratch-library', name)) }
}

const backdrop = asset(BACKDROP)
const walker = asset(WALKER)
const target = asset(TARGET)
const parityWalker = asset(PARITY_WALKER)
const defaultBackdrop = asset(DEFAULT_BACKDROP)
const scratchCatA = scratchLibraryAsset('bcf454acf82e4504149f7ffe07081dbc')
const scratchCatB = scratchLibraryAsset('0fb9be3e8397c983338cb71dc84d0b25')
const scratchApple = scratchLibraryAsset('3826a4091a33e4d26f87a2fac7cf796b')

function costume(name, source, x, y) {
  return { name, bitmapResolution: 1, dataFormat: 'svg', assetId: source.id, md5ext: source.name, rotationCenterX: x, rotationCenterY: y }
}

function project(blocks, options = {}) {
  const walkerSource = options.walkerSource ?? walker
  return {
    targets: [
      {
        isStage: true, name: 'Stage', variables: { 'parrot-score': ['score', 0] }, lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0, costumes: [costume('Parrot backdrop', backdrop, 240, 180)], sounds: [], volume: 100, layerOrder: 0,
        tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null
      },
      {
        isStage: false, name: 'Walker', variables: {}, lists: {}, broadcasts: {}, blocks, comments: {}, currentCostume: 0,
        costumes: [costume('Parrot', walkerSource, 32, 28)], sounds: [], volume: 100, layerOrder: 1, visible: true,
        x: options.walkerX ?? 0, y: options.walkerY ?? 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
      },
      {
        isStage: false, name: 'Target', variables: {}, lists: {}, broadcasts: {}, blocks: {}, comments: {}, currentCostume: 0,
        costumes: [costume('Target', target, 24, 24)], sounds: [], volume: 100, layerOrder: 2, visible: true,
        x: 150, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
      }
    ],
    monitors: [], extensions: [], meta: { semver: '3.0.0', vm: '15.0.1', agent: 'Parrot Base V0.3.1.motion examples' }
  }
}

function allBlocksProject(blocks, targetBlocks) {
  return {
    targets: [
      {
        isStage: true, name: 'Stage', variables: { 'parrot-score': ['score', 0] }, lists: {}, broadcasts: {}, blocks: {}, comments: {},
        currentCostume: 0, costumes: [costume('backdrop1', defaultBackdrop, 240, 180)], sounds: [], volume: 100, layerOrder: 0,
        tempo: 60, videoTransparency: 50, videoState: 'on', textToSpeechLanguage: null
      },
      {
        isStage: false, name: 'Sprite1', variables: {}, lists: {}, broadcasts: {}, blocks, comments: {}, currentCostume: 0,
        costumes: [
          costume('costume1', scratchCatA, 48, 50),
          costume('costume2', scratchCatB, 46, 53)
        ],
        sounds: [], volume: 100, layerOrder: 1, visible: true,
        x: 0, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
      },
      {
        isStage: false, name: 'Target', variables: {}, lists: {}, broadcasts: {}, blocks: targetBlocks, comments: {}, currentCostume: 0,
        costumes: [costume('Apple', scratchApple, 31, 31)], sounds: [], volume: 100, layerOrder: 2, visible: true,
        x: 150, y: 0, size: 100, direction: 90, draggable: false, rotationStyle: 'all around'
      }
    ],
    monitors: [{
      id: 'parrot-score', mode: 'default', opcode: 'data_variable', params: { VARIABLE: 'score' },
      spriteName: null, value: 0, width: 0, height: 0, x: 5, y: 5, visible: true,
      sliderMin: 0, sliderMax: 100, isDiscrete: true
    }],
    extensions: [], meta: { semver: '3.0.0', vm: '15.0.1', agent: 'Parrot Base V0.3.1.motion all-blocks example' }
  }
}

const examples = {
  'arrow-key-walker.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'set-x', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    'set-x': { opcode: 'motion_setx', next: 'set-y', parent: 'flag', inputs: { X: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
    'set-y': { opcode: 'motion_sety', next: 'forever', parent: 'set-x', inputs: { Y: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
    forever: { opcode: 'control_forever', next: null, parent: 'set-y', inputs: { SUBSTACK: [2, 'if-right'] }, fields: {}, shadow: false, topLevel: false },
    'if-right': { opcode: 'control_if', next: 'if-left', parent: 'forever', inputs: { CONDITION: [2, 'right-key'], SUBSTACK: [2, 'move-right'] }, fields: {}, shadow: false, topLevel: false },
    'right-key': { opcode: 'sensing_keypressed', next: null, parent: 'if-right', inputs: { KEY_OPTION: [1, 'right-menu'] }, fields: {}, shadow: false, topLevel: false },
    'right-menu': { opcode: 'sensing_keyoptions', next: null, parent: 'right-key', inputs: {}, fields: { KEY_OPTION: ['right arrow', null] }, shadow: true, topLevel: false },
    'move-right': { opcode: 'motion_changexby', next: null, parent: 'if-right', inputs: { DX: [1, [4, '5']] }, fields: {}, shadow: false, topLevel: false },
    'if-left': { opcode: 'control_if', next: null, parent: 'if-right', inputs: { CONDITION: [2, 'left-key'], SUBSTACK: [2, 'move-left'] }, fields: {}, shadow: false, topLevel: false },
    'left-key': { opcode: 'sensing_keypressed', next: null, parent: 'if-left', inputs: { KEY_OPTION: [1, 'left-menu'] }, fields: {}, shadow: false, topLevel: false },
    'left-menu': { opcode: 'sensing_keyoptions', next: null, parent: 'left-key', inputs: {}, fields: { KEY_OPTION: ['left arrow', null] }, shadow: true, topLevel: false },
    'move-left': { opcode: 'motion_changexby', next: null, parent: 'if-left', inputs: { DX: [1, [4, '-5']] }, fields: {}, shadow: false, topLevel: false }
  },
  'repeat-move.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'set-x', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    'set-x': { opcode: 'motion_setx', next: 'repeat', parent: 'flag', inputs: { X: [1, [4, '-200']] }, fields: {}, shadow: false, topLevel: false },
    repeat: { opcode: 'control_repeat', next: null, parent: 'set-x', inputs: { TIMES: [1, [4, '20']], SUBSTACK: [2, 'step'] }, fields: {}, shadow: false, topLevel: false },
    step: { opcode: 'motion_changexby', next: null, parent: 'repeat', inputs: { DX: [1, [4, '20']] }, fields: {}, shadow: false, topLevel: false }
  },
  'target-visibility.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'forever', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    forever: { opcode: 'control_forever', next: null, parent: 'flag', inputs: { SUBSTACK: [2, 'if-target'] }, fields: {}, shadow: false, topLevel: false },
    'if-target': { opcode: 'control_if_else', next: null, parent: 'forever', inputs: { CONDITION: [2, 'touching'], SUBSTACK: [2, 'hide'], SUBSTACK2: [2, 'show'] }, fields: {}, shadow: false, topLevel: false },
    touching: { opcode: 'sensing_touchingobject', next: null, parent: 'if-target', inputs: { TOUCHINGOBJECTMENU: [1, 'touch-menu'] }, fields: {}, shadow: false, topLevel: false },
    'touch-menu': { opcode: 'sensing_touchingobjectmenu', next: null, parent: 'touching', inputs: {}, fields: { TOUCHINGOBJECTMENU: ['Target', null] }, shadow: true, topLevel: false },
    hide: { opcode: 'looks_hide', next: null, parent: 'if-target', inputs: {}, fields: {}, shadow: false, topLevel: false },
    show: { opcode: 'looks_show', next: null, parent: 'if-target', inputs: {}, fields: {}, shadow: false, topLevel: false }
  },
  'variables-and-operators.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'set-score', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    'set-score': { opcode: 'data_setvariableto', next: 'set-x', parent: 'flag', inputs: { VALUE: [2, 'initial-position-sum'] }, fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false },
    'initial-position-sum': { opcode: 'operator_add', next: null, parent: 'set-score', inputs: { NUM1: [2, 'initial-x'], NUM2: [2, 'initial-y'] }, fields: {}, shadow: false, topLevel: false },
    'initial-x': { opcode: 'motion_xposition', next: null, parent: 'initial-position-sum', inputs: {}, fields: {}, shadow: false, topLevel: false },
    'initial-y': { opcode: 'motion_yposition', next: null, parent: 'initial-position-sum', inputs: {}, fields: {}, shadow: false, topLevel: false },
    'set-x': { opcode: 'motion_setx', next: 'set-y', parent: 'set-score', inputs: { X: [2, 'subtract'] }, fields: {}, shadow: false, topLevel: false },
    subtract: { opcode: 'operator_subtract', next: null, parent: 'set-x', inputs: { NUM1: [2, 'multiply'], NUM2: [1, [4, '200']] }, fields: {}, shadow: false, topLevel: false },
    multiply: { opcode: 'operator_multiply', next: null, parent: 'subtract', inputs: { NUM1: [2, 'score-for-x'], NUM2: [1, [4, '30']] }, fields: {}, shadow: false, topLevel: false },
    'score-for-x': { opcode: 'data_variable', next: null, parent: 'multiply', inputs: {}, fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false },
    'set-y': { opcode: 'motion_sety', next: 'repeat', parent: 'set-x', inputs: { Y: [2, 'divide'] }, fields: {}, shadow: false, topLevel: false },
    divide: { opcode: 'operator_divide', next: null, parent: 'set-y', inputs: { NUM1: [2, 'add'], NUM2: [1, [4, '2']] }, fields: {}, shadow: false, topLevel: false },
    add: { opcode: 'operator_add', next: null, parent: 'divide', inputs: { NUM1: [1, [4, '20']], NUM2: [1, [4, '20']] }, fields: {}, shadow: false, topLevel: false },
    repeat: { opcode: 'control_repeat', next: null, parent: 'set-y', inputs: { TIMES: [1, [4, '12']], SUBSTACK: [2, 'change-score'] }, fields: {}, shadow: false, topLevel: false },
    'change-score': { opcode: 'data_changevariableby', next: 'if-else', parent: 'repeat', inputs: { VALUE: [1, [4, '1']] }, fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false },
    'if-else': { opcode: 'control_if_else', next: null, parent: 'change-score', inputs: { CONDITION: [2, 'or'], SUBSTACK: [2, 'change-x'], SUBSTACK2: [2, 'change-y'] }, fields: {}, shadow: false, topLevel: false },
    or: { opcode: 'operator_or', next: null, parent: 'if-else', inputs: { OPERAND1: [2, 'less-than'], OPERAND2: [2, 'and'] }, fields: {}, shadow: false, topLevel: false },
    'less-than': { opcode: 'operator_lt', next: null, parent: 'or', inputs: { OPERAND1: [2, 'score-less'], OPERAND2: [1, [4, '4']] }, fields: {}, shadow: false, topLevel: false },
    'score-less': { opcode: 'data_variable', next: null, parent: 'less-than', inputs: {}, fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false },
    and: { opcode: 'operator_and', next: null, parent: 'or', inputs: { OPERAND1: [2, 'greater-than'], OPERAND2: [2, 'not'] }, fields: {}, shadow: false, topLevel: false },
    'greater-than': { opcode: 'operator_gt', next: null, parent: 'and', inputs: { OPERAND1: [2, 'score-greater'], OPERAND2: [1, [4, '6']] }, fields: {}, shadow: false, topLevel: false },
    'score-greater': { opcode: 'data_variable', next: null, parent: 'greater-than', inputs: {}, fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false },
    not: { opcode: 'operator_not', next: null, parent: 'and', inputs: { OPERAND: [2, 'equals'] }, fields: {}, shadow: false, topLevel: false },
    equals: { opcode: 'operator_equals', next: null, parent: 'not', inputs: { OPERAND1: [2, 'score-equals'], OPERAND2: [1, [4, '10']] }, fields: {}, shadow: false, topLevel: false },
    'score-equals': { opcode: 'data_variable', next: null, parent: 'equals', inputs: {}, fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false },
    'change-x': { opcode: 'motion_changexby', next: null, parent: 'if-else', inputs: { DX: [1, [4, '20']] }, fields: {}, shadow: false, topLevel: false },
    'change-y': { opcode: 'motion_changeyby', next: null, parent: 'if-else', inputs: { DY: [1, [4, '-5']] }, fields: {}, shadow: false, topLevel: false }
  },
  'edge-reset.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'go-edge', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    'go-edge': { opcode: 'motion_gotoxy', next: 'if-edge', parent: 'flag', inputs: { X: [1, [4, '220']], Y: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
    'if-edge': { opcode: 'control_if_else', next: null, parent: 'go-edge', inputs: { CONDITION: [2, 'touch-edge'], SUBSTACK: [2, 'set-center'], SUBSTACK2: [2, 'hide'] }, fields: {}, shadow: false, topLevel: false },
    'touch-edge': { opcode: 'sensing_touchingobject', next: null, parent: 'if-edge', inputs: { TOUCHINGOBJECTMENU: [1, 'edge-menu'] }, fields: {}, shadow: false, topLevel: false },
    'edge-menu': { opcode: 'sensing_touchingobjectmenu', next: null, parent: 'touch-edge', inputs: {}, fields: { TOUCHINGOBJECTMENU: ['edge', '_edge_'] }, shadow: true, topLevel: false },
    'set-center': { opcode: 'motion_setx', next: 'show', parent: 'if-edge', inputs: { X: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
    show: { opcode: 'looks_show', next: null, parent: 'set-center', inputs: {}, fields: {}, shadow: false, topLevel: false },
    hide: { opcode: 'looks_hide', next: null, parent: 'if-edge', inputs: {}, fields: {}, shadow: false, topLevel: false }
  },
  'motion-complete.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'rotation-left-right', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    'rotation-left-right': { opcode: 'motion_setrotationstyle', next: 'point-east', parent: 'flag', inputs: {}, fields: { STYLE: ['left-right', null] }, shadow: false, topLevel: false },
    'point-east': { opcode: 'motion_pointindirection', next: 'move', parent: 'rotation-left-right', inputs: { DIRECTION: [1, [8, '450']] }, fields: {}, shadow: false, topLevel: false },
    move: { opcode: 'motion_movesteps', next: 'turn-right', parent: 'point-east', inputs: { STEPS: [1, [4, '10']] }, fields: {}, shadow: false, topLevel: false },
    'turn-right': { opcode: 'motion_turnright', next: 'turn-left', parent: 'move', inputs: { DEGREES: [1, [4, '90']] }, fields: {}, shadow: false, topLevel: false },
    'turn-left': { opcode: 'motion_turnleft', next: 'goto-random', parent: 'turn-right', inputs: { DEGREES: [1, [4, '90']] }, fields: {}, shadow: false, topLevel: false },
    'goto-random': { opcode: 'motion_goto', next: 'goto-mouse', parent: 'turn-left', inputs: { TO: [1, 'goto-random-menu'] }, fields: {}, shadow: false, topLevel: false },
    'goto-random-menu': { opcode: 'motion_goto_menu', next: null, parent: 'goto-random', inputs: {}, fields: { TO: ['_random_', null] }, shadow: true, topLevel: false },
    'goto-mouse': { opcode: 'motion_goto', next: 'goto-target', parent: 'goto-random', inputs: { TO: [1, 'goto-mouse-menu'] }, fields: {}, shadow: false, topLevel: false },
    'goto-mouse-menu': { opcode: 'motion_goto_menu', next: null, parent: 'goto-mouse', inputs: {}, fields: { TO: ['_mouse_', null] }, shadow: true, topLevel: false },
    'goto-target': { opcode: 'motion_goto', next: 'glide-target', parent: 'goto-mouse', inputs: { TO: [1, 'goto-target-menu'] }, fields: {}, shadow: false, topLevel: false },
    'goto-target-menu': { opcode: 'motion_goto_menu', next: null, parent: 'goto-target', inputs: {}, fields: { TO: ['Target', null] }, shadow: true, topLevel: false },
    'glide-target': { opcode: 'motion_glideto', next: 'glide-xy', parent: 'goto-target', inputs: { SECS: [1, [4, '0.05']], TO: [1, 'glide-target-menu'] }, fields: {}, shadow: false, topLevel: false },
    'glide-target-menu': { opcode: 'motion_glideto_menu', next: null, parent: 'glide-target', inputs: {}, fields: { TO: ['Target', null] }, shadow: true, topLevel: false },
    'glide-xy': { opcode: 'motion_glidesecstoxy', next: 'point-target', parent: 'glide-target', inputs: { SECS: [1, [4, '0.05']], X: [1, [4, '-50']], Y: [1, [4, '40']] }, fields: {}, shadow: false, topLevel: false },
    'point-target': { opcode: 'motion_pointtowards', next: 'point-mouse', parent: 'glide-xy', inputs: { TOWARDS: [1, 'point-target-menu'] }, fields: {}, shadow: false, topLevel: false },
    'point-target-menu': { opcode: 'motion_pointtowards_menu', next: null, parent: 'point-target', inputs: {}, fields: { TOWARDS: ['Target', null] }, shadow: true, topLevel: false },
    'point-mouse': { opcode: 'motion_pointtowards', next: 'point-random', parent: 'point-target', inputs: { TOWARDS: [1, 'point-mouse-menu'] }, fields: {}, shadow: false, topLevel: false },
    'point-mouse-menu': { opcode: 'motion_pointtowards_menu', next: null, parent: 'point-mouse', inputs: {}, fields: { TOWARDS: ['_mouse_', null] }, shadow: true, topLevel: false },
    'point-random': { opcode: 'motion_pointtowards', next: 'rotation-none', parent: 'point-mouse', inputs: { TOWARDS: [1, 'point-random-menu'] }, fields: {}, shadow: false, topLevel: false },
    'point-random-menu': { opcode: 'motion_pointtowards_menu', next: null, parent: 'point-random', inputs: {}, fields: { TOWARDS: ['_random_', null] }, shadow: true, topLevel: false },
    'rotation-none': { opcode: 'motion_setrotationstyle', next: 'rotation-all', parent: 'point-random', inputs: {}, fields: { STYLE: ["don't rotate", null] }, shadow: false, topLevel: false },
    'rotation-all': { opcode: 'motion_setrotationstyle', next: 'go-edge', parent: 'rotation-none', inputs: {}, fields: { STYLE: ['all around', null] }, shadow: false, topLevel: false },
    'go-edge': { opcode: 'motion_gotoxy', next: 'point-before-bounce', parent: 'rotation-all', inputs: { X: [1, [4, '230']], Y: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
    'point-before-bounce': { opcode: 'motion_pointindirection', next: 'bounce', parent: 'go-edge', inputs: { DIRECTION: [1, [8, '90']] }, fields: {}, shadow: false, topLevel: false },
    bounce: { opcode: 'motion_ifonedgebounce', next: 'report-direction', parent: 'point-before-bounce', inputs: {}, fields: {}, shadow: false, topLevel: false },
    'report-direction': { opcode: 'motion_pointindirection', next: null, parent: 'bounce', inputs: { DIRECTION: [2, 'direction'] }, fields: {}, shadow: false, topLevel: false },
    direction: { opcode: 'motion_direction', next: null, parent: 'report-direction', inputs: {}, fields: {}, shadow: false, topLevel: false }
  }
}

function prefixedBlocks(prefix, blocks, xOffset) {
  const blockIds = new Set(Object.keys(blocks))
  const remapInput = (value) => Array.isArray(value)
    ? value.map((item) => typeof item === 'string' && blockIds.has(item) ? `${prefix}-${item}` : remapInput(item))
    : value

  return Object.fromEntries(Object.entries(blocks).map(([id, block]) => [
    `${prefix}-${id}`,
    {
      ...block,
      next: block.next && blockIds.has(block.next) ? `${prefix}-${block.next}` : block.next,
      parent: block.parent && blockIds.has(block.parent) ? `${prefix}-${block.parent}` : block.parent,
      inputs: Object.fromEntries(Object.entries(block.inputs).map(([name, input]) => (
        [name, remapInput(input)]
      ))),
      ...(block.topLevel ? { x: Number(block.x ?? 80) + xOffset, y: Number(block.y ?? 56) } : {})
    }
  ]))
}

const showcaseKeyBlocks = prefixedBlocks('keys', examples['arrow-key-walker.sb3'], 1560)
showcaseKeyBlocks['keys-set-x'].inputs.X = [1, [4, '-120']]
showcaseKeyBlocks['keys-if-left'].next = 'keys-if-up'
showcaseKeyBlocks['keys-move-right'].next = 'keys-score-right'
showcaseKeyBlocks['keys-move-left'].next = 'keys-score-left'
Object.assign(showcaseKeyBlocks, {
  'keys-score-right': {
    opcode: 'data_changevariableby', next: null, parent: 'keys-move-right', inputs: { VALUE: [1, [4, '1']] },
    fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false
  },
  'keys-score-left': {
    opcode: 'data_changevariableby', next: null, parent: 'keys-move-left', inputs: { VALUE: [1, [4, '1']] },
    fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false
  },
  'keys-if-up': {
    opcode: 'control_if', next: 'keys-if-down', parent: 'keys-if-left',
    inputs: { CONDITION: [2, 'keys-up-key'], SUBSTACK: [2, 'keys-move-up'] }, fields: {}, shadow: false, topLevel: false
  },
  'keys-up-key': {
    opcode: 'sensing_keypressed', next: null, parent: 'keys-if-up', inputs: { KEY_OPTION: [1, 'keys-up-menu'] },
    fields: {}, shadow: false, topLevel: false
  },
  'keys-up-menu': {
    opcode: 'sensing_keyoptions', next: null, parent: 'keys-up-key', inputs: {},
    fields: { KEY_OPTION: ['up arrow', null] }, shadow: true, topLevel: false
  },
  'keys-move-up': {
    opcode: 'motion_changeyby', next: 'keys-score-up', parent: 'keys-if-up', inputs: { DY: [1, [4, '5']] },
    fields: {}, shadow: false, topLevel: false
  },
  'keys-score-up': {
    opcode: 'data_changevariableby', next: null, parent: 'keys-move-up', inputs: { VALUE: [1, [4, '1']] },
    fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false
  },
  'keys-if-down': {
    opcode: 'control_if', next: null, parent: 'keys-if-up',
    inputs: { CONDITION: [2, 'keys-down-key'], SUBSTACK: [2, 'keys-move-down'] }, fields: {}, shadow: false, topLevel: false
  },
  'keys-down-key': {
    opcode: 'sensing_keypressed', next: null, parent: 'keys-if-down', inputs: { KEY_OPTION: [1, 'keys-down-menu'] },
    fields: {}, shadow: false, topLevel: false
  },
  'keys-down-menu': {
    opcode: 'sensing_keyoptions', next: null, parent: 'keys-down-key', inputs: {},
    fields: { KEY_OPTION: ['down arrow', null] }, shadow: true, topLevel: false
  },
  'keys-move-down': {
    opcode: 'motion_changeyby', next: 'keys-score-down', parent: 'keys-if-down', inputs: { DY: [1, [4, '-5']] },
    fields: {}, shadow: false, topLevel: false
  },
  'keys-score-down': {
    opcode: 'data_changevariableby', next: null, parent: 'keys-move-down', inputs: { VALUE: [1, [4, '1']] },
    fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false
  }
})

const allBlocksShowcase = {
  ...prefixedBlocks('motion', examples['motion-complete.sb3'], 0),
  ...prefixedBlocks('logic', examples['variables-and-operators.sb3'], 520),
  ...prefixedBlocks('sensing', examples['target-visibility.sb3'], 1040),
  ...showcaseKeyBlocks
}

const targetAnimationBlocks = {
  flag: {
    opcode: 'event_whenflagclicked', next: 'go-start', parent: null, inputs: {}, fields: {},
    shadow: false, topLevel: true, x: 80, y: 56
  },
  'go-start': {
    opcode: 'motion_gotoxy', next: 'point-start', parent: 'flag',
    inputs: { X: [1, [4, '-170']], Y: [1, [4, '100']] }, fields: {}, shadow: false, topLevel: false
  },
  'point-start': {
    opcode: 'motion_pointindirection', next: 'show', parent: 'go-start', inputs: { DIRECTION: [1, [8, '70']] },
    fields: {}, shadow: false, topLevel: false
  },
  show: { opcode: 'looks_show', next: 'forever', parent: 'point-start', inputs: {}, fields: {}, shadow: false, topLevel: false },
  forever: {
    opcode: 'control_forever', next: null, parent: 'show', inputs: { SUBSTACK: [2, 'move'] },
    fields: {}, shadow: false, topLevel: false
  },
  move: {
    opcode: 'motion_movesteps', next: 'curve', parent: 'forever', inputs: { STEPS: [1, [4, '4']] },
    fields: {}, shadow: false, topLevel: false
  },
  curve: {
    opcode: 'motion_turnright', next: 'bounce', parent: 'move', inputs: { DEGREES: [1, [4, '2']] },
    fields: {}, shadow: false, topLevel: false
  },
  bounce: { opcode: 'motion_ifonedgebounce', next: 'if-cat', parent: 'curve', inputs: {}, fields: {}, shadow: false, topLevel: false },
  'if-cat': {
    opcode: 'control_if', next: null, parent: 'bounce',
    inputs: { CONDITION: [2, 'touch-cat'], SUBSTACK: [2, 'turn-away'] }, fields: {}, shadow: false, topLevel: false
  },
  'touch-cat': {
    opcode: 'sensing_touchingobject', next: null, parent: 'if-cat', inputs: { TOUCHINGOBJECTMENU: [1, 'touch-cat-menu'] },
    fields: {}, shadow: false, topLevel: false
  },
  'touch-cat-menu': {
    opcode: 'sensing_touchingobjectmenu', next: null, parent: 'touch-cat', inputs: {},
    fields: { TOUCHINGOBJECTMENU: ['Sprite1', null] }, shadow: true, topLevel: false
  },
  'turn-away': {
    opcode: 'motion_turnright', next: 'score-hit', parent: 'if-cat', inputs: { DEGREES: [1, [4, '180']] },
    fields: {}, shadow: false, topLevel: false
  },
  'score-hit': {
    opcode: 'data_changevariableby', next: null, parent: 'turn-away', inputs: { VALUE: [1, [4, '10']] },
    fields: { VARIABLE: ['score', 'parrot-score'] }, shadow: false, topLevel: false
  }
}

const parityExamples = {
  'long-turn-move-bounce.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'forever', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    forever: { opcode: 'control_forever', next: null, parent: 'flag', inputs: { SUBSTACK: [2, 'turn'] }, fields: {}, shadow: false, topLevel: false },
    turn: { opcode: 'motion_turnright', next: 'move', parent: 'forever', inputs: { DEGREES: [1, [4, '15']] }, fields: {}, shadow: false, topLevel: false },
    move: { opcode: 'motion_movesteps', next: 'bounce', parent: 'turn', inputs: { STEPS: [1, [4, '20']] }, fields: {}, shadow: false, topLevel: false },
    bounce: { opcode: 'motion_ifonedgebounce', next: null, parent: 'move', inputs: {}, fields: {}, shadow: false, topLevel: false }
  },
  'long-vector-costume-bounce.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'forever', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    forever: { opcode: 'control_forever', next: null, parent: 'flag', inputs: { SUBSTACK: [2, 'turn'] }, fields: {}, shadow: false, topLevel: false },
    turn: { opcode: 'motion_turnright', next: 'move', parent: 'forever', inputs: { DEGREES: [1, [4, '15']] }, fields: {}, shadow: false, topLevel: false },
    move: { opcode: 'motion_movesteps', next: 'bounce', parent: 'turn', inputs: { STEPS: [1, [4, '20']] }, fields: {}, shadow: false, topLevel: false },
    bounce: { opcode: 'motion_ifonedgebounce', next: null, parent: 'move', inputs: {}, fields: {}, shadow: false, topLevel: false }
  },
  'long-coordinate-reporters.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'set-x', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    'set-x': { opcode: 'motion_setx', next: 'set-y', parent: 'flag', inputs: { X: [1, [4, '-200']] }, fields: {}, shadow: false, topLevel: false },
    'set-y': { opcode: 'motion_sety', next: 'forever', parent: 'set-x', inputs: { Y: [1, [4, '-120']] }, fields: {}, shadow: false, topLevel: false },
    forever: { opcode: 'control_forever', next: null, parent: 'set-y', inputs: { SUBSTACK: [2, 'change-x'] }, fields: {}, shadow: false, topLevel: false },
    'change-x': { opcode: 'motion_changexby', next: 'change-y', parent: 'forever', inputs: { DX: [1, [4, '7']] }, fields: {}, shadow: false, topLevel: false },
    'change-y': { opcode: 'motion_changeyby', next: 'if-x', parent: 'change-x', inputs: { DY: [1, [4, '3']] }, fields: {}, shadow: false, topLevel: false },
    'if-x': { opcode: 'control_if', next: 'if-y', parent: 'change-y', inputs: { CONDITION: [2, 'x-over'], SUBSTACK: [2, 'reset-x'] }, fields: {}, shadow: false, topLevel: false },
    'x-over': { opcode: 'operator_gt', next: null, parent: 'if-x', inputs: { OPERAND1: [2, 'x-position'], OPERAND2: [1, [4, '200']] }, fields: {}, shadow: false, topLevel: false },
    'x-position': { opcode: 'motion_xposition', next: null, parent: 'x-over', inputs: {}, fields: {}, shadow: false, topLevel: false },
    'reset-x': { opcode: 'motion_setx', next: null, parent: 'if-x', inputs: { X: [1, [4, '-200']] }, fields: {}, shadow: false, topLevel: false },
    'if-y': { opcode: 'control_if', next: null, parent: 'if-x', inputs: { CONDITION: [2, 'y-over'], SUBSTACK: [2, 'reset-y'] }, fields: {}, shadow: false, topLevel: false },
    'y-over': { opcode: 'operator_gt', next: null, parent: 'if-y', inputs: { OPERAND1: [2, 'y-position'], OPERAND2: [1, [4, '150']] }, fields: {}, shadow: false, topLevel: false },
    'y-position': { opcode: 'motion_yposition', next: null, parent: 'y-over', inputs: {}, fields: {}, shadow: false, topLevel: false },
    'reset-y': { opcode: 'motion_sety', next: null, parent: 'if-y', inputs: { Y: [1, [4, '-150']] }, fields: {}, shadow: false, topLevel: false }
  },
  'long-target-rotation.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'rotation', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    rotation: { opcode: 'motion_setrotationstyle', next: 'forever', parent: 'flag', inputs: {}, fields: { STYLE: ['all around', null] }, shadow: false, topLevel: false },
    forever: { opcode: 'control_forever', next: null, parent: 'rotation', inputs: { SUBSTACK: [2, 'point-target'] }, fields: {}, shadow: false, topLevel: false },
    'point-target': { opcode: 'motion_pointtowards', next: 'turn', parent: 'forever', inputs: { TOWARDS: [1, 'point-target-menu'] }, fields: {}, shadow: false, topLevel: false },
    'point-target-menu': { opcode: 'motion_pointtowards_menu', next: null, parent: 'point-target', inputs: {}, fields: { TOWARDS: ['Target', null] }, shadow: true, topLevel: false },
    turn: { opcode: 'motion_turnright', next: 'move', parent: 'point-target', inputs: { DEGREES: [1, [4, '30']] }, fields: {}, shadow: false, topLevel: false },
    move: { opcode: 'motion_movesteps', next: 'bounce', parent: 'turn', inputs: { STEPS: [1, [4, '12']] }, fields: {}, shadow: false, topLevel: false },
    bounce: { opcode: 'motion_ifonedgebounce', next: null, parent: 'move', inputs: {}, fields: {}, shadow: false, topLevel: false }
  },
  'long-glide-cycle.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'forever', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    forever: { opcode: 'control_forever', next: null, parent: 'flag', inputs: { SUBSTACK: [2, 'glide-out'] }, fields: {}, shadow: false, topLevel: false },
    'glide-out': { opcode: 'motion_glidesecstoxy', next: 'glide-back', parent: 'forever', inputs: { SECS: [1, [4, '1']], X: [1, [4, '150']], Y: [1, [4, '100']] }, fields: {}, shadow: false, topLevel: false },
    'glide-back': { opcode: 'motion_glidesecstoxy', next: null, parent: 'glide-out', inputs: { SECS: [1, [4, '1']], X: [1, [4, '-150']], Y: [1, [4, '-100']] }, fields: {}, shadow: false, topLevel: false }
  },
  'long-target-glide.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'forever', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    forever: { opcode: 'control_forever', next: null, parent: 'flag', inputs: { SUBSTACK: [2, 'goto-target'] }, fields: {}, shadow: false, topLevel: false },
    'goto-target': { opcode: 'motion_goto', next: 'point-left', parent: 'forever', inputs: { TO: [1, 'goto-target-menu'] }, fields: {}, shadow: false, topLevel: false },
    'goto-target-menu': { opcode: 'motion_goto_menu', next: null, parent: 'goto-target', inputs: {}, fields: { TO: ['Target', null] }, shadow: true, topLevel: false },
    'point-left': { opcode: 'motion_pointindirection', next: 'move-away', parent: 'goto-target', inputs: { DIRECTION: [1, [8, '-90']] }, fields: {}, shadow: false, topLevel: false },
    'move-away': { opcode: 'motion_movesteps', next: 'glide-target', parent: 'point-left', inputs: { STEPS: [1, [4, '30']] }, fields: {}, shadow: false, topLevel: false },
    'glide-target': { opcode: 'motion_glideto', next: 'turn-left', parent: 'move-away', inputs: { SECS: [1, [4, '0.5']], TO: [1, 'glide-target-menu'] }, fields: {}, shadow: false, topLevel: false },
    'glide-target-menu': { opcode: 'motion_glideto_menu', next: null, parent: 'glide-target', inputs: {}, fields: { TO: ['Target', null] }, shadow: true, topLevel: false },
    'turn-left': { opcode: 'motion_turnleft', next: null, parent: 'glide-target', inputs: { DEGREES: [1, [4, '15']] }, fields: {}, shadow: false, topLevel: false }
  },
  'long-idle-key-loop.sb3': {
    flag: { opcode: 'event_whenflagclicked', next: 'go-67', parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 80, y: 56 },
    'go-67': { opcode: 'motion_gotoxy', next: 'set-x', parent: 'flag', inputs: { X: [1, [4, '67']], Y: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
    'set-x': { opcode: 'motion_setx', next: 'set-y', parent: 'go-67', inputs: { X: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
    'set-y': { opcode: 'motion_sety', next: 'forever', parent: 'set-x', inputs: { Y: [1, [4, '0']] }, fields: {}, shadow: false, topLevel: false },
    forever: { opcode: 'control_forever', next: null, parent: 'set-y', inputs: { SUBSTACK: [2, 'if-right'] }, fields: {}, shadow: false, topLevel: false },
    'if-right': { opcode: 'control_if', next: 'if-left', parent: 'forever', inputs: { CONDITION: [2, 'right-key'], SUBSTACK: [2, 'move-right'] }, fields: {}, shadow: false, topLevel: false },
    'right-key': { opcode: 'sensing_keypressed', next: null, parent: 'if-right', inputs: { KEY_OPTION: [1, 'right-menu'] }, fields: {}, shadow: false, topLevel: false },
    'right-menu': { opcode: 'sensing_keyoptions', next: null, parent: 'right-key', inputs: {}, fields: { KEY_OPTION: ['right arrow', null] }, shadow: true, topLevel: false },
    'move-right': { opcode: 'motion_changexby', next: null, parent: 'if-right', inputs: { DX: [1, [4, '5']] }, fields: {}, shadow: false, topLevel: false },
    'if-left': { opcode: 'control_if', next: null, parent: 'if-right', inputs: { CONDITION: [2, 'left-key'], SUBSTACK: [2, 'move-left'] }, fields: {}, shadow: false, topLevel: false },
    'left-key': { opcode: 'sensing_keypressed', next: null, parent: 'if-left', inputs: { KEY_OPTION: [1, 'left-menu'] }, fields: {}, shadow: false, topLevel: false },
    'left-menu': { opcode: 'sensing_keyoptions', next: null, parent: 'left-key', inputs: {}, fields: { KEY_OPTION: ['left arrow', null] }, shadow: true, topLevel: false },
    'move-left': { opcode: 'motion_changexby', next: null, parent: 'if-left', inputs: { DX: [1, [4, '-5']] }, fields: {}, shadow: false, topLevel: false }
  }
}

const showcaseOnly = process.argv.includes('--showcase-only')

if (!showcaseOnly) {
  for (const [filename, blocks] of Object.entries(examples)) {
    const files = {
      'project.json': strToU8(JSON.stringify(project(blocks))),
      [backdrop.name]: backdrop.bytes,
      [walker.name]: walker.bytes,
      [target.name]: target.bytes
    }
    writeFileSync(resolve('examples', filename), zipSync(files, { level: 9 }))
  }
}

const allBlocksFiles = {
  'project.json': strToU8(JSON.stringify(allBlocksProject(allBlocksShowcase, targetAnimationBlocks))),
  [defaultBackdrop.name]: defaultBackdrop.bytes,
  [scratchCatA.name]: scratchCatA.bytes,
  [scratchCatB.name]: scratchCatB.bytes,
  [scratchApple.name]: scratchApple.bytes
}
writeFileSync(resolve('examples', 'available-blocks-showcase.sb3'), zipSync(allBlocksFiles, { level: 9 }))

if (!showcaseOnly) {
  mkdirSync(resolve('examples', 'parity'), { recursive: true })
  for (const [filename, blocks] of Object.entries(parityExamples)) {
    const initialPosition = ['long-turn-move-bounce.sb3', 'long-vector-costume-bounce.sb3'].includes(filename)
      ? { walkerX: 190, walkerY: 130 }
      : {}
    const walkerSource = filename === 'long-vector-costume-bounce.sb3' ? walker : parityWalker
    const files = {
      'project.json': strToU8(JSON.stringify(project(blocks, { walkerSource, ...initialPosition }))),
      [backdrop.name]: backdrop.bytes,
      [walkerSource.name]: walkerSource.bytes,
      [target.name]: target.bytes
    }
    writeFileSync(resolve('examples', 'parity', filename), zipSync(files, { level: 9 }))
  }
}

console.log(showcaseOnly
  ? 'Built the interactive all-blocks Scratch showcase.'
  : `Built ${Object.keys(examples).length + 1} Scratch examples and ` +
    `${Object.keys(parityExamples).length} deterministic parity fixtures.`)
