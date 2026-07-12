import { expect, test } from '../browser/test'
import {
  registerGoldenUser,
  signInGoldenUser,
  signOutGoldenUser,
} from '../browser/pages/auth'
import {
  createGoldenGlobalCharacterThroughUi,
  createGoldenProjectCharacterThroughUi,
} from '../browser/pages/assets'
import {
  createGoldenProjectThroughUi,
  deleteGoldenProjectThroughUi,
} from '../browser/pages/projects'
import { readGoldenProjectCharacter } from '../oracle/reader'
import { attachGoldenProductEvidence } from '../oracle/product-evidence'

const runtimeSuffix = process.env.GOLDEN_RUNTIME_ID?.slice(0, 12) ?? 'local'
const victim = {
  username: `golden-asset-victim-${runtimeSuffix}`,
  password: 'golden-asset-victim-password',
}
const attacker = {
  username: `golden-asset-attacker-${runtimeSuffix}`,
  password: 'golden-asset-attacker-password',
}

test('[GJ-ASSET-HUB-CROSS-PROJECT-DENIAL] an authenticated project cannot overwrite an asset owned by another project', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerGoldenUser(page, victim)
  const victimProjectId = await createGoldenProjectThroughUi(page, {
    name: `受保护资产项目-${runtimeSuffix}`,
    description: '目标角色属于另一个用户的项目。',
  })
  const victimCharacterId = await createGoldenProjectCharacterThroughUi(page, {
    projectId: victimProjectId,
    name: `受保护角色-${runtimeSuffix}`,
    description: '越权复制不能覆盖这段描述。',
  })
  const beforeAttack = await readGoldenProjectCharacter({
    characterId: victimCharacterId,
    projectId: victimProjectId,
  })
  expect(beforeAttack).not.toBeNull()

  await signOutGoldenUser(page)
  await registerGoldenUser(page, attacker)
  const attackerGlobalId = await createGoldenGlobalCharacterThroughUi(page, {
    name: `攻击者全局角色-${runtimeSuffix}`,
    description: '这段描述绝不能进入受保护项目。',
  })
  const attackerProjectId = await createGoldenProjectThroughUi(page, {
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

  const afterAttack = await readGoldenProjectCharacter({
    characterId: victimCharacterId,
    projectId: victimProjectId,
  })
  expect(afterAttack).toEqual(beforeAttack)
  await attachGoldenProductEvidence(testInfo, 'golden-asset-hub-cross-project-denial', {
    deniedStatus: denied.status(),
    beforeAttack,
    afterAttack,
  })

  await deleteGoldenProjectThroughUi(page, {
    projectId: attackerProjectId,
    name: `攻击者项目-${runtimeSuffix}`,
  })
  await signOutGoldenUser(page)
  await signInGoldenUser(page, victim)
  await deleteGoldenProjectThroughUi(page, {
    projectId: victimProjectId,
    name: `受保护资产项目-${runtimeSuffix}`,
  })
  browserObservations.assertClean()
})
