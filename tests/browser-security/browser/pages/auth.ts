import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function expectSecurityAuthenticatedUser(
  page: Page,
  username: string,
): Promise<void> {
  await expect(page.getByRole('button', { name: username, exact: true })).toBeVisible({
    timeout: 30_000,
  })
}

export async function registerSecurityUser(page: Page, input: {
  readonly username: string
  readonly password: string
}): Promise<void> {
  await page.goto('/zh/auth/signin')
  await page.getByRole('tab', { name: '注册', exact: true }).click()
  await page.getByLabel('用户名').fill(input.username)
  await page.getByLabel('密码', { exact: true }).fill(input.password)
  await page.getByLabel('确认密码', { exact: true }).fill(input.password)
  await page.getByRole('button', { name: '注册并登录', exact: true }).click()
  await expect(page).toHaveURL(/\/zh\/home(?:[/?#]|$)/, { timeout: 30_000 })
  await expectSecurityAuthenticatedUser(page, input.username)
}

export async function signInSecurityUser(page: Page, input: {
  readonly username: string
  readonly password: string
}): Promise<void> {
  await page.goto('/zh/auth/signin')
  await page.locator('#username').fill(input.username)
  await page.locator('#password').fill(input.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/zh\/home(?:[/?#]|$)/, { timeout: 30_000 })
  await expectSecurityAuthenticatedUser(page, input.username)
}

export async function signOutSecurityUser(page: Page): Promise<void> {
  await page.goto('/zh/profile')
  const [signOutResponse] = await Promise.all([
    page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/auth/signout'
    )),
    page.getByRole('button', { name: '退出登录', exact: true }).click(),
  ])
  expect(signOutResponse.status()).toBe(200)
  await expect(page).toHaveURL(/\/zh(?:[/?#]|$)/, { timeout: 30_000 })
  await expect(page.getByRole('link', { name: '登录 / 注册', exact: true })).toBeVisible({ timeout: 30_000 })
  const sessionResponse = await page.request.get('/api/auth/session')
  expect(sessionResponse.status()).toBe(200)
  expect(await sessionResponse.json()).toEqual({})
}
