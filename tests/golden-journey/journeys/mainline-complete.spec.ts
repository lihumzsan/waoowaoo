import { expect, test } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import { launchGoldenStoryFromHome } from '../browser/pages/home'
import {
  readGoldenMainlineBoundary,
  readGoldenWorkflowStage,
  reloadGoldenBoundary,
  submitGoldenBoundary,
  type GoldenMainlineBoundary,
} from '../browser/pages/workspace'
import { GOLDEN_EDIT_FIRST_WORKFLOW_STAGES } from '../contracts/stages'
import { attachGoldenOracleEvidence } from '../oracle/evidence'
import { readGoldenOracleSnapshot } from '../oracle/reader'
import type { GoldenOracleSnapshot } from '../oracle/types'
import { setGoldenMediaStatusDelay, setGoldenStreamPacing } from '../providers/control'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { TASK_TYPE } from '@/lib/task/types'

const USER_BOUNDARIES = new Set<GoldenMainlineBoundary>([
  'script_intake',
  'script_review',
  'bible_review',
  'style_choice',
  'asset_review',
  'approval',
])

const CANVAS_STREAM_CONTINUITY_KEY = 'golden:canvas-stream-continuity'

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function assertOperationGroupWait(
  oracle: GoldenOracleSnapshot,
  operationIds: readonly string[],
): readonly Record<string, unknown>[] {
  const expectedOperations = new Set(operationIds)
  const tasks = oracle.tasks.filter((task) => (
    typeof task.operationId === 'string' && expectedOperations.has(task.operationId)
  ))
  expect(new Set(tasks.map((task) => task.operationId))).toEqual(expectedOperations)
  const taskIds = new Set(tasks.flatMap((task) => typeof task.id === 'string' ? [task.id] : []))
  expect(taskIds.size).toBe(operationIds.length)
  const waits = oracle.waits.filter((wait) => {
    const rawTaskIds = typeof wait.taskIds === 'string' ? JSON.parse(wait.taskIds) as unknown : wait.taskIds
    return Array.isArray(rawTaskIds)
      && rawTaskIds.length === taskIds.size
      && rawTaskIds.every((taskId) => typeof taskId === 'string' && taskIds.has(taskId))
  })
  expect(waits).toHaveLength(1)
  return tasks
}

