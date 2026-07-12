import { test, expect } from '../browser/test'
import {
  getGoldenApprovalButton,
  readGoldenMainlineBoundary,
  readGoldenWorkflowStage,
  submitGoldenBoundary,
  type GoldenMainlineBoundary,
} from '../browser/pages/workspace'
import { GOLDEN_STAGE_PROBE_SCENARIOS } from '../contracts/scenarios'
import { GOLDEN_EDIT_FIRST_WORKFLOW_STAGES } from '../contracts/stages'
import { forkGoldenWorkflowCheckpoint } from '../fixtures/workflow-lab'
import { readGoldenSourceFixtureManifest } from '../fixtures/source-manifest'
import { attachGoldenOracleEvidence } from '../oracle/evidence'
import { readGoldenOracleSnapshot } from '../oracle/reader'
import { readFile } from 'node:fs/promises'
import { setGoldenForcedTool, setGoldenMediaStatusDelay, setGoldenStreamPacing } from '../providers/control'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import { TASK_TYPE } from '@/lib/task/types'

interface GoldenStorageState {
  readonly cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0]
}

const BOUNDARY_BY_STAGE: Readonly<Record<string, GoldenMainlineBoundary>> = {
  not_started: 'script_intake',
  script_ready_for_review: 'script_review',
  bible_ready_for_review: 'bible_review',
  needs_style_choice: 'style_choice',
  assets_ready_for_review: 'asset_review',
}

const OPERATION_BY_STAGE: Readonly<Record<string, string>> = {
  ready_to_ingest_script: 'ingest_script',
  ready_to_generate_bible: 'generate_bible_from_script',
  ready_to_generate_edit_script: 'generate_edit_script',
  ready_to_generate_assets: 'generate_edit_script_assets',
  ready_to_generate_shot_execution_plan: 'generate_edit_shot_execution_plan',
  ready_to_generate_storyboard: 'generate_edit_script_storyboard',
  ready_to_generate_storyboard_images: 'generate_edit_script_storyboard_images',
  ready_to_generate_videos: 'generate_episode_videos',
  ready_to_render_final: 'render_final_video',
}

async function assertShotExecutionPlanNodesSurviveProcessingReload(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: { readonly projectId: string; readonly episodeId: string }
}): Promise<void> {
  let runningTargetIds: string[] = []
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(input.scope)
    runningTargetIds = [...new Set(snapshot.tasks.flatMap((task) => (
      task.type === TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE
      && (task.status === 'queued' || task.status === 'processing')
      && task.targetType === 'ProjectEditScript'
      && typeof task.targetId === 'string'
        ? [task.targetId]
        : []
    )))]
    if (runningTargetIds.length === 0) return false
    const nodes = runningTargetIds.map((targetId) => (
      input.page.locator(`article[data-node-id="${workspaceNodeId.editShotExecutionPlan(targetId)}"]`)
    ))
    const [projectedNodeCount, exactNodeCounts, lifecyclePhases] = await Promise.all([
      input.page.locator('article[data-node-id^="edit-shot-execution-plan:edit-script:"]').count(),
      Promise.all(nodes.map(async (node) => await node.count())),
      Promise.all(nodes.map(async (node) => await node.getAttribute('data-lifecycle-phase'))),
    ])
    return projectedNodeCount === runningTargetIds.length
      && exactNodeCounts.every((count) => count === 1)
      && lifecyclePhases.every((phase) => phase === 'queued' || phase === 'processing' || phase === 'streaming')
  }, {
    timeout: 60_000,
    message: 'every running shot-execution Task target must project one existing Canvas lifecycle node',
  }).toBe(true)

  await input.page.reload({ waitUntil: 'domcontentloaded' })
  await expect(input.page.locator('article[data-node-id^="edit-shot-execution-plan:edit-script:"]'))
    .toHaveCount(runningTargetIds.length)
  for (const targetId of runningTargetIds) {
    await expect(input.page.locator(
      `article[data-node-id="${workspaceNodeId.editShotExecutionPlan(targetId)}"]`,
    )).toHaveCount(1)
  }
}

async function assertRunningShotMediaSurfaces(input: {
  readonly page: import('@playwright/test').Page
}): Promise<void> {
  const surfaces = input.page.locator('article[data-node-id^="shot:"] [data-canvas-media-surface="true"]')
  await expect.poll(async () => {
    const count = await surfaces.count()
    if (count === 0) return false
    return await surfaces.evaluateAll((items) => items.every((surface) => (
      surface.getAttribute('data-canvas-media-phase') === 'generating'
      && surface.getAttribute('data-canvas-media-background') === 'style-bible'
      && surface.getAttribute('data-canvas-media-placeholder-visible') === 'false'
      && surface.querySelector('[role="progressbar"]') !== null
    )))
  }, {
    timeout: 60_000,
    message: 'running shot media must show the shared Style Bible progress surface without the empty placeholder',
  }).toBe(true)
}

