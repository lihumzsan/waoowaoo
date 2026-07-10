import {
  expandedSourceScriptOutputSchema,
  sourceScriptSceneSegmentSchema,
  type EditSourceScriptAct,
  type EditSourceScriptEpisode,
  type EditSourceScriptStructure,
  type ExpandedSourceScriptOutput,
  type SourceScriptSceneSegment,
} from './schemas'

export interface NormalizedSourceScriptSegments {
  readonly normalizedText: string
  readonly structure: EditSourceScriptStructure
}

function sameText(left: string, right: string): boolean {
  return left.trim() === right.trim()
}

function assertContinuousBeats(segment: SourceScriptSceneSegment): void {
  segment.beats.forEach((beat, index) => {
    if (beat.beatIndex !== index) {
      throw new Error(`EDIT_SOURCE_SCRIPT_BEAT_INDEX_NON_CONTIGUOUS:${segment.episodeIndex}:${segment.actIndex}:${segment.sceneIndex}:${beat.beatIndex}`)
    }
  })
}

function assertSegmentOrder(
  previous: SourceScriptSceneSegment | null,
  current: SourceScriptSceneSegment,
): void {
  if (!previous) {
    if (current.episodeIndex !== 0 || current.actIndex !== 0 || current.sceneIndex !== 0) {
      throw new Error('EDIT_SOURCE_SCRIPT_SEGMENT_INDEX_MUST_START_AT_ZERO')
    }
    return
  }

  const sameEpisode = current.episodeIndex === previous.episodeIndex
  const nextEpisode = current.episodeIndex === previous.episodeIndex + 1
  if (!sameEpisode && !nextEpisode) {
    throw new Error(`EDIT_SOURCE_SCRIPT_EPISODE_INDEX_NON_CONTIGUOUS:${current.episodeIndex}`)
  }

  if (nextEpisode) {
    if (current.actIndex !== 0 || current.sceneIndex !== 0) {
      throw new Error(`EDIT_SOURCE_SCRIPT_EPISODE_FIRST_SEGMENT_INVALID:${current.episodeIndex}`)
    }
    return
  }

  if (
    !sameText(current.episodeTitle, previous.episodeTitle)
    || !sameText(current.episodeSummary, previous.episodeSummary)
  ) {
    throw new Error(`EDIT_SOURCE_SCRIPT_EPISODE_METADATA_CONFLICT:${current.episodeIndex}`)
  }

  const sameAct = current.actIndex === previous.actIndex
  const nextAct = current.actIndex === previous.actIndex + 1
  if (!sameAct && !nextAct) {
    throw new Error(`EDIT_SOURCE_SCRIPT_ACT_INDEX_NON_CONTIGUOUS:${current.episodeIndex}:${current.actIndex}`)
  }
  if (nextAct) {
    if (current.sceneIndex !== 0) {
      throw new Error(`EDIT_SOURCE_SCRIPT_ACT_FIRST_SCENE_INVALID:${current.episodeIndex}:${current.actIndex}`)
    }
    return
  }

  if (!sameText(current.actTitle, previous.actTitle) || !sameText(current.actSummary, previous.actSummary)) {
    throw new Error(`EDIT_SOURCE_SCRIPT_ACT_METADATA_CONFLICT:${current.episodeIndex}:${current.actIndex}`)
  }
  if (current.sceneIndex !== previous.sceneIndex + 1) {
    throw new Error(`EDIT_SOURCE_SCRIPT_SCENE_INDEX_NON_CONTIGUOUS:${current.episodeIndex}:${current.actIndex}:${current.sceneIndex}`)
  }
}

function appendSegment(
  episodes: EditSourceScriptEpisode[],
  segment: SourceScriptSceneSegment,
): void {
  let episode = episodes.at(-1)
  if (!episode || episode.episodeIndex !== segment.episodeIndex) {
    episode = {
      episodeIndex: segment.episodeIndex,
      title: segment.episodeTitle,
      summary: segment.episodeSummary,
      acts: [],
    }
    episodes.push(episode)
  }

  const acts = episode.acts as EditSourceScriptAct[]
  let act = acts.at(-1)
  if (!act || act.actIndex !== segment.actIndex) {
    act = {
      actIndex: segment.actIndex,
      title: segment.actTitle,
      summary: segment.actSummary,
      scenes: [],
    }
    acts.push(act)
  }
  const scenes = act.scenes as Array<EditSourceScriptAct['scenes'][number]>
  scenes.push({
    sceneIndex: segment.sceneIndex,
    title: segment.title,
    location: segment.location,
    timeOfDay: segment.timeOfDay,
    characters: segment.characters,
    summary: segment.summary,
    body: segment.body,
    beats: segment.beats,
  })
}

export function normalizeSourceScriptSegments(input: {
  readonly version: 1
  readonly title: string
  readonly summary: string
  readonly segments: readonly SourceScriptSceneSegment[]
}): NormalizedSourceScriptSegments {
  if (input.segments.length === 0) throw new Error('EDIT_SOURCE_SCRIPT_SEGMENTS_EMPTY')
  const parsedSegments = input.segments.map((segment) => sourceScriptSceneSegmentSchema.parse(segment))
  const seenKeys = new Set<string>()
  const episodes: EditSourceScriptEpisode[] = []
  let previous: SourceScriptSceneSegment | null = null

  for (const segment of parsedSegments) {
    const key = `${segment.episodeIndex}:${segment.actIndex}:${segment.sceneIndex}`
    if (seenKeys.has(key)) throw new Error(`EDIT_SOURCE_SCRIPT_SEGMENT_DUPLICATE:${key}`)
    seenKeys.add(key)
    assertContinuousBeats(segment)
    assertSegmentOrder(previous, segment)
    appendSegment(episodes, segment)
    previous = segment
  }

  return {
    normalizedText: parsedSegments.map((segment) => segment.body.trim()).join('\n\n'),
    structure: {
      version: input.version,
      title: input.title.trim(),
      summary: input.summary.trim(),
      episodes,
    },
  }
}

export function normalizeExpandedSourceScriptOutput(
  value: ExpandedSourceScriptOutput,
): NormalizedSourceScriptSegments {
  const output = expandedSourceScriptOutputSchema.parse(value)
  return normalizeSourceScriptSegments(output)
}
