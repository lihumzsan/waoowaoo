import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

interface CharacterResponsePayload {
  readonly character?: {
    readonly id?: unknown
  }
}

export async function createSecurityGlobalCharacterThroughUi(page: Page, input: {
  readonly name: string
  readonly description: string
}): Promise<string> {
  await page.goto('/zh/workspace/asset-hub', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '资产中心', exact: true })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '新建资产', exact: true }).click()
  await page.getByRole('button', { name: '新建角色', exact: true }).click()
  const modalHeading = page.getByRole('heading', { name: '新建角色', exact: true })
  await expect(modalHeading).toBeVisible()
  await page.getByRole('textbox', { name: /角色名称/ }).fill(input.name)
  await page.getByPlaceholder('请输入角色外貌描述...').fill(input.description)
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === '/api/asset-hub/characters'
    )),
    page.getByRole('button', { name: '添加', exact: true }).click(),
  ])
  if (response.status() !== 201 && response.status() !== 200) {
    throw new Error(`SECURITY_GLOBAL_CHARACTER_CREATE_HTTP_${String(response.status())}`)
  }
  const payload = await response.json() as CharacterResponsePayload
  const characterId = payload.character?.id
  if (typeof characterId !== 'string' || !characterId) {
    throw new Error('SECURITY_GLOBAL_CHARACTER_CREATE_ID_MISSING')
  }
  await expect(page.getByText(input.name, { exact: true })).toBeVisible({ timeout: 30_000 })
  return characterId
}

export async function createSecurityProjectCharacterThroughUi(page: Page, input: {
  readonly projectId: string
  readonly name: string
  readonly description: string
}): Promise<string> {
  await page.goto(`/zh/workspace/${input.projectId}?assetLibrary=1`, { waitUntil: 'domcontentloaded' })
  const library = page.getByRole('heading', { name: '资产库', exact: true }).locator('..').locator('..')
  await expect(library).toBeVisible({ timeout: 30_000 })
  await library.getByRole('button', { name: /添加角色/ }).click()
  const modalHeading = page.getByRole('heading', { name: '新建角色', exact: true })
  await expect(modalHeading).toBeVisible()
  await page.getByRole('textbox', { name: /角色名称/ }).fill(input.name)
  await page.getByPlaceholder('请输入角色外貌描述...').fill(input.description)
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === `/api/projects/${input.projectId}/character`
    )),
    page.getByRole('button', { name: '添加', exact: true }).click(),
  ])
  if (response.status() !== 201 && response.status() !== 200) {
    throw new Error(`SECURITY_PROJECT_CHARACTER_CREATE_HTTP_${String(response.status())}`)
  }
  const payload = await response.json() as CharacterResponsePayload
  const characterId = payload.character?.id
  if (typeof characterId !== 'string' || !characterId) {
    throw new Error('SECURITY_PROJECT_CHARACTER_CREATE_ID_MISSING')
  }
  await expect(page.locator(`#project-character-${characterId}`)).toContainText(input.name, { timeout: 30_000 })
  return characterId
}

export async function importSecurityGlobalCharacterThroughUi(page: Page, input: {
  readonly targetCharacterId: string
  readonly globalCharacterName: string
}): Promise<void> {
  const targetCard = page.locator(`#project-character-${input.targetCharacterId}`)
  await targetCard.getByRole('button', { name: '从资产中心导入', exact: true }).click()
  const picker = page.getByRole('heading', { name: '从资产中心选择角色', exact: true }).locator('..').locator('..')
  await expect(picker).toBeVisible()
  await picker.getByText(input.globalCharacterName, { exact: true }).click()
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === `/api/assets/${input.targetCharacterId}/copy`
    )),
    picker.getByRole('button', { name: '确认导入', exact: true }).click(),
  ])
  if (response.status() !== 200) {
    throw new Error(`SECURITY_GLOBAL_CHARACTER_IMPORT_HTTP_${String(response.status())}`)
  }
  await expect(picker).toHaveCount(0)
}

export async function editSecurityGlobalCharacterDescriptionThroughUi(page: Page, input: {
  readonly characterId: string
  readonly description: string
}): Promise<void> {
  await page.goto('/zh/workspace/asset-hub', { waitUntil: 'domcontentloaded' })
  const card = page.getByTestId(`global-character-${input.characterId}`)
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.hover()
  await page.getByTestId(`global-character-edit-${input.characterId}`).click()
  const modal = page.getByRole('heading', { name: /编辑角色/ }).locator('..').locator('..')
  await expect(modal).toBeVisible()
  await modal.locator('textarea').fill(input.description)
  const [updateResponse] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'PATCH'
      && new URL(candidate.url()).pathname.startsWith(`/api/assets/${input.characterId}/variants/`)
    )),
    page.getByRole('button', { name: '仅保存', exact: true }).click(),
  ])
  if (updateResponse.status() !== 200) {
    throw new Error('SECURITY_GLOBAL_CHARACTER_DESCRIPTION_UPDATE_FAILED')
  }
  await expect(modal).toHaveCount(0)
}

export async function deleteSecurityGlobalCharacterThroughUi(page: Page, input: {
  readonly characterId: string
}): Promise<void> {
  await page.goto('/zh/workspace/asset-hub', { waitUntil: 'domcontentloaded' })
  const card = page.getByTestId(`global-character-${input.characterId}`)
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.hover()
  await page.getByTestId(`global-character-delete-${input.characterId}`).click()
  await expect(page.getByText('确定删除此角色吗？此操作无法撤回。', { exact: true })).toBeVisible()
  const response = page.waitForResponse((candidate) => (
    candidate.request().method() === 'DELETE'
    && new URL(candidate.url()).pathname === `/api/asset-hub/characters/${input.characterId}`
  ))
  await page.getByRole('button', { name: '删除', exact: true }).click()
  if ((await response).status() !== 200) {
    throw new Error('SECURITY_GLOBAL_CHARACTER_DELETE_FAILED')
  }
  await expect(card).toHaveCount(0, { timeout: 30_000 })
}
