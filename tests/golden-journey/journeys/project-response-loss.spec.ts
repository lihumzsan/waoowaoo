import { expect, test } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import {
  deleteGoldenProjectThroughUi,
  openGoldenProjectList,
} from '../browser/pages/projects'
import {
  readGoldenProjectById,
  readGoldenProjectsByOwnerAndName,
  readGoldenUserByName,
} from '../oracle/reader'
import { attachGoldenProductEvidence } from '../oracle/product-evidence'

const runtimeSuffix = process.env.GOLDEN_RUNTIME_ID?.slice(0, 12) ?? 'local'
const user = {
  username: `golden-response-loss-${runtimeSuffix}`,
  password: 'golden-response-loss-password',
}
const project = {
  name: `Response Loss ${runtimeSuffix}`,
  description: 'The server commits this project before the browser response is deliberately lost.',
}

interface CreatedProjectPayload {
  readonly project?: {
    readonly id?: unknown
  }
}

test('[GJ-PROJECT-CREATE-RESPONSE-LOSS] reload discovers one committed project after the browser loses the 201 response', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerGoldenUser(page, user)
  const durableUser = await readGoldenUserByName(user.username)
  if (!durableUser) throw new Error('GOLDEN_RESPONSE_LOSS_USER_MISSING')
  await openGoldenProjectList(page)

  let committedProjectId: string | null = null
  let committedStatus: number | null = null
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue()
      return
    }
    const response = await route.fetch()
    committedStatus = response.status()
    const payload = await response.json() as CreatedProjectPayload
    const projectId = payload.project?.id
    if (typeof projectId === 'string') committedProjectId = projectId
    await route.abort('failed')
  })

  const openModelCheck = page.waitForResponse((candidate) => (
    candidate.request().method() === 'GET'
    && new URL(candidate.url()).pathname === '/api/user-preference'
  ))
  await page.getByText('新建项目', { exact: true }).first().click()
  expect((await openModelCheck).status()).toBe(200)
  const modal = page.getByRole('heading', { name: '新建项目', exact: true }).locator('..')
  await modal.getByLabel('项目名称 *').fill(project.name)
  await modal.getByLabel('项目描述（可选）').fill(project.description)
  await modal.getByRole('button', { name: '新建项目', exact: true }).click()
  await expect.poll(() => committedProjectId, {
    message: 'the server response must prove commit before the browser response is dropped',
  }).not.toBeNull()
  expect(committedStatus).toBe(201)
  await page.unroute('**/api/projects')

  await page.goto('/zh/workspace', { waitUntil: 'domcontentloaded' })
  const projectId = committedProjectId
  if (!projectId) throw new Error('GOLDEN_RESPONSE_LOSS_PROJECT_ID_MISSING')
  await expect(page.locator(`a[href="/zh/workspace/${projectId}"]`)).toContainText(project.name, {
    timeout: 30_000,
  })
  const durableProject = await readGoldenProjectById(projectId)
  const sameNameProjects = await readGoldenProjectsByOwnerAndName({
    userId: durableUser.id,
    name: project.name,
  })
  expect(durableProject).toEqual({
    id: projectId,
    userId: durableUser.id,
    ...project,
  })
  expect(sameNameProjects).toEqual([{ id: projectId, name: project.name }])
  await attachGoldenProductEvidence(testInfo, 'golden-project-response-loss', {
    committedStatus,
    durableProject,
    sameNameProjects,
  })

  await deleteGoldenProjectThroughUi(page, { projectId, name: project.name })
  expect(await readGoldenProjectById(projectId)).toBeNull()
  browserObservations.assertClean({
    allowedConsoleErrorPatterns: [
      /创建项目失败/,
      /Failed to load resource.*ERR_FAILED/,
    ],
    allowedFailedRequestPatterns: [{
      method: 'POST',
      url: /\/api\/projects(?:\?|$)/,
    }],
  })
})
