import { aiDesign } from '@/lib/asset-utils/ai-design'
import type { Locale } from '@/i18n/routing'
import { formatLocationAvailableSlotsText } from '@/lib/location-available-slots'
import type { EditAssetRequirement, EditScriptShot, EditScriptStyleBible } from './types'

interface DesignEditAssetRequirementsInput {
  readonly userId: string
  readonly projectId: string
  readonly locale: Locale
  readonly analysisModel: string
  readonly userPrompt: string
  readonly styleBible: EditScriptStyleBible
  readonly shots: readonly EditScriptShot[]
  readonly requirements: readonly EditAssetRequirement[]
}

interface BuildEditAssetDesignInstructionInput {
  readonly userPrompt: string
  readonly styleBible: EditScriptStyleBible
  readonly requirement: EditAssetRequirement
  readonly shots: readonly EditScriptShot[]
}

function linkedShotContext(requirement: EditAssetRequirement, shots: readonly EditScriptShot[]): readonly EditScriptShot[] {
  const linkedShotNumbers = new Set(requirement.shotNumbers)
  return shots.filter((shot) => linkedShotNumbers.has(shot.shotNumber))
}

export function buildEditAssetDesignInstruction(input: BuildEditAssetDesignInstructionInput): string {
  return JSON.stringify({
    task: 'design_edit_first_required_asset_for_image_generation',
    userRequest: input.userPrompt,
    styleBible: input.styleBible,
    asset: {
      kind: input.requirement.kind,
      name: input.requirement.name,
      extractionNotes: input.requirement.description,
      fixedVoiceTimbreText: input.requirement.voiceTimbreText ?? null,
      linkedShotNumbers: input.requirement.shotNumbers,
    },
    linkedShots: linkedShotContext(input.requirement, input.shots).map((shot) => ({
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      dramaticPurpose: shot.dramaticPurpose,
      visibleAction: shot.visibleAction,
      audienceFocus: shot.audienceFocus,
      viewpoint: shot.viewpoint,
      revealPlan: shot.revealPlan,
      performanceBeat: shot.performanceBeat,
      continuityIn: shot.continuityIn,
      continuityOut: shot.continuityOut,
      charactersAndScene: shot.charactersAndScene,
      sound: shot.sound,
    })),
    constraints: [
      'Create one stable reusable asset description for the asset library.',
      'Use only visual facts implied by the edit table and user request.',
      'Use styleBible.stylePolicy.visual as the only asset-level visual policy.',
      'The asset description must include stable lighting, color palette, material texture, composition, image-filter traits, and visual bans from the Style Bible that can directly guide image generation.',
      'Do not describe transient shot action, facial expression, camera movement, dialogue, sound, or plot function inside the asset appearance.',
      'For character assets, preserve fixedVoiceTimbreText exactly as a stable voice identity field. It is not part of the image prompt.',
      'For character assets, describe the character itself without background or pose.',
      'For location assets, describe the empty reusable environment with clear layout anchors and no named main characters.',
    ],
  }, null, 2)
}

export async function designEditAssetRequirements(
  input: DesignEditAssetRequirementsInput,
): Promise<EditAssetRequirement[]> {
  return await Promise.all(input.requirements.map(async (requirement): Promise<EditAssetRequirement> => {
    const design = await aiDesign({
      userId: input.userId,
      locale: input.locale,
      analysisModel: input.analysisModel,
      userInstruction: buildEditAssetDesignInstruction({
        userPrompt: input.userPrompt,
        styleBible: input.styleBible,
        requirement,
        shots: input.shots,
      }),
      assetType: requirement.kind,
      projectId: input.projectId,
    })

    if (!design.success || !design.prompt?.trim()) {
      throw new Error(`EDIT_SCRIPT_ASSET_DESIGN_FAILED:${requirement.kind}:${requirement.name}:${design.error ?? 'empty prompt'}`)
    }

    const slotText = requirement.kind === 'location'
      ? formatLocationAvailableSlotsText(design.availableSlots ?? [], input.locale === 'en' ? 'en' : 'zh')
      : ''
    const description = slotText ? `${design.prompt.trim()}\n${slotText}` : design.prompt.trim()

    return {
      ...requirement,
      description,
      voiceTimbreText: requirement.kind === 'character' ? requirement.voiceTimbreText?.trim() ?? null : null,
    }
  }))
}
