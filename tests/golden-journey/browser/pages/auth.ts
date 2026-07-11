import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function registerGoldenUser(page: Page, input: {
  readonly username: string
  readonly password: string
}): Promise<void> {
  await page.goto('/zh/auth/signup')
  await page.getByLabel('用户名').fill(input.username)
  await page.getByLabel('密码', { exact: true }).fill(input.password)
  await page.getByLabel('确认密码').fill(input.password)
  await page.getByRole('button', { name: '注册', exact: true }).click()
  await expect(page).toHaveURL(/\/zh\/home(?:[/?#]|$)/, { timeout: 30_000 })
}

export async function signInGoldenUser(page: Page, input: {
  readonly username: string
  readonly password: string
}): Promise<void> {
  await page.goto('/zh/auth/signin')
  await page.locator('#username').fill(input.username)
  await page.locator('#password').fill(input.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/zh\/home(?:[/?#]|$)/, { timeout: 30_000 })
}
