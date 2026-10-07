import type { ScratchBlock, ScratchInput, ScratchTarget } from './types.ts'

export interface CompilerServices {
  input: (input: ScratchInput | undefined, target: ScratchTarget) => string
  stack: (startId: string | null, target: ScratchTarget, indent: number, ancestors: Set<string>) => string[]
  variable: (id: string) => string | undefined
  warn: (message: string) => void
}

export interface StatementConversion {
  block: ScratchBlock
  target: ScratchTarget
  indent: number
  ancestors: Set<string>
  actor: string
  services: CompilerServices
}

export interface ReporterConversion {
  block: ScratchBlock
  target: ScratchTarget
  actor: string
  services: CompilerServices
}

export type StatementConverter = (conversion: StatementConversion) => string[]
export type ReporterConverter = (conversion: ReporterConversion) => string
