import { expect, test } from '../browser/test'
import {
  getGoldenApprovalButton,
  readGoldenAssistantRunStatus,
  readGoldenMainlineBoundary,
  readGoldenWorkflowProjection,
  readGoldenWorkflowStage,
  reloadGoldenBoundary,
  submitGoldenBoundary,
  type GoldenMainlineBoundary,
} from '../browser/pages/workspace'
import {
  forkGoldenWorkflowCheckpoint,
  listGoldenWorkflowCheckpointStages,
} from '../fixtures/workflow-lab'
import {
  readGoldenSourceFixtureManifest,
  writeGoldenSourceFixtureManifest,
  type GoldenSourceFixtureManifest,
} from '../fixtures/source-manifest'
import { attachGoldenOracleEvidence } from '../oracle/evidence'
import { readGoldenOracleSnapshot } from '../oracle/reader'
import { setGoldenMediaStatusDelay } from '../providers/control'
import { readFile } from 'node:fs/promises'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { GOLDEN_CHECKPOINTABLE_STAGES } from '../contracts/stages'
import { workspaceNodeId } from '@/features/project-workspace/canvas/workspace-canvas-node-ids'

interface GoldenStorageState {
  readonly cookies: Parameters<import('@playwright/test').BrowserContext['addCookies']>[0]
}

function toGoldenScope(scope: {
  readonly projectId: string
  readonly episodeId: string
}): { readonly projectId: string; readonly episodeId: string } {
  return {
    projectId: scope.projectId,
    episodeId: scope.episodeId,
  }
}

async function readGoldenEditBibleId(scope: {
  readonly projectId: string
  readonly episodeId: string
}): Promise<string> {
  const snapshot = await readGoldenOracleSnapshot(scope)
  const id = snapshot.domain.bibles[0]?.id
  if (typeof id !== 'string' || !id.trim()) throw new Error('GOLDEN_EDIT_BIBLE_ID_MISSING')
  return id
}

async function forkGoldenCheckpointWhenReady(input: {
  readonly page: import('@playwright/test').Page
  readonly context: import('@playwright/test').BrowserContext
  readonly stage: EditFirstWorkflowStage
  readonly testInfo: import('@playwright/test').TestInfo
}): Promise<{
  readonly source: GoldenSourceFixtureManifest
  readonly scope: { readonly projectId: string; readonly episodeId: string }
}> {
  const source = await readGoldenSourceFixtureManifest()
  const checkpointSource = source.checkpointSources?.[input.stage] ?? source.scope
  const authState = JSON.parse(await readFile(source.authStatePath, 'utf8')) as GoldenStorageState
  await input.context.addCookies(authState.cookies)
  await input.page.goto('/zh/home', { waitUntil: 'domcontentloaded' })
  const deadline = Date.now() + 3 * 60_000
  let lastMissing: Error | null = null
  while (Date.now() < deadline) {
    try {
      const scope = await forkGoldenWorkflowCheckpoint({
        page: input.page,
        source: checkpointSource,
        stage: input.stage,
      })
      const checkpointStages = await listGoldenWorkflowCheckpointStages({
        page: input.page,
        source: checkpointSource,
      })
      await writeGoldenSourceFixtureManifest({
        ...source,
        scope: toGoldenScope(scope),
        checkpointSources: {
          ...Object.fromEntries(checkpointStages.map((stage) => [stage, toGoldenScope(checkpointSource)])),
          ...source.checkpointSources,
        },
        createdAt: new Date().toISOString(),
      })
      await attachGoldenOracleEvidence(input.testInfo, checkpointSource, `golden-chain-source-${input.stage}`)
      return { source, scope }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes(`GOLDEN_STAGE_CHECKPOINT_MISSING:${input.stage}`)) {
        throw error
      }
      lastMissing = error
      await input.page.waitForTimeout(500)
    }
  }
  throw lastMissing ?? new Error(`GOLDEN_STAGE_CHECKPOINT_TIMEOUT:${input.stage}`)
}

