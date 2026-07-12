import { readFile } from 'node:fs/promises'
import { expect, test } from '../browser/test'
import {
  getGoldenApprovalButton,
  readGoldenMainlineBoundary,
  readGoldenWorkflowStage,
} from '../browser/pages/workspace'
import { forkGoldenWorkflowCheckpoint } from '../fixtures/workflow-lab'
import { readGoldenSourceFixtureManifest } from '../fixtures/source-manifest'
import { attachGoldenOracleEvidence } from '../oracle/evidence'
import { setGoldenMediaScenario } from '../providers/control'

interface GoldenStorageState {
  readonly cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0]
}

test('[GJ-PROVIDER-NONRETRYABLE-FAILURE] terminal video provider failure creates one failed Task and no fabricated output', async ({ page, context }, testInfo) => {
  test.skip(process.env.GOLDEN_MEDIA_DYNAMIC_VARIANTS !== '1', 'run through test:golden:variant:provider-failure')
  test.setTimeout(5 * 60_000)
  const source = await readGoldenSourceFixtureManifest()
  const authState = JSON.parse(await readFile(source.authStatePath, 'utf8')) as GoldenStorageState
  await context.addCookies(authState.cookies)
  await page.goto('/zh/home', { waitUntil: 'domcontentloaded' })
  const scope = await forkGoldenWorkflowCheckpoint({
    page,
    source: source.scope,
    stage: 'ready_to_generate_videos',
  })
  await setGoldenMediaScenario('terminal-failure')
  await page.goto(`/zh/workspace/${encodeURIComponent(scope.projectId)}?episode=${encodeURIComponent(scope.episodeId)}`, {
    waitUntil: 'domcontentloaded',
  })
  await expect.poll(async () => await readGoldenWorkflowStage(page, scope)).toBe('ready_to_generate_videos')
  await expect(getGoldenApprovalButton(page)).toBeVisible({ timeout: 30_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(getGoldenApprovalButton(page)).toBeVisible({ timeout: 30_000 })
  await getGoldenApprovalButton(page).click()

  await expect.poll(async () => await readGoldenWorkflowStage(page, scope), { timeout: 120_000 }).toBe('failed')
  await expect.poll(async () => await readGoldenMainlineBoundary(page), { timeout: 30_000 }).toBe('assistant_failure')
  const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-terminal-video-provider-failure')
  const videoTasks = oracle.tasks.filter((task) => task.type === 'video_group')
  expect(videoTasks).toHaveLength(1)
  expect(videoTasks[0]).toMatchObject({ status: 'failed', attempt: 1 })
  expect(oracle.operationExecutions.filter((execution) => execution.operationId === 'generate_episode_videos')).toHaveLength(1)
  expect(oracle.domain.finalOutputs).toHaveLength(0)
})
