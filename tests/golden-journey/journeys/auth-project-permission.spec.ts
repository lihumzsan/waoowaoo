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
  editGoldenProjectThroughUi,
  openGoldenProjectList,
  searchGoldenProjects,
} from '../browser/pages/projects'
import {
  assertGoldenOracleIsReadOnly,
  readGoldenProjectById,
  readGoldenProjectsByOwnerAndName,
  readGoldenUserByName,
} from '../oracle/reader'
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
const initialProject = {
  name: `真实项目-${runtimeSuffix}`,
  description: '由项目管理 Journey 通过真实页面创建。',
}
const editedProject = {
  name: `已修改项目-${runtimeSuffix}`,
  description: '修改后刷新、搜索和权限隔离仍应读取同一个持久项目。',
}

let ownerUserId = ''
let projectId = ''

test.describe.serial('Authentication project management and ownership journeys', () => {
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

  test('[GJ-AUTH-SESSION-RECOVERY] registration reload logout invalid login and valid login use the real session UI', async ({
    page,
    browserObservations,
  }, testInfo) => {
    await registerGoldenUser(page, owner)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page).toHaveURL(/\/zh\/home(?:[/?#]|$)/)
    await expectGoldenAuthenticatedUser(page, owner.username)
    await assertGoldenOracleIsReadOnly()
    const user = await readGoldenUserByName(owner.username)
    expect(user).not.toBeNull()
    ownerUserId = user?.id ?? ''
    await attachGoldenProductEvidence(testInfo, 'golden-auth-user', user)

    await signOutGoldenUser(page)
    await page.goto('/zh/auth/signup')
    await page.getByLabel('用户名').fill(owner.username)
    await page.getByLabel('密码', { exact: true }).fill(owner.password)
    await page.getByLabel('确认密码').fill(owner.password)
    const duplicateResponse = page.waitForResponse((candidate) => (
      candidate.request().method() === 'POST'
      && new URL(candidate.url()).pathname === '/api/auth/register'
    ))
    await page.getByRole('button', { name: '注册', exact: true }).click()
    expect((await duplicateResponse).status()).toBe(409)
    await expect(page.getByText('该用户名已被注册，请换一个用户名或直接登录')).toBeVisible()
    expect(await readGoldenUserByName(owner.username)).toEqual(user)

    await page.goto('/zh/auth/signin')
    await page.locator('#username').fill(owner.username)
    await page.locator('#password').fill('wrong-password')
    await page.getByRole('button', { name: '登录', exact: true }).click()
    await expect(page).toHaveURL(/\/zh\/auth\/signin/)
    await expect(page.getByText('登录失败，请检查用户名和密码')).toBeVisible()
    await signInGoldenUser(page, owner)
    browserObservations.assertClean({
      allowedHttpStatuses: new Set([401, 409]),
      allowedConsoleErrorPatterns: [
        /Failed to load resource: the server responded with a status of 409 \(Conflict\)/,
        /Failed to load resource: the server responded with a status of 401 \(Unauthorized\)/,
      ],
    })
  })

  test('[GJ-PROJECT-CRUD-DURABILITY] owner creates searches edits reloads and retains one durable project', async ({
    page,
    browserObservations,
  }, testInfo) => {
    await signInGoldenUser(page, owner)
    projectId = await createGoldenProjectThroughUi(page, {
      ...initialProject,
      doubleSubmit: true,
    })
    expect(await readGoldenProjectsByOwnerAndName({
      userId: ownerUserId,
      name: initialProject.name,
    })).toEqual([{ id: projectId, name: initialProject.name }])
    const created = await readGoldenProjectById(projectId)
    expect(created).toEqual({
      id: projectId,
      userId: ownerUserId,
      ...initialProject,
    })

    await editGoldenProjectThroughUi(page, { projectId, ...editedProject })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator(`a[href="/zh/workspace/${projectId}"]`)).toContainText(editedProject.name)
    await searchGoldenProjects(page, editedProject.name)
    await expect(page.locator(`a[href="/zh/workspace/${projectId}"]`)).toContainText(editedProject.description)
    const edited = await readGoldenProjectById(projectId)
    expect(edited).toEqual({
      id: projectId,
      userId: ownerUserId,
      ...editedProject,
    })
    await attachGoldenProductEvidence(testInfo, 'golden-project-crud', { created, edited })
    browserObservations.assertClean()
  })

  test('[GJ-PROJECT-CROSS-USER-ISOLATION] second user cannot list read mutate open fork or delete the owner project', async ({
    page,
    browserObservations,
  }, testInfo) => {
    await registerGoldenUser(page, intruder)
    await openGoldenProjectList(page)
    await expect(page.locator(`a[href="/zh/workspace/${projectId}"]`)).toHaveCount(0)

    const protectedRequests = [
      page.request.get(`/api/projects/${projectId}`),
      page.request.patch(`/api/projects/${projectId}`, { data: { name: '越权修改' } }),
      page.request.delete(`/api/projects/${projectId}`),
      page.request.get(`/api/projects/${projectId}/workflow-lab?episodeId=forbidden`),
    ]
    const protectedResponses = await Promise.all(protectedRequests)
    expect(protectedResponses.map((response) => response.status())).toEqual([403, 403, 403, 403])

    const directAccess = page.waitForResponse((response) => (
      response.status() === 403
      && response.url().includes(`/api/projects/${projectId}/data`)
    ))
    await page.goto(`/zh/workspace/${projectId}`, { waitUntil: 'domcontentloaded' })
    await directAccess
    await expect(page.getByRole('button', { name: '返回工作区', exact: true })).toBeVisible()
    const afterDeniedRequests = await readGoldenProjectById(projectId)
    expect(afterDeniedRequests).toEqual({
      id: projectId,
      userId: ownerUserId,
      ...editedProject,
    })

    await signOutGoldenUser(page)
    await signInGoldenUser(page, owner)
    await deleteGoldenProjectThroughUi(page, { projectId, name: editedProject.name })
    const afterOwnerDelete = await readGoldenProjectById(projectId)
    expect(afterOwnerDelete).toBeNull()
    await attachGoldenProductEvidence(testInfo, 'golden-project-ownership', {
      deniedStatuses: protectedResponses.map((response) => response.status()),
      afterDeniedRequests,
      afterOwnerDelete,
    })
    browserObservations.assertClean({
      allowedHttpStatuses: new Set([403]),
      allowedConsoleErrorPatterns: [
        /Failed to load resource: the server responded with a status of 403 \(Forbidden\)/,
      ],
    })
  })
})
