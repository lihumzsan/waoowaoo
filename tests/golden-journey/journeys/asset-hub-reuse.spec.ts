import { expect, test } from '../browser/test'
import { registerGoldenUser } from '../browser/pages/auth'
import {
  createGoldenGlobalCharacterThroughUi,
  createGoldenProjectCharacterThroughUi,
  deleteGoldenGlobalCharacterThroughUi,
  editGoldenGlobalCharacterDescriptionThroughUi,
  importGoldenGlobalCharacterThroughUi,
} from '../browser/pages/assets'
import {
  createGoldenProjectThroughUi,
  deleteGoldenProjectThroughUi,
} from '../browser/pages/projects'
import {
  readGoldenGlobalCharacter,
  readGoldenProjectCharacter,
  readGoldenProjectCharacterAppearanceCount,
  readGoldenUserByName,
} from '../oracle/reader'
import { attachGoldenProductEvidence } from '../oracle/product-evidence'

const runtimeSuffix = process.env.GOLDEN_RUNTIME_ID?.slice(0, 12) ?? 'local'
const user = {
  username: `golden-assets-${runtimeSuffix}`,
  password: 'golden-assets-password',
}
const globalCharacter = {
  name: `全局角色-${runtimeSuffix}`,
  description: '来自全局资产中心、可被多个项目复用的角色设定。',
}
const revisedGlobalDescription = '全局资产修改后的描述；项目副本只应在再次导入时更新。'
const projectCharacter = {
  name: `项目角色-${runtimeSuffix}`,
  description: '导入前的项目占位角色设定。',
}
const project = {
  name: `资产复用项目-${runtimeSuffix}`,
  description: '验证全局资产通过真实 UI 进入项目并在刷新后保持。',
}

test('[GJ-ASSET-HUB-PROJECT-REUSE] edit reimport and source deletion preserve one isolated durable project copy', async ({
  page,
  browserObservations,
}, testInfo) => {
  await registerGoldenUser(page, user)
  const owner = await readGoldenUserByName(user.username)
  expect(owner).not.toBeNull()
  const globalCharacterId = await createGoldenGlobalCharacterThroughUi(page, globalCharacter)
  const globalFact = await readGoldenGlobalCharacter({
    characterId: globalCharacterId,
    userId: owner?.id ?? '',
  })
  expect(globalFact).toEqual({
    id: globalCharacterId,
    userId: owner?.id,
    name: globalCharacter.name,
    appearanceDescription: globalCharacter.description,
  })

  const projectId = await createGoldenProjectThroughUi(page, project)
  const projectCharacterId = await createGoldenProjectCharacterThroughUi(page, {
    projectId,
    ...projectCharacter,
  })
  const beforeImport = await readGoldenProjectCharacter({
    characterId: projectCharacterId,
    projectId,
  })
  expect(beforeImport).toMatchObject({
    id: projectCharacterId,
    projectId,
    name: projectCharacter.name,
    sourceGlobalCharacterId: null,
    appearanceDescription: projectCharacter.description,
  })

  await importGoldenGlobalCharacterThroughUi(page, {
    targetCharacterId: projectCharacterId,
    globalCharacterName: globalCharacter.name,
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const afterImport = await readGoldenProjectCharacter({
    characterId: projectCharacterId,
    projectId,
  })
  expect(afterImport).toEqual({
    id: projectCharacterId,
    projectId,
    name: projectCharacter.name,
    sourceGlobalCharacterId: globalCharacterId,
    profileConfirmed: true,
    appearanceDescription: globalCharacter.description,
  })
  await page.goto(`/zh/workspace/${projectId}?assetLibrary=1`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator(`#project-character-${projectCharacterId}`)).toContainText(projectCharacter.name)

  await editGoldenGlobalCharacterDescriptionThroughUi(page, {
    characterId: globalCharacterId,
    description: revisedGlobalDescription,
  })
  const revisedGlobal = await readGoldenGlobalCharacter({
    characterId: globalCharacterId,
    userId: owner?.id ?? '',
  })
  expect(revisedGlobal?.appearanceDescription).toBe(revisedGlobalDescription)
  expect(await readGoldenProjectCharacter({
    characterId: projectCharacterId,
    projectId,
  })).toEqual(afterImport)

  await page.goto(`/zh/workspace/${projectId}?assetLibrary=1`, { waitUntil: 'domcontentloaded' })
  await importGoldenGlobalCharacterThroughUi(page, {
    targetCharacterId: projectCharacterId,
    globalCharacterName: globalCharacter.name,
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const afterReimport = await readGoldenProjectCharacter({
    characterId: projectCharacterId,
    projectId,
  })
  expect(afterReimport).toEqual({
    ...afterImport,
    appearanceDescription: revisedGlobalDescription,
  })
  expect(await readGoldenProjectCharacterAppearanceCount({
    characterId: projectCharacterId,
    projectId,
  })).toBe(1)

  await deleteGoldenGlobalCharacterThroughUi(page, { characterId: globalCharacterId })
  expect(await readGoldenGlobalCharacter({
    characterId: globalCharacterId,
    userId: owner?.id ?? '',
  })).toBeNull()
  await page.goto(`/zh/workspace/${projectId}?assetLibrary=1`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator(`#project-character-${projectCharacterId}`)).toContainText(projectCharacter.name)
  const afterSourceDelete = await readGoldenProjectCharacter({
    characterId: projectCharacterId,
    projectId,
  })
  expect(afterSourceDelete).toEqual(afterReimport)

  await attachGoldenProductEvidence(testInfo, 'golden-asset-hub-project-reuse', {
    globalFact,
    beforeImport,
    afterImport,
    revisedGlobal,
    afterReimport,
    afterSourceDelete,
  })
  await deleteGoldenProjectThroughUi(page, { projectId, name: project.name })
  browserObservations.assertClean()
})
