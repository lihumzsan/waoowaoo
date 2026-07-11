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

test('[GJ-PROVIDER-NONRETRYABLE-FAILURE] terminal provider failure creates no fabricated final output', async ({ page }, testInfo) => {
  test.skip(process.env.GOLDEN_MEDIA_SCENARIO !== 'terminal-failure', 'run through test:golden:variant:provider-failure')
  test.setTimeout(25 * 60_000)
  await registerGoldenUser(page, {
    username: `golden-provider-failure-${String(Date.now())}`,
    password: 'golden-provider-failure-password',
  })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  const deadline = Date.now() + 20 * 60_000
  while (Date.now() < deadline) {
    const boundary = await readGoldenMainlineBoundary(page)
    if (boundary === 'assistant_failure' || boundary === 'interaction_failure') {
      const oracle = await attachGoldenOracleEvidence(testInfo, scope)
      expect(oracle.domain.finalOutputs).toHaveLength(0)
      expect(oracle.tasks.some((task) => task.status === 'failed')).toBe(true)
      return
    }
    if (boundary === 'render_failure') throw new Error('GOLDEN_PROVIDER_FAILURE_MASKED_BY_RENDER_FAILURE')
    if (USER_BOUNDARIES.has(boundary)) await submitGoldenBoundary(page, boundary)
    await page.waitForTimeout(500)
  }
  await attachGoldenOracleEvidence(testInfo, scope)
  throw new Error('GOLDEN_PROVIDER_FAILURE_NOT_OBSERVED')
})
