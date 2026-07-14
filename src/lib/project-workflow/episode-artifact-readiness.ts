export type EpisodeArtifactReadiness = {
  hasStory: boolean
  hasScript: boolean
  hasVideo: boolean
}

type EpisodeScriptLike = {
  content?: string | null
  scriptText?: string | null
  bible?: unknown | null
  beatSheet?: unknown | null
  ledger?: unknown | null
  emotionalCurve?: unknown | null
}

type EpisodeLike = {
  novelText?: string | null
  editScript?: unknown | null
  editBible?: unknown | null
  videoSegments?: readonly unknown[] | null
}

function hasNonEmptyText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function hasStructuredValue(value: unknown) {
  return typeof value === 'object' && value !== null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasScriptArtifacts(script: unknown | null | undefined) {
  if (!isRecord(script)) return false
  const typed = script as EpisodeScriptLike
  return hasNonEmptyText(typed.content)
    || hasNonEmptyText(typed.scriptText)
    || hasNonEmptyText(typeof typed.bible === 'string' ? typed.bible : null)
    || hasStructuredValue(typed.bible)
    || hasStructuredValue(typed.beatSheet)
    || hasStructuredValue(typed.ledger)
    || hasStructuredValue(typed.emotionalCurve)
}

export function resolveEpisodeArtifactReadiness(episode: EpisodeLike | null | undefined): EpisodeArtifactReadiness {
  return {
    hasStory: hasNonEmptyText(episode?.novelText),
    hasScript: hasScriptArtifacts(episode?.editScript) || hasScriptArtifacts(episode?.editBible),
    hasVideo: Boolean(episode?.videoSegments?.some((segment) => {
      if (!isRecord(segment)) return false
      const media = segment.videoMedia
      return segment.status === 'completed' && isRecord(media) && hasNonEmptyText(
        typeof media.url === 'string' ? media.url : null,
      )
    })),
  }
}
