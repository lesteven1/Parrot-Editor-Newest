import type { ScratchBlock, ScratchInput } from './types.ts'

export function fieldValue(block: ScratchBlock, name: string): unknown {
  return block.fields[name]?.[0] ?? ''
}

export function fieldId(block: ScratchBlock, name: string): unknown {
  return block.fields[name]?.[1] ?? block.fields[name]?.[0] ?? ''
}

export function literalFromInput(input: ScratchInput | undefined): unknown {
  if (!input) return 0
  const candidate = input[1]
  if (!Array.isArray(candidate)) return undefined
  const type = Number(candidate[0])
  if (type >= 4 && type <= 8) {
    const number = Number(candidate[1])
    return Number.isFinite(number) ? number : 0
  }
  if (type === 10 || type === 11) return String(candidate[1] ?? '')
  if (type === 12 || type === 13) {
    return { variableId: String(candidate[2] ?? ''), name: String(candidate[1] ?? '') }
  }
  return candidate[1] ?? 0
}

export function blockIdFromInput(input: ScratchInput | undefined): string | null {
  if (!input) return null
  if (typeof input[1] === 'string') return input[1]
  if (input[0] === 3 && typeof input[2] === 'string') return input[2]
  return null
}