async function installCanvasStreamContinuityObserver(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(({ storageKey }) => {
    interface ContinuityState {
      readonly seenIds: string[]
      readonly missingIds: string[]
      readonly presentationGapIds: string[]
      readonly prematureCollapseIds: string[]
      readonly ownershipMismatchIds: string[]
    }
    const emptyState = (): ContinuityState => ({
      seenIds: [],
      missingIds: [],
      presentationGapIds: [],
      prematureCollapseIds: [],
      ownershipMismatchIds: [],
    })
    const readState = (): ContinuityState => {
      const raw = window.sessionStorage.getItem(storageKey)
      if (!raw) return emptyState()
      try {
        return { ...emptyState(), ...JSON.parse(raw) as Partial<ContinuityState> }
      } catch {
        return emptyState()
      }
    }
    let unloading = false
    const documentSeenIds = new Set<string>()
    const documentPendingHandoffTaskIdsByNodeId = new Map<string, string>()
    window.addEventListener('pagehide', () => { unloading = true }, { once: true })
    const observe = (): void => {
      const check = (): void => {
        if (unloading) return
        const state = readState()
        const seenIds = new Set(state.seenIds)
        const missingIds = new Set(state.missingIds)
        const presentationGapIds = new Set(state.presentationGapIds)
        const prematureCollapseIds = new Set(state.prematureCollapseIds)
        const ownershipMismatchIds = new Set(state.ownershipMismatchIds)
        document.querySelectorAll('article[data-node-id][data-lifecycle-phase="streaming"]').forEach((node) => {
          const nodeId = node.getAttribute('data-node-id')
          if (nodeId) {
            seenIds.add(nodeId)
            documentSeenIds.add(nodeId)
            const taskId = node.getAttribute('data-lifecycle-task-id')
            if (taskId) documentPendingHandoffTaskIdsByNodeId.set(nodeId, taskId)
          }
        })
        const currentNodes = new Map(Array.from(
          document.querySelectorAll('article[data-node-id]'),
          (node) => [node.getAttribute('data-node-id'), node] as const,
        ).filter((entry): entry is readonly [string, Element] => Boolean(entry[0])))
        seenIds.forEach((nodeId) => {
          if (currentNodes.has(nodeId)) documentSeenIds.add(nodeId)
        })
        documentSeenIds.forEach((nodeId) => {
          const node = currentNodes.get(nodeId)
          if (!node) {
            missingIds.add(nodeId)
            return
          }
          const phase = node.getAttribute('data-lifecycle-phase')
          const streamPresentation = node.getAttribute('data-stream-presentation')
          const disclosureMode = node.getAttribute('data-disclosure-mode')
          const pendingHandoffTaskId = documentPendingHandoffTaskIdsByNodeId.get(nodeId)
          if (!pendingHandoffTaskId) return
          const isTerminal = phase === 'succeeded' || phase === 'failed' || phase === 'canceled'
          if (!isTerminal && streamPresentation === 'none') presentationGapIds.add(nodeId)
          if (!isTerminal && disclosureMode === 'collapsed') prematureCollapseIds.add(nodeId)
          if (phase === 'succeeded' && streamPresentation === 'none') {
            const resourceTaskId = node.getAttribute('data-terminal-handoff-task-id')
            if (resourceTaskId === pendingHandoffTaskId) {
              documentPendingHandoffTaskIdsByNodeId.delete(nodeId)
            } else {
              ownershipMismatchIds.add(nodeId)
            }
          } else if ((phase === 'failed' || phase === 'canceled') && streamPresentation === 'none') {
            documentPendingHandoffTaskIdsByNodeId.delete(nodeId)
          }
        })
        window.sessionStorage.setItem(storageKey, JSON.stringify({
          seenIds: [...seenIds],
          missingIds: [...missingIds],
          presentationGapIds: [...presentationGapIds],
          prematureCollapseIds: [...prematureCollapseIds],
          ownershipMismatchIds: [...ownershipMismatchIds],
        }))
      }
      check()
      new MutationObserver(check).observe(document.documentElement, {
        attributes: true,
        attributeFilter: [
          'data-lifecycle-phase',
          'data-lifecycle-task-id',
          'data-terminal-handoff-task-id',
          'data-stream-presentation',
          'data-disclosure-mode',
        ],
        childList: true,
        subtree: true,
      })
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', observe, { once: true })
    } else {
      observe()
    }
  }, { storageKey: CANVAS_STREAM_CONTINUITY_KEY })
}

async function readCanvasStreamContinuity(page: import('@playwright/test').Page): Promise<{
  readonly seenIds: string[]
  readonly missingIds: string[]
  readonly presentationGapIds: string[]
  readonly prematureCollapseIds: string[]
  readonly ownershipMismatchIds: string[]
}> {
  return await page.evaluate((storageKey) => {
    const raw = window.sessionStorage.getItem(storageKey)
    return raw
      ? JSON.parse(raw) as {
          seenIds: string[]
          missingIds: string[]
          presentationGapIds: string[]
          prematureCollapseIds: string[]
          ownershipMismatchIds: string[]
        }
      : {
          seenIds: [],
          missingIds: [],
          presentationGapIds: [],
          prematureCollapseIds: [],
          ownershipMismatchIds: [],
        }
  }, CANVAS_STREAM_CONTINUITY_KEY)
}

interface GoldenScope {
  readonly projectId: string
  readonly episodeId: string
}

async function readGoldenEditBibleId(scope: GoldenScope): Promise<string> {
  const snapshot = await readGoldenOracleSnapshot(scope)
  const id = snapshot.domain.bibles[0]?.id
  if (typeof id !== 'string' || !id.trim()) throw new Error('GOLDEN_EDIT_BIBLE_ID_MISSING')
  return id
}

