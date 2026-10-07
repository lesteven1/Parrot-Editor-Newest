import { toolboxForTarget, type ScratchToolboxVariable } from './toolbox.ts'

// Scratch keeps a 598px block editor beside either a 240px or 480px stage.
// Parrot fits against the complete active layout so neither stage-size choice
// can be clipped by the edge of its editor tab.
export const SCRATCH_GUI_LAYOUT_PROFILES = Object.freeze({
  small: Object.freeze({ width: 856, height: 650 }),
  large: Object.freeze({ width: 1096, height: 650 })
})
export type ScratchGuiStageSizeMode = keyof typeof SCRATCH_GUI_LAYOUT_PROFILES
export const SCRATCH_GUI_DESIGN_SIZE = SCRATCH_GUI_LAYOUT_PROFILES.large
export const SCRATCH_EDITOR_TABS = Object.freeze(['code', 'costumes', 'sounds'] as const)

export interface ScratchVmTargetContract {
  isStage: boolean
  variables?: Record<string, { name?: unknown }>
}

export interface ScratchVmEditorContract {
  editingTarget?: ScratchVmTargetContract | null
  setEditingTarget: (targetId: string) => void
  postSpriteInfo: (properties: Record<string, unknown>) => void
}

export function fitScratchGui(
  width: number,
  height: number,
  stageSizeMode: ScratchGuiStageSizeMode = 'large'
): number {
  if (width <= 0 || height <= 0) return 1
  const profile = SCRATCH_GUI_LAYOUT_PROFILES[stageSizeMode]
  return Math.min(
    1,
    width / profile.width,
    height / profile.height
  )
}

export interface ScratchGuiLayout {
  scale: number
  width: number
  height: number
}

export function layoutScratchGui(
  width: number,
  height: number,
  stageSizeMode: ScratchGuiStageSizeMode = 'large'
): ScratchGuiLayout {
  const profile = SCRATCH_GUI_LAYOUT_PROFILES[stageSizeMode]
  const scale = fitScratchGui(width, height, stageSizeMode)
  if (width <= 0 || height <= 0) {
    return { scale, ...profile }
  }
  return {
    scale,
    width: Math.max(profile.width, width / scale),
    height: Math.max(profile.height, height / scale)
  }
}

export function scratchStageFit(width: number, height: number): { width: number; height: number } {
  const stageWidth = Math.max(0, Math.min(width, height * (4 / 3)))
  return { width: stageWidth, height: stageWidth * (3 / 4) }
}

export function shouldOpenEditorViewAfterFileOpen(openTabCount: number): boolean {
  return openTabCount === 0
}

export function selectScratchTarget(vm: ScratchVmEditorContract, targetId: string): void {
  vm.setEditingTarget(targetId)
}

export function editScratchSprite(
  vm: ScratchVmEditorContract,
  properties: Record<string, unknown>
): void {
  vm.postSpriteInfo(properties)
}

function variablesForEditingTarget(vm: Pick<ScratchVmEditorContract, 'editingTarget'>): ScratchToolboxVariable[] {
  return Object.entries(vm.editingTarget?.variables ?? {}).flatMap(([id, variable]) => (
    typeof variable.name === 'string' ? [{ id, name: variable.name }] : []
  ))
}

export function restrictedToolboxForVm(
  vm: Pick<ScratchVmEditorContract, 'editingTarget'>
): string {
  return toolboxForTarget(
    Boolean(vm.editingTarget?.isStage),
    variablesForEditingTarget(vm)
  )
}

export function shareScratchGuiVmState<T extends Record<string, unknown>>(
  initialGui: T,
  vm: unknown
): T {
  return {
    ...initialGui,
    vm,
    vmStatus: {
      ...(initialGui.vmStatus as Record<string, unknown>),
      started: true
    },
    projectState: {
      ...(initialGui.projectState as Record<string, unknown>),
      loadingState: 'SHOWING_WITHOUT_ID',
      projectId: '0',
      projectData: null
    },
    toolbox: { toolboxXML: restrictedToolboxForVm(vm as ScratchVmEditorContract) }
  }
}
