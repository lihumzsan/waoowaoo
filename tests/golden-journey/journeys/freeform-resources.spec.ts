import { expect, test } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome, type GoldenWorkspaceScope } from '../browser/pages/home'
import {
  readGoldenPendingInteractionOperationId,
  submitGoldenApproval,
} from '../browser/pages/workspace'
import { readGoldenOracleSnapshot } from '../oracle/reader'
import { failNextGoldenFalRequests, setGoldenStreamPacing } from '../providers/control'
import {
  GOLDEN_FREEFORM_ADOPT_REQUEST,
  GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST,
  GOLDEN_FREEFORM_AUDIO_REQUEST,
  GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST,
  GOLDEN_FREEFORM_IMAGE_REQUEST,
  GOLDEN_PARALLEL_IMAGE_REQUEST,
  GOLDEN_FREEFORM_RETRY_REQUEST,
  GOLDEN_FREEFORM_SCREENPLAY_REQUEST,
  GOLDEN_FREEFORM_STYLE_BIBLE_REQUEST,
  GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST,
  GOLDEN_FREEFORM_TEXT_REQUEST,
  GOLDEN_FREEFORM_VIDEO_REQUEST,
  GOLDEN_FREEFORM_ZERO_VIDEO_REQUEST,
  GOLDEN_STOP_RECOVERY_REQUEST,
  GOLDEN_STOP_REPLY_REQUEST,
} from '../providers/model/policy'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
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
  await expect.poll(async () => {
    return await readGoldenPendingInteractionOperationId(page, scope)
  }, {
    timeout: 60_000,
    message: `${operationId} must use the existing quote Approval boundary`,
  }).toBe(operationId)
  await submitGoldenApproval(page)
}

