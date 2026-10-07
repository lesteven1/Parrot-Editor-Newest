import { randomUUID } from 'node:crypto'
import type { RuntimeBundle } from './converter/types'

const MAX_RUNTIME_PROJECTS = 16

export class RuntimeProjectStore {
  private readonly projects = new Map<string, RuntimeBundle>()

  register(bundle: RuntimeBundle): string {
    const id = randomUUID()
    this.projects.set(id, bundle)
    while (this.projects.size > MAX_RUNTIME_PROJECTS) {
      const oldest = this.projects.keys().next().value
      if (typeof oldest === 'string') this.projects.delete(oldest)
    }
    return id
  }

  resolve(id: string): RuntimeBundle {
    const bundle = this.projects.get(id)
    if (!bundle) throw new Error('The Python project data expired. Press Update code before running again.')
    return bundle
  }

  clear(): void {
    this.projects.clear()
  }
}
