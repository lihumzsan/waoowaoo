import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectChangedFiles,
  resolveChangedFiles,
} from '../../../scripts/guards/changed-file-test-impact-guard.mjs'

const temporaryRepositories: string[] = []

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
}

describe('changed-file-test-impact-guard', () => {
  afterEach(() => {
    for (const repo of temporaryRepositories.splice(0)) {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('requires api changes to be paired with contract, system, or regression tests', () => {
    const violations = inspectChangedFiles([
      'src/app/api/assets/[assetId]/generate/route.ts',
    ])
    expect(violations).toEqual([
      'api: changing src/app/api/** requires a matching contract, system, or regression test change; sources=src/app/api/assets/[assetId]/generate/route.ts',
    ])
  })

  it('accepts worker changes when system tests are updated together', () => {
    const violations = inspectChangedFiles([
      'src/lib/workers/image.worker.ts',
      'tests/system/generate-image.system.test.ts',
    ])
    expect(violations).toEqual([])
  })

  it('accepts provider changes when provider contract coverage is updated', () => {
    const violations = inspectChangedFiles([
      'src/lib/ai-providers/fal/image.ts',
      'tests/integration/provider/fal-video-provider.contract.test.ts',
    ])
    expect(violations).toEqual([])
  })

  it('accepts task changes when task integration coverage is updated', () => {
    const violations = inspectChangedFiles([
      'src/lib/task/reconcile.ts',
      'tests/integration/task/create-task-dedupe.integration.test.ts',
    ])
    expect(violations).toEqual([])
  })

  it('reads the complete base-to-head range used by CI', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'waoowaoo-impact-range-'))
    temporaryRepositories.push(repo)
    git(repo, ['init', '-q'])
    git(repo, ['config', 'user.email', 'test@example.com'])
    git(repo, ['config', 'user.name', 'Test User'])
    mkdirSync(path.join(repo, 'src/lib/task'), { recursive: true })
    writeFileSync(path.join(repo, 'src/lib/task/service.ts'), 'export const version = 1\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'initial'])
    const base = git(repo, ['rev-parse', 'HEAD'])

    mkdirSync(path.join(repo, 'tests/integration/task'), { recursive: true })
    writeFileSync(path.join(repo, 'src/lib/task/service.ts'), 'export const version = 2\n')
    writeFileSync(path.join(repo, 'tests/integration/task/service.integration.test.ts'), 'test\n')
    git(repo, ['add', '.'])
    git(repo, ['commit', '-m', 'change task'])
    const head = git(repo, ['rev-parse', 'HEAD'])

    expect(resolveChangedFiles({
      argv: ['--base', base, '--head', head],
      cwd: repo,
      env: {},
    })).toEqual({
      files: [
        'src/lib/task/service.ts',
        'tests/integration/task/service.integration.test.ts',
      ],
      source: `Git range ${base}...${head}`,
    })
  })

  it('fails in CI when the base/head contract is missing', () => {
    expect(() => resolveChangedFiles({
      argv: [],
      env: { CI: 'true' },
    })).toThrow('CI requires TEST_IMPACT_BASE_SHA and TEST_IMPACT_HEAD_SHA')
  })
})
