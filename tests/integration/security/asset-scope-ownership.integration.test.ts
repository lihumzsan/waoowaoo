import { beforeEach, describe, expect, it } from 'vitest'
import {
  requireOwnedAssetProject,
  requireOwnedAssetTarget,
  requireOwnedAssetVariant,
} from '@/lib/assets/services/asset-scope-ownership'
import { copyAssetFromGlobal } from '@/lib/assets/services/asset-actions'
import { commitProjectAssetRenderUpload } from '@/lib/assets/services/project-upload-render'
import { resetSystemState } from '../../helpers/db-reset'
import { createTestProject, createTestUser } from '../../helpers/billing-fixtures'
import { prisma } from '../../helpers/prisma'

async function seedScopeGraph() {
  const owner = await createTestUser()
  const foreign = await createTestUser()
  const ownerProject = await createTestProject(owner.id)
  const foreignProject = await createTestProject(foreign.id)
  const ownerCharacter = await prisma.projectCharacter.create({
    data: { projectId: ownerProject.id, name: 'owner character' },
  })
  const ownerAppearance = await prisma.characterAppearance.create({
    data: {
      characterId: ownerCharacter.id,
      appearanceIndex: 0,
      changeReason: 'primary',
      description: 'owner description',
      imageUrls: '[]',
      previousImageUrls: '[]',
    },
  })
  const foreignCharacter = await prisma.projectCharacter.create({
    data: { projectId: foreignProject.id, name: 'foreign character' },
  })
  const foreignAppearance = await prisma.characterAppearance.create({
    data: {
      characterId: foreignCharacter.id,
      appearanceIndex: 0,
      changeReason: 'primary',
      description: 'foreign description',
      imageUrls: '[]',
      previousImageUrls: '[]',
    },
  })
  const ownerLocation = await prisma.projectLocation.create({
    data: { projectId: ownerProject.id, name: 'owner location', assetKind: 'location' },
  })
  const ownerLocationImage = await prisma.locationImage.create({
    data: { locationId: ownerLocation.id, imageIndex: 0, description: 'owner location image' },
  })
  const ownerProp = await prisma.projectLocation.create({
    data: { projectId: ownerProject.id, name: 'owner prop', assetKind: 'prop' },
  })
  const ownerPropImage = await prisma.locationImage.create({
    data: { locationId: ownerProp.id, imageIndex: 0, description: 'owner prop image' },
  })
  const ownerGlobalCharacter = await prisma.globalCharacter.create({
    data: { userId: owner.id, name: 'owner global character' },
  })
  const ownerGlobalAppearance = await prisma.globalCharacterAppearance.create({
    data: {
      characterId: ownerGlobalCharacter.id,
      appearanceIndex: 0,
      changeReason: 'primary',
      description: 'owner global description',
      imageUrls: '[]',
      previousImageUrls: '[]',
    },
  })
  const foreignGlobalCharacter = await prisma.globalCharacter.create({
    data: { userId: foreign.id, name: 'foreign global character' },
  })
  await prisma.globalCharacterAppearance.create({
    data: {
      characterId: foreignGlobalCharacter.id,
      appearanceIndex: 0,
      changeReason: 'primary',
      description: 'foreign global description',
      imageUrls: '[]',
      previousImageUrls: '[]',
    },
  })
  const ownerGlobalLocation = await prisma.globalLocation.create({
    data: { userId: owner.id, name: 'owner global location', assetKind: 'location' },
  })
  const ownerGlobalLocationImage = await prisma.globalLocationImage.create({
    data: { locationId: ownerGlobalLocation.id, imageIndex: 0, description: 'owner global location image' },
  })
  const ownerGlobalProp = await prisma.globalLocation.create({
    data: { userId: owner.id, name: 'owner global prop', assetKind: 'prop' },
  })
  const ownerGlobalPropImage = await prisma.globalLocationImage.create({
    data: { locationId: ownerGlobalProp.id, imageIndex: 0, description: 'owner global prop image' },
  })
  return {
    owner,
    foreign,
    ownerProject,
    foreignProject,
    ownerCharacter,
    ownerAppearance,
    foreignCharacter,
    foreignAppearance,
    ownerLocation,
    ownerLocationImage,
    ownerProp,
    ownerPropImage,
    ownerGlobalCharacter,
    ownerGlobalAppearance,
    foreignGlobalCharacter,
    ownerGlobalLocation,
    ownerGlobalLocationImage,
    ownerGlobalProp,
    ownerGlobalPropImage,
  }
}