async function assertStyleDirectionGeneration(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: GoldenScope
}): Promise<void> {
  const bibleId = await readGoldenEditBibleId(input.scope)
  const styleBibleNode = input.page.locator(`article[data-node-id="${workspaceNodeId.editStyleBible(bibleId)}"]`)
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(input.scope)
    const taskRunning = snapshot.tasks.some((task) => (
      task.type === TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE
      && (task.status === 'queued' || task.status === 'processing')
    ))
    const phase = await styleBibleNode.getAttribute('data-lifecycle-phase')
    return taskRunning
      && await input.page.getByText('进行中 · 1 个任务', { exact: true }).count() === 1
      && await input.page.getByText('生成视觉风格方案', { exact: true }).count() >= 1
      && await styleBibleNode.count() === 1
      && /^(queued|processing)$/.test(phase ?? '')
      && (await styleBibleNode.textContent())?.includes('Style Bible 生成中') === true
  }, {
    timeout: 60_000,
    message: 'the running style Task must be visible in Assistant and the canonical Style Bible node',
  }).toBe(true)
}

async function assertStylePreviewGeneration(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: GoldenScope
}): Promise<void> {
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(input.scope)
    const tasks = snapshot.tasks.filter((task) => task.type === TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE)
    return tasks.length === 3
      && tasks.every((task) => task.status === 'queued' || task.status === 'processing')
  }, {
    timeout: 30_000,
    message: 'style Approval must durably submit all three preview images',
  }).toBe(true)
  await expect(input.page.getByText('正在生成视觉风格候选图', { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(input.page.getByText('暮色手绘惊悚', { exact: true })).toBeVisible()
  await expect(input.page.getByText('风格化立体寓言', { exact: true })).toBeVisible()
  await expect(input.page.getByText('剪纸影戏迷局', { exact: true })).toBeVisible()
  const bibleId = await readGoldenEditBibleId(input.scope)
  const styleBibleNode = input.page.locator(`article[data-node-id="${workspaceNodeId.editStyleBible(bibleId)}"]`)
  await expect(styleBibleNode).toHaveCount(1)
  await expect.poll(async () => styleBibleNode.getAttribute('data-lifecycle-phase'), {
    timeout: 30_000,
    message: 'preview targets must aggregate into the canonical Style Bible node',
  }).toMatch(/^(queued|processing)$/)
  await expect(input.page.locator('article[data-node-id^="edit-style-preview:"]')).toHaveCount(0)
}

async function assertParallelPlanning(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: GoldenScope
}): Promise<void> {
  await expect.poll(async () => {
    const snapshot = await readGoldenOracleSnapshot(input.scope)
    const groupedTasks = snapshot.tasks.filter((task) => (
      task.operationId === 'plan_chapters' || task.operationId === 'generate_edit_script_assets'
    ))
    const operationIds = new Set(groupedTasks.map((task) => task.operationId))
    const taskIds = new Set(groupedTasks.flatMap((task) => typeof task.id === 'string' ? [task.id] : []))
    const matchingWaits = snapshot.waits.filter((wait) => {
      const rawTaskIds = typeof wait.taskIds === 'string' ? JSON.parse(wait.taskIds) as unknown : wait.taskIds
      return Array.isArray(rawTaskIds)
        && rawTaskIds.length === taskIds.size
        && rawTaskIds.every((taskId) => typeof taskId === 'string' && taskIds.has(taskId))
    })
    return operationIds.has('plan_chapters')
      && operationIds.has('generate_edit_script_assets')
      && taskIds.size >= 2
      && matchingWaits.length === 1
  }, {
    timeout: 90_000,
    message: 'core planning and planned assets must share one durable Wait',
  }).toBe(true)

  const surfaces = input.page.locator(
    'article[data-node-id^="edit-asset-group:"] [data-canvas-media-surface="true"]',
  )
  await expect.poll(async () => {
    if (await surfaces.count() === 0) return false
    return await surfaces.evaluateAll((items) => items.some((surface) => (
      surface.getAttribute('data-canvas-media-phase') === 'generating'
      && surface.getAttribute('data-canvas-media-background') === 'style-bible'
      && surface.getAttribute('data-canvas-media-placeholder-visible') === 'false'
      && surface.querySelector('[role="progressbar"]') !== null
    )))
  }, {
    timeout: 60_000,
    message: 'running planned assets must use the shared Style Bible progress surface',
  }).toBe(true)

  const editScriptNodes = input.page.locator('article[data-node-id^="edit-script:"]')
  await expect.poll(async () => await editScriptNodes.evaluateAll((nodes) => nodes.some((node) => (
    node.getAttribute('data-lifecycle-phase') === 'streaming'
    && node.querySelector('.workspace-node-loading-surface') === null
  ))), {
    timeout: 60_000,
    message: 'core edit scripts must use structured text streaming without a media loading fallback',
  }).toBe(true)
}

async function assertShotExecutionPlansMaterializeAndSurviveReload(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: GoldenScope
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
    return runningTargetIds.length >= 2
  }, {
    timeout: 30_000,
    message: 'multi-chapter asset approval must submit at least two durable shot-plan Tasks',
  }).toBe(true)

  const assertRunningNodes = async (): Promise<void> => {
    await expect(input.page.locator('article[data-node-id^="edit-shot-execution-plan:edit-script:"]'))
      .toHaveCount(runningTargetIds.length, { timeout: 30_000 })
    for (const targetId of runningTargetIds) {
      const node = input.page.locator(
        `article[data-node-id="${workspaceNodeId.editShotExecutionPlan(targetId)}"]`,
      )
      await expect(node).toHaveCount(1)
      await expect(node).toHaveAttribute('data-lifecycle-phase', /^(queued|processing|streaming)$/)
    }
  }

  await assertRunningNodes()
  await input.page.reload({ waitUntil: 'domcontentloaded' })
  await assertRunningNodes()
}

