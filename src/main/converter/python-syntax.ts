const PYTHON_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield'
])

export function pythonString(value: unknown): string {
  return JSON.stringify(String(value ?? ''))
}

export function pythonLiteral(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return pythonString(value)
}

export function safeIdentifier(value: string, fallback = 'item'): string {
  let normalized = value.normalize('NFKD').replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^\d/, '_$&')
  normalized = normalized.replace(/^_+|_+$/g, '').toLowerCase() || fallback
  return PYTHON_KEYWORDS.has(normalized) ? `${normalized}_value` : normalized
}

export function uniqueIdentifier(preferred: string, used: Set<string>): string {
  let candidate = preferred
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${preferred}_${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}
