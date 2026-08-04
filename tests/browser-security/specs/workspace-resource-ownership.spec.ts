import { expect, test } from '../browser/test'
import {
  registerSecurityUser,
  signInSecurityUser,
  signOutSecurityUser,
} from '../browser/pages/auth'
import {
  createSecurityProjectThroughUi,
  deleteSecurityProjectThroughUi,
} from '../browser/pages/projects'
import { readSecurityProjectById } from '../oracle/reader'
import { attachSecurityProductEvidence } from '../oracle/product-evidence'

const runtimeSuffix = process.env.SECURITY_RUNTIME_ID?.slice(0, 12) ?? 'local'
const owner = {
  username: `security-resource-owner-${runtimeSuffix}`,
  password: 'security-resource-owner-password',
}
const attacker = {
  username: `security-resource-attacker-${runtimeSuffix}`,
  password: 'security-resource-attacker-password',
}

test('[SEC-RESOURCE-CROSS-PROJECT-DENIAL] an authenticated user cannot read another project WorkspaceResource tree', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerSecurityUser(page, owner)
  const victimProjectId = await createSecurityProjectThroughUi(page, {
    name: `受保护资源项目-${runtimeSuffix}`,
    description: 'WorkspaceResource 目录只允许项目所有者读取。',
  })
  const ownerRead = await page.request.get(`/api/projects/${victimProjectId}/resources`)
  expect(ownerRead.status()).toBe(200)
  const beforeAttack = await readSecurityProjectById(victimProjectId)
  expect(beforeAttack).not.toBeNull()

  await signOutSecurityUser(page)
  await registerSecurityUser(page, attacker)
  const attackerProjectId = await createSecurityProjectThroughUi(page, {
    name: `攻击者资源项目-${runtimeSuffix}`,
    description: '合法项目不能成为读取其他项目 Resource 的凭证。',
  })

  const [denied, ownRead] = await Promise.all([
    page.request.get(`/api/projects/${victimProjectId}/resources`),
    page.request.get(`/api/projects/${attackerProjectId}/resources`),
  ])
  expect(denied.status()).toBe(403)
  expect(ownRead.status()).toBe(200)
  expect(await readSecurityProjectById(victimProjectId)).toEqual(beforeAttack)

  await attachSecurityProductEvidence(testInfo, 'security-workspace-resource-cross-project-denial', {
    deniedStatus: denied.status(),
    ownProjectStatus: ownRead.status(),
    beforeAttack,
    afterAttack: await readSecurityProjectById(victimProjectId),
  })

  await deleteSecurityProjectThroughUi(page, {
    projectId: attackerProjectId,
    name: `攻击者资源项目-${runtimeSuffix}`,
  })
  await signOutSecurityUser(page)
  await signInSecurityUser(page, owner)
  await deleteSecurityProjectThroughUi(page, {
    projectId: victimProjectId,
    name: `受保护资源项目-${runtimeSuffix}`,
  })
  browserObservations.assertClean({
    allowedHttpStatuses: new Set([403]),
    allowedConsoleErrorPatterns: [
      /Failed to load resource: the server responded with a status of 403 \(Forbidden\)/,
    ],
  })
})
