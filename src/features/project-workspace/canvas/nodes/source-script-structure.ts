export interface SourceScriptBeat {
  readonly beatIndex: number
  readonly title: string
  readonly summary: string
}

export interface SourceScriptScene {
  readonly sceneIndex: number
  readonly title: string
  readonly location: string
  readonly timeOfDay?: string | null
  readonly characters: readonly string[]
  readonly summary: string
  readonly body: string
  readonly beats: readonly SourceScriptBeat[]
}

export interface SourceScriptAct {
  readonly actIndex: number
  readonly title: string
  readonly summary: string
  readonly scenes: readonly SourceScriptScene[]
}

export interface SourceScriptEpisode {
  readonly episodeIndex: number
  readonly title: string
  readonly summary: string
  readonly acts: readonly SourceScriptAct[]
}

export interface SourceScriptStructure {
  readonly version: 1
  readonly title: string
  readonly summary: string
  readonly episodes: readonly SourceScriptEpisode[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readStructureString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStructureOptionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStructureIndex(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function readStructureStringArray(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
}

function readStructureArray(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

function readSourceScriptBeat(value: unknown): SourceScriptBeat | null {
  if (!isRecord(value)) return null
  const beatIndex = readStructureIndex(value, 'beatIndex')
  const title = readStructureString(value, 'title')
  const summary = readStructureString(value, 'summary')
  if (beatIndex === null || !title || !summary) return null
  return {
    beatIndex,
    title,
    summary,
  }
}

function readSourceScriptScene(value: unknown): SourceScriptScene | null {
  if (!isRecord(value)) return null
  const sceneIndex = readStructureIndex(value, 'sceneIndex')
  const title = readStructureString(value, 'title')
  const location = readStructureString(value, 'location')
  const summary = readStructureString(value, 'summary')
  const body = readStructureString(value, 'body')
  const beats = readStructureArray(value, 'beats')
    .map(readSourceScriptBeat)
    .filter((beat): beat is SourceScriptBeat => Boolean(beat))
  if (sceneIndex === null || !title || !location || !summary || !body || beats.length === 0) return null
  return {
    sceneIndex,
    title,
    location,
    timeOfDay: readStructureOptionalString(value, 'timeOfDay'),
    characters: readStructureStringArray(value, 'characters'),
    summary,
    body,
    beats,
  }
}

function readSourceScriptAct(value: unknown): SourceScriptAct | null {
  if (!isRecord(value)) return null
  const actIndex = readStructureIndex(value, 'actIndex')
  const title = readStructureString(value, 'title')
  const summary = readStructureString(value, 'summary')
  const scenes = readStructureArray(value, 'scenes')
    .map(readSourceScriptScene)
    .filter((scene): scene is SourceScriptScene => Boolean(scene))
  if (actIndex === null || !title || !summary || scenes.length === 0) return null
  return {
    actIndex,
    title,
    summary,
    scenes,
  }
}

function readSourceScriptEpisode(value: unknown): SourceScriptEpisode | null {
  if (!isRecord(value)) return null
  const episodeIndex = readStructureIndex(value, 'episodeIndex')
  const title = readStructureString(value, 'title')
  const summary = readStructureString(value, 'summary')
  const acts = readStructureArray(value, 'acts')
    .map(readSourceScriptAct)
    .filter((act): act is SourceScriptAct => Boolean(act))
  if (episodeIndex === null || !title || !summary || acts.length === 0) return null
  return {
    episodeIndex,
    title,
    summary,
    acts,
  }
}

export function readSourceScriptStructure(value: unknown): SourceScriptStructure | null {
  if (!isRecord(value) || value.version !== 1) return null
  const title = readStructureString(value, 'title')
  const summary = readStructureString(value, 'summary')
  const episodes = readStructureArray(value, 'episodes')
    .map(readSourceScriptEpisode)
    .filter((episode): episode is SourceScriptEpisode => Boolean(episode))
  if (!title || !summary || episodes.length === 0) return null
  return {
    version: 1,
    title,
    summary,
    episodes,
  }
}

export function countSourceScriptScenes(episode: SourceScriptEpisode): number {
  return episode.acts.reduce((total, act) => total + act.scenes.length, 0)
}

export function countSourceScriptStructureScenes(structure: SourceScriptStructure): number {
  return structure.episodes.reduce((total, episode) => total + countSourceScriptScenes(episode), 0)
}
