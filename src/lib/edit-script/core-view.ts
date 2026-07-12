import { loadKnownPlanAssets, type KnownPlanAsset } from '@/lib/edit-chapter/asset-menu'
import { normalizeEditScriptStructure } from './normalize'
import type { EditScriptShot } from './types'

export function projectEditScriptCoreNames(
  value: unknown,
  assets: readonly KnownPlanAsset[],
): ReturnType<typeof normalizeEditScriptStructure> {
  const core = normalizeEditScriptStructure(value)
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const shots = core.shots.map((shot): EditScriptShot => {
    const location = assetById.get(shot.scene.locationId)
    if (!location || location.kind !== 'location') {
      throw new Error(`EDIT_SCRIPT_LOCATION_UNKNOWN:${shot.shotNumber}:${shot.scene.locationId}`)
    }
    return {
      ...shot,
      scene: { ...shot.scene, name: location.name },
      characters: shot.characters.map((character) => {
        const asset = assetById.get(character.characterId)
        if (!asset || asset.kind !== 'character') {
          throw new Error(`EDIT_SCRIPT_CHARACTER_UNKNOWN:${shot.shotNumber}:${character.characterId}`)
        }
        return { ...character, name: asset.name }
      }),
    }
  })
  return { ...core, shots }
}

export async function loadEditScriptCoreView(
  projectId: string,
  value: unknown,
): Promise<ReturnType<typeof normalizeEditScriptStructure>> {
  return projectEditScriptCoreNames(value, await loadKnownPlanAssets(projectId))
}
