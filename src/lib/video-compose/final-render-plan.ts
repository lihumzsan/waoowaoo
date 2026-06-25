import { z } from 'zod'
import { AI_PROMPT_IDS, buildAiPrompt, type AiPromptLocale } from '@/lib/ai-prompts'
import { editScriptShotSchema, type EditScriptStyleBible } from '@/lib/edit-script/types'
import { normalizeVideoBlockPlanResponse } from '@/lib/video-groups/planner'

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
  readonly clip?: {
    readonly createdAt?: Date | string
  } | null
}

export interface FinalRenderPanelInput {
  readonly id: string
  readonly panelIndex: number
  readonly panelNumber?: number | null
  readonly duration?: number | null
  readonly description?: string | null
  readonly videoUrl?: string | null
  readonly videoMedia?: FinalRenderMediaRefInput | null
  readonly photographyRules?: string | null
  readonly storyboard: FinalRenderStoryboardInput
}

export interface FinalRenderVideoGroupInput {
  readonly id: string
  readonly gridMode: string
  readonly shotNumbers: unknown
  readonly durationSec: number
  readonly status: string
  readonly prompt?: string | null
  readonly videoUrl?: string | null
  readonly videoMedia?: FinalRenderMediaRefInput | null
}

export interface FinalRenderEditScriptInput {
  readonly id: string
  readonly userPrompt: string
  readonly title: string
  readonly logline?: string | null
  readonly durationSec: number
  readonly styleBible?: EditScriptStyleBible | null
  readonly shots: readonly FinalRenderEditShot[]
  readonly videoBlocks: readonly FinalRenderEditVideoBlock[]
}

export interface FinalRenderEditShot {
  readonly shotNumber: number
  readonly durationSec: number
  readonly dramaticPurpose: string
  readonly visibleAction: string
  readonly audienceFocus: string
  readonly viewpoint: string
  readonly revealPlan: string
  readonly performanceBeat: string
  readonly continuityIn: string
  readonly continuityOut: string
  readonly charactersAndScene?: string
  readonly sound: string
}

export interface FinalRenderEditVideoBlock {
  readonly kind: 'single' | 'group'
  readonly shotNumbers: readonly number[]
  readonly gridMode?: '2x2' | '3x3'
  readonly reason: string
  readonly prompt: string
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

const editScriptShotsSchema = z.array(editScriptShotSchema)
const LYRIA_PRO_DURATIONS = [30, 60, 90, 120, 180] as const

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

function parseGroupShotNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'number' ? item : Number(item)))
    .filter((item) => Number.isInteger(item) && item > 0)
}

function shotSoundForGroup(shotNumbers: readonly number[], editScript: FinalRenderEditScriptInput | null): string | null {
  if (!editScript) return null
  const sounds = shotNumbers
    .map((shotNumber) => editScript.shots.find((shot) => shot.shotNumber === shotNumber)?.sound)
    .map((value) => normalizeString(value))
    .filter(Boolean)
  return sounds.length > 0 ? sounds.join(' / ') : null
}

