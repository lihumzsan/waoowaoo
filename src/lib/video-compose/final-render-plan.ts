import { AI_PROMPT_IDS, buildAiPrompt, type AiPromptLocale } from '@/lib/ai-prompts'
import { editScriptCoreSchema, type EditGenerationSegment, type EditScriptShot, type EditScriptStyleBible } from '@/lib/edit-script/types'
import { normalizeEditScriptStructure } from '@/lib/edit-script/normalize'

export type FinalRenderAspectRatio = '9:16' | '16:9' | '21:9'

export interface FinalRenderDimensions {
  readonly width: number
  readonly height: number
}
export interface FinalRenderMediaRefInput {
  readonly url?: string | null
  readonly storageKey?: string | null
}

export interface FinalRenderVideoSegmentInput {
  readonly id: string
  readonly editScriptId: string
  readonly segmentId: string
  readonly inputSignature: string
  readonly durationSec: number
  readonly status: string
  readonly videoMediaId?: string | null
  readonly videoMedia?: FinalRenderMediaRefInput | null
}

export interface FinalRenderEditScriptInput {
  readonly id: string
  readonly userPrompt: string
  readonly durationSec: number
  readonly styleBible?: EditScriptStyleBible | null
  readonly shots: readonly EditScriptShot[]
  readonly generationSegments: readonly EditGenerationSegment[]
}

export interface FinalRenderClipPlan {
  readonly clipId: string
  readonly sourceKind: 'videoSegment' | 'chapter'
  readonly sourceId: string
  readonly videoSegmentId: string | null
  readonly segmentId: string | null
  readonly source: string | FinalRenderMediaRefInput
  readonly durationSeconds: number
  readonly order: number
  readonly shotNumber: number | null
  readonly shotNumbers: readonly number[]
  readonly shotId: string | null
  readonly shotIds: readonly string[]
  readonly description: string | null
  readonly synchronousSound: string | null
}

export interface FinalRenderProjectContextInput {
  readonly videoRatio?: string | null
}

