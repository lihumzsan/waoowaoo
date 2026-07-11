import { test, expect } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome } from '../browser/pages/home'
import {
  expectGoldenIntakeChoice,
  submitGoldenIntakeChoices,
  waitForGoldenProductionPlanOutcome,
  waitForGoldenScriptReviewOutcome,
} from '../browser/pages/workspace'
import { attachGoldenOracleEvidence } from '../oracle/evidence'

test('[GJ-CHOICE-DOUBLE-SUBMIT] concurrent confirmation resumes a Choice once', async ({ page }, testInfo) => {
  await registerGoldenUser(page, {
    username: `golden-double-submit-${String(Date.now())}`,
    password: 'golden-double-submit-password',
  })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  await expectGoldenIntakeChoice(page)
  await submitGoldenIntakeChoices(page)
  expect(await waitForGoldenScriptReviewOutcome(page)).toBe('script_review')
  const button = page.getByRole('button', { name: '确认剧本，生成制作规划' })
  await button.dblclick({ delay: 5 })
  const outcome = await waitForGoldenProductionPlanOutcome(page)
  const oracle = await attachGoldenOracleEvidence(testInfo, scope)
  const consumedScriptChoices = oracle.interruptions.filter((item) => (
    item.type === 'choice' && item.operationId === 'request_edit_script_review_choice' && item.status !== 'pending'
  ))
  expect(consumedScriptChoices).toHaveLength(1)
  expect(outcome).toBe('bible_review')
})
