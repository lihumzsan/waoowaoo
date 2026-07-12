import { readFile } from 'node:fs/promises'
import { test, expect } from '../browser/test'
import {
  readGoldenMainlineBoundary,
  submitGoldenBoundary,
  waitForGoldenProductionPlanOutcome,
} from '../browser/pages/workspace'
import { forkGoldenWorkflowCheckpoint } from '../fixtures/workflow-lab'
import { readGoldenSourceFixtureManifest } from '../fixtures/source-manifest'
import { attachGoldenOracleEvidence } from '../oracle/evidence'
import { setGoldenStreamPacing } from '../providers/control'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'

interface GoldenStorageState {
  readonly cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0]
}

test('[GJ-CANVAS-STRUCTURED-PREVIEW] paced model output remains a processing card and reveals valid items', async ({
  page,
  context,
  browserObservations,
}, testInfo) => {
  test.setTimeout(3 * 60_000)
  const source = await readGoldenSourceFixtureManifest()
  const authState = JSON.parse(await readFile(source.authStatePath, 'utf8')) as GoldenStorageState
  await context.addCookies(authState.cookies)
  await page.goto('/zh/home')
  const checkpointSource = source.checkpointSources?.script_ready_for_review ?? source.scope
  const scope = await forkGoldenWorkflowCheckpoint({
    page,
    source: checkpointSource,
    stage: 'script_ready_for_review',
  })
  await page.goto(`/zh/workspace/${encodeURIComponent(scope.projectId)}?episode=${encodeURIComponent(scope.episodeId)}`)
  await expect.poll(async () => await readGoldenMainlineBoundary(page), { timeout: 30_000 }).toBe('script_review')

  const node = page.locator(`article[data-node-id="${workspaceNodeId.editBible(scope.episodeId)}"]`)
  await setGoldenStreamPacing({ chunkSize: 32, delayMs: 120 })
  try {
    await submitGoldenBoundary(page, 'script_review')
    await expect.poll(async () => ({
      phase: await node.getAttribute('data-lifecycle-phase'),
      beatSectionCount: await node.getByRole('button', { name: /剧情节拍/ }).count(),
      failedCount: await node.getByText('失败', { exact: true }).count(),
    }), {
      timeout: 60_000,
      message: 'A completed raw beat must become visible while the durable Task is still processing',
    }).toEqual({ phase: 'streaming', beatSectionCount: 1, failedCount: 0 })

    const expandButton = node.getByRole('button', { name: '展开', exact: true })
    if (await expandButton.count() > 0) await expandButton.click()
    await node.getByRole('button', { name: /剧情节拍/ }).click()
    await expect(node.getByText('祭坛循环', { exact: true })).toBeVisible()
    await expect(node).not.toContainText('sourceStart')
    await expect(node).not.toContainText('invalid_type')
  } catch (error) {
    await attachGoldenOracleEvidence(testInfo, scope, 'golden-structured-preview-processing-failure')
    throw error
  } finally {
    await setGoldenStreamPacing(null)
  }

  expect(await waitForGoldenProductionPlanOutcome(page, 90_000)).toBe('bible_review')
  await expect(node).toHaveAttribute('data-lifecycle-phase', 'succeeded')
  const finalExpandButton = node.getByRole('button', { name: '展开', exact: true })
  if (await finalExpandButton.count() > 0) await finalExpandButton.click()
  await node.getByRole('button', { name: /事件台账/ }).click()
  await expect(node.getByText('旅人无法离开祭坛所在的循环。', { exact: true })).toBeVisible()
  await node.getByRole('button', { name: /情绪曲线/ }).click()
  await expect(node.getByText('危险逼近', { exact: true })).toBeVisible()
  browserObservations.assertClean()
  await attachGoldenOracleEvidence(testInfo, scope, 'golden-structured-preview-completed')
})