export interface FinalRenderMusicPromptInput {
  readonly editScript: FinalRenderEditScriptInput | null
  readonly projectContext?: FinalRenderProjectContextInput | null
  readonly clips: readonly FinalRenderClipPlan[]
  readonly totalDurationSeconds: number
  readonly locale?: AiPromptLocale
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function formatMusicTimestamp(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function isFinalRenderMediaRef(value: unknown): value is FinalRenderMediaRefInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as { url?: unknown; storageKey?: unknown }
  return typeof record.url === 'string' || typeof record.storageKey === 'string'
}

function requireVideoSegmentSource(segment: FinalRenderVideoSegmentInput): FinalRenderMediaRefInput {
  if (segment.status !== 'completed' || !segment.videoMediaId || !isFinalRenderMediaRef(segment.videoMedia)) {
    throw new Error(`FINAL_RENDER_VIDEO_SEGMENT_INCOMPLETE:${segment.id}:${segment.status}`)
  }
  return segment.videoMedia
}

function shotsForSegment(
  segment: EditGenerationSegment,
  editScript: FinalRenderEditScriptInput,
): readonly EditScriptShot[] {
  const shotsById = new Map(editScript.shots.map((shot) => [shot.shotId, shot]))
  return segment.shotIds.map((shotId) => {
    const shot = shotsById.get(shotId)
    if (!shot) throw new Error(`FINAL_RENDER_SEGMENT_SHOT_MISSING:${segment.segmentId}:${shotId}`)
    return shot
  })
}

export function resolveFinalRenderDimensions(videoRatio: string | null | undefined): FinalRenderDimensions {
  const ratio = normalizeString(videoRatio)
  if (ratio === '16:9') return { width: 1920, height: 1080 }
  if (ratio === '21:9') return { width: 2560, height: 1080 }
  return { width: 1080, height: 1920 }
}

export function parseFinalRenderEditScriptShots(value: unknown): readonly EditScriptShot[] {
  const parsed = editScriptCoreSchema.safeParse(value)
  if (!parsed.success) return []
  return normalizeEditScriptStructure(parsed.data).shots
}

export function parseFinalRenderEditScriptCore(value: unknown): {
  readonly shots: readonly EditScriptShot[]
  readonly generationSegments: readonly EditGenerationSegment[]
} | null {
  const parsed = editScriptCoreSchema.safeParse(value)
  if (!parsed.success) return null
  const normalized = normalizeEditScriptStructure(parsed.data)
  return { shots: normalized.shots, generationSegments: normalized.generationSegments }
}

export function buildFinalRenderClips(input: {
  readonly videoSegments: readonly FinalRenderVideoSegmentInput[]
  readonly editScript: FinalRenderEditScriptInput
}): FinalRenderClipPlan[] {
  const segmentById = new Map(input.videoSegments.map((segment) => [segment.segmentId, segment]))
  if (segmentById.size !== input.videoSegments.length) {
    throw new Error('FINAL_RENDER_VIDEO_SEGMENT_ID_DUPLICATE')
  }
  if (input.videoSegments.some((segment) => segment.editScriptId !== input.editScript.id)) {
    throw new Error(`FINAL_RENDER_VIDEO_SEGMENT_EDIT_SCRIPT_MISMATCH:${input.editScript.id}`)
  }
  const expectedIds = new Set(input.editScript.generationSegments.map((segment) => segment.segmentId))
  const unexpected = input.videoSegments.find((segment) => !expectedIds.has(segment.segmentId))
  if (unexpected) throw new Error(`FINAL_RENDER_VIDEO_SEGMENT_UNEXPECTED:${unexpected.segmentId}`)

  return input.editScript.generationSegments.map((generationSegment, index): FinalRenderClipPlan => {
    const videoSegment = segmentById.get(generationSegment.segmentId)
    if (!videoSegment) throw new Error(`FINAL_RENDER_VIDEO_SEGMENT_MISSING:${generationSegment.segmentId}`)
    const shots = shotsForSegment(generationSegment, input.editScript)
    const calculatedDuration = shots.reduce((total, shot) => total + shot.durationSec, 0)
    if (videoSegment.durationSec !== calculatedDuration) {
      throw new Error(`FINAL_RENDER_VIDEO_SEGMENT_DURATION_MISMATCH:${videoSegment.id}:${String(videoSegment.durationSec)}:${String(calculatedDuration)}`)
    }
    return {
      clipId: videoSegment.id,
      sourceKind: 'videoSegment',
      sourceId: videoSegment.id,
      videoSegmentId: videoSegment.id,
      segmentId: generationSegment.segmentId,
      source: requireVideoSegmentSource(videoSegment),
      durationSeconds: calculatedDuration,
      order: index + 1,
      shotNumber: shots[0]?.shotNumber ?? null,
      shotNumbers: shots.map((shot) => shot.shotNumber),
      shotId: shots[0]?.shotId ?? null,
      shotIds: shots.map((shot) => shot.shotId),
      description: shots.map((shot) => shot.action.trim()).filter(Boolean).join(' / ') || null,
      synchronousSound: shots.map((shot) => shot.synchronousSound.trim()).filter(Boolean).join(' / ') || null,
    }
  })
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

function shotNumbersForIds(shotIds: readonly string[], editScript: FinalRenderEditScriptInput): number[] {
  const shotNumberById = new Map(editScript.shots.map((shot) => [shot.shotId, shot.shotNumber]))
  return shotIds.map((shotId) => shotNumberById.get(shotId)).filter((value): value is number => value !== undefined)
}

function buildProjectContextJson(projectContext: FinalRenderProjectContextInput | null | undefined): string {
  return safeJsonStringify({ videoRatio: normalizeString(projectContext?.videoRatio) || null })
}

function buildEditScriptJson(editScript: FinalRenderEditScriptInput | null): string {
  if (!editScript) return safeJsonStringify(null)
  return safeJsonStringify({
    userPrompt: editScript.userPrompt,
    durationSec: editScript.durationSec,
    visualStyle: editScript.styleBible?.visualStyle ?? null,
    shotCount: editScript.shots.length,
    generationSegments: editScript.generationSegments.map((segment, index) => ({
      segmentNumber: index + 1,
      shotNumbers: shotNumbersForIds(segment.shotIds, editScript),
      continuity: segment.continuity,
    })),
    shots: editScript.shots.map((shot) => ({
      shotNumber: shot.shotNumber,
      durationSec: shot.durationSec,
      scene: { name: shot.scene.name, subScene: shot.scene.subScene },
      action: shot.action,
      characters: shot.characters.map(({ name, performance }) => ({ name, performance })),
      synchronousSound: shot.synchronousSound,
    })),
  })
}

function buildRenderedTimelineJson(clips: readonly FinalRenderClipPlan[]): string {
  return safeJsonStringify(clips.map((clip) => ({
    order: clip.order,
    sourceKind: clip.sourceKind,
    sourceId: clip.sourceId,
    segmentId: clip.segmentId,
    shotNumbers: clip.shotNumbers,
    durationSeconds: clip.durationSeconds,
    visualSummary: clip.description,
    synchronizedSound: clip.synchronousSound,
  })))
}

export function buildFinalRenderMusicPrompt(input: FinalRenderMusicPromptInput): string {
  const storyContext = normalizeString(input.editScript?.userPrompt) || 'No additional story context provided.'
  let cursorSeconds = 0
  const timelineMap = input.clips.map((clip) => {
    const start = cursorSeconds
    cursorSeconds += clip.durationSeconds
    const shotLabel = clip.shotNumber === null ? `Segment ${clip.order}` : `Shot ${clip.shotNumber}`
    return [
      `[${formatMusicTimestamp(start)} - ${formatMusicTimestamp(cursorSeconds)}] ${shotLabel}`,
      `Visual action: ${normalizeString(clip.description) || 'No visual description provided.'}`,
      `Synchronized sound context: ${normalizeString(clip.synchronousSound) || 'none'}`,
      `Segment length: ${clip.durationSeconds.toFixed(1)} seconds.`,
    ].join('\n')
  }).join('\n')

  return buildAiPrompt({
    promptId: AI_PROMPT_IDS.MUSIC_FINAL_RENDER_BGM,
    locale: input.locale ?? 'en',
    variables: {
      title: 'final video',
      story_context: storyContext,
      duration_seconds: String(Math.round(input.totalDurationSeconds)),
      project_context_json: buildProjectContextJson(input.projectContext),
      edit_script_json: buildEditScriptJson(input.editScript),
      rendered_timeline_json: buildRenderedTimelineJson(input.clips),
      timeline_map: timelineMap,
    },
  })
}
