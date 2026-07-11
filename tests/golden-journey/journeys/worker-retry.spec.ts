import { test, expect } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome } from '../browser/pages/home'
import {
  readGoldenMainlineBoundary,
  submitGoldenBoundary,
  type GoldenMainlineBoundary,
} from '../browser/pages/workspace'
import { attachGoldenOracleEvidence } from '../oracle/evidence'

const USER_BOUNDARIES = new Set<GoldenMainlineBoundary>([
  'script_intake',
  'script_review',
  'bible_review',
  'style_choice',
  'asset_review',
  'approval',
])

test('[GJ-WORKER-RETRY] retryable provider failure does not become premature business failure', async ({ page }, testInfo) => {
  test.skip(process.env.GOLDEN_MEDIA_SCENARIO !== 'retry-once', 'run through test:golden:variant:worker-retry')
  test.setTimeout(30 * 60_000)
  await registerGoldenUser(page, {
    username: `golden-worker-retry-${String(Date.now())}`,
    password: 'golden-worker-retry-password',
  })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  const deadline = Date.now() + 25 * 60_000
  while (Date.now() < deadline) {
    const boundary = await readGoldenMainlineBoundary(page)
    if (boundary === 'final_output') {
      const oracle = await attachGoldenOracleEvidence(testInfo, scope)
      expect(oracle.tasks.some((task) => Number(task.attempt) >= 2)).toBe(true)
      expect(oracle.tasks.some((task) => task.status === 'failed')).toBe(false)
      expect(oracle.domain.finalOutputs.length).toBeGreaterThan(0)
      return
    }
    if (boundary === 'assistant_failure' || boundary === 'interaction_failure' || boundary === 'render_failure') {
      await attachGoldenOracleEvidence(testInfo, scope)
      throw new Error(`GOLDEN_WORKER_RETRY_PREMATURE_FAILURE:${boundary}`)
    }
    if (USER_BOUNDARIES.has(boundary)) await submitGoldenBoundary(page, boundary)
    await page.waitForTimeout(500)
  }
  await attachGoldenOracleEvidence(testInfo, scope)
  throw new Error('GOLDEN_WORKER_RETRY_TIMEOUT')
})
