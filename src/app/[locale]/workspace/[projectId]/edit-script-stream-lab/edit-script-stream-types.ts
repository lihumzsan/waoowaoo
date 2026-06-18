import type { ProjectEditScriptShot } from '@/types/project'

export const SHOT_GRID_COLUMNS = 3

export type StreamPhase = 'loading' | 'empty' | 'streaming' | 'paused' | 'complete'
export type StreamEffectMode = 'soft' | 'scan' | 'hologram' | 'cascade'

export type LabelReader = (key: string, values?: Record<string, string | number>) => string

export const STREAM_EFFECT_MODES: readonly StreamEffectMode[] = ['soft', 'scan', 'hologram', 'cascade']

export interface EpisodeOption {
  readonly id: string
  readonly name: string
  readonly episodeNumber?: number | null
}

export interface DetailField {
  readonly key: string
  readonly label: string
  readonly value: string
  readonly glyph: string
}

export interface DetailGroup {
  readonly key: string
  readonly title: string
  readonly glyph: string
  readonly fields: readonly DetailField[]
}

interface FieldDefinition {
  readonly key: string
  readonly labelKey: string
  readonly glyph: string
  readonly readValue: (shot: ProjectEditScriptShot) => string
}

const narrativeFieldDefinitions: readonly FieldDefinition[] = [
  {
    key: 'dramaticPurpose',
    labelKey: 'dramaticPurpose',
    glyph: 'target',
    readValue: (shot) => shot.dramaticPurpose,
  },
  {
    key: 'visibleAction',
    labelKey: 'visibleAction',
    glyph: 'motion',
    readValue: (shot) => shot.visibleAction,
  },
  {
    key: 'audienceFocus',
    labelKey: 'audienceFocus',
    glyph: 'eye',
    readValue: (shot) => shot.audienceFocus,
  },
  {
    key: 'viewpoint',
    labelKey: 'viewpoint',
    glyph: 'perspective',
    readValue: (shot) => shot.viewpoint,
  },
  {
    key: 'revealPlan',
    labelKey: 'revealPlan',
    glyph: 'info',
    readValue: (shot) => shot.revealPlan,
  },
  {
    key: 'performanceBeat',
    labelKey: 'performanceBeat',
    glyph: 'pulse',
    readValue: (shot) => shot.performanceBeat,
  },
  {
    key: 'charactersAndScene',
    labelKey: 'charactersAndScene',
    glyph: 'people',
    readValue: (shot) => shot.charactersAndScene,
  },
] as const

const soundFieldDefinitions: readonly FieldDefinition[] = [
  {
    key: 'duration',
    labelKey: 'duration',
    glyph: 'clock',
    readValue: (shot) => `${shot.durationSec}s`,
  },
  {
    key: 'sound',
    labelKey: 'sound',
    glyph: 'sound',
    readValue: (shot) => shot.sound,
  },
] as const

const continuityFieldDefinitions: readonly FieldDefinition[] = [
  {
    key: 'continuityIn',
    labelKey: 'continuityIn',
    glyph: 'link',
    readValue: (shot) => shot.continuityIn,
  },
  {
    key: 'continuityOut',
    labelKey: 'continuityOut',
    glyph: 'link',
    readValue: (shot) => shot.continuityOut,
  },
] as const

export const DETAIL_FIELD_COUNT =
  narrativeFieldDefinitions.length +
  soundFieldDefinitions.length +
  continuityFieldDefinitions.length

export function sortEpisodes(episodes: readonly EpisodeOption[]): readonly EpisodeOption[] {
  return [...episodes].sort((left, right) => {
    const leftNumber = typeof left.episodeNumber === 'number' ? left.episodeNumber : Number.POSITIVE_INFINITY
    const rightNumber = typeof right.episodeNumber === 'number' ? right.episodeNumber : Number.POSITIVE_INFINITY
    if (leftNumber !== rightNumber) return leftNumber - rightNumber
    return left.name.localeCompare(right.name)
  })
}

export function chunkItems<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}

export function flattenGroups(groups: readonly DetailGroup[]): readonly DetailField[] {
  return groups.flatMap((group) => group.fields)
}

function isVisibleValue(value: string): boolean {
  return value.trim().length > 0
}

function buildGroupFields(
  shot: ProjectEditScriptShot,
  definitions: readonly FieldDefinition[],
  fieldLabels: LabelReader,
): readonly DetailField[] {
  return definitions
    .map((definition) => ({
      key: definition.key,
      label: fieldLabels(definition.labelKey),
      value: definition.readValue(shot),
      glyph: definition.glyph,
    }))
    .filter((field) => isVisibleValue(field.value))
}

export function buildShotDetailGroups(
  shot: ProjectEditScriptShot,
  fieldLabels: LabelReader,
  labLabels: LabelReader,
): readonly DetailGroup[] {
  return [
    {
      key: 'narrative',
      title: labLabels('groups.narrative'),
      glyph: 'target',
      fields: buildGroupFields(shot, narrativeFieldDefinitions, fieldLabels),
    },
    {
      key: 'sound',
      title: labLabels('groups.sound'),
      glyph: 'sound',
      fields: buildGroupFields(shot, soundFieldDefinitions, fieldLabels),
    },
    {
      key: 'continuity',
      title: labLabels('groups.continuity'),
      glyph: 'link',
      fields: buildGroupFields(shot, continuityFieldDefinitions, fieldLabels),
    },
  ].filter((group) => group.fields.length > 0)
}
