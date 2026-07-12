import { readFile } from 'node:fs/promises'
import { expect, test } from '../browser/test'
import {
  getGoldenApprovalButton,
  readGoldenWorkflowStage,
} from '../browser/pages/workspace'
import { forkGoldenWorkflowCheckpoint } from '../fixtures/workflow-lab'
import { readGoldenSourceFixtureManifest } from '../fixtures/source-manifest'
import { attachGoldenOracleEvidence } from '../oracle/evidence'
import { readGoldenOracleSnapshot } from '../oracle/reader'

interface GoldenStorageState {
  readonly cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0]
}

test('[GJ-TASK-COMPLETES-DURING-BROWSER-DISCONNECT][GJ-SSE-OLD-CURSOR-REPLAY] durable completion and stale-cursor replay preserve one UI result', async ({
  page,
  context,
  browserObservations,
}, testInfo) => {
  test.skip(process.env.GOLDEN_ADVANCED_SOURCE_VARIANTS !== '1', 'run through test:golden:variant:task-disconnect')
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

  const approvalResponsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/approval')
  ))
  await getGoldenApprovalButton(page).click()
  const approvalResponse = await approvalResponsePromise
  expect(approvalResponse.ok()).toBe(true)
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(scope)
    const videoTasks = snapshot.tasks.filter((task) => task.type === 'video_group')
    return videoTasks.length === 1 ? videoTasks[0]?.status : null
  }, {
    timeout: 30_000,
    message: 'disconnect only after the server has durably submitted the production Task',
  }).toMatch(/^(queued|processing)$/)
  await page.close()

  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(scope)
    const videoTasks = snapshot.tasks.filter((task) => task.type === 'video_group')
    return videoTasks.length === 1 ? videoTasks[0]?.status : null
  }, {
    timeout: 180_000,
    message: 'the production worker must finish while no page is connected',
  }).toBe('completed')

  const reconnectedPage = await context.newPage()
  browserObservations.attach(reconnectedPage)
  await reconnectedPage.goto(
    `/zh/workspace/${encodeURIComponent(scope.projectId)}?episode=${encodeURIComponent(scope.episodeId)}`,
    { waitUntil: 'domcontentloaded' },
  )
  await expect.poll(async () => await readGoldenWorkflowStage(reconnectedPage, scope), {
    timeout: 60_000,
  }).toBe('ready_to_render_chapters')
  await expect(getGoldenApprovalButton(reconnectedPage)).toHaveCount(0)

  const beforeReplay = await readGoldenOracleSnapshot(scope)
  const latestTaskEventId = beforeReplay.taskEvents.reduce((latest, event) => {
    const eventId = Number(event.id)
    return Number.isSafeInteger(eventId) ? Math.max(latest, eventId) : latest
  }, 0)
  if (latestTaskEventId < 2) throw new Error('GOLDEN_SSE_REPLAY_TASK_EVENT_HISTORY_MISSING')
  const staleTaskEventId = Math.max(1, latestTaskEventId - 2)
  await reconnectedPage.evaluate(({ key, cursor }) => {
    window.sessionStorage.setItem(key, cursor)
  }, {
    key: `workspace-sse-cursor:v1:${scope.projectId}:${scope.episodeId}`,
    cursor: `v2;t=${String(staleTaskEventId)};m=0:-;a=0`,
  })
  const replayRequestPromise = reconnectedPage.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === '/api/sse' && url.searchParams.has('cursor')
  })
  await reconnectedPage.reload({ waitUntil: 'domcontentloaded' })
  const replayRequest = await replayRequestPromise
  expect(new URL(replayRequest.url()).searchParams.get('cursor')).toContain(`t=${String(staleTaskEventId)}`)
  await expect.poll(async () => await readGoldenWorkflowStage(reconnectedPage, scope), {
    timeout: 60_000,
  }).toBe('ready_to_render_chapters')

  const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-task-completion-disconnect-and-replay')
  const videoTasks = oracle.tasks.filter((task) => task.type === 'video_group')
  expect(videoTasks).toHaveLength(1)
  expect(videoTasks[0]).toMatchObject({ status: 'completed', attempt: 1 })
  expect(oracle.operationExecutions.filter((execution) => execution.operationId === 'generate_episode_videos')).toHaveLength(1)
  expect(oracle.tasks.some((task) => task.status === 'failed')).toBe(false)
  expect(oracle.tasks).toHaveLength(beforeReplay.tasks.length)
  expect(oracle.taskEvents).toHaveLength(beforeReplay.taskEvents.length)
  expect(oracle.operationExecutions).toHaveLength(beforeReplay.operationExecutions.length)
  expect(oracle.identities.duplicateMessageIds).toEqual(beforeReplay.identities.duplicateMessageIds)
  expect(oracle.identities.duplicateToolCallIds).toEqual(beforeReplay.identities.duplicateToolCallIds)
})