async function assertRunningShotMediaSurfaces(page: import('@playwright/test').Page): Promise<void> {
  const surfaces = page.locator('article[data-node-id^="shot:"] [data-canvas-media-surface="true"]')
  await expect.poll(async () => {
    if (await surfaces.count() === 0) return false
    return await surfaces.evaluateAll((items) => items.every((surface) => (
      surface.getAttribute('data-canvas-media-phase') === 'generating'
      && surface.getAttribute('data-canvas-media-background') === 'style-bible'
      && surface.getAttribute('data-canvas-media-placeholder-visible') === 'false'
      && surface.querySelector('[role="progressbar"]') !== null
    )))
  }, {
    timeout: 60_000,
    message: 'running shot media must use the shared Style Bible progress surface',
  }).toBe(true)
}

async function assertAudioNodeVisibility(
  page: import('@playwright/test').Page,
  expectedCount: 0 | 1,
): Promise<void> {
  await expect(page.locator('article[data-node-id^="bgm-score:"]')).toHaveCount(expectedCount, { timeout: 30_000 })
  await expect(page.locator('article[data-node-id^="soundscape:"]')).toHaveCount(expectedCount, { timeout: 30_000 })
}

async function assertAllScopeVideoProjection(
  page: import('@playwright/test').Page,
  videoGroups: readonly Record<string, unknown>[],
): Promise<void> {
  expect(videoGroups.length, 'main Journey must persist at least one continuous video group').toBeGreaterThan(0)
  expect(videoGroups.every((group) => (
    group.status === 'completed'
    && typeof group.videoUrl === 'string'
    && group.videoUrl.length > 0
    && typeof group.videoMediaId === 'string'
    && group.videoMediaId.length > 0
  )), 'every durable video group must have a completed media output').toBe(true)
  await expect(page.locator('article[data-node-id^="video-plan:"]')).toHaveCount(videoGroups.length)
  await expect(page.locator('article[data-node-id^="video-plan:"] video[src]')).toHaveCount(videoGroups.length)
}

