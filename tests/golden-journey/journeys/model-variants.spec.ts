import { test, expect } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome } from '../browser/pages/home'
import {
  approveGoldenScript,
  expectGoldenIntakeChoice,
  readGoldenAssistantRunStatus,
  readGoldenWorkflowStage,
  submitGoldenBoundary,
  submitGoldenIntakeChoices,
  waitForGoldenProductionPlanOutcome,
  waitForGoldenScriptReviewOutcome,
} from '../browser/pages/workspace'
import { attachGoldenOracleEvidence } from '../oracle/evidence'
import { GOLDEN_MODEL_VARIANT_SCENARIOS } from '../contracts/scenarios'

const scenario = process.env.GOLDEN_MODEL_SCENARIO ?? 'normal-mainline'
const modelStopScenario = GOLDEN_MODEL_VARIANT_SCENARIOS.find((candidate) => (
  candidate.id === 'GJ-MODEL-STOPS-AFTER-CONFIRM'
))
if (!modelStopScenario || modelStopScenario.expectedTerminal.kind !== 'workflow_stage') {
  throw new Error('GOLDEN_MODEL_STOP_SCENARIO_CONTRACT_MISSING')
}

async function startVariant(page: Parameters<typeof registerGoldenUser>[0], identity: string) {
  await registerGoldenUser(page, {
    username: `golden-${identity}-${String(Date.now())}`,
    password: 'golden-variant-password',
  })
  return await launchGoldenStoryFromHome(page, '恐怖故事')
}

test('[GJ-MODEL-STOPS-AFTER-CONFIRM] keeps an atomic production-plan confirmation when the subsequent model turn stops', async ({ page, browserObservations }, testInfo) => {
  test.skip(scenario !== 'stop-after-successful-confirmation', 'run through test:golden:variant:model-stop')
  const scope = await startVariant(page, 'model-stop')
  await expectGoldenIntakeChoice(page)
  await submitGoldenIntakeChoices(page)
  expect(await waitForGoldenScriptReviewOutcome(page)).toBe('script_review')
  await approveGoldenScript(page)
  expect(await waitForGoldenProductionPlanOutcome(page)).toBe('bible_review')
  await submitGoldenBoundary(page, 'bible_review')
  await expect.poll(async () => await readGoldenWorkflowStage(page, scope), { timeout: 30_000 }).toBe(
    modelStopScenario.expectedTerminal.stage,
  )
  await expect.poll(async () => await readGoldenAssistantRunStatus(page, scope), { timeout: 30_000 }).toBe('completed')
  await expect(page.getByText('AI 运行失败', { exact: true })).toHaveCount(0)
  await expect(page.getByText('成功 · 确认制作规划', { exact: true })).toHaveCount(1)
  const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-model-stop')

  expect(oracle.domain.bibles.some((bible) => bible.status === 'confirmed')).toBe(true)
  expect(oracle.domain.stylePreviews).toHaveLength(0)
  expect(oracle.tasks.filter((task) => task.type === 'edit_style_preview_image')).toHaveLength(0)
  expect(oracle.approvalGrants.filter((grant) => grant.operationId === 'generate_edit_style_previews')).toHaveLength(0)
  expect(oracle.operationExecutions.filter((execution) => execution.operationId === 'generate_edit_style_previews')).toHaveLength(0)
  expect(oracle.runs.some((run) => run.status === 'failed')).toBe(false)
  expect(oracle.activities.filter((activity) => (
    activity.operationId === 'confirm_bible' && activity.status === 'completed'
  ))).toHaveLength(1)
  expect(oracle.activities.some((activity) => (
    activity.operationId === 'generate_edit_style_previews'
  ))).toBe(false)
  expect(oracle.interruptions.filter((item) => (
    item.type === 'choice'
    && item.status === 'consumed'
    && item.operationId === 'request_edit_bible_review_choice'
  ))).toHaveLength(1)
  browserObservations.assertClean()
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
