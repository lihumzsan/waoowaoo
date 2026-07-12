import { readFile } from 'node:fs/promises'
import { test, expect } from '../browser/test'
import {
  getGoldenApprovalButton,
  readGoldenWorkflowStage,
} from '../browser/pages/workspace'
import { forkGoldenWorkflowCheckpoint } from '../fixtures/workflow-lab'
import { readGoldenSourceFixtureManifest } from '../fixtures/source-manifest'
import { attachGoldenOracleEvidence } from '../oracle/evidence'

interface GoldenStorageState {
  readonly cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0]
}

test('[GJ-APPROVAL-DOUBLE-SUBMIT] concurrent approval creates one grant and one execution', async ({ page, context }, testInfo) => {
  test.skip(process.env.GOLDEN_ADVANCED_SOURCE_VARIANTS !== '1', 'run through test:golden:variant:approval-double')
  test.setTimeout(5 * 60_000)
  const source = await readGoldenSourceFixtureManifest()
  const authState = JSON.parse(await readFile(source.authStatePath, 'utf8')) as GoldenStorageState
  await context.addCookies(authState.cookies)
  await page.goto('/zh/home')
  const scope = await forkGoldenWorkflowCheckpoint({
    page,
    source: source.scope,
    stage: 'ready_to_generate_videos',
  })
  await page.goto(`/zh/workspace/${encodeURIComponent(scope.projectId)}?episode=${encodeURIComponent(scope.episodeId)}`)
  await expect.poll(async () => await readGoldenWorkflowStage(page, scope)).toBe('ready_to_generate_videos')
  await expect(getGoldenApprovalButton(page)).toBeVisible({ timeout: 60_000 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(getGoldenApprovalButton(page)).toBeVisible({ timeout: 30_000 })
  await getGoldenApprovalButton(page).dblclick({ delay: 5 })
  await expect.poll(async () => {
    const stage = await readGoldenWorkflowStage(page, scope)
    return stage === 'videos_generating' || stage === 'ready_to_render_chapters'
  }, { timeout: 120_000 }).toBe(true)
  const oracle = await attachGoldenOracleEvidence(testInfo, scope)
  expect(oracle.approvalGrants.filter((grant) => grant.operationId === 'generate_episode_videos')).toHaveLength(1)
  expect(oracle.operationExecutions.filter((execution) => execution.operationId === 'generate_episode_videos')).toHaveLength(1)
})