async function resolveInitialVideoRatioChoice(
  page: import('@playwright/test').Page,
  scope: GoldenWorkspaceScope,
): Promise<void> {
  const initial = await readGoldenOracleSnapshot(scope)
  if (asRecord(initial.project)?.videoRatio !== null) return

  await expect.poll(async () => await readGoldenPendingInteractionOperationId(page, scope), {
    timeout: 60_000,
    message: 'the model must use the generic Choice boundary for the missing project video ratio',
  }).toBe('request_choice')

  const awaitingChoice = await readGoldenOracleSnapshot(scope)
  const pendingChoice = awaitingChoice.interruptions.find((interruption) => (
    interruption.type === 'choice' && interruption.status === 'pending'
  ))
  const offer = asRecord(pendingChoice?.payload)
  const card = asRecord(offer?.card)
  const groups = Array.isArray(card?.groups) ? card.groups.map(asRecord) : []
  const commitments = Array.isArray(offer?.commitments) ? offer.commitments.map(asRecord) : []
  expect(offer?.subject).toMatchObject({ kind: 'none' })
  expect(card).toMatchObject({
    mode: 'select',
    title: '请选择当前项目的画面比例',
    description: '这个选择只会保存当前项目的画面比例。',
    submitLabel: '保存本次画面比例',
  })
  expect(groups).toEqual([expect.objectContaining({
    key: 'videoRatio',
    required: true,
    presentation: 'aspect_ratio',
  })])
  expect(commitments).toEqual([
    expect.objectContaining({
      when: { kind: 'option', groupKey: 'videoRatio', optionValue: '16:9' },
      operationId: 'update_project_config',
      input: { videoRatio: '16:9' },
    }),
    expect.objectContaining({
      when: { kind: 'option', groupKey: 'videoRatio', optionValue: '9:16' },
      operationId: 'update_project_config',
      input: { videoRatio: '9:16' },
    }),
    expect.objectContaining({
      when: { kind: 'option', groupKey: 'videoRatio', optionValue: '21:9' },
      operationId: 'update_project_config',
      input: { videoRatio: '21:9' },
    }),
  ])
  expect(awaitingChoice.tasks).toHaveLength(0)
  expect(awaitingChoice.resources).toHaveLength(0)

  await page.getByRole('button', { name: /16:9 横屏/ }).filter({ visible: true }).last().click()
  await page.getByRole('button', { name: '保存本次画面比例', exact: true }).filter({ visible: true }).click()
  await expect.poll(async () => asRecord((await readGoldenOracleSnapshot(scope)).project)?.videoRatio, {
    timeout: 60_000,
    message: 'the selected ratio must be written only by the Choice commitment',
  }).toBe('16:9')
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

async function waitForSchemaResource(
  scope: GoldenWorkspaceScope,
  schemaId: string,
): Promise<Record<string, unknown>> {
  let matching: Record<string, unknown> | undefined
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(scope)
    matching = snapshot.resources.find((resource) => resource.schemaId === schemaId)
    return {
      status: matching?.status ?? null,
      runStatus: snapshot.runs.at(-1)?.status ?? null,
    }
  }, {
    timeout: 120_000,
    message: `${schemaId} must be materialized as one ready Resource by the completed Creative Task`,
  }).toEqual({ status: 'ready', runStatus: 'completed' })
  if (!matching) throw new Error(`GOLDEN_SCHEMA_RESOURCE_MISSING:${schemaId}`)
  return matching
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
  await resolveInitialVideoRatioChoice(page, scope)
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
    expect(afterRetry.resourceRevisions
      .filter((revision) => revision.resourceId === failedResourceId)
      .map((revision) => revision.prompt)).toEqual([
      'A cinematic midnight shrine in mist, wide composition.',
    ])
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

  const imageTaskCountBeforeCreativeJudgment = (await readGoldenOracleSnapshot(scope)).tasks
    .filter((task) => task.type === TASK_TYPE.CREATIVE_RESOURCE_IMAGE).length

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_SCREENPLAY_REQUEST)
  const screenplayResource = await waitForSchemaResource(scope, CREATIVE_RESOURCE_SCHEMA.SOURCE_SCRIPT)
  const afterScreenplay = await readGoldenOracleSnapshot(scope)
  const screenplayRevision = afterScreenplay.resourceRevisions.find((revision) => (
    revision.resourceId === screenplayResource.id
  ))
  const screenplayTask = afterScreenplay.tasks.find((task) => (
    task.id === screenplayRevision?.taskId && task.type === TASK_TYPE.CREATIVE_WORK
  ))
  expect(screenplayTask).toMatchObject({ status: 'completed', operationId: 'delegate_creative_work' })
  expect(screenplayRevision).toMatchObject({
    resourceId: screenplayResource.id,
    generationOptions: { outputKind: 'screenplay_draft', estimatedDurationSeconds: 240 },
  })
  expect(afterScreenplay.domain.sourceDocuments).toHaveLength(0)
  expect(afterScreenplay.domain.bibles).toHaveLength(0)
  expect(afterScreenplay.domain.chapters).toHaveLength(0)

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_STYLE_BIBLE_REQUEST)
  const styleResource = await waitForSchemaResource(scope, CREATIVE_RESOURCE_SCHEMA.STYLE_BIBLE)
  const afterStyle = await readGoldenOracleSnapshot(scope)
  const styleRevision = afterStyle.resourceRevisions.find((revision) => revision.resourceId === styleResource.id)
  expect(styleRevision).toMatchObject({
    resourceId: styleResource.id,
    generationOptions: { outputKind: 'style_bible' },
  })
  expect(afterStyle.tasks.filter((task) => task.type === TASK_TYPE.CREATIVE_RESOURCE_IMAGE))
    .toHaveLength(imageTaskCountBeforeCreativeJudgment)
  expect(afterStyle.domain.chapters).toHaveLength(0)

  const taskIdsBeforeChoice = afterStyle.tasks.map((task) => task.id)
  const resourceIdsBeforeChoice = afterStyle.resources.map((resource) => resource.id)
  await sendNaturalLanguage(page, GOLDEN_FREEFORM_STYLE_CHOICE_REQUEST)
  await expect.poll(async () => await readGoldenPendingInteractionOperationId(page, scope), {
    timeout: 60_000,
    message: 'the model-authored Choice must suspend only the current Style Bible decision',
  }).toBe('request_choice')
  const awaitingStyleChoice = await readGoldenOracleSnapshot(scope)
  const activityIdsBeforeChoiceDecision = new Set(awaitingStyleChoice.activities.map((activity) => activity.id))
  const pendingStyleChoice = awaitingStyleChoice.interruptions.find((interruption) => (
    interruption.type === 'choice' && interruption.status === 'pending'
  ))
  const choiceOffer = asRecord(pendingStyleChoice?.payload)
  const choiceCard = asRecord(choiceOffer?.card)
  const choiceSubject = asRecord(choiceOffer?.subject)
  const choiceCommitments = Array.isArray(choiceOffer?.commitments) ? choiceOffer.commitments : []
  expect(choiceCard).toMatchObject({
    mode: 'select',
    title: '是否采用当前 Style Bible？',
    description: '这里只决定当前视觉规则是否成为项目采用版本。',
    submitLabel: '提交本次视觉风格选择',
  })
  expect(choiceSubject).toMatchObject({
    kind: 'resource_revisions',
    revisions: [{ resourceId: styleResource.id, revisionId: styleRevision?.id }],
  })
  expect(choiceCommitments).toEqual([expect.objectContaining({
    when: { kind: 'option', groupKey: 'styleDecision', optionValue: 'adopt' },
    operationId: 'adopt_style_bible',
  })])
  await page.getByRole('button', { name: /\u91c7\u7528\u8fd9\u4efd Style Bible/ }).click()
  await page.getByRole('button', { name: '提交本次视觉风格选择', exact: true }).click()
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(scope)
    return snapshot.resourceBindings.filter((binding) => binding.role === 'adopted_style_bible').length
  }, {
    timeout: 60_000,
    message: 'the selected Choice commitment must atomically adopt only the exact Style Bible revision',
  }).toBe(1)
  await waitForAgentRunSettlement(scope)
  const afterStyleChoice = await readGoldenOracleSnapshot(scope)
  expect(afterStyleChoice.resourceBindings.find((binding) => binding.role === 'adopted_style_bible')).toMatchObject({
    slotKey: 'primary',
    resourceId: styleResource.id,
    revisionId: styleRevision?.id,
  })
  expect(afterStyleChoice.tasks.map((task) => task.id)).toEqual(taskIdsBeforeChoice)
  expect(afterStyleChoice.resources.map((resource) => resource.id)).toEqual(resourceIdsBeforeChoice)
  expect(afterStyleChoice.activities
    .filter((activity) => !activityIdsBeforeChoiceDecision.has(activity.id))
    .filter((activity) => activity.operationId !== 'list_resources')
    .map((activity) => activity.operationId)).toEqual(['adopt_style_bible'])
  expect(afterStyleChoice.domain.bibles).toHaveLength(0)
  expect(afterStyleChoice.domain.chapters).toHaveLength(0)

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_CHAPTER_PLAN_REQUEST)
  const chapterPlanResource = await waitForSchemaResource(scope, CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN)
  const afterChapterPlan = await readGoldenOracleSnapshot(scope)
  const chapterPlanRevision = afterChapterPlan.resourceRevisions.find((revision) => (
    revision.resourceId === chapterPlanResource.id
  ))
  expect(afterChapterPlan.tasks.find((task) => task.id === chapterPlanRevision?.taskId)).toMatchObject({
    type: TASK_TYPE.CREATIVE_WORK,
    status: 'completed',
    operationId: 'delegate_creative_work',
  })
  expect(afterChapterPlan.resourceLineage.filter((lineage) => (
    lineage.outputRevisionId === chapterPlanRevision?.id
  ))).toEqual([expect.objectContaining({
    inputRevisionId: screenplayRevision?.id,
    role: 'source_material',
  })])
  expect(afterChapterPlan.domain.chapters).toHaveLength(0)

  await sendNaturalLanguage(page, GOLDEN_FREEFORM_ADOPT_CHAPTERS_REQUEST)
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(scope)
    const failedAdoption = snapshot.activities.find((activity) => (
      activity.operationId === 'adopt_chapters' && activity.status === 'failed'
    ))
    if (failedAdoption) {
      throw new Error(`adopt_chapters failed: ${String(failedAdoption.errorMessage)}`)
    }
    return {
      runStatus: snapshot.runs.at(-1)?.status ?? null,
      chapters: snapshot.domain.chapters.map((chapter) => chapter.targetDurationSec),
    }
  }, {
    timeout: 60_000,
    message: 'Chapter projection must appear only after the explicit adopt_chapters operation',
  }).toEqual({ runStatus: 'completed', chapters: [120, 120] })
  const afterChapterAdoption = await readGoldenOracleSnapshot(scope)
  expect(afterChapterAdoption.domain.sourceDocuments).toHaveLength(1)
  expect(afterChapterAdoption.domain.sourceDocuments[0]).toMatchObject({
    sourceResourceId: screenplayResource.id,
    sourceRevisionId: screenplayRevision?.id,
    sourceFingerprint: screenplayRevision?.fingerprint,
  })
  expect(afterChapterAdoption.domain.bibles).toHaveLength(0)
  expect(afterChapterAdoption.domain.chapters).toEqual([
    expect.objectContaining({ chapterIndex: 0, targetDurationSec: 120 }),
    expect.objectContaining({ chapterIndex: 1, targetDurationSec: 120 }),
  ])
  expect(afterChapterAdoption.tasks.filter((task) => task.type === TASK_TYPE.CREATIVE_RESOURCE_IMAGE))
    .toHaveLength(imageTaskCountBeforeCreativeJudgment)

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
  expect(finalSnapshot.resourceBindings.map((binding) => binding.role).sort()).toEqual([
    'adopted_style_bible',
    'primary_image',
  ])

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
  await resolveInitialVideoRatioChoice(page, scope)
  await approveOperation(page, scope, 'create_video')
  await waitForResources(scope, 'video', 1)
  const snapshot = await readGoldenOracleSnapshot(scope)
  expect(snapshot.domain.sourceDocuments).toHaveLength(0)
  expect(snapshot.domain.bibles).toHaveLength(0)
  expect(snapshot.domain.chapters).toHaveLength(0)
  expect(snapshot.tasks.filter((task) => task.type === TASK_TYPE.CREATIVE_RESOURCE_VIDEO)).toHaveLength(1)
  expect(snapshot.tasks.some((task) => task.type === TASK_TYPE.CREATIVE_WORK)).toBe(false)
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
  await resolveInitialVideoRatioChoice(page, scope)

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

  await submitGoldenApproval(page)
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
