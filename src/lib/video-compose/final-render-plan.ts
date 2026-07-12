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

export interface FinalRenderStoryboardInput {
  readonly id: string
  readonly editScriptId?: string | null
  readonly createdAt?: Date | string
  readonly storyboardTextJson?: string | null
}

export interface FinalRenderPanelInput {
  readonly id: string
  readonly panelIndex: number
  readonly panelNumber?: number | null
  readonly sourceShotId?: string | null
  readonly duration?: number | null
  readonly description?: string | null
  readonly videoUrl?: string | null
  readonly videoMedia?: FinalRenderMediaRefInput | null
  readonly storyboard: FinalRenderStoryboardInput
}

export interface FinalRenderVideoGroupInput {
  readonly id: string
  readonly gridMode: string
  readonly shotIds: unknown
  readonly durationSec: number
  readonly status: string
  readonly prompt?: string | null
  readonly videoUrl?: string | null
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
  readonly panelId: string
  readonly groupId?: string | null
  readonly sourceKind: 'panel' | 'videoGroup'
  readonly source: string | FinalRenderMediaRefInput
  readonly durationSeconds: number
  readonly order: number
  readonly shotNumber: number | null
  readonly shotNumbers: readonly number[]
  readonly shotId: string | null
  readonly shotIds: readonly string[]
  readonly description: string | null
  readonly sound: string | null
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

const editScriptCorePlanSchema = editScriptCoreSchema

function normalizeString(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readCreatedAtMillis(value: Date | string | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function clampPositiveDuration(value: number | null | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.max(0.1, value)
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

function resolvePanelVideoSource(panel: FinalRenderPanelInput): string | FinalRenderMediaRefInput | null {
  if (isFinalRenderMediaRef(panel.videoMedia)) return panel.videoMedia
  if (normalizeString(panel.videoUrl)) return normalizeString(panel.videoUrl)
  return null
}

function resolveVideoGroupSource(group: FinalRenderVideoGroupInput): string | FinalRenderMediaRefInput | null {
  if (isFinalRenderMediaRef(group.videoMedia)) return group.videoMedia
  if (normalizeString(group.videoUrl)) return normalizeString(group.videoUrl)
  return null
}

function parseGroupShotIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function shotSoundForGroup(shotIds: readonly string[], editScript: FinalRenderEditScriptInput | null): string | null {
  if (!editScript) return null
  const sounds = shotIds
    .map((shotId) => editScript.shots.find((shot) => shot.shotId === shotId)?.sound)
    .map((value) => normalizeString(value))
    .filter(Boolean)
  return sounds.length > 0 ? sounds.join(' / ') : null
}

function shotDescriptionForGroup(shotIds: readonly string[], editScript: FinalRenderEditScriptInput | null, fallback?: string | null): string | null {
  if (!editScript) return normalizeString(fallback) || null
  const descriptions = shotIds
    .map((shotId) => editScript.shots.find((shot) => shot.shotId === shotId)?.action)
    .map((value) => normalizeString(value))
    .filter(Boolean)
  return descriptions.length > 0 ? descriptions.join(' / ') : normalizeString(fallback) || null
}

function storyboardReferencesEditScript(storyboard: FinalRenderStoryboardInput, editScriptId: string): boolean {
  if (storyboard.editScriptId === editScriptId) return true
  const raw = normalizeString(storyboard.storyboardTextJson)
  if (!raw) return false
  return raw.includes(editScriptId)
}

function findShotByPanel(panel: FinalRenderPanelInput, editScript: FinalRenderEditScriptInput | null): EditScriptShot | null {
  if (!editScript) return null
  const sourceShotId = normalizeString(panel.sourceShotId)
  if (sourceShotId) {
    return editScript.shots.find((shot) => shot.shotId === sourceShotId) ?? null
  }
  const panelNumber = panel.panelNumber
  if (typeof panelNumber === 'number' && Number.isInteger(panelNumber)) {
    return editScript.shots.find((shot) => shot.shotNumber === panelNumber) ?? null
  }
  return null
}

function shotNumbersForIds(shotIds: readonly string[], editScript: FinalRenderEditScriptInput | null): number[] {
  if (!editScript) return []
  return shotIds
    .map((shotId) => editScript.shots.find((shot) => shot.shotId === shotId)?.shotNumber ?? null)
    .filter((value): value is number => typeof value === 'number' && Number.isInteger(value))
}

function shotNumberForPanelClip(shot: EditScriptShot | null, panel: FinalRenderPanelInput): number | null {
  const value = shot?.shotNumber ?? panel.panelNumber ?? null
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function sortPanelsForFinalRender(
  panels: readonly FinalRenderPanelInput[],
  editScript: FinalRenderEditScriptInput | null,
): FinalRenderPanelInput[] {
  let scopedPanels: readonly FinalRenderPanelInput[] = panels
  if (editScript) {
    const explicitlyLinked = panels.filter((panel) =>
      storyboardReferencesEditScript(panel.storyboard, editScript.id))
    scopedPanels = explicitlyLinked.length > 0
      ? explicitlyLinked
      : panels.filter((panel) => findShotByPanel(panel, editScript) !== null)
  }

  return [...scopedPanels].sort((a, b) => {
    const aShot = typeof a.panelNumber === 'number' ? a.panelNumber : Number.POSITIVE_INFINITY
    const bShot = typeof b.panelNumber === 'number' ? b.panelNumber : Number.POSITIVE_INFINITY
    if (aShot !== bShot) return aShot - bShot
    const aStoryboardAt = readCreatedAtMillis(a.storyboard.createdAt)
    const bStoryboardAt = readCreatedAtMillis(b.storyboard.createdAt)
    if (aStoryboardAt !== bStoryboardAt) return aStoryboardAt - bStoryboardAt
    return a.panelIndex - b.panelIndex
  })
}

export function resolveFinalRenderDimensions(videoRatio: string | null | undefined): FinalRenderDimensions {
  const ratio = normalizeString(videoRatio)
  if (ratio === '16:9') return { width: 1920, height: 1080 }
  if (ratio === '21:9') return { width: 2560, height: 1080 }
  return { width: 1080, height: 1920 }
}

export function parseFinalRenderEditScriptShots(value: unknown): readonly EditScriptShot[] {
  const parsed = editScriptCorePlanSchema.safeParse(value)
  if (!parsed.success) return []
  return parsed.data.shots
}

export function parseFinalRenderEditScriptCore(value: unknown): {
  readonly shots: readonly EditScriptShot[]
  readonly generationSegments: readonly EditGenerationSegment[]
} | null {
  const parsed = editScriptCorePlanSchema.safeParse(value)
  if (!parsed.success) return null
  const normalized = normalizeEditScriptStructure(parsed.data)
  return {
    shots: normalized.shots,
    generationSegments: normalized.generationSegments,
  }
}

function sameShotIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotId, index) => shotId === right[index])
}

function buildPanelClip(panel: FinalRenderPanelInput, editScript: FinalRenderEditScriptInput | null): FinalRenderClipPlan {
  const shot = findShotByPanel(panel, editScript)
  const shotNumber = shotNumberForPanelClip(shot, panel)
  const shotId = shot?.shotId ?? (normalizeString(panel.sourceShotId) || null)
  const durationSeconds = clampPositiveDuration(panel.duration, shot?.durationSec ?? 3)
  const source = resolvePanelVideoSource(panel)
  return {
    panelId: panel.id,
    groupId: null,
    sourceKind: 'panel',
    source: source ?? '',
    durationSeconds,
    order: 0,
    shotNumber,
    shotNumbers: shotNumber === null ? [] : [shotNumber],
    shotId,
    shotIds: shotId === null ? [] : [shotId],
    description: normalizeString(panel.description) || null,
    sound: normalizeString(shot?.sound) || null,
  }
}

function buildEditScriptOrderedFinalRenderClips(input: {
  readonly panels: readonly FinalRenderPanelInput[]
  readonly videoGroups: readonly FinalRenderVideoGroupInput[]
  readonly editScript: FinalRenderEditScriptInput
}): FinalRenderClipPlan[] {
  const sortedPanels = sortPanelsForFinalRender(input.panels, input.editScript)
  const panelByShotId = new Map<string, FinalRenderPanelInput>()
  sortedPanels.forEach((panel) => {
    const shot = findShotByPanel(panel, input.editScript)
    const shotId = shot?.shotId ?? normalizeString(panel.sourceShotId)
    if (shotId && !panelByShotId.has(shotId)) {
      panelByShotId.set(shotId, panel)
    }
  })

  const groups = input.videoGroups.map((group) => ({
    group,
    shotIds: parseGroupShotIds(group.shotIds),
  }))
  const clips: FinalRenderClipPlan[] = []
  const coveredShotIds = new Set<string>()

  input.editScript.generationSegments.forEach((segment) => {
    const matchingGroup = groups.find((item) => sameShotIds(item.shotIds, segment.shotIds))
    const source = matchingGroup ? resolveVideoGroupSource(matchingGroup.group) : null
    if (matchingGroup) {
      segment.shotIds.forEach((shotId) => coveredShotIds.add(shotId))
      const shotNumbers = shotNumbersForIds(segment.shotIds, input.editScript)
      clips.push({
        panelId: matchingGroup.group.id,
        groupId: matchingGroup.group.id,
        sourceKind: 'videoGroup',
        source: source ?? '',
        durationSeconds: clampPositiveDuration(matchingGroup.group.durationSec, segment.shotIds.length * 3),
        order: 0,
        shotNumber: shotNumbers[0] ?? null,
        shotNumbers,
        shotId: segment.shotIds[0] ?? null,
        shotIds: segment.shotIds,
        description: shotDescriptionForGroup(segment.shotIds, input.editScript, matchingGroup.group.prompt ?? segment.continuity),
        sound: shotSoundForGroup(segment.shotIds, input.editScript),
      })
      return
    }

    segment.shotIds.forEach((shotId) => {
      const panel = panelByShotId.get(shotId)
      if (!panel) return
      coveredShotIds.add(shotId)
      clips.push(buildPanelClip(panel, input.editScript))
    })
  })

  sortedPanels.forEach((panel) => {
    const shot = findShotByPanel(panel, input.editScript)
    const shotId = shot?.shotId ?? normalizeString(panel.sourceShotId)
    if (shotId && coveredShotIds.has(shotId)) return
    clips.push(buildPanelClip(panel, input.editScript))
  })

  return clips.map((clip, index) => ({
    ...clip,
    order: index + 1,
  }))
}

export function buildFinalRenderClips(input: {
  readonly panels: readonly FinalRenderPanelInput[]
  readonly videoGroups?: readonly FinalRenderVideoGroupInput[]
  readonly editScript: FinalRenderEditScriptInput | null
}): FinalRenderClipPlan[] {
  if (input.editScript?.generationSegments.length) {
    return buildEditScriptOrderedFinalRenderClips({
      panels: input.panels,
      videoGroups: input.videoGroups ?? [],
      editScript: input.editScript,
    })
  }

  const groupPlans = (input.videoGroups ?? [])
    .map((group) => ({
      group,
      shotIds: parseGroupShotIds(group.shotIds),
    }))
    .filter((item) => item.shotIds.length > 0)
    .sort((left, right) => {
      const leftShot = shotNumbersForIds(left.shotIds, input.editScript)[0] ?? Number.POSITIVE_INFINITY
      const rightShot = shotNumbersForIds(right.shotIds, input.editScript)[0] ?? Number.POSITIVE_INFINITY
      return leftShot - rightShot
    })

  const coveredShotIds = new Set<string>()
  const groupClips = groupPlans.map((item): FinalRenderClipPlan => {
    item.shotIds.forEach((shotId) => coveredShotIds.add(shotId))
    const shotNumbers = shotNumbersForIds(item.shotIds, input.editScript)
    const source = resolveVideoGroupSource(item.group)
    return {
      panelId: item.group.id,
      groupId: item.group.id,
      sourceKind: 'videoGroup' as const,
      source: source ?? '',
      durationSeconds: clampPositiveDuration(item.group.durationSec, item.shotIds.length * 3),
      order: 0,
      shotNumber: shotNumbers[0] ?? null,
      shotNumbers,
      shotId: item.shotIds[0] ?? null,
      shotIds: item.shotIds,
      description: shotDescriptionForGroup(item.shotIds, input.editScript, item.group.prompt),
      sound: shotSoundForGroup(item.shotIds, input.editScript),
    }
  })

  const sortedPanels = sortPanelsForFinalRender(input.panels, input.editScript)
    .filter((panel) => {
      const shot = findShotByPanel(panel, input.editScript)
      const shotId = shot?.shotId ?? normalizeString(panel.sourceShotId)
      return shotId ? !coveredShotIds.has(shotId) : true
    })
  const panelClips = sortedPanels.map((panel) => {
    const shot = findShotByPanel(panel, input.editScript)
    const shotNumber = shotNumberForPanelClip(shot, panel)
    const shotId = shot?.shotId ?? (normalizeString(panel.sourceShotId) || null)
    const durationSeconds = clampPositiveDuration(panel.duration, shot?.durationSec ?? 3)
    const source = resolvePanelVideoSource(panel)
    if (!source) {
      return {
        panelId: panel.id,
        groupId: null,
        sourceKind: 'panel' as const,
        source: '',
        durationSeconds,
        order: 0,
        shotNumber,
        shotNumbers: shotNumber === null ? [] : [shotNumber],
        shotId,
        shotIds: shotId === null ? [] : [shotId],
        description: normalizeString(panel.description) || null,
        sound: normalizeString(shot?.sound) || null,
      }
    }
    return {
      panelId: panel.id,
      groupId: null,
      sourceKind: 'panel' as const,
      source,
      durationSeconds,
      order: 0,
      shotNumber,
      shotNumbers: shotNumber === null ? [] : [shotNumber],
      shotId,
      shotIds: shotId === null ? [] : [shotId],
      description: normalizeString(panel.description) || null,
      sound: normalizeString(shot?.sound) || null,
    }
  })
  return [...groupClips, ...panelClips]
    .sort((left, right) => {
      const leftShot = typeof left.shotNumber === 'number' ? left.shotNumber : Number.POSITIVE_INFINITY
      const rightShot = typeof right.shotNumber === 'number' ? right.shotNumber : Number.POSITIVE_INFINITY
      if (leftShot !== rightShot) return leftShot - rightShot
      return left.sourceKind === right.sourceKind ? 0 : left.sourceKind === 'videoGroup' ? -1 : 1
    })
    .map((clip, index) => ({
      ...clip,
      order: index + 1,
    }))
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? 'null'
}

function buildProjectContextJson(projectContext: FinalRenderProjectContextInput | null | undefined): string {
  if (!projectContext) return safeJsonStringify({})
  return safeJsonStringify({
    videoRatio: normalizeString(projectContext.videoRatio) || null,
  })
}

function buildEditScriptJson(editScript: FinalRenderEditScriptInput | null): string {
  if (!editScript) return safeJsonStringify(null)
  return safeJsonStringify({
    userPrompt: editScript.userPrompt,
    durationSec: editScript.durationSec,
    styleBible: editScript.styleBible ?? null,
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
      characters: shot.characters.map(({ name, visibility, role, performance }) => ({
        name,
        visibility,
        role,
        performance,
      })),
      keyObjects: shot.keyObjects,
      sound: shot.sound,
    })),
  })
}