function shotDescriptionForGroup(shotNumbers: readonly number[], editScript: FinalRenderEditScriptInput | null, fallback?: string | null): string | null {
  if (!editScript) return normalizeString(fallback) || null
  const descriptions = shotNumbers
    .map((shotNumber) => editScript.shots.find((shot) => shot.shotNumber === shotNumber)?.visibleAction)
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

function panelReferencesEditScript(panel: FinalRenderPanelInput, editScriptId: string): boolean {
  const raw = normalizeString(panel.photographyRules)
  if (!raw) return false
  return raw.includes(editScriptId)
}

function findShotByPanel(panel: FinalRenderPanelInput, editScript: FinalRenderEditScriptInput | null): FinalRenderEditShot | null {
  if (!editScript) return null
  const panelNumber = panel.panelNumber
  if (typeof panelNumber === 'number' && Number.isInteger(panelNumber)) {
    return editScript.shots.find((shot) => shot.shotNumber === panelNumber) ?? null
  }
  return null
}

function shotNumberForPanelClip(shot: FinalRenderEditShot | null, panel: FinalRenderPanelInput): number | null {
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
      storyboardReferencesEditScript(panel.storyboard, editScript.id)
      || panelReferencesEditScript(panel, editScript.id))
    scopedPanels = explicitlyLinked.length > 0
      ? explicitlyLinked
      : panels.filter((panel) => findShotByPanel(panel, editScript) !== null)
  }

  return [...scopedPanels].sort((a, b) => {
    const aShot = typeof a.panelNumber === 'number' ? a.panelNumber : Number.POSITIVE_INFINITY
    const bShot = typeof b.panelNumber === 'number' ? b.panelNumber : Number.POSITIVE_INFINITY
    if (aShot !== bShot) return aShot - bShot
    const aClipAt = readCreatedAtMillis(a.storyboard.clip?.createdAt)
    const bClipAt = readCreatedAtMillis(b.storyboard.clip?.createdAt)
    if (aClipAt !== bClipAt) return aClipAt - bClipAt
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

export function selectFinalRenderMusicDurationSeconds(modelKey: string, targetDurationSeconds: number): number {
  const target = Math.max(1, Math.ceil(targetDurationSeconds))
  if (modelKey.includes('lyria-3-clip-preview')) return 30
  for (const duration of LYRIA_PRO_DURATIONS) {
    if (target <= duration) return duration
  }
  return LYRIA_PRO_DURATIONS[LYRIA_PRO_DURATIONS.length - 1]
}

export function parseFinalRenderEditScriptShots(value: unknown): readonly FinalRenderEditShot[] {
  const parsed = editScriptShotsSchema.safeParse(value)
  if (!parsed.success) return []
  return parsed.data
}

export function parseFinalRenderEditScriptVideoBlocks(input: {
  readonly value: unknown
  readonly shots: readonly FinalRenderEditShot[]
}): readonly FinalRenderEditVideoBlock[] {
  if (!Array.isArray(input.value) || input.value.length === 0) return []
  return normalizeVideoBlockPlanResponse({
    response: { items: input.value },
    allShotNumbers: input.shots.map((shot) => shot.shotNumber),
    shots: input.shots,
    enforceSingleMinDuration: false,
  }).items
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
}

function buildPanelClip(panel: FinalRenderPanelInput, editScript: FinalRenderEditScriptInput | null): FinalRenderClipPlan {
  const shot = findShotByPanel(panel, editScript)
  const shotNumber = shotNumberForPanelClip(shot, panel)
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
  const panelByShotNumber = new Map<number, FinalRenderPanelInput>()
  sortedPanels.forEach((panel) => {
    const shot = findShotByPanel(panel, input.editScript)
    const shotNumber = shotNumberForPanelClip(shot, panel)
    if (typeof shotNumber === 'number' && !panelByShotNumber.has(shotNumber)) {
      panelByShotNumber.set(shotNumber, panel)
    }
  })

  const groups = input.videoGroups.map((group) => ({
    group,
    shotNumbers: parseGroupShotNumbers(group.shotNumbers),
  }))
  const clips: FinalRenderClipPlan[] = []
  const coveredShotNumbers = new Set<number>()

  input.editScript.videoBlocks.forEach((block) => {
    const matchingGroup = groups.find((item) => sameShotNumbers(item.shotNumbers, block.shotNumbers))
    const source = matchingGroup ? resolveVideoGroupSource(matchingGroup.group) : null
    if (matchingGroup && source) {
      block.shotNumbers.forEach((shotNumber) => coveredShotNumbers.add(shotNumber))
      clips.push({
        panelId: matchingGroup.group.id,
        groupId: matchingGroup.group.id,
        sourceKind: 'videoGroup',
        source,
        durationSeconds: clampPositiveDuration(matchingGroup.group.durationSec, block.shotNumbers.length * 3),
        order: 0,
        shotNumber: block.shotNumbers[0] ?? null,
        shotNumbers: block.shotNumbers,
        description: shotDescriptionForGroup(block.shotNumbers, input.editScript, matchingGroup.group.prompt ?? block.prompt),
        sound: shotSoundForGroup(block.shotNumbers, input.editScript),
      })
      return
    }

    block.shotNumbers.forEach((shotNumber) => {
      const panel = panelByShotNumber.get(shotNumber)
      if (!panel) return
      coveredShotNumbers.add(shotNumber)
      clips.push(buildPanelClip(panel, input.editScript))
    })
  })

  sortedPanels.forEach((panel) => {
    const shot = findShotByPanel(panel, input.editScript)
    const shotNumber = shotNumberForPanelClip(shot, panel)
    if (typeof shotNumber === 'number' && coveredShotNumbers.has(shotNumber)) return
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
  if (input.editScript?.videoBlocks.length) {
    return buildEditScriptOrderedFinalRenderClips({
      panels: input.panels,
      videoGroups: input.videoGroups ?? [],
      editScript: input.editScript,
    })
  }

  const groupPlans = (input.videoGroups ?? [])
    .map((group) => ({
      group,
      shotNumbers: parseGroupShotNumbers(group.shotNumbers),
    }))
    .filter((item) => item.shotNumbers.length > 0)
    .sort((left, right) => left.shotNumbers[0] - right.shotNumbers[0])

  const coveredShotNumbers = new Set<number>()
  const groupClips = groupPlans.map((item): FinalRenderClipPlan => {
    item.shotNumbers.forEach((shotNumber) => coveredShotNumbers.add(shotNumber))
    const source = resolveVideoGroupSource(item.group)
    return {
      panelId: item.group.id,
      groupId: item.group.id,
      sourceKind: 'videoGroup' as const,
      source: source ?? '',
      durationSeconds: clampPositiveDuration(item.group.durationSec, item.shotNumbers.length * 3),
      order: 0,
      shotNumber: item.shotNumbers[0] ?? null,
      shotNumbers: item.shotNumbers,
      description: shotDescriptionForGroup(item.shotNumbers, input.editScript, item.group.prompt),
      sound: shotSoundForGroup(item.shotNumbers, input.editScript),
    }
  })

  const sortedPanels = sortPanelsForFinalRender(input.panels, input.editScript)
    .filter((panel) => {
      const shot = findShotByPanel(panel, input.editScript)
      const shotNumber = shot?.shotNumber ?? panel.panelNumber ?? null
      return typeof shotNumber === 'number' ? !coveredShotNumbers.has(shotNumber) : true
    })
  const panelClips = sortedPanels.map((panel) => {
    const shot = findShotByPanel(panel, input.editScript)
    const shotNumber = shotNumberForPanelClip(shot, panel)
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
    id: editScript.id,
    userPrompt: editScript.userPrompt,
    title: editScript.title,
    logline: editScript.logline ?? null,
    durationSec: editScript.durationSec,
    styleBible: editScript.styleBible ?? null,
    shotCount: editScript.shots.length,
    videoBlocks: editScript.videoBlocks.map((block, index) => ({
      blockNumber: index + 1,
      kind: block.kind,
      shotNumbers: block.shotNumbers,
      gridMode: block.gridMode ?? null,
      reason: block.reason,
      prompt: block.prompt,
    })),
    shots: editScript.shots.map((shot) => ({
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
      charactersAndScene: shot.charactersAndScene ?? '',
      sound: shot.sound,
    })),
  })
}

function buildRenderedTimelineJson(clips: readonly FinalRenderClipPlan[]): string {
  return safeJsonStringify(clips.map((clip) => ({
    order: clip.order,
    sourceKind: clip.sourceKind,
    panelId: clip.panelId,
    groupId: clip.groupId ?? null,
    shotNumber: clip.shotNumber,
    shotNumbers: clip.shotNumbers,
    durationSeconds: clip.durationSeconds,
    visualSummary: clip.description,
    soundDirection: clip.sound,
  })))
}

export function buildFinalRenderMusicPrompt(input: FinalRenderMusicPromptInput): string {
  const title = normalizeString(input.editScript?.title) || 'final video'
  const storyContext = normalizeString(input.editScript?.logline) || 'No additional story context provided.'
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
