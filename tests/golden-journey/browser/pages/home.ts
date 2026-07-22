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
