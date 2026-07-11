import { test } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome } from '../browser/pages/home'
import {
  expectGoldenIntakeChoice,
  approveGoldenScript,
  submitGoldenIntakeChoices,
  waitForGoldenProductionPlanOutcome,
  waitForGoldenScriptReviewOutcome,
} from '../browser/pages/workspace'
import {
  assertGoldenOracleIsReadOnly,
} from '../oracle/reader'
import { attachGoldenOracleEvidence } from '../oracle/evidence'

test('[GJ-MAIN-INTAKE-DURABILITY] real browser reaches a durable intake Choice', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerGoldenUser(page, {
    username: `golden-mainline-user-${String(testInfo.repeatEachIndex)}`,
    password: 'golden-mainline-password',
  })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  await testInfo.attach('golden-scope', {
    body: Buffer.from(JSON.stringify(scope, null, 2)),
    contentType: 'application/json',
  })
  await expectGoldenIntakeChoice(page)
  await assertGoldenOracleIsReadOnly()
  const oracle = await attachGoldenOracleEvidence(testInfo, scope)
  if (oracle.identities.duplicateMessageIds.length > 0 || oracle.identities.duplicateToolCallIds.length > 0) {
    throw new Error(`GOLDEN_DUPLICATE_PERSISTED_IDENTITY:${JSON.stringify(oracle.identities)}`)
  }
  if (!oracle.interruptions.some((value) => (
    value && typeof value === 'object'
    && (value as Record<string, unknown>).status === 'pending'
    && (value as Record<string, unknown>).type === 'choice'
  ))) {
    throw new Error('GOLDEN_DURABLE_INTAKE_CHOICE_MISSING')
  }
  browserObservations.assertClean()
})

test('[GJ-CHOICE-LEGAL-WATERMARK-ADVANCE] confirmed script reaches production-plan review', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerGoldenUser(page, {
    username: `golden-bible-review-user-${String(testInfo.repeatEachIndex)}`,
    password: 'golden-bible-review-password',
  })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  await expectGoldenIntakeChoice(page)
  await submitGoldenIntakeChoices(page)
  const scriptOutcome = await waitForGoldenScriptReviewOutcome(page)
  if (scriptOutcome !== 'script_review') {
    const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-before-script-confirmation')
    void oracle
    await testInfo.attach('golden-stage-outcome', {
      body: Buffer.from(JSON.stringify({ expected: 'bible_review', actual: scriptOutcome }, null, 2)),
      contentType: 'application/json',
    })
    throw new Error(`GOLDEN_STAGE_PREREQUISITE_MISMATCH:expected=script_review:actual=${scriptOutcome}`)
  }
  await approveGoldenScript(page)
  const outcome = await waitForGoldenProductionPlanOutcome(page)
  await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-after-script-confirmation')
  await testInfo.attach('golden-stage-outcome', {
    body: Buffer.from(JSON.stringify({ expected: 'bible_review', actual: outcome }, null, 2)),
    contentType: 'application/json',
  })
  browserObservations.assertClean()
  if (outcome !== 'bible_review') {
    throw new Error(`GOLDEN_STAGE_TERMINAL_MISMATCH:expected=bible_review:actual=${outcome}`)
  }
})

test('[GJ-MAIN-INTAKE-TO-SCRIPT-REVIEW] real Choice response reaches script review', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerGoldenUser(page, {
    username: `golden-script-review-user-${String(testInfo.repeatEachIndex)}`,
    password: 'golden-script-review-password',
  })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  await expectGoldenIntakeChoice(page)
  await submitGoldenIntakeChoices(page)
  const outcome = await waitForGoldenScriptReviewOutcome(page)
  const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-after-intake-choice')
  await testInfo.attach('golden-stage-outcome', {
    body: Buffer.from(JSON.stringify({ expected: 'script_review', actual: outcome }, null, 2)),
    contentType: 'application/json',
  })
  if (oracle.identities.duplicateMessageIds.length > 0 || oracle.identities.duplicateToolCallIds.length > 0) {
    throw new Error(`GOLDEN_DUPLICATE_PERSISTED_IDENTITY:${JSON.stringify(oracle.identities)}`)
  }
  browserObservations.assertClean()
  if (outcome !== 'script_review') {
    throw new Error(`GOLDEN_STAGE_TERMINAL_MISMATCH:expected=script_review:actual=${outcome}`)
  }
})
