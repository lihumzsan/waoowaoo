import { test, expect } from '../browser/test'
import {
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
import { readFile } from 'node:fs/promises'
import { setGoldenForcedTool } from '../providers/control'

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

for (const scenario of GOLDEN_STAGE_PROBE_SCENARIOS) {
  test(`[${scenario.id}] canonical checkpoint reaches ${scenario.expectedTerminal.kind === 'workflow_stage' ? scenario.expectedTerminal.stage : scenario.expectedTerminal.code}`, async ({ page, context }, testInfo) => {
    test.setTimeout(5 * 60_000)
    const source = await readGoldenSourceFixtureManifest()
    const authState = JSON.parse(await readFile(source.authStatePath, 'utf8')) as GoldenStorageState
    await context.addCookies(authState.cookies)
    await page.goto('/zh/home')
    const scope = await forkGoldenWorkflowCheckpoint({
      page,
      source: source.scope,
      stage: scenario.startStage,
    })
    await page.goto(`/zh/workspace/${encodeURIComponent(scope.projectId)}?episode=${encodeURIComponent(scope.episodeId)}`)
    await expect.poll(async () => await readGoldenWorkflowStage(page, scope), { timeout: 30_000 }).toBe(scenario.startStage)

    const boundary = BOUNDARY_BY_STAGE[scenario.startStage]
    await setGoldenForcedTool(OPERATION_BY_STAGE[scenario.startStage] ?? null)
    if (boundary) {
      await expect.poll(async () => await readGoldenMainlineBoundary(page), { timeout: 30_000 }).toBe(boundary)
      await submitGoldenBoundary(page, boundary)
    } else {
      const composer = page.getByPlaceholder('和 AI 一起创造')
      await composer.fill('继续执行当前工作流的下一步')
      await composer.press('Enter')
    }

    if (scenario.expectedTerminal.kind !== 'workflow_stage') {
      throw new Error(`GOLDEN_STAGE_PROBE_TERMINAL_UNSUPPORTED:${scenario.id}`)
    }
    const minimumStageIndex = GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(scenario.expectedTerminal.stage)
    await expect.poll(async () => {
      const actual = await readGoldenWorkflowStage(page, scope)
      const actualIndex = GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(actual)
      return actual !== 'failed' && actualIndex >= minimumStageIndex
    }, {
      timeout: 120_000,
      message: `${scenario.startStage} must advance through at least ${scenario.expectedTerminal.stage}`,
    }).toBe(true)
    await attachGoldenOracleEvidence(testInfo, scope)
  })
}
