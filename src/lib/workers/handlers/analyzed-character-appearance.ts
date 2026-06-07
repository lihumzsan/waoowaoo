import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'

export type CharacterAnalysisDb = {
  projectCharacter: {
    create(args: Record<string, unknown>): Promise<{ id: string }>
  }
  characterAppearance: {
    create(args: Record<string, unknown>): Promise<unknown>
  }
}

type AppearanceSeed = {
  changeReason: string
  descriptions: string[]
}

export function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => readText(item).trim())
    .filter(Boolean)
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is Record<string, unknown> =>
    typeof item === 'object' && item !== null && !Array.isArray(item),
  )
}

function readAppearanceChangeReason(value: Record<string, unknown>, index: number): string {
  return readText(value.change_reason).trim()
    || readText(value.changeReason).trim()
    || (index === 0 ? '初始形象' : `形象 ${index + 1}`)
}

export function readAnalyzedCharacterAppearances(character: Record<string, unknown>): AppearanceSeed[] {
  const rawAppearances = readRecordArray(character.appearances)
  if (rawAppearances.length === 0) {
    throw new Error(`ANALYZED_CHARACTER_APPEARANCES_MISSING:${readText(character.name).trim() || 'unknown'}`)
  }

  return rawAppearances.map((appearance, index) => {
    const descriptions = toStringArray(appearance.descriptions)
    if (descriptions.length === 0) {
      const singleDescription = readText(appearance.description).trim()
      if (singleDescription) descriptions.push(singleDescription)
    }
    if (descriptions.length === 0) {
      throw new Error(`ANALYZED_CHARACTER_APPEARANCE_DESCRIPTIONS_MISSING:${readText(character.name).trim() || 'unknown'}:${index + 1}`)
    }

    return {
      changeReason: readAppearanceChangeReason(appearance, index),
      descriptions,
    }
  })
}

export function buildCharacterProfileData(character: Record<string, unknown>) {
  const expectedAppearanceRecords = readRecordArray(character.expected_appearances)
  const appearanceRecords = expectedAppearanceRecords.length > 0
    ? expectedAppearanceRecords
    : readRecordArray(character.appearances)

  return {
    archetype: character.archetype,
    personality_tags: toStringArray(character.personality_tags),
    era_period: character.era_period,
    social_class: character.social_class,
    occupation: character.occupation,
    suggested_colors: toStringArray(character.suggested_colors),
    primary_identifier: character.primary_identifier,
    visual_keywords: toStringArray(character.visual_keywords),
    gender: character.gender,
    age_range: character.age_range,
    style_alignment_notes: character.style_alignment_notes,
    expected_appearances: appearanceRecords.map((appearance, index) => ({
      id: typeof appearance.id === 'number' ? appearance.id : index + 1,
      change_reason: readAppearanceChangeReason(appearance, index),
    })),
  }
}

export async function createProjectCharacterWithAnalyzedAppearances(params: {
  db: CharacterAnalysisDb
  projectId: string
  character: Record<string, unknown>
  name: string
  aliases: string[]
  introduction?: string
}) {
  const appearances = readAnalyzedCharacterAppearances(params.character)
  const created = await params.db.projectCharacter.create({
    data: {
      projectId: params.projectId,
      name: params.name,
      aliases: JSON.stringify(params.aliases),
      introduction: params.introduction || null,
      profileData: JSON.stringify(buildCharacterProfileData(params.character)),
      profileConfirmed: true,
    },
    select: { id: true },
  })

  for (let index = 0; index < appearances.length; index += 1) {
    const appearance = appearances[index]
    await params.db.characterAppearance.create({
      data: {
        characterId: created.id,
        appearanceIndex: index,
        changeReason: appearance.changeReason,
        description: appearance.descriptions[0] || '',
        descriptions: JSON.stringify(appearance.descriptions),
        imageUrls: encodeImageUrls([]),
        previousImageUrls: encodeImageUrls([]),
      },
    })
  }

  return created
}
