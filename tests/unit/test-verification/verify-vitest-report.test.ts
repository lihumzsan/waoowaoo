import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const temporaryDirectories: string[] = []

function runVerifier(repo: string, report: string): string {
  const script = path.resolve(process.cwd(), 'scripts/test-verification/verify-vitest-report.mjs')
  const result = spawnSync(process.execPath, [
    script,
    '--repo', repo,
    '--report', report,
    '--suite', 'fixture',
    '--root', 'tests/unit',
  ], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`${result.stderr}${result.stdout}`)
  }
  return result.stdout
}

function writeReport(reportPath: string, repo: string, input: {
  readonly success?: boolean
  readonly includeSecondFile?: boolean
  readonly secondStatus?: 'passed' | 'pending'
} = {}): void {
  const results = [
    {
      name: path.join(repo, 'tests/unit/first.test.ts'),
      status: 'passed',
      assertionResults: [{ status: 'passed', fullName: 'first passes' }],
    },
  ]
  if (input.includeSecondFile !== false) {
    results.push({
      name: path.join(repo, 'tests/unit/second.test.ts'),
      status: input.secondStatus ?? 'passed',
      assertionResults: [{ status: input.secondStatus ?? 'passed', fullName: 'second result' }],
    })
  }
  writeFileSync(reportPath, JSON.stringify({
    success: input.success ?? true,
    numTotalTests: 2,
    numPendingTests: input.secondStatus === 'pending' ? 1 : 0,
    numTodoTests: 0,
    testResults: results,
  }))
}

describe('Vitest report verification', () => {
  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('proves that every discovered test file executed with no skipped cases', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'waoowaoo-suite-report-'))
    temporaryDirectories.push(repo)
    mkdirSync(path.join(repo, 'tests/unit'), { recursive: true })
    writeFileSync(path.join(repo, 'tests/unit/first.test.ts'), '')
    writeFileSync(path.join(repo, 'tests/unit/second.test.ts'), '')
    const report = path.join(repo, 'report.json')
    writeReport(report, repo)

    expect(runVerifier(repo, report)).toContain('"expectedFileCount":2')
  })

  it('fails when a required test file is absent from the runner report', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'waoowaoo-suite-report-'))
    temporaryDirectories.push(repo)
    mkdirSync(path.join(repo, 'tests/unit'), { recursive: true })
    writeFileSync(path.join(repo, 'tests/unit/first.test.ts'), '')
    writeFileSync(path.join(repo, 'tests/unit/second.test.ts'), '')
    const report = path.join(repo, 'report.json')
    writeReport(report, repo, { includeSecondFile: false })

    expect(() => runVerifier(repo, report)).toThrow('did not collect every required test file')
  })

  it('fails when the runner marks a required case as pending', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'waoowaoo-suite-report-'))
    temporaryDirectories.push(repo)
    mkdirSync(path.join(repo, 'tests/unit'), { recursive: true })
    writeFileSync(path.join(repo, 'tests/unit/first.test.ts'), '')
    writeFileSync(path.join(repo, 'tests/unit/second.test.ts'), '')
    const report = path.join(repo, 'report.json')
    writeReport(report, repo, { secondStatus: 'pending' })

    expect(() => runVerifier(repo, report)).toThrow('contains skipped or todo cases')
  })
})
