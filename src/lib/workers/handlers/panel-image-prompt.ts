import { type TaskJobData } from '@/lib/task/types'
import { buildAiPrompt as buildPrompt, AI_PROMPT_IDS as PROMPT_IDS } from '@/lib/ai-prompts'
import {
  findAppearanceForStoryboardReference,
  findCharacterForStoryboardReference,
  type StoryboardPanelCharacterReference,
} from '@/lib/storyboard-character-bindings'
import {
  parsePanelCharacterReferences,
  type NumberedReferenceImage,
  type NovelProjectData,
} from './image-task-handler-shared'

function parseJsonUnknown(raw: string | null | undefined): unknown | null {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parseDescriptionList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

function pickAppearanceDescription(appearance: {
  descriptions?: string | null
  description?: string | null
  selectedIndex?: number | null
}): string {
  const descriptions = parseDescriptionList(appearance.descriptions || null)
  if (descriptions.length > 0) {
    const selectedIndex = typeof appearance.selectedIndex === 'number' ? appearance.selectedIndex : 0
    const selected = descriptions[selectedIndex] || descriptions[0]
    if (selected && selected.trim()) return selected.trim()
  }
  if (typeof appearance.description === 'string' && appearance.description.trim()) {
    return appearance.description.trim()
  }
  return '无描述'
}

export type PanelPromptSource = {
  id: string
  shotType: string | null
  cameraMove: string | null
  description: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  location: string | null
  characters: string | null
  srtSegment: string | null
  photographyRules: string | null
  actingNotes: string | null
}

export function buildPanelPromptContext(params: {
  panel: PanelPromptSource
  projectData: NovelProjectData
  referenceImageNotes?: string[]
  referenceImagesMap: NumberedReferenceImage[]
}) {
  const panelCharacters = parsePanelCharacterReferences(params.panel.characters)
  const characterContexts = panelCharacters.map((reference) => {
    const character = findCharacterForStoryboardReference(
      params.projectData.characters || [],
      reference as StoryboardPanelCharacterReference,
    )
    if (!character) {
      return {
        name: reference.name,
        appearance: reference.appearance || null,
        description: '无角色外貌数据',
      }
    }

    const appearances = character.appearances || []
    const matchedAppearance = findAppearanceForStoryboardReference(
      appearances,
      reference as StoryboardPanelCharacterReference,
    ) || null

    return {
      name: character.name,
      characterId: character.id || reference.characterId || null,
      appearanceId: matchedAppearance?.id || reference.appearanceId || null,
      appearance: matchedAppearance?.changeReason || null,
      description: matchedAppearance ? pickAppearanceDescription(matchedAppearance) : '无角色外貌数据',
      slot: reference.slot || null,
    }
  })

  const photographyRules = parseJsonUnknown(params.panel.photographyRules)
  const photographyRuleRecord = photographyRules && typeof photographyRules === 'object' && !Array.isArray(photographyRules)
    ? photographyRules as Record<string, unknown>
    : {}
  const consistencyMetadataRecord = photographyRuleRecord.consistencyMetadata
    && typeof photographyRuleRecord.consistencyMetadata === 'object'
    && !Array.isArray(photographyRuleRecord.consistencyMetadata)
    ? photographyRuleRecord.consistencyMetadata as Record<string, unknown>
    : {}
  const cameraPlanSource = photographyRuleRecord.cameraPlan ?? consistencyMetadataRecord.cameraPlan
  const cameraPlanRecord = cameraPlanSource && typeof cameraPlanSource === 'object' && !Array.isArray(cameraPlanSource)
    ? cameraPlanSource as Record<string, unknown>
    : {}
  const shotBlocking = cameraPlanRecord.shotBlocking ?? photographyRuleRecord.shotBlocking ?? null

  const locationContext = (() => {
    if (!params.panel.location) return null
    const matchedLocation = (params.projectData.locations || []).find(
      (item) => item.name.toLowerCase() === params.panel.location!.toLowerCase(),
    )
    if (!matchedLocation) return null
    const selectedImage = (matchedLocation.images || []).find((item) => item.isSelected) || matchedLocation.images?.[0]
    return {
      name: matchedLocation.name,
      description: selectedImage?.description || null,
      spatial_profile: selectedImage && 'spatialProfileJson' in selectedImage ? selectedImage.spatialProfileJson ?? null : null,
    }
  })()

  return {
    panel: {
      panel_id: params.panel.id,
      shot_type: params.panel.shotType || '',
      camera_move: params.panel.cameraMove || '',
      description: params.panel.description || '',
      image_prompt: params.panel.imagePrompt || '',
      video_prompt: params.panel.videoPrompt || '',
      location: params.panel.location || '',
      characters: panelCharacters,
      source_text: params.panel.srtSegment || '',
      photography_rules: photographyRules,
      shot_blocking: shotBlocking,
      acting_notes: parseJsonUnknown(params.panel.actingNotes),
    },
    context: {
      character_appearances: characterContexts,
      location_reference: locationContext,
      reference_images: params.referenceImagesMap,
      additional_reference_images: (params.referenceImageNotes || []).map((note, index) => ({
        reference_image_order: index + 1,
        note,
      })),
    },
  }
}

export function buildPanelPrompt(params: {
  locale: TaskJobData['locale']
  aspectRatio: string
  styleText: string
  sourceText: string
  contextJson: string
}) {
  return buildPrompt({
    promptId: PROMPT_IDS.PANEL_IMAGE_GENERATE,
    locale: params.locale,
    variables: {
      aspect_ratio: params.aspectRatio,
      storyboard_text_json_input: params.contextJson,
      source_text: params.sourceText || '无',
      style: params.styleText,
    },
  })
}

export function buildPanelGridPrompt(params: {
  locale: TaskJobData['locale']
  aspectRatio: string
  sourceText: string
  contextJson: string
  styleText: string
}) {
  return buildPrompt({
    promptId: PROMPT_IDS.PANEL_GRID_IMAGE_GENERATE,
    locale: params.locale,
    variables: {
      aspect_ratio: params.aspectRatio,
      storyboard_grid_json_input: params.contextJson,
      source_text: params.sourceText || '无',
      style: params.styleText,
    },
  })
}
