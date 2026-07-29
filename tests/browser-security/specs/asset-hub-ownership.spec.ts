import { expect, test } from '../browser/test'
import {
  registerSecurityUser,
  signInSecurityUser,
  signOutSecurityUser,
} from '../browser/pages/auth'
import {
  createSecurityGlobalCharacterThroughUi,
  createSecurityProjectCharacterThroughUi,
} from '../browser/pages/assets'
import {
  createSecurityProjectThroughUi,
  deleteSecurityProjectThroughUi,
} from '../browser/pages/projects'
import { readSecurityProjectCharacter } from '../oracle/reader'
import { attachSecurityProductEvidence } from '../oracle/product-evidence'

const runtimeSuffix = process.env.SECURITY_RUNTIME_ID?.slice(0, 12) ?? 'local'
const victim = {
  username: `security-asset-victim-${runtimeSuffix}`,
  password: 'security-asset-victim-password',
}
const attacker = {
  username: `security-asset-attacker-${runtimeSuffix}`,
  password: 'security-asset-attacker-password',
}

test('[SEC-ASSET-CROSS-PROJECT-DENIAL] an authenticated project cannot overwrite an asset owned by another project', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerSecurityUser(page, victim)
  const victimProjectId = await createSecurityProjectThroughUi(page, {
    name: `受保护资产项目-${runtimeSuffix}`,
    description: '目标角色属于另一个用户的项目。',
  })
  const victimCharacterId = await createSecurityProjectCharacterThroughUi(page, {
    projectId: victimProjectId,
    name: `受保护角色-${runtimeSuffix}`,
    description: '越权复制不能覆盖这段描述。',
  })
  const beforeAttack = await readSecurityProjectCharacter({
    characterId: victimCharacterId,
    projectId: victimProjectId,
  })
  expect(beforeAttack).not.toBeNull()

  await signOutSecurityUser(page)
  await registerSecurityUser(page, attacker)
  const attackerGlobalId = await createSecurityGlobalCharacterThroughUi(page, {
    name: `攻击者全局角色-${runtimeSuffix}`,
    description: '这段描述绝不能进入受保护项目。',
  })
  const attackerProjectId = await createSecurityProjectThroughUi(page, {
    name: `攻击者项目-${runtimeSuffix}`,
    description: '请求通过这个合法项目取得鉴权。',
  })

  const denied = await page.request.post(`/api/assets/${victimCharacterId}/copy`, {
    data: {
      kind: 'character',
      projectId: attackerProjectId,
      globalAssetId: attackerGlobalId,
    },
  })
  expect(denied.status()).toBe(404)

  const afterAttack = await readSecurityProjectCharacter({
    characterId: victimCharacterId,
    projectId: victimProjectId,
  })
  expect(afterAttack).toEqual(beforeAttack)
  await attachSecurityProductEvidence(testInfo, 'security-asset-hub-cross-project-denial', {
    deniedStatus: denied.status(),
    beforeAttack,
    afterAttack,
  })

  await deleteSecurityProjectThroughUi(page, {
    projectId: attackerProjectId,
    name: `攻击者项目-${runtimeSuffix}`,
  })
  await signOutSecurityUser(page)
  await signInSecurityUser(page, victim)
  await deleteSecurityProjectThroughUi(page, {
    projectId: victimProjectId,
    name: `受保护资产项目-${runtimeSuffix}`,
  })
  browserObservations.assertClean()
})