for (const scenario of GOLDEN_STAGE_PROBE_SCENARIOS) {
  const terminalLabel = scenario.expectedTerminal.kind === 'workflow_stage'
    ? scenario.expectedTerminal.stage
    : scenario.expectedTerminal.kind === 'declared_failure'
      ? scenario.expectedTerminal.code
      : scenario.expectedTerminal.fact
  test(`[${scenario.id}] canonical checkpoint reaches ${terminalLabel}`, async ({
    page,
    context,
    browserObservations,
  }, testInfo) => {
    test.setTimeout(5 * 60_000)
    const source = await readGoldenSourceFixtureManifest()
    const authState = JSON.parse(await readFile(source.authStatePath, 'utf8')) as GoldenStorageState
    await context.addCookies(authState.cookies)
    await page.goto('/zh/home')
    if (scenario.startStage === 'outside_workflow') {
      throw new Error(`GOLDEN_STAGE_PROBE_START_UNSUPPORTED:${scenario.id}`)
    }
    const checkpointSource = source.checkpointSources?.[scenario.startStage] ?? source.scope
    const scope = await forkGoldenWorkflowCheckpoint({
      page,
      source: checkpointSource,
      stage: scenario.startStage,
    })
    await page.goto(`/zh/workspace/${encodeURIComponent(scope.projectId)}?episode=${encodeURIComponent(scope.episodeId)}`)
    await expect.poll(async () => await readGoldenWorkflowStage(page, scope), { timeout: 30_000 }).toBe(scenario.startStage)

    const verifiesShotExecutionPlanProjection = scenario.startStage === 'ready_to_generate_shot_execution_plan'
    const verifiesShotMediaSurface = scenario.startStage === 'ready_to_generate_storyboard_images'
    if (verifiesShotExecutionPlanProjection) {
      await setGoldenStreamPacing({ chunkSize: 1, delayMs: 1 })
    }
    if (verifiesShotMediaSurface) {
      await setGoldenMediaStatusDelay(15_000)
    }
    try {
      const boundary = BOUNDARY_BY_STAGE[scenario.startStage]
      await setGoldenForcedTool(scope.checkpointKind === 'approval'
        ? null
        : OPERATION_BY_STAGE[scenario.startStage] ?? null)
      let approvalSubmitted = false
      let intakeChoiceSubmitted = false
      if (scope.checkpointKind === 'approval') {
        await expect(getGoldenApprovalButton(page)).toBeVisible({ timeout: 30_000 })
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect(getGoldenApprovalButton(page)).toBeVisible({ timeout: 30_000 })
        await getGoldenApprovalButton(page).click()
        approvalSubmitted = true
      } else if (boundary) {
        await expect.poll(async () => await readGoldenMainlineBoundary(page), { timeout: 30_000 }).toBe(boundary)
        await submitGoldenBoundary(page, boundary)
      } else {
        const composer = page.getByPlaceholder('和 AI 一起创造')
        await composer.fill('继续执行当前工作流的下一步')
        await composer.press('Enter')
      }

      if (verifiesShotExecutionPlanProjection) {
        await assertShotExecutionPlanNodesSurviveProcessingReload({ page, scope })
      }
      if (verifiesShotMediaSurface) {
        await assertRunningShotMediaSurfaces({ page })
      }

      if (scenario.expectedTerminal.kind !== 'workflow_stage') {
        throw new Error(`GOLDEN_STAGE_PROBE_TERMINAL_UNSUPPORTED:${scenario.id}`)
      }
      const minimumStageIndex = GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(scenario.expectedTerminal.stage)
      const advanceDeadline = Date.now() + 120_000
      let advanced = false
      while (Date.now() < advanceDeadline) {
        const actual = await readGoldenWorkflowStage(page, scope)
        const actualIndex = GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(actual)
        if (actual !== 'failed' && actualIndex >= minimumStageIndex) {
          advanced = true
          break
        }
        if (actual === 'failed') break
        if (!approvalSubmitted && await getGoldenApprovalButton(page).count() > 0) {
          await setGoldenForcedTool(null)
          await page.reload({ waitUntil: 'domcontentloaded' })
          await expect(getGoldenApprovalButton(page)).toBeVisible({ timeout: 30_000 })
          await getGoldenApprovalButton(page).click()
          approvalSubmitted = true
        }
        if (!intakeChoiceSubmitted && scenario.startStage === 'ready_to_ingest_script') {
          const activeBoundary = await readGoldenMainlineBoundary(page)
          if (activeBoundary === 'script_intake') {
            await submitGoldenBoundary(page, activeBoundary)
            intakeChoiceSubmitted = true
          }
        }
        await page.waitForTimeout(250)
      }
      expect(advanced, `${scenario.startStage} must advance through at least ${scenario.expectedTerminal.stage}`).toBe(true)
      if (verifiesShotExecutionPlanProjection || verifiesShotMediaSurface) browserObservations.assertClean()
    } catch (error) {
      await attachGoldenOracleEvidence(testInfo, scope)
      throw error
    } finally {
      if (verifiesShotExecutionPlanProjection) await setGoldenStreamPacing(null)
      if (verifiesShotMediaSurface) await setGoldenMediaStatusDelay(0)
    }
    await attachGoldenOracleEvidence(testInfo, scope)
  })
}
