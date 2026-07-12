import { expect, test } from '../browser/test'
import { deleteGoldenProjectThroughUi } from '../browser/pages/projects'
import { readGoldenProjectById, readGoldenUserByName } from '../oracle/reader'
import { attachGoldenProductEvidence } from '../oracle/product-evidence'

const runtimeSuffix = process.env.GOLDEN_RUNTIME_ID?.slice(0, 12) ?? 'local'
const englishUser = {
  username: `golden-english-${runtimeSuffix}`,
  password: 'golden-english-password',
}
const deploymentUser = {
  username: `golden-deployment-${runtimeSuffix}`,
  password: 'golden-deployment-password',
}
const projectName = `Locale Identity ${runtimeSuffix}`
const projectDescription = 'Created through the English product UI and verified again in Chinese.'

interface CreatedProjectPayload {
  readonly project?: {
    readonly id?: unknown
  }
}

test('[GJ-DEPLOY-SELF-HOSTED-CAPABILITIES] public capability facts match signup and navigation surfaces', async ({
  page,
  browserObservations,
}, testInfo) => {
  const response = await page.request.get('/api/deployment')
  expect(response.status()).toBe(200)
  const deployment = await response.json() as unknown
  expect(deployment).toMatchObject({
    success: true,
    deployment: {
      edition: 'self-hosted',
      providerCredentialMode: 'user-key',
      usesPlatformProviderKeys: false,
    },
    billingMode: 'OFF',
    features: {
      showPricingPage: false,
      showRecharge: false,
      showInviteCode: false,
      showBilling: false,
      showApiConfig: true,
      showAccountSecurity: false,
      showGoogleOAuth: false,
      showDownloadLogs: true,
      showUpdateCheck: true,
      requireInviteCodeOnSignup: false,
      usePlatformProviderConfig: false,
    },
  })

  await page.goto('/en/auth/signup')
  await expect(page.getByLabel('Invite Code')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Pricing' })).toHaveCount(0)
  await page.getByLabel('Username').fill(deploymentUser.username)
  await page.getByLabel('Password', { exact: true }).fill(deploymentUser.password)
  await page.getByLabel('Confirm Password').fill(deploymentUser.password)
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/home(?:[/?#]|$)/, { timeout: 30_000 })
  await page.goto('/en/profile')
  await expect(page.getByText('API Configuration', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Account Security', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Account Overview', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Billing', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: new RegExp(deploymentUser.username) }).click()
  const menu = page.getByRole('menu', { name: 'Settings' })
  await expect(menu.getByText('Download Logs', { exact: true })).toBeVisible()
  await expect(menu.getByText('Check for updates', { exact: true })).toBeVisible()
  await expect(menu.getByText('Top Up', { exact: true })).toHaveCount(0)
  await attachGoldenProductEvidence(testInfo, 'golden-self-hosted-capabilities', deployment)
  browserObservations.assertClean()
})

test('[GJ-I18N-CRITICAL-PROJECT] English project creation keeps one durable identity after the product switches to Chinese', async ({
  page,
  browserObservations,
}, testInfo) => {
  await page.goto('/en/auth/signup')
  await page.getByLabel('Username').fill(englishUser.username)
  await page.getByLabel('Password', { exact: true }).fill(englishUser.password)
  await page.getByLabel('Confirm Password').fill(englishUser.password)
  await page.getByRole('button', { name: 'Sign Up', exact: true }).click()
  await expect(page).toHaveURL(/\/en\/home(?:[/?#]|$)/, { timeout: 30_000 })
  const user = await readGoldenUserByName(englishUser.username)
  expect(user).not.toBeNull()

  await page.goto('/en/workspace')
  const openModelCheck = page.waitForResponse((candidate) => (
    candidate.request().method() === 'GET'
    && new URL(candidate.url()).pathname === '/api/user-preference'
  ))
  await page.getByText('New Project', { exact: true }).first().click()
  expect((await openModelCheck).status()).toBe(200)
  const modal = page.getByRole('heading', { name: 'New Project', exact: true }).locator('..')
  await modal.getByLabel('Project Name *').fill(projectName)
  await modal.getByLabel('Project Description (Optional)').fill(projectDescription)
  const acceptDialog = (dialog: import('@playwright/test').Dialog) => void dialog.accept()
  page.on('dialog', acceptDialog)
  const [createResponse, createdProjectModelCheck] = await Promise.all([
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === '/api/projects'
    )),
    page.waitForResponse((candidate) => (
      candidate.request().method() === 'GET'
      && new URL(candidate.url()).pathname === '/api/user-preference'
    )),
    modal.getByRole('button', { name: 'New Project', exact: true }).click(),
  ])
  expect(createResponse.status()).toBe(201)
  expect(createdProjectModelCheck.status()).toBe(200)
  const payload = await createResponse.json() as CreatedProjectPayload
  const projectId = payload.project?.id
  if (typeof projectId !== 'string' || !projectId) throw new Error('GOLDEN_I18N_PROJECT_ID_MISSING')
  await expect(page).toHaveURL(/\/en\/profile(?:[/?#]|$)/)
  await page.goto('/en/workspace')
  page.off('dialog', acceptDialog)
  await expect(page.locator(`a[href="/en/workspace/${projectId}"]`)).toContainText(projectName)
  const englishProject = await readGoldenProjectById(projectId)
  expect(englishProject).toEqual({
    id: projectId,
    userId: user?.id,
    name: projectName,
    description: projectDescription,
  })

  await page.getByRole('button', { name: 'Switch language' }).click()
  await page.getByRole('button', { name: '简体中文', exact: true }).click()
  await page.getByRole('button', { name: '确认切换', exact: true }).click()
  await expect(page).toHaveURL(/\/zh\/workspace(?:[/?#]|$)/)
  await expect(page.locator(`a[href="/zh/workspace/${projectId}"]`)).toContainText(projectDescription)
  const chineseProject = await readGoldenProjectById(projectId)
  expect(chineseProject).toEqual({
    id: projectId,
    userId: user?.id,
    name: projectName,
    description: projectDescription,
  })

  await deleteGoldenProjectThroughUi(page, { projectId, name: projectName })
  const afterDelete = await readGoldenProjectById(projectId)
  expect(afterDelete).toBeNull()
  await attachGoldenProductEvidence(testInfo, 'golden-i18n-project-identity', {
    englishProject,
    chineseProject,
    afterDelete,
  })
  browserObservations.assertClean()
})
