import { expect, test } from '../browser/test'
import {
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
