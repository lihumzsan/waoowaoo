import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export interface GoldenWorkspaceScope {
  readonly projectId: string
  readonly episodeId: string
}

export async function launchGoldenStoryFromHome(page: Page, story: string): Promise<GoldenWorkspaceScope> {
  await page.getByRole('textbox').fill(story)
  await page.getByRole('button', { name: '开始创作' }).click()
  await expect(page).toHaveURL(/\/zh\/workspace\/[^?]+\?episode=[^&#]+/, { timeout: 30_000 })
  const url = new URL(page.url())
  const pathSegments = url.pathname.split('/').filter(Boolean)
  const projectId = pathSegments.at(-1)
  const episodeId = url.searchParams.get('episode')
  if (!projectId || !episodeId) throw new Error(`GOLDEN_WORKSPACE_SCOPE_MISSING:${url.toString()}`)
  return { projectId, episodeId }
}

function readNestedId(value: unknown, key: 'project' | 'episode'): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`GOLDEN_${key.toUpperCase()}_RESPONSE_INVALID`)
  }
  const nested = (value as Record<string, unknown>)[key]
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    throw new Error(`GOLDEN_${key.toUpperCase()}_RESPONSE_INVALID`)
  }
  const id = (nested as Record<string, unknown>).id
  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(`GOLDEN_${key.toUpperCase()}_ID_MISSING`)
  }
  return id
}

export async function launchGoldenProjectWithoutHomeRatio(page: Page): Promise<GoldenWorkspaceScope> {
  const projectResponse = await page.request.post('/api/projects', {
    data: { name: `Golden missing ratio ${String(Date.now())}` },
  })
  expect(projectResponse.ok()).toBe(true)
  const projectId = readNestedId(await projectResponse.json(), 'project')
  const episodeResponse = await page.request.post(`/api/projects/${projectId}/episodes`, {
    data: { name: 'Episode 1' },
  })
  expect(episodeResponse.ok()).toBe(true)
  const episodeId = readNestedId(await episodeResponse.json(), 'episode')
  await page.goto(`/zh/workspace/${projectId}?episode=${episodeId}`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(new RegExp(`/zh/workspace/${projectId}\\?episode=${episodeId}`))
  return { projectId, episodeId }
}
