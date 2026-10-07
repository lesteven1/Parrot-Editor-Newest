import { execFile } from 'node:child_process'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
let resolvedPython: Promise<string> | null = null

export function pythonExecutableCandidates(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string[] {
  const executableName = platform === 'win32' ? 'python.exe' : 'python3'
  const separator = platform === 'win32' ? ';' : ':'
  const fromPath = (environment.PATH ?? '')
    .split(separator)
    .filter((directory) => isAbsolute(directory))
    .map((directory) => join(directory, executableName))
  const known = platform === 'darwin'
    ? [
        '/Library/Frameworks/Python.framework/Versions/Current/bin/python3',
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
        '/usr/bin/python3'
      ]
    : platform === 'linux'
      ? ['/usr/local/bin/python3', '/usr/bin/python3']
      : []
  const configured = environment.PARROT_PYTHON
  return [...new Set([
    ...(configured && isAbsolute(configured) ? [configured] : []),
    ...fromPath,
    ...known
  ])]
}

async function findPythonExecutable(): Promise<string> {
  for (const candidate of pythonExecutableCandidates()) {
    try {
      await execFileAsync(candidate, ['-I', '-c', 'import pygame, sys; print(sys.executable)'], {
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          PYGAME_HIDE_SUPPORT_PROMPT: '1'
        },
        maxBuffer: 64 * 1024,
        timeout: 5_000,
        windowsHide: true
      })
      return candidate
    } catch {
      // Try the next fixed candidate.
    }
  }
  throw new Error(
    'Parrot could not find Python 3 with Pygame-CE. Install it with: python3 -m pip install pygame-ce'
  )
}

export async function resolvePythonExecutable(): Promise<string> {
  resolvedPython ??= findPythonExecutable()
  try {
    return await resolvedPython
  } catch (reason) {
    resolvedPython = null
    throw reason
  }
}
