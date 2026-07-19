import { expect, test } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome, type GoldenWorkspaceScope } from '../browser/pages/home'
import {
  readGoldenPendingInteractionOperationId,
  submitGoldenBoundary,
} from '../browser/pages/workspace'
import { readGoldenOracleSnapshot } from '../oracle/reader'
import { failNextGoldenFalRequests, setGoldenStreamPacing } from '../providers/control'
import {
  GOLDEN_FREEFORM_ADOPT_REQUEST,
  GOLDEN_FREEFORM_AUDIO_REQUEST,
  GOLDEN_FREEFORM_IMAGE_REQUEST,
  GOLDEN_PARALLEL_IMAGE_REQUEST,
  GOLDEN_FREEFORM_RETRY_REQUEST,
  GOLDEN_FREEFORM_TEXT_REQUEST,
  GOLDEN_FREEFORM_VIDEO_REQUEST,
  GOLDEN_FREEFORM_ZERO_VIDEO_REQUEST,
  GOLDEN_STOP_RECOVERY_REQUEST,
  GOLDEN_STOP_REPLY_REQUEST,
} from '../providers/model/policy'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import { TASK_TYPE } from '@/lib/task/types'

async function sendNaturalLanguage(page: import('@playwright/test').Page, text: string): Promise<void> {
  const composer = page.getByPlaceholder('和 AI 一起创造').filter({ visible: true })
  await composer.fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).filter({ visible: true }).click()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

async function approveOperation(
  page: import('@playwright/test').Page,
  scope: GoldenWorkspaceScope,
  operationId: string,
): Promise<void> {
  await expect.poll(async () => await readGoldenPendingInteractionOperationId(page, scope), {
    timeout: 60_000,
    message: `${operationId} must use the existing quote Approval boundary`,
  }).toBe(operationId)
  await submitGoldenBoundary(page, 'approval')
}

async function waitForResources(
  scope: GoldenWorkspaceScope,
  mediaType: 'text' | 'image' | 'audio' | 'video',
  count: number,
): Promise<readonly Record<string, unknown>[]> {
  let matching: readonly Record<string, unknown>[] = []
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(scope)
    matching = snapshot.resources.filter((resource) => resource.mediaType === mediaType)
    return {
      count: matching.length,
      ready: matching.filter((resource) => resource.status === 'ready').length,
      runStatus: snapshot.runs.at(-1)?.status ?? null,
    }
  }, { timeout: 120_000 }).toEqual({ count, ready: count, runStatus: 'completed' })
  return matching
}

async function waitForAgentRunSettlement(scope: GoldenWorkspaceScope): Promise<void> {
  await expect.poll(async () => (await readGoldenOracleSnapshot(scope)).runs.at(-1)?.status ?? null, {
    timeout: 60_000,
    message: 'the durable Task continuation must settle before the next user turn',
  }).toBe('completed')
}