async function submitObservedBoundary(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: GoldenScope
  readonly boundary: GoldenMainlineBoundary
  readonly workflowStage: EditFirstWorkflowStage
}): Promise<void> {
  if (input.boundary === 'bible_review') {
    await setGoldenStreamPacing({ chunkSize: 5, delayMs: 15 })
    try {
      await submitGoldenBoundary(input.page, input.boundary)
      await assertStyleDirectionGeneration(input)
    } finally {
      await setGoldenStreamPacing(null)
    }
    return
  }

  if (input.boundary === 'style_choice') {
    const bibleId = await readGoldenEditBibleId(input.scope)
    const styleBibleNode = input.page.locator(`article[data-node-id="${workspaceNodeId.editStyleBible(bibleId)}"]`)
    await expect(styleBibleNode).toHaveAttribute('data-lifecycle-phase', 'succeeded')
    await expect(input.page.getByRole('button', { name: '选择这个风格', exact: true }).filter({ visible: true })).toHaveCount(1)
    await expect(input.page.getByRole('button', { name: '确认并继续', exact: true }).filter({ visible: true })).toHaveCount(0)
    await submitGoldenBoundary(input.page, input.boundary)
    await expect.poll(async () => await readGoldenWorkflowStage(input.page, input.scope), {
      timeout: 60_000,
      message: 'style choice must be durably consumed before the Journey reloads the boundary',
    }).not.toBe('needs_style_choice')
    await expect(styleBibleNode).toHaveAttribute('data-lifecycle-phase', 'succeeded', { timeout: 30_000 })
    await input.page.reload({ waitUntil: 'domcontentloaded' })
    await expect(styleBibleNode).toHaveAttribute('data-lifecycle-phase', 'succeeded')
    await expect(input.page.locator('article[data-node-id^="edit-style-preview:"]')).toHaveCount(0)
    return
  }

  if (input.boundary === 'asset_review') {
    await expect(input.page.getByText('已就绪资产', { exact: true })).toHaveCount(0)
    await setGoldenStreamPacing({ chunkSize: 1, delayMs: 10 })
    try {
      await submitGoldenBoundary(input.page, input.boundary)
      await assertShotExecutionPlansMaterializeAndSurviveReload(input)
    } finally {
      await setGoldenStreamPacing(null)
    }
    return
  }

  if (input.boundary === 'approval' && input.workflowStage === 'ready_to_generate_style_previews') {
    await setGoldenMediaStatusDelay(15_000)
    try {
      await submitGoldenBoundary(input.page, input.boundary)
      await assertStylePreviewGeneration(input)
    } finally {
      await setGoldenMediaStatusDelay(0)
    }
    return
  }

  if (input.boundary === 'approval' && input.workflowStage === 'ready_to_generate_edit_script') {
    await setGoldenMediaStatusDelay(15_000)
    await setGoldenStreamPacing({ chunkSize: 5, delayMs: 10 })
    try {
      await submitGoldenBoundary(input.page, input.boundary)
      await assertParallelPlanning(input)
    } finally {
      await setGoldenStreamPacing(null)
      await setGoldenMediaStatusDelay(0)
    }
    return
  }

  if (input.boundary === 'approval' && input.workflowStage === 'ready_to_generate_storyboard_images') {
    await setGoldenMediaStatusDelay(15_000)
    try {
      await submitGoldenBoundary(input.page, input.boundary)
      await assertRunningShotMediaSurfaces(input.page)
    } finally {
      await setGoldenMediaStatusDelay(0)
    }
    return
  }

  await submitGoldenBoundary(input.page, input.boundary)
}

