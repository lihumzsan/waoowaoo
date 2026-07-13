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
    await expect(styleBibleNode).toHaveAttribute('data-lifecycle-phase', 'pending')
    await expect(input.page.getByRole('button', { name: '选择这个风格', exact: true }).filter({ visible: true })).toHaveCount(1)
    await expect(input.page.getByRole('button', { name: '确认并继续', exact: true }).filter({ visible: true })).toHaveCount(0)
    await submitGoldenBoundary(input.page, input.boundary)
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
      if (workflowStage === 'ready_to_generate_audio_layers') {
        await assertAudioNodeVisibility(page, 1)
        observedAudioVisibleAtAudioStage = true
      }
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
      expect(
        oracle.tasks.some((task) => task.operationId === 'generate_edit_script_storyboard'),
        'automatic storyboard projection must not create the removed standalone panel Task',
      ).toBe(false)
      expect(oracle.domain.assetRequirements.length, 'main Journey must exercise multiple planned assets').toBeGreaterThanOrEqual(2)
      expect(oracle.domain.finalOutputs.length, 'final output must be durable').toBe(1)
      expect(observedAudioHiddenBeforeVideos, 'main Journey must observe hidden audio nodes before video generation').toBe(true)
      expect(observedAudioVisibleAtAudioStage, 'main Journey must observe audio nodes at the audio stage').toBe(true)
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