test('[GJ-FREEFORM-RESOURCE-CREATION] natural language creates, retries, reuses, adopts, and renders independent Resources', async ({
  page,
  browserObservations,
}, testInfo) => {
  test.setTimeout(20 * 60_000)
  await registerGoldenUser(page, {
    username: `golden-freeform-${String(Date.now())}`,
    password: 'golden-freeform-password',
  })

  await failNextGoldenFalRequests(2)
  const scope = await launchGoldenStoryFromHome(page, GOLDEN_FREEFORM_IMAGE_REQUEST)
  await approveOperation(page, scope, 'create_image')

  let initialImageResources: readonly Record<string, unknown>[] = []
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(scope)
    initialImageResources = snapshot.resources.filter((resource) => resource.mediaType === 'image')
    return {
      resources: initialImageResources.length,
      ready: initialImageResources.filter((resource) => resource.status === 'ready').length,
      failed: initialImageResources.filter((resource) => resource.status === 'failed').length,
      tasks: snapshot.tasks.filter((task) => task.type === TASK_TYPE.CREATIVE_RESOURCE_IMAGE).length,
    }
  }, {
    timeout: 120_000,
    message: 'the controlled provider boundary must produce one success and two durable failures',
  }).toEqual({ resources: 3, ready: 1, failed: 2, tasks: 3 })
  await waitForAgentRunSettlement(scope)

  const successfulBeforeRetry = initialImageResources.find((resource) => resource.status === 'ready')?.id
  const failedBeforeRetry = initialImageResources
    .filter((resource) => resource.status === 'failed')
    .map((resource) => resource.id)
  expect(typeof successfulBeforeRetry).toBe('string')
  expect(failedBeforeRetry).toHaveLength(2)

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_RETRY_REQUEST)
  await approveOperation(page, scope, 'create_image')
  const readyImages = await waitForResources(scope, 'image', 3)
  const afterRetry = await readGoldenOracleSnapshot(scope)
  const imageTasks = afterRetry.tasks.filter((task) => task.type === TASK_TYPE.CREATIVE_RESOURCE_IMAGE)
  expect(imageTasks).toHaveLength(5)
  expect(imageTasks.filter((task) => task.targetId === successfulBeforeRetry)).toHaveLength(1)
  for (const failedResourceId of failedBeforeRetry) {
    expect(imageTasks.filter((task) => task.targetId === failedResourceId)).toHaveLength(2)
  }
  expect(new Set(readyImages.map((resource) => resource.candidateSetId)).size).toBe(1)

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_ADOPT_REQUEST)
  await expect.poll(async () => (await readGoldenOracleSnapshot(scope)).resourceBindings.length, {
    timeout: 60_000,
    message: 'candidate adoption must persist independently of generation',
  }).toBe(1)
  await waitForAgentRunSettlement(scope)
  const adopted = await readGoldenOracleSnapshot(scope)
  expect(adopted.resourceBindings[0]).toMatchObject({ role: 'primary_image', slotKey: 'main', source: 'agent' })
  expect(adopted.resources.filter((resource) => resource.mediaType === 'image')).toHaveLength(3)

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_TEXT_REQUEST)
  const textResources = await waitForResources(scope, 'text', 3)
  expect(new Set(textResources.map((resource) => resource.candidateSetId)).size).toBe(1)

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_VIDEO_REQUEST)
  await approveOperation(page, scope, 'create_video')
  const videoResources = await waitForResources(scope, 'video', 2)

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_AUDIO_REQUEST)
  await approveOperation(page, scope, 'create_audio')
  const audioResources = await waitForResources(scope, 'audio', 1)

  await page.reload({ waitUntil: 'domcontentloaded' })
  const finalSnapshot = await readGoldenOracleSnapshot(scope)
  const imageRevisionIds = new Set(finalSnapshot.resourceRevisions
    .filter((revision) => readyImages.some((resource) => resource.id === revision.resourceId))
    .map((revision) => revision.id))
  const videoRevisionIds = new Set(finalSnapshot.resourceRevisions
    .filter((revision) => videoResources.some((resource) => resource.id === revision.resourceId))
    .map((revision) => revision.id))
  const videoLineage = finalSnapshot.resourceLineage.filter((lineage) => videoRevisionIds.has(lineage.outputRevisionId))
  const audioRevisionIds = new Set(finalSnapshot.resourceRevisions
    .filter((revision) => audioResources.some((resource) => resource.id === revision.resourceId))
    .map((revision) => revision.id))
  const audioLineage = finalSnapshot.resourceLineage.filter((lineage) => audioRevisionIds.has(lineage.outputRevisionId))
  expect(videoLineage.length).toBeGreaterThanOrEqual(2)
  expect(videoLineage.every((lineage) => imageRevisionIds.has(lineage.inputRevisionId))).toBe(true)
  expect(audioLineage).toHaveLength(2)
  expect(audioLineage.every((lineage) => videoRevisionIds.has(lineage.inputRevisionId))).toBe(true)
  expect(finalSnapshot.resourceRevisions.every((revision) => (
    typeof revision.fingerprint === 'string'
    && revision.fingerprint.length === 64
    && typeof revision.operationId === 'string'
    && typeof revision.inputHash === 'string'
  ))).toBe(true)
  expect(finalSnapshot.resourceBindings).toHaveLength(1)

  for (const resource of [...readyImages, ...textResources, ...videoResources, ...audioResources]) {
    if (typeof resource.id !== 'string') throw new Error('GOLDEN_RESOURCE_ID_MISSING')
    await expect(page.locator(`article[data-node-id="${workspaceNodeId.resourceCard(String(resource.candidateSetId ?? resource.id))}"]`))
      .toHaveCount(1)
  }
  await expect(page.locator('article[data-node-id^="resource:"] video[src]')).toHaveCount(2)
  await expect(page.locator('article[data-node-id^="resource:"] audio[src]')).toHaveCount(1)
  expect(finalSnapshot.identities.duplicateMessageIds).toHaveLength(0)
  expect(finalSnapshot.identities.duplicateToolCallIds).toHaveLength(0)
  browserObservations.assertClean()

  await testInfo.attach('freeform-resource-oracle', {
    body: Buffer.from(JSON.stringify(finalSnapshot, null, 2)),
    contentType: 'application/json',
  })
})