async function submitGoldenCheckpointBoundary(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: { readonly projectId: string; readonly episodeId: string }
  readonly stage: EditFirstWorkflowStage
  readonly boundary: GoldenMainlineBoundary
}): Promise<void> {
  await input.page.goto(
    `/zh/workspace/${encodeURIComponent(input.scope.projectId)}?episode=${encodeURIComponent(input.scope.episodeId)}`,
    { waitUntil: 'domcontentloaded' },
  )
  await expect.poll(async () => await readGoldenWorkflowStage(input.page, input.scope), {
    timeout: 30_000,
  }).toBe(input.stage)
  if (input.boundary === 'approval') {
    await expect(getGoldenApprovalButton(input.page)).toBeVisible({ timeout: 30_000 })
    await input.page.reload({ waitUntil: 'domcontentloaded' })
    await expect(getGoldenApprovalButton(input.page)).toBeVisible({ timeout: 30_000 })
  } else {
    await expect.poll(async () => await readGoldenMainlineBoundary(input.page), {
      timeout: 30_000,
    }).toBe(input.boundary)
    await reloadGoldenBoundary(input.page, input.boundary)
  }
  await submitGoldenBoundary(input.page, input.boundary)
  await expect.poll(async () => await readGoldenWorkflowStage(input.page, input.scope), {
    timeout: 30_000,
    message: `${input.stage} must durably advance before the browser context closes`,
  }).not.toBe(input.stage)
}

async function openGoldenSourceScope(input: {
  readonly page: import('@playwright/test').Page
  readonly context: import('@playwright/test').BrowserContext
}): Promise<GoldenSourceFixtureManifest> {
  const source = await readGoldenSourceFixtureManifest()
  const authState = JSON.parse(await readFile(source.authStatePath, 'utf8')) as GoldenStorageState
  await input.context.addCookies(authState.cookies)
  await input.page.goto(
    `/zh/workspace/${encodeURIComponent(source.scope.projectId)}?episode=${encodeURIComponent(source.scope.episodeId)}`,
    { waitUntil: 'domcontentloaded' },
  )
  return source
}

async function recordGoldenCheckpointSources(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: { readonly projectId: string; readonly episodeId: string }
}): Promise<void> {
  const source = await readGoldenSourceFixtureManifest()
  const stableScope = toGoldenScope(input.scope)
  const checkpointStages = await listGoldenWorkflowCheckpointStages({
    page: input.page,
    source: stableScope,
  })
  await writeGoldenSourceFixtureManifest({
    ...source,
    scope: stableScope,
    checkpointSources: {
      ...Object.fromEntries(checkpointStages.map((stage) => [stage, stableScope])),
      ...source.checkpointSources,
    },
    createdAt: new Date().toISOString(),
  })
}

const GOLDEN_CHECKPOINTABLE_STAGE_SET = new Set<EditFirstWorkflowStage>(GOLDEN_CHECKPOINTABLE_STAGES)

async function preserveGoldenApprovalCheckpointSource(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: { readonly projectId: string; readonly episodeId: string }
  readonly stage: EditFirstWorkflowStage
}): Promise<void> {
  if (!GOLDEN_CHECKPOINTABLE_STAGE_SET.has(input.stage)) return
  const frozen = await forkGoldenWorkflowCheckpoint({
    page: input.page,
    source: input.scope,
    stage: input.stage,
  })
  if (frozen.checkpointKind !== 'approval') return
  const source = await readGoldenSourceFixtureManifest()
  await writeGoldenSourceFixtureManifest({
    ...source,
    checkpointSources: {
      ...source.checkpointSources,
      [input.stage]: {
        projectId: frozen.projectId,
        episodeId: frozen.episodeId,
      },
    },
    createdAt: new Date().toISOString(),
  })
}

async function wakeGoldenAssistantThroughUi(page: import('@playwright/test').Page): Promise<void> {
  const composer = page.getByPlaceholder('和 AI 一起创造')
  await composer.fill('继续执行当前工作流的下一步')
  await composer.press('Enter')
}

async function waitForGoldenBoundary(
  page: import('@playwright/test').Page,
  boundary: GoldenMainlineBoundary,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await readGoldenMainlineBoundary(page) === boundary) return true
    await page.waitForTimeout(250)
  }
  return false
}

