import type { ScratchBlock, ScratchTarget } from './types.ts'

export interface EventRoot {
  id: string
  block: ScratchBlock
  index: number
}

export function greenFlagRoots(target: ScratchTarget): EventRoot[] {
  return Object.entries(target.blocks ?? {})
    .filter(([, block]) => block.topLevel && block.opcode === 'event_whenflagclicked')
    .map(([id, block], index) => ({ id, block, index }))
}

export function warnAboutUnsupportedEvents(target: ScratchTarget, warn: (message: string) => void): void {
  for (const block of Object.values(target.blocks ?? {})) {
    if (!block.shadow && block.topLevel && block.opcode !== 'event_whenflagclicked') {
      warn(`Top-level ${block.opcode} is not started because Base V0.3.1.motion supports green-flag scripts only.`)
    }
  }
}
