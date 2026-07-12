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
import { readFile } from 'node:fs/promises'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import { GOLDEN_CHECKPOINTABLE_STAGES } from '../contracts/stages'

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
  const authState = JSON.parse(await readFile(source.authStatePath, 'utf8')) as GoldenStorageState
  await input.context.addCookies(authState.cookies)
  await input.page.goto('/zh/home', { waitUntil: 'domcontentloaded' })
  const deadline = Date.now() + 3 * 60_000
  let lastMissing: Error | null = null
  while (Date.now() < deadline) {
    try {
      const scope = await forkGoldenWorkflowCheckpoint({
        page: input.page,
        source: source.scope,
        stage: input.stage,
      })
      const checkpointStages = await listGoldenWorkflowCheckpointStages({
        page: input.page,
        source: source.scope,
      })
      await writeGoldenSourceFixtureManifest({
        ...source,
        scope: toGoldenScope(scope),
        checkpointSources: {
          ...Object.fromEntries(checkpointStages.map((stage) => [stage, toGoldenScope(source.scope)])),
          ...source.checkpointSources,
        },
        createdAt: new Date().toISOString(),
      })
      await attachGoldenOracleEvidence(input.testInfo, source.scope, `golden-chain-source-${input.stage}`)
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
    await reloadGoldenBoundary(page, 'approval')
    await submitGoldenBoundary(page, 'approval')
    await expect.poll(async () => await readGoldenWorkflowStage(page, scope), {
      timeout: 30_000,
      message: 'style Approval must durably submit the real image tasks',
    }).not.toBe('ready_to_generate_style_previews')
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
    await submitGoldenCheckpointBoundary({
      page,
      scope,
      stage: 'needs_style_choice',
      boundary: 'style_choice',
    })
    await recordGoldenCheckpointSources({ page, scope })
  })

  test('[GJ-DOWNSTREAM-STEP-ASSET-APPROVAL-RECOVERY] real UI wake-up reaches and approves required-asset generation', async ({ page, context }, testInfo) => {
    test.setTimeout(4 * 60_000)
    const source = await openGoldenSourceScope({ page, context })
    await expect.poll(async () => await readGoldenWorkflowStage(page, source.scope), {
      timeout: 90_000,
      message: 'core edit planning must reach the required-asset generation boundary',
    }).toBe('ready_to_generate_assets')

    const automaticApproval = await waitForGoldenBoundary(page, 'approval', 10_000)
    if (!automaticApproval) {
      await attachGoldenOracleEvidence(testInfo, source.scope, 'golden-asset-approval-auto-continuation-missing')
      await wakeGoldenAssistantThroughUi(page)
      await expect.poll(async () => await readGoldenMainlineBoundary(page), {
        timeout: 30_000,
        message: 'a real user follow-up must let AI raise the required-asset Approval',
      }).toBe('approval')
    }
    await preserveGoldenApprovalCheckpointSource({
      page,
      scope: source.scope,
      stage: 'ready_to_generate_assets',
    })
    await reloadGoldenBoundary(page, 'approval')
    await submitGoldenBoundary(page, 'approval')

    await expect.poll(async () => await readGoldenWorkflowStage(page, source.scope), {
      timeout: 90_000,
      message: 'approved asset tasks must reach durable asset review facts',
    }).toBe('assets_ready_for_review')
    const automaticChoice = await waitForGoldenBoundary(page, 'asset_review', 10_000)
    if (!automaticChoice) {
      await attachGoldenOracleEvidence(testInfo, source.scope, 'golden-asset-review-auto-continuation-missing')
      await wakeGoldenAssistantThroughUi(page)
      await expect.poll(async () => await readGoldenMainlineBoundary(page), {
        timeout: 30_000,
        message: 'a real user follow-up must let AI raise the durable asset-review Choice',
      }).toBe('asset_review')
    }
    await recordGoldenCheckpointSources({ page, scope: source.scope })
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