async function driveGoldenDownstreamThroughUi(input: {
  readonly page: import('@playwright/test').Page
  readonly scope: { readonly projectId: string; readonly episodeId: string }
  readonly targetStage: EditFirstWorkflowStage
  readonly targetBoundary: GoldenMainlineBoundary
  readonly testInfo: import('@playwright/test').TestInfo
}): Promise<void> {
  const deadline = Date.now() + 8 * 60_000
  const wakeCountByStage = new Map<EditFirstWorkflowStage, number>()
  const preservedApprovalStages = new Set<EditFirstWorkflowStage>()
  let activeStepIdentity: string | null = null
  let activeStepVisit = 0
  let activeStepEnteredAt = 0
  let refreshedActiveVisit = false
  let wokenActiveVisit = false
  while (Date.now() < deadline) {
    const workflow = await readGoldenWorkflowProjection(input.page, input.scope)
    const stage = workflow.stage
    const stepIdentity = `${stage}:${workflow.nextActionId ?? 'no-next-action'}`
    if (stepIdentity !== activeStepIdentity) {
      activeStepIdentity = stepIdentity
      activeStepVisit += 1
      activeStepEnteredAt = Date.now()
      refreshedActiveVisit = false
      wokenActiveVisit = false
    }
    const boundary = await readGoldenMainlineBoundary(input.page)
    const visibleApprovalButton = getGoldenApprovalButton(input.page)
    const approvalVisible = await visibleApprovalButton.count() > 0
    const finalOutputVisible = await input.page.getByText(/最终成片|最终视频已完成|制作完成/).filter({ visible: true }).count() > 0
    const actionableBoundary: GoldenMainlineBoundary = approvalVisible
      ? 'approval'
      : finalOutputVisible
        ? 'final_output'
        : boundary
    if (approvalVisible && !preservedApprovalStages.has(stage)) {
      await preserveGoldenApprovalCheckpointSource({
        page: input.page,
        scope: input.scope,
        stage,
      })
      preservedApprovalStages.add(stage)
    }
    if (
      stage === input.targetStage
      && actionableBoundary === input.targetBoundary
    ) return
    const runStatus = await readGoldenAssistantRunStatus(input.page, input.scope)
    if (runStatus === 'awaiting_approval' && !approvalVisible) {
      await input.page.reload({ waitUntil: 'domcontentloaded' })
      await expect(getGoldenApprovalButton(input.page)).toBeVisible({ timeout: 30_000 })
      continue
    }
    if (stage === 'failed' && (boundary === 'assistant_failure' || boundary === 'interaction_failure' || boundary === 'render_failure')) {
      await attachGoldenOracleEvidence(input.testInfo, input.scope, `golden-downstream-${stage}-${boundary}`)
      throw new Error(`GOLDEN_DOWNSTREAM_BLOCKED:${stage}:${boundary}`)
    }
    if (actionableBoundary === 'approval') {
      await input.page.reload({ waitUntil: 'domcontentloaded' })
      await expect(visibleApprovalButton).toBeVisible({ timeout: 30_000 })
      await visibleApprovalButton.click()
      await input.page.waitForTimeout(500)
      continue
    }
    if (stage.endsWith('_generating') || stage.endsWith('_rendering')) {
      await input.page.waitForTimeout(500)
      continue
    }
    if (Date.now() - activeStepEnteredAt < 5_000) {
      await input.page.waitForTimeout(500)
      continue
    }
    if (!refreshedActiveVisit) {
      refreshedActiveVisit = true
      await input.page.reload({ waitUntil: 'domcontentloaded' })
      const recoveryDeadline = Date.now() + 10_000
      while (Date.now() < recoveryDeadline) {
        if (await getGoldenApprovalButton(input.page).count() > 0) break
        if (await readGoldenWorkflowStage(input.page, input.scope) !== stage) break
        await input.page.waitForTimeout(250)
      }
      continue
    }
    if (!wokenActiveVisit) {
      const wakeCount = wakeCountByStage.get(stage) ?? 0
      if (wakeCount >= 4) {
        await attachGoldenOracleEvidence(input.testInfo, input.scope, `golden-downstream-repeated-auto-continuation-missing-${stage}`)
        throw new Error(`GOLDEN_DOWNSTREAM_WAKE_LIMIT:${stage}`)
      }
      wakeCountByStage.set(stage, wakeCount + 1)
      wokenActiveVisit = true
      await attachGoldenOracleEvidence(
        input.testInfo,
        input.scope,
        `golden-downstream-auto-continuation-missing-${stage}-${workflow.nextActionId ?? 'no-next-action'}-visit-${String(activeStepVisit)}-wake-${String(wakeCount + 1)}`,
      )
      await wakeGoldenAssistantThroughUi(input.page)
    }
    await input.page.waitForTimeout(500)
  }
  await attachGoldenOracleEvidence(input.testInfo, input.scope, 'golden-downstream-timeout')
  throw new Error(`GOLDEN_DOWNSTREAM_TIMEOUT:${input.targetStage}:${input.targetBoundary}`)
}

