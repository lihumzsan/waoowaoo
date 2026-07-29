import type { Locator, Page } from '@playwright/test'
import type { GoldenWorkspaceScope } from './home'

export async function readGoldenAssistantRunStatus(
  page: Page,
  scope: GoldenWorkspaceScope,
): Promise<string | null> {
  const response = await page.request.get(
    `/api/projects/${encodeURIComponent(scope.projectId)}/assistant/session-state?episodeId=${encodeURIComponent(scope.episodeId)}`,
  )
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`GOLDEN_ASSISTANT_SESSION_HTTP_${String(response.status())}:${body}`)
  }
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const sessionState = (payload as Record<string, unknown>).sessionState
  if (!sessionState || typeof sessionState !== 'object' || Array.isArray(sessionState)) return null
  const currentRun = (sessionState as Record<string, unknown>).currentRun
  if (!currentRun || typeof currentRun !== 'object' || Array.isArray(currentRun)) return null
  const status = (currentRun as Record<string, unknown>).status
  return typeof status === 'string' ? status : null
}

export async function readGoldenPendingInteractionOperationId(
  page: Page,
  scope: GoldenWorkspaceScope,
): Promise<string | null> {
  const response = await page.request.get(
    `/api/projects/${encodeURIComponent(scope.projectId)}/assistant/session-state?episodeId=${encodeURIComponent(scope.episodeId)}`,
  )
  if (!response.ok()) {
    const body = await response.text()
    throw new Error(`GOLDEN_ASSISTANT_SESSION_HTTP_${String(response.status())}:${body}`)
  }
  const payload: unknown = await response.json()
  const sessionState = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).sessionState
    : null
  const pendingInteraction = sessionState && typeof sessionState === 'object' && !Array.isArray(sessionState)
    ? (sessionState as Record<string, unknown>).pendingInteraction
    : null
  const operationId = pendingInteraction && typeof pendingInteraction === 'object' && !Array.isArray(pendingInteraction)
    ? (pendingInteraction as Record<string, unknown>).operationId
    : null
  return typeof operationId === 'string' ? operationId : null
}

export function getGoldenApprovalButton(page: Page): Locator {
  const currentApprovalCard = page
    .getByText('需要确认', { exact: true })
    .filter({ visible: true })
    .last()
    .locator('..')
  return currentApprovalCard.getByRole('button').filter({ hasText: '继续执行' }).last()
}

export async function submitGoldenApproval(page: Page): Promise<void> {
  await getGoldenApprovalButton(page).click()
}

export function getGoldenApprovalCancellationButton(page: Page): Locator {
  const currentApprovalCard = page
    .getByText('需要确认', { exact: true })
    .filter({ visible: true })
    .last()
    .locator('..')
  return currentApprovalCard.getByRole('button', { name: '取消操作', exact: true }).last()
}

export async function submitGoldenApprovalCancellation(page: Page): Promise<void> {
  await getGoldenApprovalCancellationButton(page).click()
}
