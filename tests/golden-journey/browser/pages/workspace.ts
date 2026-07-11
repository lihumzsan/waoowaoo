import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import type { GoldenWorkspaceScope } from './home'

export async function readGoldenWorkflowStage(
  page: Page,
  scope: GoldenWorkspaceScope,
): Promise<EditFirstWorkflowStage> {
  const value = await page.evaluate(async ({ projectId, episodeId }) => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/context?episodeId=${encodeURIComponent(episodeId)}`)
    if (!response.ok) throw new Error(`GOLDEN_CONTEXT_HTTP_${String(response.status)}`)
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const context = (payload as Record<string, unknown>).context
    if (!context || typeof context !== 'object' || Array.isArray(context)) return null
    const workflow = (context as Record<string, unknown>).editFirstWorkflow
    if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return null
    const stage = (workflow as Record<string, unknown>).stage
    return typeof stage === 'string' ? stage : null
  }, scope)
  if (!value) throw new Error('GOLDEN_CONTEXT_WORKFLOW_STAGE_MISSING')
  return value as EditFirstWorkflowStage
}

export async function expectGoldenIntakeChoice(page: Page): Promise<void> {
  await expect(page.getByText('补充创作方向', { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('AI 运行失败', { exact: true })).toHaveCount(0)
  await expect(page.getByText('工具调用失败', { exact: true })).toHaveCount(0)
}

export async function submitGoldenIntakeChoices(page: Page): Promise<void> {
  await page.getByRole('button', { name: /1分钟/ }).click()
  await page.getByRole('button', { name: /民俗恐怖/ }).click()
  await page.getByRole('button', { name: /循环重启/ }).click()
}

export type GoldenWorkspaceOutcome = 'script_review' | 'assistant_failure' | 'render_failure' | 'timeout'

export async function waitForGoldenScriptReviewOutcome(
  page: Page,
  timeoutMs = 120_000,
): Promise<GoldenWorkspaceOutcome> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.getByText('确认剧本', { exact: true }).count() > 0) return 'script_review'
    if (await page.getByText(/Maximum update depth exceeded/).count() > 0) return 'render_failure'
    if (
      await page.getByText('AI 运行失败', { exact: true }).count() > 0
      || await page.getByText('工具调用失败', { exact: true }).count() > 0
    ) return 'assistant_failure'
    await page.waitForTimeout(250)
  }
  return 'timeout'
}

export async function approveGoldenScript(page: Page): Promise<void> {
  await page.getByRole('button', { name: '确认剧本，生成制作规划' }).click()
}

export type GoldenProductionPlanOutcome = 'bible_review' | 'assistant_failure' | 'interaction_failure' | 'render_failure' | 'timeout'

export async function waitForGoldenProductionPlanOutcome(
  page: Page,
  timeoutMs = 120_000,
): Promise<GoldenProductionPlanOutcome> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await page.getByText('确认制作规划', { exact: true }).count() > 0) return 'bible_review'
    if (await page.getByText(/Maximum update depth exceeded/).count() > 0) return 'render_failure'
    if (await page.getByText(/消息发送失败，内容已保留，请重试/).count() > 0) return 'interaction_failure'
    if (
      await page.getByText('AI 运行失败', { exact: true }).count() > 0
      || await page.getByText('工具调用失败', { exact: true }).count() > 0
    ) return 'assistant_failure'
    await page.waitForTimeout(250)
  }
  return 'timeout'
}

export type GoldenMainlineBoundary =
  | 'script_intake'
  | 'script_review'
  | 'bible_review'
  | 'style_choice'
  | 'asset_review'
  | 'approval'
  | 'final_output'
  | 'assistant_failure'
  | 'interaction_failure'
  | 'render_failure'
  | 'waiting'

async function visible(page: Page, text: string | RegExp, exact = true): Promise<boolean> {
  return await page.getByText(text, { exact }).filter({ visible: true }).count() > 0
}

export async function readGoldenMainlineBoundary(page: Page): Promise<GoldenMainlineBoundary> {
  if (await visible(page, /Maximum update depth exceeded/, false)) return 'render_failure'
  if (await visible(page, /消息发送失败，内容已保留，请重试/, false)) return 'interaction_failure'
  if (
    await visible(page, 'AI 运行失败')
    || await visible(page, '工具调用失败')
  ) return 'assistant_failure'
  if (await visible(page, '补充创作方向')) return 'script_intake'
  if (await visible(page, '确认剧本')) return 'script_review'
  if (await visible(page, '确认制作规划')) return 'bible_review'
  if (await visible(page, '选择视觉风格')) return 'style_choice'
  if (await visible(page, '审核分镜资产')) return 'asset_review'
  if (await visible(page, '需要确认')) return 'approval'
  if (await visible(page, /最终成片|最终视频已完成|制作完成/, false)) return 'final_output'
  return 'waiting'
}

export async function reloadGoldenBoundary(page: Page, expected: GoldenMainlineBoundary): Promise<void> {
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect.poll(async () => await readGoldenMainlineBoundary(page), {
    timeout: 30_000,
    message: `Golden boundary ${expected} must survive reload`,
  }).toBe(expected)
}

export async function submitGoldenBoundary(page: Page, boundary: GoldenMainlineBoundary): Promise<void> {
  if (boundary === 'script_intake') {
    await submitGoldenIntakeChoices(page)
    return
  }
  if (boundary === 'script_review') {
    await approveGoldenScript(page)
    return
  }
  if (boundary === 'bible_review') {
    await page.getByRole('button', { name: /16:9/ }).filter({ visible: true }).last().click()
    await page.getByRole('button', { name: '确认制作规划', exact: true }).filter({ visible: true }).last().click()
    return
  }
  if (boundary === 'style_choice') {
    await page.getByRole('button', { name: /候选 1/ }).filter({ visible: true }).last().click()
    await page.getByRole('button', { name: '确认并继续', exact: true }).filter({ visible: true }).last().click()
    return
  }
  if (boundary === 'asset_review') {
    await page.getByRole('button', { name: '资产满意，继续', exact: true }).filter({ visible: true }).last().click()
    return
  }
  if (boundary === 'approval') {
    await page.getByRole('button', { name: '继续执行', exact: true }).filter({ visible: true }).last().click()
  }
}
