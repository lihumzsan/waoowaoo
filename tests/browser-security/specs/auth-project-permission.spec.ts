import { expect, test } from '../browser/test'
import {
  expectSecurityAuthenticatedUser,
  registerSecurityUser,
  signInSecurityUser,
  signOutSecurityUser,
} from '../browser/pages/auth'
import {
  createSecurityProjectThroughUi,
  deleteSecurityProjectThroughUi,
  openSecurityProjectList,
} from '../browser/pages/projects'
import { readSecurityProjectById } from '../oracle/reader'
import { attachSecurityProductEvidence } from '../oracle/product-evidence'

const runtimeSuffix = process.env.SECURITY_RUNTIME_ID?.slice(0, 12) ?? 'local'
const owner = {
  username: `security-owner-${runtimeSuffix}`,
  password: 'security-owner-password',
}
const intruder = {
  username: `security-intruder-${runtimeSuffix}`,
  password: 'security-intruder-password',
}
const recoveryUser = {
  username: `security-recovery-${runtimeSuffix}`,
  password: 'security-recovery-password',
}
const project = {
  name: `权限边界项目-${runtimeSuffix}`,
  description: '只允许项目所有者访问。',
}

test('[SEC-AUTH-UNAUTHENTICATED-DENIAL] new browser cannot open workspace or read the project API', async ({
  page,
  browserObservations,
}, testInfo) => {
  const response = await page.request.get('/api/projects')
  expect(response.status()).toBe(401)
  await page.goto('/zh/workspace', { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/zh\/auth\/signin(?:[/?#]|$)/, { timeout: 30_000 })
  await attachSecurityProductEvidence(testInfo, 'security-unauthenticated-denial', {
    projectApiStatus: response.status(),
    finalUrl: page.url(),
  })
  browserObservations.assertClean()
})

test('[SEC-AUTH-SESSION-RECOVERY] unified auth creates then restores the same persistent identity', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerSecurityUser(page, recoveryUser)
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
  await expectSecurityAuthenticatedUser(page, recoveryUser.username)
  await signOutSecurityUser(page)

  await page.goto('/zh/auth/signin')
  await page.locator('#username').fill(recoveryUser.username)
  await page.locator('#password').fill('definitely-wrong-password')
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page).toHaveURL(/\/zh\/auth\/signin(?:[/?#]|$)/)
  expect(await (await page.request.get('/api/auth/session')).json()).toEqual({})

  await page.locator('#password').fill(recoveryUser.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/zh\/home(?:[/?#]|$)/, { timeout: 30_000 })
  await expectSecurityAuthenticatedUser(page, recoveryUser.username)
  const restoredSessionResponse = await page.request.get('/api/auth/session')
  expect(restoredSessionResponse.status()).toBe(200)
  const restoredSession = await restoredSessionResponse.json() as {
    user?: {
      id?: unknown
    }
  }
  expect(restoredSession.user?.id).toBe(initialUserId)

  await attachSecurityProductEvidence(testInfo, 'security-auth-session-recovery', {
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

test('[SEC-PROJECT-CROSS-USER-ISOLATION] second user cannot list read mutate open or delete the owner project', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerSecurityUser(page, owner)
  const projectId = await createSecurityProjectThroughUi(page, project)
  const beforeDeniedRequests = await readSecurityProjectById(projectId)
  expect(beforeDeniedRequests).not.toBeNull()

  await signOutSecurityUser(page)
  await registerSecurityUser(page, intruder)
  await openSecurityProjectList(page)
  await expect(page.locator(`a[href="/zh/workspace/${projectId}"]`)).toHaveCount(0)

  const protectedResponses = await Promise.all([
    page.request.get(`/api/projects/${projectId}`),
    page.request.patch(`/api/projects/${projectId}`, { data: { name: '越权修改' } }),
    page.request.delete(`/api/projects/${projectId}`),
  ])
  expect(protectedResponses.map((response) => response.status())).toEqual([403, 403, 403])

  await page.goto(`/zh/workspace/${projectId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('没有权限访问', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '返回工作区', exact: true })).toBeVisible()
  expect(await readSecurityProjectById(projectId)).toEqual(beforeDeniedRequests)

  await attachSecurityProductEvidence(testInfo, 'security-project-ownership', {
    deniedStatuses: protectedResponses.map((response) => response.status()),
    beforeDeniedRequests,
    afterDeniedRequests: await readSecurityProjectById(projectId),
  })

  await signOutSecurityUser(page)
  await signInSecurityUser(page, owner)
  await deleteSecurityProjectThroughUi(page, { projectId, name: project.name })
  browserObservations.assertClean({
    allowedHttpStatuses: new Set([403]),
    allowedConsoleErrorPatterns: [
      /Failed to load resource: the server responded with a status of 403 \(Forbidden\)/,
    ],
  })
})
