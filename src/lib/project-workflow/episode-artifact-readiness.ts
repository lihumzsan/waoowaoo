export type EpisodeArtifactReadiness = {
  hasStory: boolean
  hasScript: boolean
  hasStoryboard: boolean
  hasVideo: boolean
}

type StoryboardPanelLike = {
  videoUrl?: string | null
  [key: string]: unknown
}

type EpisodeScriptLike = {
  content?: string | null
  scriptText?: string | null
  bible?: unknown | null
  beatSheet?: unknown | null
  ledger?: unknown | null
  emotionalCurve?: unknown | null
  [key: string]: unknown
}

type StoryboardLike = {
  panels?: StoryboardPanelLike[] | null
  [key: string]: unknown
}

type EpisodeLike = {
  novelText?: string | null
  editScript?: unknown | null
  editBible?: unknown | null
  storyboards?: unknown[] | null
}

function hasNonEmptyText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasStructuredValue(value: unknown) {
  return typeof value === 'object' && value !== null
}

function isEpisodeScriptLike(value: unknown): value is EpisodeScriptLike {
  return typeof value === 'object' && value !== null
}

function isStoryboardPanelLike(value: unknown): value is StoryboardPanelLike {
  return typeof value === 'object' && value !== null
}

function isStoryboardLike(value: unknown): value is StoryboardLike {
  return typeof value === 'object' && value !== null
}

export function hasScriptArtifacts(script: unknown | null | undefined) {
  if (!isEpisodeScriptLike(script)) return false
  return hasNonEmptyText(script.content)
    || hasNonEmptyText(script.scriptText)
    || hasNonEmptyText(typeof script.bible === 'string' ? script.bible : null)
    || hasStructuredValue(script.bible)
    || hasStructuredValue(script.beatSheet)
    || hasStructuredValue(script.ledger)
    || hasStructuredValue(script.emotionalCurve)
}

export function hasStoryboardArtifacts(storyboards: unknown[] | null | undefined) {
  if (!Array.isArray(storyboards) || storyboards.length === 0) return false
  return storyboards.some((storyboard) => isStoryboardLike(storyboard)
    && Array.isArray(storyboard.panels)
    && storyboard.panels.some((panel) => isStoryboardPanelLike(panel)))
}

export function hasVideoArtifacts(storyboards: unknown[] | null | undefined) {
  if (!Array.isArray(storyboards) || storyboards.length === 0) return false
  return storyboards.some((storyboard) => isStoryboardLike(storyboard)
    && Array.isArray(storyboard.panels)
    && storyboard.panels.some((panel) => isStoryboardPanelLike(panel) && hasNonEmptyText(panel.videoUrl)))
}

export function resolveEpisodeArtifactReadiness(episode: EpisodeLike | null | undefined): EpisodeArtifactReadiness {
  return {
    hasStory: hasNonEmptyText(episode?.novelText),
    hasScript: hasScriptArtifacts(episode?.editScript) || hasScriptArtifacts(episode?.editBible),
    hasStoryboard: hasStoryboardArtifacts(episode?.storyboards),
    hasVideo: hasVideoArtifacts(episode?.storyboards),
  }
}
