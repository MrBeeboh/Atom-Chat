import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const launcher = readFileSync(new URL('./start-atom.sh', import.meta.url), 'utf8')
const lib = readFileSync(new URL('./atom-launcher-lib.sh', import.meta.url), 'utf8')
const desktop = readFileSync(new URL('../ATOM.desktop', import.meta.url), 'utf8')
const setup = readFileSync(new URL('../setup.sh', import.meta.url), 'utf8')

describe('ATOM launcher contract (do not regress Mint startup)', () => {
  it('does not enable set -e (missing optional binaries must not abort)', () => {
    expect(launcher).not.toMatch(/^set -e\b/m)
  })

  it('never invokes llama-server --help (red flash when the binary is absent)', () => {
    expect(launcher).not.toMatch(/--help/)
    expect(lib).toMatch(/command -v llama-server/)
  })

  it('resolves llama only when the binary exists', () => {
    expect(lib).toContain('atom_resolve_llama_bin')
    expect(launcher).toContain('atom_resolve_llama_bin')
    expect(launcher).toMatch(/No llama-server on PATH/)
  })

  it('keeps the terminal open and logs to atom-start.log', () => {
    expect(launcher).toMatch(/\bhold\s*\(/)
    expect(launcher).toContain('atom-start.log')
    expect(launcher).toContain('Press Enter to close this window')
  })

  it('reuses an already-running UI instead of starting a second Vite', () => {
    expect(launcher).toContain('atom_find_running_ui')
    expect(lib).toContain('atom_find_running_ui')
    expect(launcher).toMatch(/UI already running/)
  })

  it('runs Vite in the foreground so the desktop terminal stays alive', () => {
    expect(launcher).toMatch(/npm run dev -- --port/)
    const afterDev = launcher.split('npm run dev -- --port')[1] ?? ''
    expect(afterDev.split('\n')[0]).not.toMatch(/&\s*$/)
  })

  it('desktop template uses a substitutable root, not a hardcoded atom-v2 path', () => {
    expect(desktop).toContain('__ATOM_ROOT__')
    expect(desktop).not.toMatch(/Exec=bash -c "cd \/home\/mike\/atom-v2/)
    expect(setup).toContain('__ATOM_ROOT__')
  })
})
