import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

interface ProjectMutationPayload {
  readonly project?: {
    readonly id?: unknown
  }
}

function projectLink(page: Page, projectId: string) {
  return page.locator(`a[href="/zh/workspace/${projectId}"]`)
}

export async function openSecurityProjectList(page: Page): Promise<void> {
  await page.goto('/zh/workspace')
  await expect(page.getByText('新建项目', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
}

export async function createSecurityProjectThroughUi(page: Page, input: {
  readonly name: string
  readonly description: string
  readonly doubleSubmit?: boolean
}): Promise<string> {
  await openSecurityProjectList(page)
  await page.getByText('新建项目', { exact: true }).first().click()
  const modal = page.getByRole('heading', { name: '新建项目', exact: true }).locator('..')
  await modal.getByLabel('项目名称 *').fill(input.name)
  await modal.getByLabel('项目描述（可选）').fill(input.description)
  const acceptDialog = (dialog: import('@playwright/test').Dialog) => void dialog.accept()
  const isProjectCreate = (request: import('@playwright/test').Request) => (
    request.method() === 'POST' && new URL(request.url()).pathname === '/api/projects'
  )
  let pendingProjectCreates = 0
  const onRequest = (request: import('@playwright/test').Request) => {
    if (isProjectCreate(request)) pendingProjectCreates += 1
  }
  const onRequestSettled = (request: import('@playwright/test').Request) => {
    if (isProjectCreate(request)) pendingProjectCreates -= 1
  }
  page.on('dialog', acceptDialog)
  page.on('request', onRequest)
  page.on('requestfinished', onRequestSettled)
  page.on('requestfailed', onRequestSettled)
  const submit = modal.getByRole('button', { name: '新建项目', exact: true })
  const [response, preferenceResponse] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === '/api/projects'
    )),
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'GET'
      && new URL(candidate.url()).pathname === '/api/user-preference'
    )),
    input.doubleSubmit ? submit.dblclick() : submit.click(),
  ])
  if (response.status() !== 201) {
    throw new Error(`SECURITY_PROJECT_CREATE_HTTP_${String(response.status())}`)
  }
  if (preferenceResponse.status() !== 200) {
    throw new Error(`SECURITY_PROJECT_CREATE_PREFERENCE_HTTP_${String(preferenceResponse.status())}`)
  }
  await expect.poll(() => pendingProjectCreates, {
    message: 'every browser create submission must settle before checking duplicate durable effects',
  }).toBe(0)
  const payload = await response.json() as ProjectMutationPayload
  const projectId = payload.project?.id
  if (typeof projectId !== 'string' || !projectId) {
    throw new Error('SECURITY_PROJECT_CREATE_ID_MISSING')
  }
  await expect(modal).toBeHidden()
  await expect(page).toHaveURL(/\/zh\/(?:profile|workspace)(?:[/?#]|$)/)
  if (new URL(page.url()).pathname.endsWith('/profile')) {
    await page.goto('/zh/workspace')
  }
  page.off('dialog', acceptDialog)
  page.off('request', onRequest)
  page.off('requestfinished', onRequestSettled)
  page.off('requestfailed', onRequestSettled)
  await expect(projectLink(page, projectId)).toContainText(input.name, { timeout: 30_000 })
  return projectId
}

export async function editSecurityProjectThroughUi(page: Page, input: {
  readonly projectId: string
  readonly name: string
  readonly description: string
}): Promise<void> {
  const card = projectLink(page, input.projectId)
  await card.hover()
  await card.getByTitle('编辑项目').click()
  const modal = page.getByRole('heading', { name: '编辑项目', exact: true }).locator('..')
  await modal.locator('#edit-name').fill(input.name)
  await modal.locator('#edit-description').fill(input.description)
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'PATCH'
      && new URL(candidate.url()).pathname === `/api/projects/${input.projectId}`
    )),
    modal.getByRole('button', { name: '保存', exact: true }).click(),
  ])
  if (response.status() !== 200) {
    throw new Error(`SECURITY_PROJECT_EDIT_HTTP_${String(response.status())}`)
  }
  await expect(projectLink(page, input.projectId)).toContainText(input.name)
}

export async function searchSecurityProjects(page: Page, query: string): Promise<void> {
  await page.getByPlaceholder('搜索项目名称或描述...').fill(query)
  const response = page.waitForResponse((candidate) => (
    candidate.request().method() === 'GET'
    && new URL(candidate.url()).pathname === '/api/projects'
    && new URL(candidate.url()).searchParams.get('search') === query
  ))
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  if ((await response).status() !== 200) throw new Error('SECURITY_PROJECT_SEARCH_FAILED')
}

export async function deleteSecurityProjectThroughUi(page: Page, input: {
  readonly projectId: string
  readonly name: string
}): Promise<void> {
  await openSecurityProjectList(page)
  const card = projectLink(page, input.projectId)
  await card.hover()
  await card.getByTitle('删除项目').click()
  await expect(page.getByText(`确定要删除项目"${input.name}"吗？此操作无法撤销。`)).toBeVisible()
  const [response, refreshResponse] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'DELETE'
      && new URL(candidate.url()).pathname === `/api/projects/${input.projectId}`
    )),
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'GET'
      && new URL(candidate.url()).pathname === '/api/projects'
    )),
    page.getByRole('button', { name: '删除', exact: true }).click(),
  ])
  if (response.status() !== 200) {
    throw new Error(`SECURITY_PROJECT_DELETE_HTTP_${String(response.status())}`)
  }
  if (refreshResponse.status() !== 200) {
    throw new Error(`SECURITY_PROJECT_DELETE_REFRESH_HTTP_${String(refreshResponse.status())}`)
  }
  await expect(projectLink(page, input.projectId)).toHaveCount(0, { timeout: 30_000 })
}
