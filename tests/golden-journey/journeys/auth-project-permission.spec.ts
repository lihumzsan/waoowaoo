import { expect, test } from '../browser/test'
import {
  expectGoldenAuthenticatedUser,
  registerGoldenUser,
  signInGoldenUser,
  signOutGoldenUser,
} from '../browser/pages/auth'
import {
  createGoldenProjectThroughUi,
  deleteGoldenProjectThroughUi,
  openGoldenProjectList,
} from '../browser/pages/projects'
import { readGoldenProjectById } from '../oracle/reader'
import { attachGoldenProductEvidence } from '../oracle/product-evidence'

const runtimeSuffix = process.env.GOLDEN_RUNTIME_ID?.slice(0, 12) ?? 'local'
const owner = {
  username: `golden-owner-${runtimeSuffix}`,
  password: 'golden-owner-password',
}
const intruder = {
  username: `golden-intruder-${runtimeSuffix}`,
  password: 'golden-intruder-password',
}
const recoveryUser = {
  username: `golden-recovery-${runtimeSuffix}`,
  password: 'golden-recovery-password',
}
const project = {
  name: `权限边界项目-${runtimeSuffix}`,
  description: '只允许项目所有者访问。',
}

test('[GJ-AUTH-UNAUTHENTICATED-DENIAL] new browser cannot open workspace or read the project API', async ({
  page,
  browserObservations,
}, testInfo) => {
  const response = await page.request.get('/api/projects')
  expect(response.status()).toBe(401)
  await page.goto('/zh/workspace', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/zh\/auth\/signin(?:[/?#]|$)/, { timeout: 30_000 })
  await attachGoldenProductEvidence(testInfo, 'golden-unauthenticated-denial', {
    projectApiStatus: response.status(),
    finalUrl: page.url(),
  })
  browserObservations.assertClean()
})

test('[GJ-AUTH-SESSION-RECOVERY] unified auth creates then restores the same persistent identity', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerGoldenUser(page, recoveryUser)
  const initialSessionResponse = await page.request.get('/api/auth/session')
  expect(initialSessionResponse.status()).toBe(200)
  const initialSession = await initialSessionResponse.json() as {
    user?: {
      id?: unknown
    }
  }
  expect(typeof initialSession.user?.id).toBe('string')
  const initialUserId = initialSession.user?.id

  await page.reload()
  await expectGoldenAuthenticatedUser(page, recoveryUser.username)
  await signOutGoldenUser(page)

  await page.goto('/zh/auth/signin')
  await page.locator('#username').fill(recoveryUser.username)
  await page.locator('#password').fill('definitely-wrong-password')
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/zh\/auth\/signin(?:[/?#]|$)/)
  expect(await (await page.request.get('/api/auth/session')).json()).toEqual({})

  await page.locator('#password').fill(recoveryUser.password)
  await page.getByRole('button', { name: '登录 / 注册', exact: true }).click()
  await expect(page).toHaveURL(/\/zh\/home(?:[/?#]|$)/, { timeout: 30_000 })
  await expectGoldenAuthenticatedUser(page, recoveryUser.username)
  const restoredSessionResponse = await page.request.get('/api/auth/session')
  expect(restoredSessionResponse.status()).toBe(200)
  const restoredSession = await restoredSessionResponse.json() as {
    user?: {
      id?: unknown
    }
  }
  expect(restoredSession.user?.id).toBe(initialUserId)

  await attachGoldenProductEvidence(testInfo, 'golden-auth-session-recovery', {
    initialUserId,
    restoredUserId: restoredSession.user?.id,
  })
  browserObservations.assertClean({
    allowedHttpStatuses: new Set([401]),
    allowedConsoleErrorPatterns: [
      /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/,
    ],
  })
})

test('[GJ-PROJECT-CROSS-USER-ISOLATION] second user cannot list read mutate open or delete the owner project', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerGoldenUser(page, owner)
  const projectId = await createGoldenProjectThroughUi(page, project)
  const beforeDeniedRequests = await readGoldenProjectById(projectId)
  expect(beforeDeniedRequests).not.toBeNull()

  await signOutGoldenUser(page)
  await registerGoldenUser(page, intruder)
  await openGoldenProjectList(page)
  await expect(page.locator(`a[href="/zh/workspace/${projectId}"]`)).toHaveCount(0)

  const protectedResponses = await Promise.all([
    page.request.get(`/api/projects/${projectId}`),
    page.request.patch(`/api/projects/${projectId}`, { data: { name: '越权修改' } }),
    page.request.delete(`/api/projects/${projectId}`),
  ])
  expect(protectedResponses.map((response) => response.status())).toEqual([403, 403, 403])

  const directAccess = page.waitForResponse((response) => (
    response.status() === 403
    && response.url().includes(`/api/projects/${projectId}/data`)
  ))
  await page.goto(`/zh/workspace/${projectId}`, { waitUntil: 'domcontentloaded' })
  await directAccess
  await expect(page.getByRole('button', { name: '返回工作区', exact: true })).toBeVisible()
  expect(await readGoldenProjectById(projectId)).toEqual(beforeDeniedRequests)

  await attachGoldenProductEvidence(testInfo, 'golden-project-ownership', {
    deniedStatuses: protectedResponses.map((response) => response.status()),
    beforeDeniedRequests,
    afterDeniedRequests: await readGoldenProjectById(projectId),
  })

  await signOutGoldenUser(page)
  await signInGoldenUser(page, owner)
  await deleteGoldenProjectThroughUi(page, { projectId, name: project.name })
  browserObservations.assertClean({
    allowedHttpStatuses: new Set([403]),
    allowedConsoleErrorPatterns: [
      /Failed to load resource: the server responded with a status of 403 \(Forbidden\)/,
    ],
  })
})