describe('asset scope ownership real-MySQL conformance', () => {
  beforeEach(async () => {
    await resetSystemState()
  })

  it('admits every exact global/project kind and rejects foreign or wrong-kind opaque IDs', async () => {
    const graph = await seedScopeGraph()
    const projectAccess = {
      scope: 'project' as const,
      userId: graph.owner.id,
      projectId: graph.ownerProject.id,
    }
    const globalAccess = { scope: 'global' as const, userId: graph.owner.id }

    await expect(requireOwnedAssetProject(projectAccess)).resolves.toBe(graph.ownerProject.id)
    await expect(requireOwnedAssetTarget({ access: projectAccess, kind: 'character', assetId: graph.ownerCharacter.id })).resolves.toBeUndefined()
    await expect(requireOwnedAssetTarget({ access: projectAccess, kind: 'location', assetId: graph.ownerLocation.id })).resolves.toBeUndefined()
    await expect(requireOwnedAssetTarget({ access: projectAccess, kind: 'prop', assetId: graph.ownerProp.id })).resolves.toBeUndefined()
    await expect(requireOwnedAssetTarget({ access: globalAccess, kind: 'character', assetId: graph.ownerGlobalCharacter.id })).resolves.toBeUndefined()
    await expect(requireOwnedAssetTarget({ access: globalAccess, kind: 'location', assetId: graph.ownerGlobalLocation.id })).resolves.toBeUndefined()
    await expect(requireOwnedAssetTarget({ access: globalAccess, kind: 'prop', assetId: graph.ownerGlobalProp.id })).resolves.toBeUndefined()

    await expect(requireOwnedAssetTarget({ access: projectAccess, kind: 'character', assetId: graph.foreignCharacter.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(requireOwnedAssetTarget({ access: projectAccess, kind: 'prop', assetId: graph.ownerLocation.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(requireOwnedAssetTarget({ access: globalAccess, kind: 'character', assetId: graph.foreignGlobalCharacter.id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('binds every variant to its exact owner, parent asset, scope and kind', async () => {
    const graph = await seedScopeGraph()
    const projectAccess = {
      scope: 'project' as const,
      userId: graph.owner.id,
      projectId: graph.ownerProject.id,
    }
    const globalAccess = { scope: 'global' as const, userId: graph.owner.id }
    const admitted = [
      { access: projectAccess, kind: 'character' as const, assetId: graph.ownerCharacter.id, variantId: graph.ownerAppearance.id },
      { access: projectAccess, kind: 'location' as const, assetId: graph.ownerLocation.id, variantId: graph.ownerLocationImage.id },
      { access: projectAccess, kind: 'prop' as const, assetId: graph.ownerProp.id, variantId: graph.ownerPropImage.id },
      { access: globalAccess, kind: 'character' as const, assetId: graph.ownerGlobalCharacter.id, variantId: graph.ownerGlobalAppearance.id },
      { access: globalAccess, kind: 'location' as const, assetId: graph.ownerGlobalLocation.id, variantId: graph.ownerGlobalLocationImage.id },
      { access: globalAccess, kind: 'prop' as const, assetId: graph.ownerGlobalProp.id, variantId: graph.ownerGlobalPropImage.id },
    ]
    for (const identity of admitted) {
      await expect(requireOwnedAssetVariant(identity)).resolves.toBeUndefined()
    }
    await expect(requireOwnedAssetVariant({
      access: projectAccess,
      kind: 'character',
      assetId: graph.ownerCharacter.id,
      variantId: graph.foreignAppearance.id,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(requireOwnedAssetVariant({
      access: projectAccess,
      kind: 'location',
      assetId: graph.ownerLocation.id,
      variantId: graph.ownerPropImage.id,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects a foreign copy before deleting target variants and commits a valid copy completely', async () => {
    const graph = await seedScopeGraph()
    const before = await prisma.characterAppearance.findMany({
      where: { characterId: graph.ownerCharacter.id },
      select: { id: true, description: true },
    })
    await expect(copyAssetFromGlobal({
      kind: 'character',
      targetId: graph.ownerCharacter.id,
      globalAssetId: graph.foreignGlobalCharacter.id,
      access: {
        userId: graph.foreign.id,
        projectId: graph.foreignProject.id,
      },
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(prisma.characterAppearance.findMany({
      where: { characterId: graph.ownerCharacter.id },
      select: { id: true, description: true },
    })).resolves.toEqual(before)

    await prisma.$transaction(async (transaction) => {
      await copyAssetFromGlobal({
        kind: 'character',
        targetId: graph.ownerCharacter.id,
        globalAssetId: graph.ownerGlobalCharacter.id,
        access: {
          userId: graph.owner.id,
          projectId: graph.ownerProject.id,
        },
      }, transaction)
    })
    await expect(prisma.projectCharacter.findUniqueOrThrow({
      where: { id: graph.ownerCharacter.id },
      select: {
        sourceGlobalCharacterId: true,
        appearances: { select: { description: true } },
      },
    })).resolves.toEqual({
      sourceGlobalCharacterId: graph.ownerGlobalCharacter.id,
      appearances: [{ description: 'owner global description' }],
    })
  })

  it('rejects a stale prepared upload instead of overwriting a newer character render', async () => {
    const graph = await seedScopeGraph()
    const input = {
      userId: graph.owner.id,
      projectId: graph.ownerProject.id,
      kind: 'character' as const,
      assetId: graph.ownerCharacter.id,
      appearanceId: graph.ownerAppearance.id,
      imageIndex: 0,
    }
    const preparedVersion = graph.ownerAppearance.updatedAt.getTime()

    await expect(prisma.$transaction(async (transaction) => (
      await commitProjectAssetRenderUpload(input, {
        kind: 'character',
        imageKey: 'uploads/first-render.jpg',
        appearanceId: graph.ownerAppearance.id,
        appearanceUpdatedAtMs: preparedVersion,
      }, transaction)
    ))).resolves.toMatchObject({ success: true, imageKey: 'uploads/first-render.jpg' })

    await expect(prisma.$transaction(async (transaction) => (
      await commitProjectAssetRenderUpload(input, {
        kind: 'character',
        imageKey: 'uploads/stale-render.jpg',
        appearanceId: graph.ownerAppearance.id,
        appearanceUpdatedAtMs: preparedVersion,
      }, transaction)
    ))).rejects.toThrow('PROJECT_CHARACTER_APPEARANCE_CHANGED_DURING_UPLOAD')

    const persisted = await prisma.characterAppearance.findUniqueOrThrow({
      where: { id: graph.ownerAppearance.id },
      select: { imageUrl: true, imageUrls: true },
    })
    expect(persisted.imageUrl).toBe('uploads/first-render.jpg')
    expect(JSON.parse(persisted.imageUrls ?? '[]')).toEqual(['uploads/first-render.jpg'])
  })
})
