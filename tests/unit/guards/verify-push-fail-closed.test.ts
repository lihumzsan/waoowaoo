import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

function runVerifyPush(failingScript: string | null): {
  readonly status: number | null
  readonly stdout: string
  readonly calls: readonly string[]
} {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'waoowaoo-verify-push-'))
  temporaryDirectories.push(fixtureRoot)
  const binDirectory = path.join(fixtureRoot, 'bin')
  const callLog = path.join(fixtureRoot, 'npm-calls.log')
  mkdirSync(binDirectory, { recursive: true })
  const npmPath = path.join(binDirectory, 'npm')
  writeFileSync(npmPath, `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "$NPM_CALL_LOG"
if [[ -n "\${FAILING_NPM_SCRIPT:-}" && "$*" == "run $FAILING_NPM_SCRIPT" ]]; then
  exit 9
fi
exit 0
`)
  chmodSync(npmPath, 0o755)

  const result = spawnSync('bash', ['scripts/verify-push.sh'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      NPM_CALL_LOG: callLog,
      FAILING_NPM_SCRIPT: failingScript ?? '',
    },
  })
  const calls = readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean)
  return {
    status: result.status,
    stdout: result.stdout,
    calls,
  }
}

describe('verify:push required service gate', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('fails immediately instead of skipping integration, system, and regression suites', () => {
    const result = runVerifyPush('test:services:prepare')

    expect(result.status).toBe(1)
    expect(result.stdout).toContain('required test services are unavailable')
    expect(result.calls).toEqual([
      'run test:services:prepare',
      'run test:services:stop',
    ])
  })

  it('runs every required high-value suite when services are ready', () => {
    const result = runVerifyPush(null)

    expect(result.status).toBe(0)
    expect(result.calls).toEqual(expect.arrayContaining([
      'run test:integration:api',
      'run test:integration:chain',
      'run test:integration:task',
      'run test:system',
      'run test:regression:cases',
    ]))
    expect(result.stdout).not.toContain('[skip]')
    expect(result.stdout).toContain('verify:push passed')
  })
})
