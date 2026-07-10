import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

type CandidateReport = {
  readonly summary: {
    readonly scannedCommitCount: number
    readonly candidateCommitCount: number
    readonly candidatesWithAnyTestChange: number
    readonly candidatesByTestLayer: Readonly<Record<string, number>>
  }
  readonly candidates: ReadonlyArray<{
    readonly subject: string
    readonly matchedSignals: readonly string[]
    readonly testLayers: readonly string[]
  }>
  readonly productionHotspots: ReadonlyArray<{
    readonly file: string
    readonly count: number
    readonly timeline: ReadonlyArray<{ readonly subject: string }>
  }>
}

const temporaryRepositories: string[] = []

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

function commit(repo: string, subject: string): void {
  git(repo, ['add', '.'])
  git(repo, ['commit', '-m', subject])
}

describe('test history candidate report', () => {
  afterEach(() => {
    for (const repo of temporaryRepositories.splice(0)) {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('separates corrective candidates, test layers, and repeated production hotspots', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'waoowaoo-test-history-'))
    temporaryRepositories.push(repo)
    git(repo, ['init'])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test User'])

    mkdirSync(path.join(repo, 'src'), { recursive: true })
    writeFileSync(path.join(repo, 'src/example.ts'), 'export const value = 1\n')
    commit(repo, 'feat: add example')

    mkdirSync(path.join(repo, 'tests/unit'), { recursive: true })
    writeFileSync(path.join(repo, 'src/example.ts'), 'export const value = 2\n')
    writeFileSync(path.join(repo, 'tests/unit/example.test.ts'), 'unit test\n')
    commit(repo, 'fix: correct example value')

    mkdirSync(path.join(repo, 'tests/integration/task'), { recursive: true })
    writeFileSync(path.join(repo, 'src/example.ts'), 'export const value = 3\n')
    writeFileSync(path.join(repo, 'tests/integration/task/example.test.ts'), 'integration test\n')
    commit(repo, 'Stabilize example lifecycle')

    const script = path.resolve(process.cwd(), 'scripts/test-history/candidate-report.mjs')
    const output = execFileSync(process.execPath, [script, '--repo', repo, '--days', '90'], {
      encoding: 'utf8',
    })
    const report = JSON.parse(output) as CandidateReport

    expect(report.summary).toEqual(expect.objectContaining({
      scannedCommitCount: 3,
      candidateCommitCount: 2,
      candidatesWithAnyTestChange: 2,
    }))
    expect(report.summary.candidatesByTestLayer).toEqual(expect.objectContaining({
      unit: 1,
      'integration-task': 1,
    }))
    expect(report.candidates.map((candidate) => candidate.subject)).toEqual([
      'Stabilize example lifecycle',
      'fix: correct example value',
    ])
    expect(report.productionHotspots[0]).toEqual(expect.objectContaining({
      file: 'src/example.ts',
      count: 2,
      timeline: [
        expect.objectContaining({ subject: 'Stabilize example lifecycle' }),
        expect.objectContaining({ subject: 'fix: correct example value' }),
      ],
    }))
  })
})
