import type { ScratchBlock, ScratchTarget } from './types.ts'

interface StackTraversal {
  startId: string | null
  target: ScratchTarget
  ancestors: Set<string>
  visit: (block: ScratchBlock, ancestors: Set<string>) => string[]
  warn: (message: string) => void
}

export function traverseStack({ startId, target, ancestors, visit, warn }: StackTraversal): string[] {
  const lines: string[] = []
  const visited = new Set(ancestors)
  let blockId = startId
  while (blockId) {
    if (visited.has(blockId)) {
      warn(`A block cycle in ${target.name} was stopped during conversion.`)
      break
    }
    visited.add(blockId)
    const block = target.blocks[blockId]
    if (!block) {
      warn(`A referenced block in ${target.name} is missing.`)
      break
    }
    lines.push(...visit(block, visited))
    blockId = block.next
  }
  return lines
}
