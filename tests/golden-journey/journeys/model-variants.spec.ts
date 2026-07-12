import { test, expect } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome } from '../browser/pages/home'
import {
  expectGoldenIntakeChoice,
  submitGoldenIntakeChoices,
  waitForGoldenScriptReviewOutcome,
} from '../browser/pages/workspace'
import { attachGoldenOracleEvidence } from '../oracle/evidence'

const scenario = process.env.GOLDEN_MODEL_SCENARIO ?? 'normal-mainline'

async function startVariant(page: Parameters<typeof registerGoldenUser>[0], identity: string) {
  await registerGoldenUser(page, {
    username: `golden-${identity}-${String(Date.now())}`,
    password: 'golden-variant-password',
  })
  return await launchGoldenStoryFromHome(page, '恐怖故事')
}

test('[GJ-MODEL-STOPS-AFTER-CONFIRM] preserves completed work and reports an AI-turn protocol failure without invoking nextAction', async ({ page }, testInfo) => {
  test.skip(scenario !== 'stop-after-successful-confirmation', 'run through test:golden:variant:model-stop')
  const scope = await startVariant(page, 'model-stop')
  await expectGoldenIntakeChoice(page)
  await submitGoldenIntakeChoices(page)
  const outcome = await waitForGoldenScriptReviewOutcome(page)
  const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-model-stop')

  expect(outcome).toBe('assistant_failure')
  expect(oracle.activities.filter((activity) => (
    activity.type === 'operation' && activity.status === 'completed'
  )).length).toBeGreaterThan(0)
  expect(oracle.runs.some((run) => (
    run.errorCode === 'PROJECT_AGENT_AI_TURN_PROTOCOL_REQUIRED'
  ))).toBe(true)
  expect(oracle.activities.some((activity) => (
    activity.operationId === 'generate_edit_style_previews'
  ))).toBe(false)
})

test('[GJ-MODEL-DUPLICATES-TOOL-CALL] duplicate calls create one durable effect', async ({ page }, testInfo) => {
  test.skip(scenario !== 'duplicate-tool-call', 'run through test:golden:variant:duplicate-tool')
  const scope = await startVariant(page, 'duplicate-tool')
  await expectGoldenIntakeChoice(page)
  const oracle = await attachGoldenOracleEvidence(testInfo, scope)
  const pendingIntakeChoices = oracle.interruptions.filter((item) => (
    item.type === 'choice' && item.status === 'pending' && item.operationId === 'request_script_intake_choice'
  ))
  expect(pendingIntakeChoices).toHaveLength(1)
  expect(oracle.identities.duplicateToolCallIds).toEqual([])
})

test('[GJ-MODEL-STREAM-DISCONNECT] partial stream creates no partial committed interaction', async ({ page }, testInfo) => {
  test.skip(scenario !== 'disconnect-mid-tool-call', 'run through test:golden:variant:stream-disconnect')
  const scope = await startVariant(page, 'stream-disconnect')
  await expect(page.getByText('AI 运行失败', { exact: true })).toBeVisible({ timeout: 60_000 })
  const oracle = await attachGoldenOracleEvidence(testInfo, scope)
  expect(oracle.interruptions).toHaveLength(0)
  expect(oracle.domain.sourceDocuments).toHaveLength(0)
})