test('[GJ-MAIN-STORY-TO-FINAL-DELIVERABLE] real multi-chapter browser journey reaches a durable final video', async ({
  page,
  browserObservations,
}, testInfo) => {
  test.setTimeout(30 * 60_000)
  await installCanvasStreamContinuityObserver(page)
  await registerGoldenUser(page, {
    username: `golden-complete-${String(Date.now())}`,
    password: 'golden-complete-password',
  })
  const scope = await launchGoldenStoryFromHome(page, '恐怖故事')
  const visitedBoundaries: GoldenMainlineBoundary[] = []
  const visitedStages: EditFirstWorkflowStage[] = []
  const reloadedTaskStages = new Set<EditFirstWorkflowStage>()
  let reloadedCompletedStage = false
  let observedAudioHiddenBeforeVideos = false
  let observedAudioVisibleAtAudioStage = false
  let lastBoundary: GoldenMainlineBoundary = 'waiting'
  const deadline = Date.now() + 25 * 60_000

  while (Date.now() < deadline) {
    const workflowStage = await readGoldenWorkflowStage(page, scope)
    if (workflowStage === 'failed') {
      await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-failed-stage')
      throw new Error(`GOLDEN_MAINLINE_FAILED_STAGE:boundaries=${visitedBoundaries.join(',')}:stages=${visitedStages.join(',')}`)
    }
    if (workflowStage === 'completed' && !reloadedCompletedStage) {
      reloadedCompletedStage = true
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(async () => await readGoldenMainlineBoundary(page), {
        timeout: 30_000,
        message: 'final output must survive reload',
      }).toBe('final_output')
    }
    if (visitedStages.at(-1) !== workflowStage) {
      visitedStages.push(workflowStage)
      await testInfo.attach(`stage-${String(visitedStages.length)}-${workflowStage}`, {
        body: Buffer.from(JSON.stringify(await readGoldenOracleSnapshot(scope), null, 2)),
        contentType: 'application/json',
      })
      if (workflowStage === 'ready_to_generate_videos') {
        await assertAudioNodeVisibility(page, 0)
        observedAudioHiddenBeforeVideos = true
      }
      if (workflowStage === 'ready_to_plan_audio_layers' || workflowStage === 'audio_layers_planning') {
        await assertAudioNodeVisibility(page, 1)
        observedAudioVisibleAtAudioStage = true
      }
      if (
        (
          workflowStage.endsWith('_generating')
          || workflowStage.endsWith('_planning')
          || workflowStage.endsWith('_rendering')
        )
        && !reloadedTaskStages.has(workflowStage)
      ) {
        reloadedTaskStages.add(workflowStage)
        const minimumIndex = GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(workflowStage)
        await page.reload({ waitUntil: 'domcontentloaded' })
        await expect.poll(async () => {
          const restored = await readGoldenWorkflowStage(page, scope)
          return restored !== 'failed' && GOLDEN_EDIT_FIRST_WORKFLOW_STAGES.indexOf(restored) >= minimumIndex
        }, {
          timeout: 30_000,
          message: `processing stage ${workflowStage} must recover or advance after reload`,
        }).toBe(true)
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
      expect(oracle.domain.chapters.length, 'main Journey must exercise multiple chapters').toBeGreaterThanOrEqual(2)
      expect(oracle.domain.editScripts.length, 'each chapter must have a durable edit script').toBe(oracle.domain.chapters.length)
      expect(oracle.domain.shotExecutionPlans.length, 'each chapter must have a durable shot plan').toBe(oracle.domain.chapters.length)
      expect(oracle.domain.storyboards.length, 'each ready shot plan must atomically materialize one storyboard').toBe(oracle.domain.chapters.length)
      expect(oracle.domain.panels.length, 'automatic storyboard projection must materialize multiple panels').toBeGreaterThan(oracle.domain.chapters.length)
      await assertAllScopeVideoProjection(page, oracle.domain.videoGroups)
      expect(
        oracle.tasks.some((task) => task.operationId === 'generate_edit_script_storyboard'),
        'automatic storyboard projection must not create the removed standalone panel Task',
      ).toBe(false)
      expect(oracle.domain.assetRequirements.length, 'main Journey must exercise multiple planned assets').toBeGreaterThanOrEqual(2)
      const audioPlanTasks = assertOperationGroupWait(oracle, [
        'plan_episode_bgm_score',
        'plan_episode_soundscape',
      ])
      expect(audioPlanTasks.map((task) => task.type).sort()).toEqual([
        TASK_TYPE.MUSIC_SCORE_PLAN,
        TASK_TYPE.SOUNDSCAPE_PLAN,
      ].sort())
      expect(audioPlanTasks.every((task) => task.approvalGrantId === null)).toBe(true)
      const audioGenerationTasks = assertOperationGroupWait(oracle, [
        'generate_episode_bgm_score',
        'generate_episode_soundscape',
      ])
      expect(audioGenerationTasks.map((task) => task.type).sort()).toEqual([
        TASK_TYPE.MUSIC_SCORE_GENERATE,
        TASK_TYPE.SOUNDSCAPE_GENERATE,
      ].sort())
      expect(audioGenerationTasks.every((task) => typeof task.approvalGrantId === 'string')).toBe(true)
      const audioGenerationOperationIds = [
        'generate_episode_bgm_score',
        'generate_episode_soundscape',
      ]
      expect(oracle.approvalGrants
        .flatMap((grant) => typeof grant.operationId === 'string' && audioGenerationOperationIds.includes(grant.operationId)
          ? [grant.operationId]
          : [])
        .sort()).toEqual([...audioGenerationOperationIds].sort())
      expect(oracle.operationExecutions
        .flatMap((execution) => typeof execution.operationId === 'string' && audioGenerationOperationIds.includes(execution.operationId)
          ? [execution.operationId]
          : [])
        .sort()).toEqual([...audioGenerationOperationIds].sort())
      const musicScore = oracle.domain.musicScores[0]
      const musicScoreData = asRecord(musicScore?.cuesJson)
      expect(oracle.domain.musicScores).toHaveLength(1)
      expect(musicScore).toMatchObject({ status: 'completed' })
      expect(asRecord(musicScoreData?.plan)).not.toBeNull()
      expect(asRecord(musicScore?.mixJson)).not.toBeNull()
      const soundscape = oracle.domain.soundscapes[0]
      expect(oracle.domain.soundscapes).toHaveLength(1)
      expect(soundscape).toMatchObject({ status: 'completed' })
      expect(asRecord(soundscape?.planJson)).toMatchObject({ decision: 'soundscape' })
      expect(asRecord(soundscape?.mixJson)).not.toBeNull()
      expect(oracle.domain.finalOutputs.length, 'final output must be durable').toBe(1)
      expect(observedAudioHiddenBeforeVideos, 'main Journey must observe hidden audio nodes before video generation').toBe(true)
      expect(observedAudioVisibleAtAudioStage, 'main Journey must observe audio nodes at the audio stage').toBe(true)
      const streamContinuity = await readCanvasStreamContinuity(page)
      expect(streamContinuity.seenIds.length, 'main Journey must observe at least one structured-stream Canvas node').toBeGreaterThan(0)
      expect(streamContinuity.missingIds, 'a streamed canonical node must never disappear before formal Query handoff').toEqual([])
      expect(streamContinuity.presentationGapIds, 'stream presentation must remain until the exact formal Query resource takes over').toEqual([])
      expect(streamContinuity.prematureCollapseIds, 'stream disclosure must stay expanded throughout terminal handoff').toEqual([])
      expect(streamContinuity.ownershipMismatchIds, 'formal Query takeover must belong to the same Task as the observed stream').toEqual([])
      expect(oracle.identities.duplicateMessageIds).toHaveLength(0)
      expect(oracle.identities.duplicateToolCallIds).toHaveLength(0)
      browserObservations.assertClean()
      return
    }
    if (boundary === 'assistant_failure' || boundary === 'interaction_failure' || boundary === 'render_failure') {
      await attachGoldenOracleEvidence(testInfo, scope, `golden-oracle-${boundary}`)
      throw new Error(`GOLDEN_MAINLINE_BLOCKED:${boundary}:boundaries=${visitedBoundaries.join(',')}:stages=${visitedStages.join(',')}`)
    }
    if (USER_BOUNDARIES.has(boundary)) {
      await reloadGoldenBoundary(page, boundary)
      await submitObservedBoundary({ page, scope, boundary, workflowStage })
      await page.waitForTimeout(500)
      continue
    }
    await page.waitForTimeout(500)
  }

  await attachGoldenOracleEvidence(testInfo, scope, 'golden-oracle-timeout')
  throw new Error(`GOLDEN_MAINLINE_TIMEOUT:boundaries=${visitedBoundaries.join(',')}:stages=${visitedStages.join(',')}`)
})
