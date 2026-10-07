import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { promisify } from 'node:util'
import {
  pythonExecutableCandidates,
  resolvePythonExecutable
} from '../src/main/python-executable.ts'

const execFileAsync = promisify(execFile)
const runtimeManagerSource = readFileSync(new URL('../src/main/python-runtime.ts', import.meta.url), 'utf8')

test('configured Python takes priority and duplicate candidates are removed', () => {
  const candidates = pythonExecutableCandidates({
    PARROT_PYTHON: '/custom/python3',
    PATH: '/usr/bin:/custom'
  }, 'darwin')
  assert.equal(candidates[0], '/custom/python3')
  assert.equal(new Set(candidates).size, candidates.length)
})

test('Parrot resolves a Python interpreter that can import Pygame', async () => {
  const executable = await resolvePythonExecutable()
  const { stdout } = await execFileAsync(executable, [
    '-I',
    '-c',
    'import pygame, sys; print(sys.executable); print(pygame.version.ver)'
  ], {
    env: { ...process.env, PYGAME_HIDE_SUPPORT_PROMPT: '1' },
    timeout: 5_000
  })
  const [reportedExecutable, pygameVersion] = stdout.trim().split(/\r?\n/)
  assert.ok(reportedExecutable)
  assert.match(pygameVersion, /^\d+\.\d+/)
})

test('the Python runtime manager keeps separate concurrent sessions with an explicit bound', () => {
  assert.match(runtimeManagerSource, /sessions = new Map<string, RuntimeSession>\(\)/)
  assert.match(runtimeManagerSource, /this\.sessions\.size >= 8/)
  assert.match(runtimeManagerSource, /this\.sessions\.set\(session\.id, session\)/)
  assert.match(runtimeManagerSource, /Promise\.all\(\[\.\.\.this\.sessions\.values\(\)\]/)
  assert.doesNotMatch(runtimeManagerSource, /private active:/)
})
