import { describe, expect, it } from 'vitest'
import { inspectChangedFiles } from '../../../scripts/guards/changed-file-test-impact-guard.mjs'

describe('changed-file-test-impact-guard', () => {
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
})