test.describe.serial('Golden downstream checkpoint staircase', () => {
  test('[GJ-DOWNSTREAM-CHECKPOINT-TO-FINAL-DELIVERABLE][STEP-SCRIPT] real script Choice starts production-plan generation', async ({ page, context }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const { scope } = await forkGoldenCheckpointWhenReady({
      page,
      context,
      stage: 'script_ready_for_review',
      testInfo,
    })
    await submitGoldenCheckpointBoundary({
      page,
      scope,
      stage: 'script_ready_for_review',
      boundary: 'script_review',
    })
    await recordGoldenCheckpointSources({ page, scope })
  })

  test('[GJ-DOWNSTREAM-STEP-BIBLE] production-plan Choice reaches and reloads the real style Approval', async ({ page, context }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const { scope } = await forkGoldenCheckpointWhenReady({
      page,
      context,
      stage: 'bible_ready_for_review',
      testInfo,
    })
    await submitGoldenCheckpointBoundary({
      page,
      scope,
      stage: 'bible_ready_for_review',
      boundary: 'bible_review',
    })
    await expect.poll(async () => await readGoldenMainlineBoundary(page), {
      timeout: 60_000,
      message: 'AI must raise the paid style-generation Approval after Bible confirmation',
    }).toBe('approval')
    await expect(page.getByText('成功 · 确认制作规划', { exact: true })).toHaveCount(1)
    await reloadGoldenBoundary(page, 'approval')
    await setGoldenMediaStatusDelay(15_000)
    try {
      await submitGoldenBoundary(page, 'approval')
      await expect.poll(async () => {
        const snapshot = await readGoldenOracleSnapshot(scope)
        const tasks = snapshot.tasks.filter((task) => task.type === 'edit_style_preview_image')
        return tasks.length === 3 && tasks.every((task) => task.status === 'queued' || task.status === 'processing')
      }, {
        timeout: 30_000,
        message: 'style Approval must durably submit three still-running image tasks',
      }).toBe(true)

      await expect(page.getByText('正在生成视觉风格候选图', { exact: true })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('暮色手绘惊悚', { exact: true })).toBeVisible()
      await expect(page.getByText('风格化立体寓言', { exact: true })).toBeVisible()
      await expect(page.getByText('剪纸影戏迷局', { exact: true })).toBeVisible()

      const bibleId = await readGoldenEditBibleId(scope)
      const styleBibleNode = page.locator(`article[data-node-id="${workspaceNodeId.editStyleBible(bibleId)}"]`)
      await expect(styleBibleNode).toHaveCount(1)
      await expect(styleBibleNode).toContainText('Style Bible 生成中')
      await expect.poll(async () => styleBibleNode.getAttribute('data-lifecycle-phase'), {
        timeout: 30_000,
        message: 'the single Style Bible node must aggregate the running preview targets',
      }).toMatch(/^(queued|processing)$/)
      await expect(page.locator('article[data-node-id^="edit-style-preview:"]')).toHaveCount(0)
    } finally {
      await setGoldenMediaStatusDelay(0)
    }
    await attachGoldenOracleEvidence(testInfo, scope, 'golden-style-approval-submitted')
    await recordGoldenCheckpointSources({ page, scope })
  })

  test('[GJ-DOWNSTREAM-STEP-STYLE] fresh browser resumes the real visual-style Choice', async ({ page, context }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const { scope } = await forkGoldenCheckpointWhenReady({
      page,
      context,
      stage: 'needs_style_choice',
      testInfo,
    })
    const bibleId = await readGoldenEditBibleId(scope)
    await page.goto(
      `/zh/workspace/${encodeURIComponent(scope.projectId)}?episode=${encodeURIComponent(scope.episodeId)}`,
      { waitUntil: 'domcontentloaded' },
    )
    const styleBibleNode = page.locator(`article[data-node-id="${workspaceNodeId.editStyleBible(bibleId)}"]`)
    await expect(styleBibleNode).toHaveCount(1)
    await expect(styleBibleNode).toHaveAttribute('data-lifecycle-phase', 'pending')
    await expect(styleBibleNode).toContainText('等待选择视觉风格')
    await expect(page.getByRole('button', { name: '选择这个风格', exact: true }).filter({ visible: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: '确认并继续', exact: true }).filter({ visible: true })).toHaveCount(0)

    await submitGoldenCheckpointBoundary({
      page,
      scope,
      stage: 'needs_style_choice',
      boundary: 'style_choice',
    })
    await expect.poll(async () => await readGoldenMainlineBoundary(page), {
      timeout: 60_000,
      message: 'the post-style model step must freeze core planning and billable planned-asset generation together',
    }).toBe('approval')
    await expect(page.locator(`article[data-node-id="${workspaceNodeId.editAssetGroup(scope.episodeId)}"]`)).toHaveCount(1)
    await preserveGoldenApprovalCheckpointSource({
      page,
      scope,
      stage: 'ready_to_generate_edit_script',
    })
    await expect(page.getByText('成功 · 选择视觉风格', { exact: true })).toHaveCount(1)
    await expect(page.getByText('成功 · 确认视觉风格', { exact: true })).toHaveCount(0)
    await expect(styleBibleNode).toHaveCount(1)
    await expect(styleBibleNode).toHaveAttribute('data-lifecycle-phase', 'succeeded', { timeout: 30_000 })
    await expect(styleBibleNode).toContainText('Style Bible')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(styleBibleNode).toHaveCount(1)
    await expect(styleBibleNode).toHaveAttribute('data-lifecycle-phase', 'succeeded')
    await expect(page.locator('article[data-node-id^="edit-style-preview:"]')).toHaveCount(0)
    await recordGoldenCheckpointSources({ page, scope })
  })

  test('[GJ-DOWNSTREAM-STEP-PARALLEL-APPROVAL-RECOVERY] one restored approval starts core and planned-asset tasks behind one Wait', async ({ page, context }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const { scope } = await forkGoldenCheckpointWhenReady({
      page,
      context,
      stage: 'ready_to_generate_edit_script',
      testInfo,
    })
    await page.goto(
      `/zh/workspace/${encodeURIComponent(scope.projectId)}?episode=${encodeURIComponent(scope.episodeId)}`,
      { waitUntil: 'domcontentloaded' },
    )
    await reloadGoldenBoundary(page, 'approval')
    await submitGoldenBoundary(page, 'approval')

    await expect.poll(async () => {
      const snapshot = await readGoldenOracleSnapshot(scope)
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
        && matchingWaits.length === 1
    }, {
      timeout: 90_000,
      message: 'approved core and planned-asset Operations must submit independently and share exactly one durable Wait',
    }).toBe(true)

    const editScriptNodes = page.locator('article[data-node-id^="edit-script:"]')
    await expect.poll(async () => await editScriptNodes.evaluateAll((nodes) => nodes.some((node) => (
      node.getAttribute('data-lifecycle-phase') === 'streaming'
      && node.querySelector('.workspace-node-loading-surface') === null
    ))), {
      timeout: 60_000,
      message: 'a completed shot must render through structured text streaming without the removed media loading fallback',
    }).toBe(true)

    await expect.poll(async () => await readGoldenWorkflowStage(page, scope), {
      timeout: 90_000,
      message: 'both parallel branches must complete before durable asset review',
    }).toBe('assets_ready_for_review')
    const automaticChoice = await waitForGoldenBoundary(page, 'asset_review', 10_000)
    if (!automaticChoice) {
      await attachGoldenOracleEvidence(testInfo, scope, 'golden-asset-review-auto-continuation-missing')
      await wakeGoldenAssistantThroughUi(page)
      await expect.poll(async () => await readGoldenMainlineBoundary(page), {
        timeout: 30_000,
        message: 'a real user follow-up must let AI raise the durable asset-review Choice',
      }).toBe('asset_review')
    }
    await expect(page.getByText('已就绪资产', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '资产满意，继续', exact: true }).filter({ visible: true }).last()).toBeVisible()
    await recordGoldenCheckpointSources({ page, scope })
  })

  test('[GJ-DOWNSTREAM-STEP-ASSETS] fresh browser resumes the real generated-assets Choice and reaches video Approval', async ({ page, context }, testInfo) => {
    test.setTimeout(10 * 60_000)
    const { scope } = await forkGoldenCheckpointWhenReady({
      page,
      context,
      stage: 'assets_ready_for_review',
      testInfo,
    })
    await submitGoldenCheckpointBoundary({
      page,
      scope,
      stage: 'assets_ready_for_review',
      boundary: 'asset_review',
    })
    await driveGoldenDownstreamThroughUi({
      page,
      scope,
      targetStage: 'ready_to_generate_videos',
      targetBoundary: 'approval',
      testInfo,
    })
    await recordGoldenCheckpointSources({ page, scope })
  })

  test('[GJ-DOWNSTREAM-STEP-VIDEO-APPROVAL] fresh browser resumes the real video-generation Approval and reaches final output', async ({ page, context }, testInfo) => {
    test.setTimeout(12 * 60_000)
    const { scope } = await forkGoldenCheckpointWhenReady({
      page,
      context,
      stage: 'ready_to_generate_videos',
      testInfo,
    })
    await submitGoldenCheckpointBoundary({
      page,
      scope,
      stage: 'ready_to_generate_videos',
      boundary: 'approval',
    })
    await driveGoldenDownstreamThroughUi({
      page,
      scope,
      targetStage: 'completed',
      targetBoundary: 'final_output',
      testInfo,
    })
    const oracle = await attachGoldenOracleEvidence(testInfo, scope, 'golden-downstream-final-output')
    expect(oracle.domain.finalOutputs.length).toBeGreaterThan(0)
    await recordGoldenCheckpointSources({ page, scope })
  })
})