test('[GJ-FREEFORM-ZERO-VIDEO] an empty project submits text-to-video directly without workflow artifacts', async ({
  page,
  browserObservations,
}) => {
  test.setTimeout(8 * 60_000)
  await registerGoldenUser(page, {
    username: `golden-zero-video-${String(Date.now())}`,
    password: 'golden-zero-video-password',
  })
  const scope = await launchGoldenStoryFromHome(page, GOLDEN_FREEFORM_ZERO_VIDEO_REQUEST)
  await approveOperation(page, scope, 'create_video')
  await waitForResources(scope, 'video', 1)
  const snapshot = await readGoldenOracleSnapshot(scope)
  expect(snapshot.domain.sourceDocuments).toHaveLength(0)
  expect(snapshot.domain.bibles).toHaveLength(0)
  expect(snapshot.domain.editScripts).toHaveLength(0)
  expect(snapshot.tasks.filter((task) => task.type === TASK_TYPE.CREATIVE_RESOURCE_VIDEO)).toHaveLength(1)
  expect(snapshot.tasks.some((task) => task.type === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE)).toBe(false)
  browserObservations.assertClean()
})

test('[GJ-ASSISTANT-STOP-REPLY] stopping a streamed reply cancels its Run and permits a new turn', async ({
  page,
  browserObservations,
}, testInfo) => {
  test.setTimeout(5 * 60_000)
  await registerGoldenUser(page, {
    username: `golden-stop-reply-${String(Date.now())}`,
    password: 'golden-stop-reply-password',
  })

  await setGoldenStreamPacing({ chunkSize: 8, delayMs: 5 })
  let scope: GoldenWorkspaceScope | null = null
  try {
    scope = await launchGoldenStoryFromHome(page, GOLDEN_STOP_REPLY_REQUEST)
    await expect(page.getByText(/STOP_REPLY_STREAM_BEGIN/).first()).toBeVisible({ timeout: 60_000 })
    const stopReply = page.getByRole('button', { name: '停止生成', exact: true }).filter({ visible: true })
    await expect(stopReply).toBeVisible()
    await stopReply.click()
  } finally {
    await setGoldenStreamPacing(null)
  }
  if (!scope) throw new Error('GOLDEN_STOP_REPLY_SCOPE_MISSING')

  await expect(page.getByRole('button', { name: '发送', exact: true }).filter({ visible: true })).toBeVisible()
  await sendNaturalLanguage(page, GOLDEN_STOP_RECOVERY_REQUEST)
  await expect(page.getByText('STOP_REPLY_RECOVERY_COMPLETED', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect.poll(async () => (await readGoldenOracleSnapshot(scope)).runs.map((run) => ({
    status: run.status,
    stopReason: run.stopReason,
  })), {
    timeout: 60_000,
    message: 'the stop click must cancel its Run and an immediate new user turn must acquire the released lock',
  }).toEqual([
    { status: 'cancelled', stopReason: 'stream_cancelled' },
    { status: 'completed', stopReason: 'completed' },
  ])

  const snapshot = await readGoldenOracleSnapshot(scope)
  expect(snapshot.tasks).toHaveLength(0)
  expect(snapshot.waits).toHaveLength(0)
  expect(snapshot.handoffs).toHaveLength(0)
  browserObservations.assertClean()
  await testInfo.attach('stop-reply-oracle', {
    body: Buffer.from(JSON.stringify(snapshot, null, 2)),
    contentType: 'application/json',
  })
})

test('[GJ-PARALLEL-OPERATION-BATCH] three same-Operation calls share one quote and one background continuation', async ({
  page,
  browserObservations,
}) => {
  test.setTimeout(8 * 60_000)
  await registerGoldenUser(page, {
    username: `golden-parallel-batch-${String(Date.now())}`,
    password: 'golden-parallel-batch-password',
  })
  const scope = await launchGoldenStoryFromHome(page, GOLDEN_PARALLEL_IMAGE_REQUEST)

  await expect.poll(async () => await readGoldenPendingInteractionOperationId(page, scope), {
    timeout: 60_000,
    message: 'three parallel create_image calls must produce one approval interaction',
  }).toBe('create_image')
  const beforeApproval = await readGoldenOracleSnapshot(scope)
  const pendingApprovals = beforeApproval.interruptions.filter((item) => (
    item.type === 'approval' && item.status === 'pending'
  ))
  expect(pendingApprovals).toHaveLength(1)
  const approvalPayload = asRecord(pendingApprovals[0]?.payload)
  expect(Array.isArray(approvalPayload?.approvalItems) ? approvalPayload.approvalItems : []).toHaveLength(3)
  expect(asRecord(approvalPayload?.operationPlan)?.taskCount).toBe(3)
  expect(beforeApproval.tasks).toHaveLength(0)
  expect(beforeApproval.approvalGrants).toHaveLength(0)

  await submitGoldenBoundary(page, 'approval')
  const resources = await waitForResources(scope, 'image', 3)
  await expect.poll(async () => {
    const current = await readGoldenOracleSnapshot(scope)
    return current.runs
      .filter((run) => typeof run.requestId === 'string' && run.requestId.startsWith('operation-batch:'))
      .map((run) => run.status)
  }, {
    timeout: 60_000,
    message: 'the single background OperationBatch Run must finish its one continuation',
  }).toEqual(['completed'])
  const snapshot = await readGoldenOracleSnapshot(scope)
  const imageTasks = snapshot.tasks.filter((task) => task.type === TASK_TYPE.CREATIVE_RESOURCE_IMAGE)
  const operationBatchRuns = snapshot.runs.filter((run) => (
    typeof run.requestId === 'string' && run.requestId.startsWith('operation-batch:')
  ))
  const operationBatchHandoffs = snapshot.handoffs.filter((handoff) => handoff.kind === 'task_batch')
  expect(imageTasks).toHaveLength(3)
  expect(snapshot.approvalGrants).toHaveLength(3)
  expect(snapshot.operationExecutions).toHaveLength(3)
  expect(snapshot.waits).toHaveLength(1)
  expect(Array.isArray(snapshot.waits[0]?.taskIds) ? snapshot.waits[0]?.taskIds : []).toHaveLength(3)
  expect(snapshot.waits[0]?.status).toBe('followed')
  expect(snapshot.checkpoints).toHaveLength(1)
  expect(snapshot.outboxCommands.filter((command) => command.kind === 'project_agent.continue_wait')).toHaveLength(1)
  expect(operationBatchRuns).toHaveLength(1)
  expect(operationBatchRuns[0]?.status).toBe('completed')
  expect(operationBatchHandoffs).toHaveLength(1)
  expect(operationBatchHandoffs[0]?.status).toBe('settled')
  expect(snapshot.identities.duplicateToolCallIds).toHaveLength(0)
  expect(snapshot.identities.toolCallIds.filter((id) => id.includes('create_image'))).toHaveLength(3)
  for (const resource of resources) {
    if (typeof resource.id !== 'string') throw new Error('GOLDEN_RESOURCE_ID_MISSING')
    await expect(page.locator(`article[data-node-id="${workspaceNodeId.resourceCard(String(resource.candidateSetId ?? resource.id))}"]`))
      .toHaveCount(1)
  }
  browserObservations.assertClean()
})
