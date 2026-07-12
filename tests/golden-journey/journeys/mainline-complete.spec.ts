import { test, expect } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome } from '../browser/pages/home'
import {
  readGoldenMainlineBoundary,
  readGoldenWorkflowStage,
  reloadGoldenBoundary,
  submitGoldenBoundary,
  type GoldenMainlineBoundary,
} from '../browser/pages/workspace'
import { attachGoldenOracleEvidence } from '../oracle/evidence'
import { readGoldenOracleSnapshot } from '../oracle/reader'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { writeGoldenSourceFixtureManifest } from '../fixtures/source-manifest'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { GOLDEN_EDIT_FIRST_WORKFLOW_STAGES } from '../contracts/stages'

const USER_BOUNDARIES = new Set<GoldenMainlineBoundary>([
  'script_intake',
  'script_review',
  'bible_review',
  'style_choice',
  'asset_review',
  'approval',
])

test('[GJ-MAIN-STORY-TO-FINAL-DELIVERABLE][GJ-RELOAD-EACH-SUSPENSION] real browser and workers reach a durable final output', async ({
  page,
  context,
  browserObservations,
}, testInfo) => {
  test.setTimeout(30 * 60_000)
  const username = `golden-complete-${String(Date.now())}`
  const password = 'golden-complete-password'
  await registerGoldenUser(page, { username, password })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  const authStatePath = path.resolve(process.cwd(), 'artifacts/golden-journey/fixtures/source-auth.json')
  await mkdir(path.dirname(authStatePath), { recursive: true })
  await context.storageState({ path: authStatePath })
  await writeGoldenSourceFixtureManifest({
    username,
    password,
    scope,
    authStatePath,
    createdAt: new Date().toISOString(),
  })
  const visitedBoundaries: GoldenMainlineBoundary[] = []
  const visitedStages: EditFirstWorkflowStage[] = []
  const reloadedTaskStages = new Set<EditFirstWorkflowStage>()
  let reloadedCompletedStage = false
  let lastBoundary: GoldenMainlineBoundary = 'waiting'
  const deadline = Date.now() + 25 * 60_000

  while (Date.now() < deadline) {
    const workflowStage = await readGoldenWorkflowStage(page, scope)
    if (workflowStage === 'completed' && !reloadedCompletedStage) {
      reloadedCompletedStage = true
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(async () => await readGoldenMainlineBoundary(page), {
        timeout: 30_000,
        message: 'Final output must survive reload',
      }).toBe('final_output')
    }
    if (visitedStages.at(-1) !== workflowStage) {
      visitedStages.push(workflowStage)
      await testInfo.attach(`stage-${String(visitedStages.length)}-${workflowStage}`, {
        body: Buffer.from(JSON.stringify(await readGoldenOracleSnapshot(scope), null, 2)),
        contentType: 'application/json',
      })
      if (
        (workflowStage.endsWith('_generating') || workflowStage.endsWith('_rendering'))
        && !reloadedTaskStages.has(workflowStage)
      ) {
        reloadedTaskStages.add(workflowStage)
        const minimumIndex = GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(workflowStage)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect.poll(async () => {
          const restored = await readGoldenWorkflowStage(page, scope)
          return restored !== 'failed' && GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(restored) >= minimumIndex
        }, { timeout: 30_000, message: `Task stage ${workflowStage} must recover or advance after reload` }).toBe(true)
      }
    }
    const boundary = await readGoldenMainlineBoundary(page)
    if (boundary !== 'waiting' && boundary !== lastBoundary) {
      visitedBoundaries.push(boundary)
      lastBoundary = boundary
      await testInfo.attach(`boundary-${String(visitedBoundaries.length)}-${boundary}`, {
        body: Buffer.from(JSON.stringify(await readGoldenOracleSnapshot(scope), null, 2)),
        contentType: 'application/json',
      })
    }
    if (boundary === 'final_output') {
      const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-final')
      if (oracle.domain.finalOutputs.length === 0) throw new Error('GOLDEN_FINAL_OUTPUT_NOT_DURABLE')
      if (oracle.identities.duplicateMessageIds.length > 0 || oracle.identities.duplicateToolCallIds.length > 0) {
        throw new Error(`GOLDEN_DUPLICATE_PERSISTED_IDENTITY:${JSON.stringify(oracle.identities)}`)
      }
      browserObservations.assertClean()
      return
    }
    if (boundary === 'assistant_failure' || boundary === 'interaction_failure' || boundary === 'render_failure') {
      await attachGoldenOracleEvidence(testInfo, scope, `golden-oracle-${boundary}`)
      throw new Error(`GOLDEN_MAINLINE_BLOCKED:${boundary}:boundaries=${visitedBoundaries.join(',')}:stages=${visitedStages.join(',')}`)
    }
    if (USER_BOUNDARIES.has(boundary)) {
      await reloadGoldenBoundary(page, boundary)
      await submitGoldenBoundary(page, boundary)
      await page.waitForTimeout(500)
      continue
    }
    await page.waitForTimeout(500)
  }

  await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-timeout')
  throw new Error(`GOLDEN_MAINLINE_TIMEOUT:boundaries=${visitedBoundaries.join(',')}:stages=${visitedStages.join(',')}`)
})