function buildRenderedTimelineJson(clips: readonly FinalRenderClipPlan[]): string {
  return safeJsonStringify(clips.map((clip) => ({
    order: clip.order,
    sourceKind: clip.sourceKind,
    shotNumber: clip.shotNumber,
    shotNumbers: clip.shotNumbers,
    durationSeconds: clip.durationSeconds,
    visualSummary: clip.description,
    soundDirection: clip.sound,
  })))
}

export function buildFinalRenderMusicPrompt(input: FinalRenderMusicPromptInput): string {
  const title = 'final video'
  const storyContext = normalizeString(input.editScript?.userPrompt) || 'No additional story context provided.'
  let cursorSeconds = 0
  const timelineMap = input.clips.map((clip) => {
    const start = cursorSeconds
    cursorSeconds += clip.durationSeconds
    const end = cursorSeconds
    const shotLabel = clip.shotNumber === null ? `Segment ${clip.order}` : `Shot ${clip.shotNumber}`
    const sound = normalizeString(clip.sound) || 'support the visual action with matching mood and rhythm'
    const description = normalizeString(clip.description)
    return [
      `[${formatMusicTimestamp(start)} - ${formatMusicTimestamp(end)}] ${shotLabel}`,
      `Visual action: ${description || 'No visual description provided.'}`,
      `Edit-first sound direction: ${sound}`,
      `Segment length: ${clip.durationSeconds.toFixed(1)} seconds.`,
    ].join('\n')
  }).join('\n')

  return buildAiPrompt({
    promptId: AI_PROMPT_IDS.MUSIC_FINAL_RENDER_BGM,
    locale: input.locale ?? 'en',
    variables: {
      title,
      story_context: storyContext,
      duration_seconds: String(Math.round(input.totalDurationSeconds)),
      project_context_json: buildProjectContextJson(input.projectContext),
      edit_script_json: buildEditScriptJson(input.editScript),
      rendered_timeline_json: buildRenderedTimelineJson(input.clips),
      timeline_map: timelineMap,
    },
  })
}
