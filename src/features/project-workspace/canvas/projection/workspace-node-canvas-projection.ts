import type { CSSProperties } from 'react'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { resolveEditFirstCanvasVisibility } from '@/lib/project-workflow/edit-first-canvas-visibility'
import { buildEditStylePreviewSetView } from '@/lib/edit-script/style-preview-set-view'
import { TASK_RUNTIME_TARGETS, type TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type {
  Character,
  Location,
  ProjectEditAssetRequirement,
  ProjectEditBible,
  ProjectEditScript,
  ProjectEditScriptShot,
  ProjectEditShotExecutionPlan,
  ProjectFinalVideo,
  ProjectPanel,
  ProjectStoryboard,
  ProjectVideoGroup,
} from '@/types/project'
import type {
  WorkspaceCanvasAssetRef,
  WorkspaceCanvasBgmScoreDetails,
  WorkspaceCanvasEditPipelineStepItem,
  WorkspaceCanvasFlowEdge,
  WorkspaceCanvasFlowNode,
  WorkspaceCanvasImageDetails,
  MediaLoadingContext,
  WorkspaceCanvasMediaNodeKind,
  WorkspaceCanvasMediaNodeData,
  WorkspaceCanvasNodeActionHandler,
  WorkspaceCanvasNodeData,
  WorkspaceCanvasNodeRecord,
  WorkspaceCanvasProjection,
  WorkspaceCanvasShotDetails,
  WorkspaceCanvasSoundscapeDetails,
  WorkspaceCanvasStyleBibleDetails,
  WorkspaceCanvasVideoPlanDetails,
} from '../node-canvas-types'

type WorkspaceCanvasNodeInputBase = Omit<
  WorkspaceCanvasNodeData,
  'nodeId' | 'width' | 'height' | 'kind' | 'mediaLoadingContext'
>

type WorkspaceCanvasNodeInputData = WorkspaceCanvasNodeInputBase & (
  | {
    readonly kind: WorkspaceCanvasMediaNodeKind
    readonly mediaLoadingContext: MediaLoadingContext
  }
  | {
    readonly kind: Exclude<WorkspaceCanvasNodeData['kind'], WorkspaceCanvasMediaNodeKind>
    readonly mediaLoadingContext?: never
  }
)

type WorkspaceCanvasMediaNodeInputData = Omit<
  WorkspaceCanvasMediaNodeData,
  'nodeId' | 'width' | 'height' | 'mediaLoadingContext'
>
import {
  WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE,
  WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y,
  WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE,
  WORKSPACE_CANVAS_FINAL_NODE_SIZE,
  WORKSPACE_CANVAS_SHOT_NODE_SIZE,
  WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE,
} from '../node-presentation-profiles'
import { workspaceNodeId } from '../workspace-canvas-node-ids'
import { resolveWorkspaceCanvasNodeMaterialization } from '../registry/workspace-canvas-node-registry'
import type { WorkspaceCanvasStreamTarget } from '../structured-stream/workspace-structured-stream-runtime-types'
import {
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasResourcePhaseFromStatus,
  workspaceCanvasResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
} from '../lifecycle/workspace-canvas-resource-lifecycle'

interface TranslateValues {
  readonly [key: string]: string | number
}

type Translate = (key: string, values?: TranslateValues) => string

interface WorkspaceCanvasActiveTaskTarget extends TaskRuntimeTarget {
  readonly taskId: string
  readonly sourceKind?: string | null
}

export interface BuildWorkspaceNodeCanvasProjectionInput {
  readonly projectId?: string
  readonly episodeId: string
  readonly episodeName?: string
  readonly storyboards: readonly ProjectStoryboard[]
  readonly editFirstWorkflow: EditFirstWorkflowState
  readonly editBible?: ProjectEditBible | null
  readonly editScript?: ProjectEditScript | null
  readonly editScripts?: readonly ProjectEditScript[]
  readonly editShotExecutionPlans?: readonly ProjectEditShotExecutionPlan[]
  readonly projectCharacters?: readonly Character[]
  readonly projectLocations?: readonly Location[]
  readonly activeTaskTargets?: readonly WorkspaceCanvasActiveTaskTarget[]
  readonly editScriptPending?: boolean
  readonly streamTargets?: readonly WorkspaceCanvasStreamTarget[]
  readonly finalVideo?: ProjectFinalVideo | null
  readonly videoGroups?: readonly ProjectVideoGroup[]
  readonly defaultVideoModel?: string | null
  readonly defaultSequenceVideoModel?: string | null
  readonly savedLayouts: readonly CanvasNodeLayout[]
  readonly translate: Translate
  readonly onAction?: WorkspaceCanvasNodeActionHandler
}

type JsonRecord = Record<string, unknown>

const STORY_COLUMN_X = 260
const COLUMN_GAP_X = 900
const ROW_GAP_Y = 170
const SHOT_GRID_COLUMNS = 5
const VIDEO_PLAN_GRID_COLUMNS = SHOT_GRID_COLUMNS
const SHOT_GRID_GAP_X = 44
const SHOT_GRID_GAP_Y = 820
const STAGE_START_Y = 120
const SHOT_GRID_START_Y = 460
const DOWNSTREAM_STAGE_GAP_Y = 160
const VIDEO_PLAN_GRID_GAP_Y = 96
const FINAL_TIMELINE_GAP_Y = 120
const ASSET_GROUP_Y_OFFSET = WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y
const SHOT_GRID_START_X = STORY_COLUMN_X + COLUMN_GAP_X * 3

interface CanvasGridPositionInput {
  readonly index: number
  readonly columns: number
  readonly startX: number
  readonly startY: number
  readonly itemWidth: number
  readonly columnGapX: number
  readonly rowStepY: number
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readJsonRecord(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null
}

function parseJsonRecord(value: unknown): JsonRecord | null {
  if (isRecord(value)) return value
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return readJsonRecord(parsed)
  } catch {
    return null
  }
}

function parseStringList(value: string | null | undefined): string[] {
  if (!value?.trim()) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function planningEntityNameSet(value: unknown, key: 'characters' | 'locations'): ReadonlySet<string> {
  const record = readJsonRecord(value)
  const collection = record?.[key]
  if (!Array.isArray(collection)) return new Set()
  return new Set(collection.flatMap((item) => {
    const name = stringValue(readJsonRecord(item)?.name)
    return name ? [name.replace(/\s+/g, ' ').toLocaleLowerCase()] : []
  }))
}

function readShotIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const output: string[] = []
  value.forEach((item) => {
    if (typeof item !== 'string') return
    const shotId = item.trim()
    if (!shotId || seen.has(shotId)) return
    seen.add(shotId)
    output.push(shotId)
  })
  return output
}

function sameShotIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotId, index) => shotId === right[index])
}

function runtimeTargets(...targets: Array<TaskRuntimeTarget | null>): readonly TaskRuntimeTarget[] {
  return targets.filter((target): target is TaskRuntimeTarget => target !== null)
}

function hasStreamTarget(
  targets: readonly WorkspaceCanvasStreamTarget[],
  streamKind: WorkspaceCanvasStreamTarget['streamKind'],
  targetId: string,
): boolean {
  return targets.some((target) => target.streamKind === streamKind && target.targetId === targetId)
}

function findStreamTarget(
  targets: readonly WorkspaceCanvasStreamTarget[],
  streamKind: WorkspaceCanvasStreamTarget['streamKind'],
  episodeId: string,
): WorkspaceCanvasStreamTarget | null {
  return targets.find((target) => (
    target.streamKind === streamKind
    && (target.episodeId === null || target.episodeId === episodeId)
  )) ?? null
}

function resourcePresentationFromStatus(
  status: string | null | undefined,
) {
  const phase = workspaceCanvasResourcePhaseFromStatus(status)
  return phase ? workspaceCanvasResourcePresentation(phase) : null
}

function primaryPanelImageUrl(panel: ProjectPanel | null): string | null {
  if (!panel) return null
  return panel.media?.url
    ?? panel.imageUrl
    ?? parseStringList(panel.candidateImages).find((url) => !url.startsWith('PENDING:'))
    ?? null
}

function mediaAspectRatio(media: ProjectPanel['media']): number | null {
  if (!media) return null
  if (typeof media.width !== 'number' || typeof media.height !== 'number') return null
  if (!Number.isFinite(media.width) || !Number.isFinite(media.height)) return null
  if (media.width <= 0 || media.height <= 0) return null
  return media.width / media.height
}

function stylePreviewAspectRatioValue(value: '9:16' | '16:9' | '21:9' | null | undefined): number | null {
  switch (value) {
    case '9:16':
      return 9 / 16
    case '16:9':
      return 16 / 9
    case '21:9':
      return 21 / 9
    default:
      return null
  }
}

function confirmedStylePreviewAspectRatio(bible: ProjectEditBible | null | undefined): number | null {
  const confirmed = bible?.stylePreviews?.find((preview) => preview.status === 'confirmed') ?? null
  const fallback = bible?.stylePreviews?.[0] ?? null
  return stylePreviewAspectRatioValue(confirmed?.aspectRatio ?? fallback?.aspectRatio)
}

function resolvePanelShotNumber(panel: ProjectPanel): number {
  return panel.panelNumber ?? panel.panelIndex + 1
}

function resolvePanelShotId(panel: ProjectPanel): string {
  return panel.sourceShotId ?? `panel:${panel.id}`
}

function collectPanels(storyboards: readonly ProjectStoryboard[]): ProjectPanel[] {
  return storyboards
    .flatMap((storyboard) => storyboard.panels ?? [])
    .sort((left, right) => (
      resolvePanelShotNumber(left) - resolvePanelShotNumber(right)
      || left.panelIndex - right.panelIndex
      || left.id.localeCompare(right.id)
    ))
}

function gridRowCount(itemCount: number, columns: number): number {
  if (itemCount <= 0) return 0
  return Math.ceil(itemCount / columns)
}

function gridPosition(input: CanvasGridPositionInput): { readonly x: number; readonly y: number } {
  const column = input.index % input.columns
  const row = Math.floor(input.index / input.columns)
  return {
    x: input.startX + column * (input.itemWidth + input.columnGapX),
    y: input.startY + row * input.rowStepY,
  }
}

function gridBottomY(input: {
  readonly itemCount: number
  readonly columns: number
  readonly startY: number
  readonly itemHeight: number
  readonly rowStepY: number
}): number | null {
  const rows = gridRowCount(input.itemCount, input.columns)
  if (rows === 0) return null
  return input.startY + (rows - 1) * input.rowStepY + input.itemHeight
}

function defaultStoryboardBottomY(visibleStoryboardPanelCount: number): number {
  return gridBottomY({
    itemCount: visibleStoryboardPanelCount,
    columns: SHOT_GRID_COLUMNS,
    startY: SHOT_GRID_START_Y,
    itemHeight: WORKSPACE_CANVAS_SHOT_NODE_SIZE.height,
    rowStepY: SHOT_GRID_GAP_Y,
  }) ?? (STAGE_START_Y + WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.height)
}

function nextDefaultStageY(previousStageBottomY: number): number {
  return previousStageBottomY + DOWNSTREAM_STAGE_GAP_Y
}

function nodeBottomY(node: WorkspaceCanvasFlowNode): number {
  return node.position.y + node.data.height
}

function maxNodeBottomY(
  nodes: readonly WorkspaceCanvasFlowNode[],
  kind: WorkspaceCanvasFlowNode['data']['kind'],
): number | null {
  const matchingBottoms = nodes
    .filter((node) => node.data.kind === kind)
    .map((node) => nodeBottomY(node))
  return matchingBottoms.length > 0 ? Math.max(...matchingBottoms) : null
}

function panelByShotId(storyboards: readonly ProjectStoryboard[]): ReadonlyMap<string, ProjectPanel> {
  const panels = new Map<string, ProjectPanel>()
  collectPanels(storyboards).forEach((panel) => {
    const shotId = resolvePanelShotId(panel)
    if (!panels.has(shotId)) panels.set(shotId, panel)
  })
  return panels
}

function videoGroupForShotIds(
  videoGroups: readonly ProjectVideoGroup[],
  shotIds: readonly string[],
): ProjectVideoGroup | null {
  return videoGroups.find((group) => sameShotIds(readShotIds(group.shotIds), shotIds)) ?? null
}

function inferGridMode(shotCount: number): '2x2' | '3x3' | undefined {
  if (shotCount >= 2 && shotCount <= 4) return '2x2'
  if (shotCount >= 5 && shotCount <= 9) return '3x3'
  return undefined
}

function styleBibleHasPolicyText(details: WorkspaceCanvasStyleBibleDetails): boolean {
  return [
    details.rawUserStyle,
    details.styleSummary,
    ...Object.values(details.visual),
    ...Object.values(details.camera),
    ...Object.values(details.sound),
  ].some((value) => typeof value === 'string' && value.trim().length > 0)
}

function buildStyleBibleDetails(value: unknown): WorkspaceCanvasStyleBibleDetails | null {
  const root = readJsonRecord(value)
  if (!root) return null
  const stylePolicy = readJsonRecord(root.stylePolicy) ?? {}
  const visual = readJsonRecord(stylePolicy.visual) ?? {}
  const camera = readJsonRecord(stylePolicy.camera) ?? {}
  const sound = readJsonRecord(stylePolicy.sound) ?? {}
  const details: WorkspaceCanvasStyleBibleDetails = {
    rawUserStyle: stringValue(root.rawUserStyle),
    styleSummary: stringValue(root.styleSummary),
    visual: {
      imageFilterPrompt: stringValue(visual.imageFilterPrompt),
      lightingPrompt: stringValue(visual.lightingPrompt),
      colorPrompt: stringValue(visual.colorPrompt),
      texturePrompt: stringValue(visual.texturePrompt),
      compositionPrompt: stringValue(visual.compositionPrompt),
    },
    camera: {
      movementPrompt: stringValue(camera.movementPrompt),
      lensAndDepthPrompt: stringValue(camera.lensAndDepthPrompt),
      videoRhythmPrompt: stringValue(camera.videoRhythmPrompt),
    },
    sound: {
      soundFilterPrompt: stringValue(sound.soundFilterPrompt),
    },
  }
  return styleBibleHasPolicyText(details) ? details : null
}

function confirmedStylePreviewImageUrl(bible: ProjectEditBible | null | undefined): string | null {
  return bible?.stylePreviews?.find((preview) => (
    preview.status === 'confirmed' && Boolean(stringValue(preview.imageUrl))
  ))?.imageUrl ?? null
}

function editBiblePreviewText(editBible: ProjectEditBible | null | undefined): string {
  if (!editBible) return ''
  if (typeof editBible.textPreview === 'string' && editBible.textPreview.trim()) return editBible.textPreview.trim()
  const bible = editBible.bible
  if (bible && typeof bible === 'object') {
    const synopsis = (bible as { synopsis?: unknown }).synopsis
    if (typeof synopsis === 'string' && synopsis.trim()) return synopsis.trim()
  }
  return ''
}

function assetPreviewUrl(requirement: ProjectEditAssetRequirement): string | null {
  return requirement.previewImageUrl ?? null
}

function shotCharacters(shot: ProjectEditScriptShot): string[] {
  return shot.characters.map((character) => `${character.name} / ${character.visibility} / ${character.role}`)
}

function shotKeyObjects(shot: ProjectEditScriptShot): string[] {
  return shot.keyObjects.map((object) => `${object.name} / ${object.role}`)
}

function shotDialogue(shot: ProjectEditScriptShot): string[] {
  const characterNameById = new Map(shot.characters.map((character) => [character.characterId, character.name]))
  return shot.dialogue.map((line) => {
    const speaker = characterNameById.get(line.characterId)
    if (!speaker) throw new Error(`EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:${shot.shotNumber}:${line.characterId}`)
    return `${speaker}: ${line.line}`
  })
}

function shotAssetRefs(panel: ProjectPanel): WorkspaceCanvasAssetRef[] {
  return parseStringList(panel.characters).map((name) => ({ name }))
}

function shotDetails(panel: ProjectPanel): WorkspaceCanvasShotDetails {
  return {
    shotType: panel.shotType,
    cameraMove: panel.cameraMove,
    characters: shotAssetRefs(panel),
    location: panel.location,
    props: parseStringList(panel.props),
    srtSegment: panel.srtSegment,
    timeRange: panel.srtStart !== null && panel.srtEnd !== null ? `${panel.srtStart} - ${panel.srtEnd}` : null,
    duration: panel.duration,
    imagePrompt: panel.imagePrompt,
    videoPrompt: panel.videoPrompt,
    executionSnapshot: parseJsonRecord(panel.executionSnapshotJson),
    renderFacts: parseJsonRecord(panel.renderFactsJson),
    actingNotes: panel.actingNotes,
    storyboardTextJson: null,
    errorMessage: panel.imageErrorMessage ?? panel.videoErrorMessage ?? null,
  }
}

function imageDetails(panel: ProjectPanel): WorkspaceCanvasImageDetails {
  return {
    imagePrompt: panel.imagePrompt,
    description: panel.description,
    candidateImages: parseStringList(panel.candidateImages),
    errorMessage: panel.imageErrorMessage ?? null,
  }
}

function styleForNode(width: number, height: number): CSSProperties {
  return { width, height }
}

function layoutPosition(
  savedLayouts: readonly CanvasNodeLayout[],
  nodeId: string,
  fallback: { readonly x: number; readonly y: number },
): { readonly x: number; readonly y: number } {
  const saved = savedLayouts.find((layout) => layout.nodeKey === nodeId)
  return saved ? { x: saved.x, y: saved.y } : fallback
}

function createEdge(id: string, source: string, target: string): WorkspaceCanvasFlowEdge {
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    animated: false,
  }
}

function normalizeMediaLoadingContext(value: unknown): MediaLoadingContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const styleImageUrl = Reflect.get(value, 'styleImageUrl')
  if (styleImageUrl !== null && typeof styleImageUrl !== 'string') return null
  return { styleImageUrl }
}

function createNode(input: {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: WorkspaceCanvasNodeInputData
  readonly width: number
  readonly height: number
}): WorkspaceCanvasFlowNode {
  const data: WorkspaceCanvasNodeRecord = {
    ...input.data,
    mediaLoadingContext: normalizeMediaLoadingContext(input.data.mediaLoadingContext),
    nodeId: input.id,
    width: input.width,
    height: input.height,
    layoutBasePosition: input.position,
  }
  return {
    id: input.id,
    type: 'workspaceNode',
    position: input.position,
    style: styleForNode(input.width, input.height),
    data,
  }
}

function createMediaNode(input: {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: WorkspaceCanvasMediaNodeInputData
  readonly loadingContext: { readonly styleImageUrl: string | null }
  readonly width: number
  readonly height: number
}): WorkspaceCanvasFlowNode {
  return createNode({
    id: input.id,
    position: input.position,
    width: input.width,
    height: input.height,
    data: {
      ...input.data,
      mediaLoadingContext: input.loadingContext,
    },
  })
}

function executionItems(
  plan: ProjectEditShotExecutionPlan,
  editScript: ProjectEditScript,
  translate: Translate,
): WorkspaceCanvasEditPipelineStepItem[] {
  const characterNameById = new Map(editScript.shots.flatMap((shot) => (
    shot.characters.map((character) => [character.characterId, character.name] as const)
  )))
  return plan.shots.map((shot) => ({
    title: translate('nodeFields.shotIndex', { index: shot.shotNumber }),
    fields: [
      { label: translate('nodeFields.shotScale'), value: shot.camera.shotScale },
      { label: translate('nodeFields.lens'), value: shot.camera.lens },
      { label: translate('nodeFields.focus'), value: shot.camera.focus },
      { label: translate('nodeFields.cameraHeight'), value: shot.camera.height },
      { label: translate('nodeFields.cameraAngle'), value: shot.camera.angle },
      { label: translate('nodeFields.composition'), value: shot.camera.composition },
      { label: translate('nodeFields.lighting'), value: shot.camera.lighting },
      { label: translate('nodeFields.axisAndEyeline'), value: shot.blocking.axis.screenDirection },
    ],
    body: shot.blocking.spatialNote,
    chips: [
      ...shot.blocking.characters.map((character) => {
        const name = characterNameById.get(character.characterId)
        if (!name) throw new Error(`EDIT_SHOT_EXECUTION_CHARACTER_UNKNOWN:${shot.shotNumber}:${character.characterId}`)
        return `${name} / ${character.visibility}`
      }),
      ...shot.blocking.objects.map((object) => object.name),
    ],
  }))
}

function bgmScoreDetails(finalVideo: ProjectFinalVideo | null | undefined): WorkspaceCanvasBgmScoreDetails | undefined {
  const bgmScore = finalVideo?.musicScore
  if (!bgmScore) return undefined
  return {
    status: bgmScore.status,
    durationSeconds: bgmScore.durationSeconds ?? null,
    musicModel: bgmScore.musicModel ?? null,
    hasPromptDesign: Boolean(bgmScore.plan),
    promptDesignMissing: !bgmScore.plan,
    designSectionCount: bgmScore.plan?.scoreDesign.sections.length ?? 0,
    promptSectionCount: bgmScore.plan?.promptSections.length ?? 0,
    virtualLayerCount: bgmScore.plan?.virtualLayers.length ?? 0,
    mixUrl: bgmScore.mix?.url ?? null,
    errorMessage: bgmScore.errorMessage ?? null,
    scoreOverview: bgmScore.plan?.scoreDesign.overview ?? null,
    designSections: bgmScore.plan?.scoreDesign.sections ?? [],
    promptSections: bgmScore.plan?.promptSections ?? [],
    virtualLayers: bgmScore.plan?.virtualLayers ?? [],
    finalPrompt: bgmScore.plan?.finalPrompt ?? null,
  }
}

function soundscapeDetails(
  finalVideo: ProjectFinalVideo | null | undefined,
  editScripts: readonly ProjectEditScript[],
): WorkspaceCanvasSoundscapeDetails | undefined {
  const soundscape = finalVideo?.soundscape
  if (!soundscape) return undefined
  const sources = soundscape.plan?.sources ?? []
  const sourceIndexById = new Map(sources.map((source, index) => [source.sourceId, index + 1]))
  const shotNumberById = new Map(editScripts.flatMap((script) => (
    script.shots.map((shot) => [shot.shotId, shot.shotNumber] as const)
  )))
  return {
    status: soundscape.status,
    decision: soundscape.decision ?? null,
    soundEffectModel: soundscape.soundEffectModel ?? null,
    sourceCount: soundscape.sourceCount,
    sectionCount: soundscape.sectionCount,
    sources: sources.map((source, index) => ({
      key: source.sourceId,
      sourceIndex: index + 1,
      prompt: source.prompt,
      loopDurationSeconds: source.loopDurationSeconds,
      promptInfluence: source.promptInfluence,
    })),
    sections: (soundscape.plan?.sections ?? []).map((section, index) => {
      const sourceIndex = sourceIndexById.get(section.sourceId)
      const rangeStart = shotNumberById.get(section.fromShotId)
      const rangeEnd = shotNumberById.get(section.toShotId)
      if (!sourceIndex) throw new Error(`SOUNDSCAPE_SECTION_SOURCE_UNKNOWN:${section.sourceId}`)
      if (!rangeStart || !rangeEnd) {
        throw new Error(`SOUNDSCAPE_SECTION_SHOT_UNKNOWN:${section.fromShotId}:${section.toShotId}`)
      }
      return {
        key: `${section.sourceId}:${section.fromShotId}:${section.toShotId}:${index}`,
        sourceIndex,
        rangeKind: 'shot' as const,
        rangeStart,
        rangeEnd,
        perspective: section.perspective,
        intensity: section.intensity,
        transitionIn: section.transitionIn,
        transitionOut: section.transitionOut,
      }
    }),
    mixUrl: soundscape.mix?.url ?? null,
    errorMessage: soundscape.errorMessage ?? null,
  }
}

function countCompletedEditAssetRequirements(requirements: readonly ProjectEditAssetRequirement[]): number {
  return requirements.filter((requirement) => requirement.status === 'completed').length
}

function videoPlanDetails(input: {
  readonly editScript: ProjectEditScript
  readonly segmentIndex: number
  readonly videoGroup: ProjectVideoGroup | null
  readonly panelsByShot: ReadonlyMap<string, ProjectPanel>
  readonly requirements: readonly ProjectEditAssetRequirement[]
  readonly defaultVideoModel?: string | null
}): WorkspaceCanvasVideoPlanDetails {
  const segment = input.editScript.generationSegments[input.segmentIndex]
  if (!segment) throw new Error(`GENERATION_SEGMENT_MISSING:${input.segmentIndex}`)
  const segmentShots = segment.shotIds.map((shotId) => input.editScript.shots.find((candidate) => candidate.shotId === shotId)).filter((shot): shot is ProjectEditScriptShot => Boolean(shot))
  const shotNumbers = segmentShots.map((shot) => shot.shotNumber)
  const durationSec = segment.shotIds.reduce((total, shotId) => {
    const shot = input.editScript.shots.find((candidate) => candidate.shotId === shotId)
    return total + (shot?.durationSec ?? 0)
  }, 0)
  const sourceImages = segment.shotIds.map((shotId, index) => {
    const panel = input.panelsByShot.get(shotId) ?? null
    return {
      panelId: panel?.id ?? null,
      storyboardId: panel?.storyboardId ?? null,
      panelIndex: panel?.panelIndex ?? null,
      shotNumber: shotNumbers[index] ?? index + 1,
      imageUrl: primaryPanelImageUrl(panel),
      aspectRatio: null,
    }
  })
  return {
    editScriptId: input.editScript.id,
    segmentIndex: input.segmentIndex,
    kind: 'group',
    videoGroupId: input.videoGroup?.id ?? null,
    shotNumbers,
    shotIds: segment.shotIds,
    durationSec,
    gridMode: inferGridMode(segment.shotIds.length),
    continuity: segment.continuity,
    prompt: input.videoGroup?.prompt ?? null,
    assetReferenceVideoModel: input.defaultVideoModel ?? null,
    outputUrl: input.videoGroup?.videoMedia?.url ?? input.videoGroup?.videoUrl ?? null,
    outputAspectRatio: null,
    errorMessage: input.videoGroup?.errorMessage ?? null,
    sourceImages,
    assetReferences: input.requirements
      .filter((requirement) => requirement.shotIds.some((shotId) => segment.shotIds.includes(shotId)))
      .map((requirement) => ({
        id: requirement.id,
        name: requirement.name,
        kind: requirement.kind,
        imageUrl: assetPreviewUrl(requirement),
        shotNumbers: requirement.shotIds
          .map((shotId) => input.editScript.shots.find((shot) => shot.shotId === shotId)?.shotNumber ?? null)
          .filter((value): value is number => typeof value === 'number'),
        shotIds: requirement.shotIds,
      })),
    validationMessage: null,
  }
}

export function buildWorkspaceNodeCanvasProjection(input: BuildWorkspaceNodeCanvasProjectionInput): WorkspaceCanvasProjection {
  const {
    projectId,
    episodeId,
    episodeName,
    storyboards,
    editFirstWorkflow,
    editBible = null,
    editScript = null,
    editScripts = [],
    editShotExecutionPlans = [],
    projectCharacters = [],
    projectLocations = [],
    activeTaskTargets = [],
    editScriptPending = false,
    streamTargets = [],
    finalVideo = null,
    videoGroups = [],
    defaultVideoModel = null,
    defaultSequenceVideoModel = null,
    savedLayouts,
    translate,
    onAction,
  } = input

  const nodes: WorkspaceCanvasFlowNode[] = []
  const edges: WorkspaceCanvasFlowEdge[] = []
  const panelsByShot = panelByShotId(storyboards)
  const projectedEditScripts = editScripts.length > 0 ? editScripts : editScript ? [editScript] : []
  const chapterIndexById = new Map(
    (editBible?.chapters ?? []).map((chapter) => [chapter.id, chapter.chapterIndex] as const),
  )
  const editFirstCanvasVisibility = resolveEditFirstCanvasVisibility(editFirstWorkflow)
  const styleBibleDetails = buildStyleBibleDetails(editBible?.styleBible)
  const stylePreviewSetView = buildEditStylePreviewSetView({
    previews: editBible?.stylePreviews ?? [],
  })
  const stylePreviewImageUrl = confirmedStylePreviewImageUrl(editBible)
  const stylePreviewAspectRatio = confirmedStylePreviewAspectRatio(editBible)
  const editSourceScriptStreamTarget = findStreamTarget(streamTargets, 'editSourceScript', episodeId)
  const editBibleStreamTarget = findStreamTarget(streamTargets, 'editBible', episodeId)
  const sourceScriptMaterialized = Boolean(
    editBible?.sourceKind === 'prompt_generated_script'
    && (
      (typeof editBible.sourceText === 'string' && editBible.sourceText.trim().length > 0)
      || editBible.scriptStructure
    ),
  )
  const sourceScriptFailed = Boolean(
    editBible?.status === 'failed'
    && editBible.sourceKind === 'prompt_generated_outline'
    && !sourceScriptMaterialized,
  )
  const sourceScriptStreamAvailable = Boolean(editSourceScriptStreamTarget)
    || (editBible ? hasStreamTarget(streamTargets, 'editSourceScript', editBible.id) : false)
  const sourceScriptProjection = resolveWorkspaceCanvasNodeMaterialization('editSourceScript', activeTaskTargets, {
    identityAvailable: true,
    workflowVisible: editFirstCanvasVisibility.editSourceScript,
    resourceAvailable: Boolean(
      editBible
      && (
        editBible.sourceKind === 'prompt_generated_outline'
        || editBible.sourceKind === 'prompt_generated_script'
      ),
    ),
    streamAvailable: sourceScriptStreamAvailable,
    submissionAvailable: false,
    targetId: editBible?.id ?? null,
  })
  const activeSourceScriptTaskTarget = sourceScriptProjection.activeTaskTargets[0] ?? null
  const sourceScriptRuntimeTargetId = editBible?.id ?? activeSourceScriptTaskTarget?.targetId ?? editSourceScriptStreamTarget?.targetId ?? null
  const sourceScriptRunning = !sourceScriptMaterialized && (
    sourceScriptProjection.activeTaskTargets.length > 0 || sourceScriptStreamAvailable
  )
  const hasProductionPlanningArtifact = Boolean(
    editBible
    && (
      editBible.bible
      || editBible.beatSheet
      || editBible.ledger
      || editBible.emotionalCurve
      || (editBible.chapters?.length ?? 0) > 0
      || editBible.status === 'ready_for_review'
      || editBible.status === 'confirmed'
      || (editBible.status === 'failed' && editBible.sourceKind !== 'prompt_generated_outline')
    ),
  )
  const bibleStreamAvailable = Boolean(editBibleStreamTarget)
    || (editBible ? hasStreamTarget(streamTargets, 'editBible', editBible.id) : false)
  const bibleProjection = resolveWorkspaceCanvasNodeMaterialization('editBible', activeTaskTargets, {
    identityAvailable: true,
    workflowVisible: editFirstCanvasVisibility.editBible,
    resourceAvailable: hasProductionPlanningArtifact,
    streamAvailable: bibleStreamAvailable,
    submissionAvailable: editScriptPending,
    targetId: editBible?.id ?? null,
  })
  const activeEditBibleTaskTarget = bibleProjection.activeTaskTargets[0] ?? null
  const editBibleRuntimeTargetId = editBible?.id ?? activeEditBibleTaskTarget?.targetId ?? editBibleStreamTarget?.targetId ?? null
  const bibleRunning = bibleProjection.activeTaskTargets.length > 0 || bibleStreamAvailable
  let sourceScriptNodeId: string | null = null
  if (sourceScriptProjection.materialized) {
    sourceScriptNodeId = workspaceNodeId.editSourceScript(episodeId)
    const sourceScriptPresentation = sourceScriptFailed
      ? workspaceCanvasFailedResourcePresentation()
      : sourceScriptMaterialized
        ? workspaceCanvasSucceededResourcePresentation()
        : workspaceCanvasPendingResourcePresentation()
    const sourceText = typeof editBible?.sourceText === 'string' ? editBible.sourceText.trim() : ''
    nodes.push(createNode({
      id: sourceScriptNodeId,
      position: layoutPosition(savedLayouts, sourceScriptNodeId, { x: STORY_COLUMN_X, y: STAGE_START_Y }),
      width: WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editSourceScript',
        layoutNodeType: 'editSourceScript',
        targetType: 'editSourceScript',
        targetId: sourceScriptRuntimeTargetId ?? episodeId,
        title: translate(sourceScriptRunning || !sourceScriptMaterialized ? 'nodes.editSourceScript.pendingTitle' : 'nodes.editSourceScript.title'),
        eyebrow: translate('nodes.editSourceScript.eyebrow'),
        body: sourceText || translate('nodes.editSourceScript.pendingBody'),
        meta: sourceScriptRunning ? translate('nodes.editSourceScript.pendingMeta') : '',
        ...sourceScriptPresentation,
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditSourceScript(sourceScriptRuntimeTargetId)),
        sourceScriptDetails: {
          sourceDocumentId: editBible?.sourceDocumentId ?? null,
          sourceText,
          scriptStructure: editBible?.scriptStructure ?? null,
        },
        onAction,
      },
    }))
  }

  let bibleNodeId: string | null = null
  if (bibleProjection.materialized) {
    const biblePresentation = editBible
      ? resourcePresentationFromStatus(editBible.status) ?? workspaceCanvasPendingResourcePresentation()
      : workspaceCanvasPendingResourcePresentation()
    bibleNodeId = workspaceNodeId.editBible(episodeId)
    const productionNodeY = sourceScriptNodeId
      ? STAGE_START_Y + WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height + 96
      : STAGE_START_Y
    nodes.push(createNode({
      id: bibleNodeId,
      position: layoutPosition(savedLayouts, bibleNodeId, { x: STORY_COLUMN_X, y: productionNodeY }),
      width: WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editBible',
        layoutNodeType: 'editBible',
        targetType: 'editBible',
        targetId: editBibleRuntimeTargetId ?? episodeId,
        title: translate(bibleRunning || !editBible ? 'nodes.editBible.pendingTitle' : 'nodes.editBible.title'),
        eyebrow: translate('nodes.editBible.eyebrow'),
        body: editBiblePreviewText(editBible) || translate('nodes.editBible.pendingBody'),
        meta: '',
        ...biblePresentation,
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditBible(editBibleRuntimeTargetId)),
        editBibleDetails: editBible
          ? {
              bibleText: editBiblePreviewText(editBible),
              bible: editBible.bible ?? null,
              beatSheet: editBible.beatSheet ?? null,
              ledger: editBible.ledger ?? null,
              emotionalCurve: editBible.emotionalCurve ?? null,
              chapters: (editBible.chapters ?? []).map((chapter) => ({
                id: chapter.id,
                chapterIndex: chapter.chapterIndex,
                title: chapter.title,
                summary: chapter.summary,
                targetDurationSec: chapter.targetDurationSec,
                status: chapter.status,
                renderStatus: chapter.renderStatus ?? null,
                outputMediaId: chapter.outputMediaId ?? null,
              })),
            }
          : undefined,
        onAction,
      },
    }))
    if (sourceScriptNodeId) edges.push(createEdge(`edge:${sourceScriptNodeId}:${bibleNodeId}`, sourceScriptNodeId, bibleNodeId))
  }

  const stylePreviewStartY = (sourceScriptNodeId
    ? STAGE_START_Y + WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height + 96
    : STAGE_START_Y) + ROW_GAP_Y + WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height
  let styleBibleNodeId: string | null = null
  const styleBibleProjection = resolveWorkspaceCanvasNodeMaterialization('editStyleBible', activeTaskTargets, {
    identityAvailable: Boolean(editBible),
    workflowVisible: editFirstWorkflow.stage === 'style_preview_generating',
    resourceAvailable: Boolean(styleBibleDetails || stylePreviewSetView),
    streamAvailable: false,
    submissionAvailable: false,
    targetId: editBible?.id ?? null,
  })
  const stylePreviewOptionsRunning = styleBibleProjection.activeTaskTargets.length > 0
    || (editFirstWorkflow.stage === 'style_preview_generating' && !stylePreviewSetView)
  if (editBible && styleBibleProjection.materialized) {
    styleBibleNodeId = workspaceNodeId.editStyleBible(editBible.id)
    const stylePreviewRuntimeTargets = stylePreviewSetView?.allCandidates.flatMap((candidate) => {
      const target = TASK_RUNTIME_TARGETS.projectEditStylePreviewImage(candidate.id)
      return target ? [target] : []
    }) ?? []
    const hasGeneratingPreview = stylePreviewOptionsRunning
      || (stylePreviewSetView?.hasGeneratingPreview ?? false)
    const hasUsablePreview = stylePreviewSetView?.hasUsablePreview ?? false
    const hasFailedPreview = stylePreviewSetView?.hasFailedPreview ?? false
    nodes.push(createMediaNode({
      id: styleBibleNodeId,
      position: layoutPosition(savedLayouts, styleBibleNodeId, {
        x: STORY_COLUMN_X,
        y: stylePreviewStartY,
      }),
      width: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE.height,
      loadingContext: { styleImageUrl: stylePreviewImageUrl },
      data: {
        projectId,
        episodeName,
        kind: 'editStyleBible',
        layoutNodeType: 'editStyleBible',
        targetType: 'editStyleBible',
        targetId: editBible.id,
        title: translate(styleBibleDetails
          ? 'nodes.editStyleBible.title'
          : hasGeneratingPreview
            ? 'nodes.editStyleBible.pendingTitle'
            : hasFailedPreview && !hasUsablePreview
              ? 'nodes.editStyleBible.failedTitle'
              : 'nodes.editStyleBible.waitingTitle'),
        eyebrow: translate('nodes.editStyleBible.eyebrow'),
        body: styleBibleDetails?.styleSummary ?? translate(hasGeneratingPreview
          ? 'nodes.editStyleBible.pendingBody'
          : hasFailedPreview && !hasUsablePreview
            ? 'nodes.editStyleBible.failedBody'
            : 'nodes.editStyleBible.waitingBody'),
        meta: styleBibleDetails ? translate('status.succeeded') : '',
        ...(styleBibleDetails || hasUsablePreview
          ? workspaceCanvasSucceededResourcePresentation()
          : hasFailedPreview && !hasGeneratingPreview
            ? workspaceCanvasFailedResourcePresentation()
            : workspaceCanvasPendingResourcePresentation()),
        previewImageUrl: stylePreviewImageUrl,
        styleBibleDetails: styleBibleDetails ?? undefined,
        runtimeTargets: runtimeTargets(
          TASK_RUNTIME_TARGETS.projectEditStylePreviewOptions(editBible.id),
          ...stylePreviewRuntimeTargets,
        ),
        onAction,
      },
    }))
    if (bibleNodeId) {
      edges.push(createEdge(`edge:${bibleNodeId}:${styleBibleNodeId}`, bibleNodeId, styleBibleNodeId))
    }
  }

  let editScriptNodeId: string | null = null
  const editScriptNodeIdsByScriptId = new Map<string, string>()
  if (editFirstCanvasVisibility.editScript || editScript || editScripts.length > 0 || editScriptPending) {
    const scriptNodes = projectedEditScripts
    const editScriptTitle = (chapterId: string | null): string => {
      if (!chapterId) return translate('nodes.editScript.title')
      const chapterIndex = chapterIndexById.get(chapterId)
      return chapterIndex === undefined
        ? translate('nodes.editScript.title')
        : translate('nodes.editScript.titleWithChapterNumber', { chapter: chapterIndex + 1 })
    }
    const existingScriptChapterIds = new Set(scriptNodes.map((script) => script.chapterId).filter((chapterId): chapterId is string => Boolean(chapterId)))
    const pendingChapters = (editBible?.chapters ?? []).filter((chapter) => !existingScriptChapterIds.has(chapter.id))
    if (scriptNodes.length > 0) {
      scriptNodes.forEach((script, index) => {
        const nodeId = workspaceNodeId.editScript(episodeId, script.chapterId ?? null)
        const scriptChapterId = script.chapterId ?? null
        editScriptNodeIdsByScriptId.set(script.id, nodeId)
        if (editScript?.id === script.id || (!editScriptNodeId && index === 0)) editScriptNodeId = nodeId
        const editScriptPresentation = resourcePresentationFromStatus(script.status)
          ?? workspaceCanvasPendingResourcePresentation()
        const editScriptDetails = {
          bibleText: script.sourceText ?? '',
          durationSec: script.durationSec,
          shotCount: script.shotCount,
          shots: script.shots.map((shot) => {
            const panel = panelsByShot.get(shot.shotId) ?? null
            return {
              shotId: shot.shotId,
              shotNumber: shot.shotNumber,
              durationSec: shot.durationSec,
              sceneName: shot.scene.name,
              action: shot.action,
              characters: shotCharacters(shot),
              keyObjects: shotKeyObjects(shot),
              imagePrompt: panel?.imagePrompt ?? null,
              dialogue: shotDialogue(shot),
              sound: shot.sound,
              imageUrl: primaryPanelImageUrl(panel),
              videoUrl: panel?.videoMedia?.url ?? panel?.videoUrl ?? null,
            }
          }),
        }
        nodes.push(createNode({
          id: nodeId,
          position: layoutPosition(savedLayouts, nodeId, {
            x: STORY_COLUMN_X + COLUMN_GAP_X,
            y: STAGE_START_Y + index * (WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.height + 64),
          }),
          width: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.width,
          height: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.height,
          data: {
            projectId,
            episodeName,
            kind: 'editScript',
            layoutNodeType: 'editScript',
            targetType: 'editScript',
            targetId: script.id,
            title: editScriptTitle(scriptChapterId),
            eyebrow: translate('nodes.editScript.eyebrow'),
            body: script.shots.slice(0, 4).map((shot) => `${shot.shotNumber}. ${shot.action}`).join('\n')
              || translate('nodes.editScript.pendingBody'),
            meta: translate('nodes.editScript.meta', {
              shots: script.shotCount,
              duration: script.durationSec,
              assets: script.requirements.length,
              completed: countCompletedEditAssetRequirements(script.requirements),
            }),
            ...editScriptPresentation,
            runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditChapterScriptGeneration(scriptChapterId)),
            editScriptDetails,
            onAction,
          },
        }))
        if (styleBibleNodeId) {
          edges.push(createEdge(`edge:${styleBibleNodeId}:${nodeId}`, styleBibleNodeId, nodeId))
        } else if (bibleNodeId) {
          edges.push(createEdge(`edge:${bibleNodeId}:${nodeId}`, bibleNodeId, nodeId))
        }
      })
      pendingChapters.forEach((chapter, pendingIndex) => {
        const index = scriptNodes.length + pendingIndex
        const nodeId = workspaceNodeId.editScript(episodeId, chapter.id)
        nodes.push(createNode({
          id: nodeId,
          position: layoutPosition(savedLayouts, nodeId, {
            x: STORY_COLUMN_X + COLUMN_GAP_X,
            y: STAGE_START_Y + index * (WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.height + 64),
          }),
          width: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.width,
          height: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.height,
          data: {
            projectId,
            episodeName,
            kind: 'editScript',
            layoutNodeType: 'editScript',
            targetType: 'editScript',
            targetId: chapter.id,
            title: editScriptTitle(chapter.id),
            eyebrow: translate('nodes.editScript.eyebrow'),
            body: chapter.summary || translate('nodes.editScript.pendingBody'),
            meta: translate('nodes.editScript.pendingMeta'),
            ...workspaceCanvasPendingResourcePresentation(),
            runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditChapterScriptGeneration(chapter.id)),
            onAction,
          },
        }))
        if (styleBibleNodeId) {
          edges.push(createEdge(`edge:${styleBibleNodeId}:${nodeId}`, styleBibleNodeId, nodeId))
        } else if (bibleNodeId) {
          edges.push(createEdge(`edge:${bibleNodeId}:${nodeId}`, bibleNodeId, nodeId))
        }
      })
    } else if (pendingChapters.length > 0) {
      pendingChapters.forEach((chapter, index) => {
        const nodeId = workspaceNodeId.editScript(episodeId, chapter.id)
        if (!editScriptNodeId) editScriptNodeId = nodeId
        nodes.push(createNode({
          id: nodeId,
          position: layoutPosition(savedLayouts, nodeId, {
            x: STORY_COLUMN_X + COLUMN_GAP_X,
            y: STAGE_START_Y + index * (WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.height + 64),
          }),
          width: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.width,
          height: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.height,
          data: {
            projectId,
            episodeName,
            kind: 'editScript',
            layoutNodeType: 'editScript',
            targetType: 'editScript',
            targetId: chapter.id,
            title: editScriptTitle(chapter.id),
            eyebrow: translate('nodes.editScript.eyebrow'),
            body: chapter.summary || translate('nodes.editScript.pendingBody'),
            meta: translate('nodes.editScript.pendingMeta'),
            ...workspaceCanvasPendingResourcePresentation(),
            runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditChapterScriptGeneration(chapter.id)),
            onAction,
          },
        }))
        if (styleBibleNodeId) {
          edges.push(createEdge(`edge:${styleBibleNodeId}:${nodeId}`, styleBibleNodeId, nodeId))
        } else if (bibleNodeId) {
          edges.push(createEdge(`edge:${bibleNodeId}:${nodeId}`, bibleNodeId, nodeId))
        }
      })
    } else {
      editScriptNodeId = workspaceNodeId.editScript(episodeId, null)
      nodes.push(createNode({
        id: editScriptNodeId,
        position: layoutPosition(savedLayouts, editScriptNodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X, y: STAGE_START_Y }),
        width: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE.height,
        data: {
          projectId,
          episodeName,
          kind: 'editScript',
          layoutNodeType: 'editScript',
          targetType: 'editScript',
          targetId: episodeId,
          title: translate('nodes.editScript.title'),
          eyebrow: translate('nodes.editScript.eyebrow'),
          body: translate('nodes.editScript.pendingBody'),
          meta: translate('nodes.editScript.pendingMeta'),
          ...workspaceCanvasPendingResourcePresentation(),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeEditScriptGeneration(episodeId)),
          actionLabel: translate('actions.generateEditScript'),
          action: editBible ? { type: 'generate_edit_script' } : undefined,
          actionDisabled: !editBible,
          onAction,
        },
      }))
      if (styleBibleNodeId) {
        edges.push(createEdge(`edge:${styleBibleNodeId}:${editScriptNodeId}`, styleBibleNodeId, editScriptNodeId))
      } else if (bibleNodeId) {
        edges.push(createEdge(`edge:${bibleNodeId}:${editScriptNodeId}`, bibleNodeId, editScriptNodeId))
      }
    }
  }

  let assetGroupNodeId: string | null = null
  const assetGroupScripts = editScripts.length > 0 ? editScripts : editScript ? [editScript] : []
  const allAssetRequirements = assetGroupScripts.flatMap((script) => script.requirements.map((requirement) => ({ script, requirement })))
  const requirementByAssetId = new Map<string, (typeof allAssetRequirements)[number]>()
  allAssetRequirements.forEach((item) => {
    const key = item.requirement.targetId?.trim()
    if (key && !requirementByAssetId.has(key)) requirementByAssetId.set(key, item)
  })
  const plannedCharacterNames = planningEntityNameSet(editBible?.bible, 'characters')
  const plannedLocationNames = planningEntityNameSet(editBible?.bible, 'locations')
  const plannedAssetCandidates = [
    ...projectCharacters
      .filter((character) => plannedCharacterNames.size === 0 || plannedCharacterNames.has(character.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()))
      .map((character) => {
      const appearance = character.appearances[0] ?? null
      const imageUrl = appearance?.imageUrl || appearance?.imageUrls?.[0] || appearance?.media?.url || null
      return {
        id: character.id,
        kind: 'character' as const,
        name: character.name,
        description: character.profileData || character.introduction || appearance?.description || character.name,
        previewImageUrl: imageUrl,
        errorMessage: appearance?.imageErrorMessage ?? null,
        taskTargetType: 'CharacterAppearance' as const,
        taskTargetId: appearance?.id ?? character.id,
      }
    }),
    ...projectLocations
      .filter((location) => plannedLocationNames.size === 0 || plannedLocationNames.has(location.name.trim().replace(/\s+/g, ' ').toLocaleLowerCase()))
      .map((location) => {
      const image = location.images.find((item) => item.id === location.selectedImageId)
        ?? location.images.find((item) => item.isSelected)
        ?? location.images[0]
        ?? null
      return {
        id: location.id,
        kind: 'location' as const,
        name: location.name,
        description: location.summary || image?.description || location.name,
        previewImageUrl: image?.imageUrl || image?.media?.url || null,
        errorMessage: image?.imageErrorMessage ?? image?.spatialProfileError ?? null,
        taskTargetType: 'LocationImage' as const,
        taskTargetId: location.id,
      }
    }),
  ]
  const plannedAssetsByIdentity = new Map<string, (typeof plannedAssetCandidates)[number]>()
  for (const asset of plannedAssetCandidates) {
    const identity = `${asset.kind}:${asset.id}`
    if (!plannedAssetsByIdentity.has(identity)) plannedAssetsByIdentity.set(identity, asset)
  }
  const plannedAssets = [...plannedAssetsByIdentity.values()]
  const fallbackAssetsByIdentity = new Map<string, {
    readonly id: string
    readonly kind: 'character' | 'location'
    readonly name: string
    readonly description: string
    readonly previewImageUrl: string | null
    readonly errorMessage: string | null
    readonly taskTargetType: 'CharacterAppearance' | 'LocationImage'
    readonly taskTargetId: string
  }>()
  for (const { requirement } of allAssetRequirements) {
    const assetId = requirement.targetId ?? requirement.id
    const identity = `${requirement.kind}:${assetId}`
    if (fallbackAssetsByIdentity.has(identity)) continue
    fallbackAssetsByIdentity.set(identity, {
      id: assetId,
      kind: requirement.kind,
      name: requirement.name,
      description: requirement.description,
      previewImageUrl: assetPreviewUrl(requirement),
      errorMessage: requirement.errorMessage ?? null,
      taskTargetType: requirement.taskTargetType ?? (requirement.kind === 'character' ? 'CharacterAppearance' : 'LocationImage'),
      taskTargetId: requirement.taskTargetId ?? assetId,
    })
  }
  const displayedAssets = plannedAssets.length > 0
    ? plannedAssets
    : [...fallbackAssetsByIdentity.values()]
  if (editFirstCanvasVisibility.editAssetGroup && displayedAssets.length > 0) {
    const nodeId = workspaceNodeId.editAssetGroup(episodeId)
    assetGroupNodeId = nodeId
    const primaryScript = editScript ?? assetGroupScripts[0] ?? null
    const characterRequirements = displayedAssets.filter((asset) => asset.kind === 'character').length
    const locationRequirements = displayedAssets.filter((asset) => asset.kind === 'location').length
    const assetsReady = displayedAssets.every((asset) => Boolean(asset.previewImageUrl))
    const assetsFailed = displayedAssets.some((asset) => Boolean(asset.errorMessage))
      || allAssetRequirements.some(({ requirement }) => requirement.status === 'failed')
    const assetGroupPresentation = assetsFailed
        ? workspaceCanvasFailedResourcePresentation()
        : assetsReady
          ? workspaceCanvasSucceededResourcePresentation()
          : null
    nodes.push(createMediaNode({
      id: nodeId,
      position: layoutPosition(savedLayouts, nodeId, {
        x: STORY_COLUMN_X + COLUMN_GAP_X,
        y: STAGE_START_Y + 420 + ASSET_GROUP_Y_OFFSET,
      }),
      width: 720,
      height: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.height,
      loadingContext: { styleImageUrl: stylePreviewImageUrl },
      data: {
        projectId,
        episodeName,
        kind: 'editAssetGroup',
        layoutNodeType: 'editAssetGroup',
        targetType: 'editAssetRequirement',
        targetId: episodeId,
        title: translate('nodes.editAssetGroup.title'),
        eyebrow: translate('nodes.editAssetGroup.eyebrow'),
        body: displayedAssets.map((asset) => `${asset.name} / ${asset.kind}`).join('\n')
          || translate('empty.editAsset'),
        meta: translate('nodes.editAssetGroup.meta', {
          characters: characterRequirements,
          locations: locationRequirements,
        }),
        ...(assetGroupPresentation ?? workspaceCanvasPendingResourcePresentation()),
        actionLabel: !assetsReady && primaryScript ? translate('actions.generateEditAssets') : undefined,
        action: !assetsReady && primaryScript ? { type: 'generate_edit_assets', editScriptId: primaryScript.id } : undefined,
        editAssetGroupDetails: {
          editScriptId: primaryScript?.id ?? episodeId,
          assets: displayedAssets.map((asset) => {
            const binding = requirementByAssetId.get(asset.id) ?? null
            const requirement = binding?.requirement ?? null
            const script = binding?.script ?? null
            const shotIds = requirement?.shotIds ?? []
            return {
            requirementId: requirement?.id ?? `planned-asset:${asset.kind}:${asset.id}`,
            kind: asset.kind,
            name: asset.name,
            eyebrow: asset.kind,
            description: asset.description,
            shotIds,
            shotNumbers: shotIds
              .map((shotId) => script?.shots.find((shot) => shot.shotId === shotId)?.shotNumber ?? null)
              .filter((value): value is number => typeof value === 'number'),
            lifecycle: asset.errorMessage || requirement?.status === 'failed'
                ? workspaceCanvasFailedResourcePresentation().lifecycle
                : asset.previewImageUrl
                  ? workspaceCanvasSucceededResourcePresentation().lifecycle
                  : resourcePresentationFromStatus(requirement?.status)?.lifecycle
                ?? workspaceCanvasPendingResourcePresentation().lifecycle,
            previewImageUrl: asset.previewImageUrl,
            runtimeTarget: TASK_RUNTIME_TARGETS.projectEditAssetImage(asset.taskTargetType, asset.taskTargetId),
            action: asset.previewImageUrl
              ? { type: 'regenerate_edit_asset_image', assetId: asset.id, kind: asset.kind }
              : requirement && script
                ? { type: 'generate_edit_asset', editScriptId: script.id, requirementId: requirement.id }
                : undefined,
            actionLabel: asset.previewImageUrl
              ? translate('actions.regenerateImage')
              : requirement && script
                ? translate('actions.generateEditAsset')
                : undefined,
          }}),
        },
        onAction,
      },
    }))
    const sourceNodeId = primaryScript
      ? workspaceNodeId.editScript(episodeId, primaryScript.chapterId ?? null)
      : bibleNodeId
    if (sourceNodeId) {
    edges.push(createEdge(`edge:${sourceNodeId}:${nodeId}`, sourceNodeId, nodeId))
    }
  }

  let executionNodeId: string | null = null
  const executionNodeIdsByEditScriptId = new Map<string, string>()
  const executionPlanByEditScriptId = new Map(
    editShotExecutionPlans.map((plan) => [plan.editScriptId, plan] as const),
  )
  const streamedExecutionPlanTargetIds = new Set(
    streamTargets
      .filter((target) => target.streamKind === 'editShotExecutionPlan')
      .map((target) => target.targetId),
  )
  projectedEditScripts.forEach((script, index) => {
    const matchingExecutionPlan = executionPlanByEditScriptId.get(script.id) ?? null
    const executionPlanProjection = resolveWorkspaceCanvasNodeMaterialization('editShotExecutionPlan', activeTaskTargets, {
      identityAvailable: true,
      workflowVisible: editFirstCanvasVisibility.editShotExecutionPlan,
      resourceAvailable: matchingExecutionPlan !== null,
      streamAvailable: streamedExecutionPlanTargetIds.has(script.id),
      submissionAvailable: false,
      targetId: script.id,
    })
    if (!executionPlanProjection.materialized) return
    const executionPresentation = matchingExecutionPlan
      ? resourcePresentationFromStatus(matchingExecutionPlan.status)
        ?? workspaceCanvasPendingResourcePresentation()
      : null
    const nodeId = workspaceNodeId.editShotExecutionPlan(script.id)
    executionNodeIdsByEditScriptId.set(script.id, nodeId)
    if (editScript?.id === script.id || executionNodeId === null) executionNodeId = nodeId
    const chapterIndex = script.chapterId ? chapterIndexById.get(script.chapterId) : undefined
    nodes.push(createNode({
      id: nodeId,
      position: layoutPosition(savedLayouts, nodeId, {
        x: STORY_COLUMN_X + COLUMN_GAP_X * 2,
        y: STAGE_START_Y + index * (WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.height + 64),
      }),
      width: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editShotExecutionPlan',
        layoutNodeType: 'editShotExecutionPlan',
        targetType: 'editShotExecutionPlan',
        targetId: script.id,
        title: chapterIndex === undefined
          ? translate('nodes.editShotExecutionPlan.title')
          : translate('nodes.editShotExecutionPlan.titleWithChapterNumber', { chapter: chapterIndex + 1 }),
        eyebrow: translate('nodes.editShotExecutionPlan.eyebrow'),
        body: matchingExecutionPlan
          ? matchingExecutionPlan.shots.slice(0, 4).map((shot) => `${shot.shotNumber}. ${shot.camera.shotScale} / ${shot.blocking.spatialNote}`).join('\n')
          : translate('nodes.editShotExecutionPlan.pendingBody'),
        meta: matchingExecutionPlan
          ? translate('nodes.editShotExecutionPlan.meta', { shots: matchingExecutionPlan.shots.length })
          : '',
        ...(executionPresentation ?? workspaceCanvasPendingResourcePresentation()),
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditShotExecutionPlan(script.id)),
        actionLabel: matchingExecutionPlan ? undefined : translate('actions.generateShotExecutionPlan'),
        action: matchingExecutionPlan ? undefined : { type: 'generate_edit_shot_execution_plan', editScriptId: script.id },
        editPipelineStepDetails: matchingExecutionPlan ? { items: executionItems(matchingExecutionPlan, script, translate) } : undefined,
        onAction,
      },
    }))
    const sourceNodeId = assetGroupNodeId ?? editScriptNodeIdsByScriptId.get(script.id) ?? null
    if (sourceNodeId) {
      edges.push(createEdge(`edge:${sourceNodeId}:${nodeId}`, sourceNodeId, nodeId))
    }
  })

  const panelList = collectPanels(storyboards)
  const shotNodeIdsByShotId = new Map<string, string>()
  const storyboardSourceNodeId = executionNodeId ?? editScriptNodeId
  const storyboardEditScriptIdById = new Map(
    storyboards.flatMap((storyboard) => storyboard.editScriptId
      ? [[storyboard.id, storyboard.editScriptId] as const]
      : []),
  )
  const visibleStoryboardPanelCount = editFirstCanvasVisibility.storyboardPanels && storyboardSourceNodeId
    ? panelList.length
    : 0
  if (editFirstCanvasVisibility.storyboardPanels && storyboardSourceNodeId) {
    panelList.forEach((panel, index) => {
      const shotNumber = resolvePanelShotNumber(panel)
      const shotId = resolvePanelShotId(panel)
      const nodeId = workspaceNodeId.shot(panel.id)
      shotNodeIdsByShotId.set(shotId, nodeId)
      const previewImageUrl = primaryPanelImageUrl(panel)
      const previewAspectRatio = mediaAspectRatio(panel.media) ?? stylePreviewAspectRatio
      const shotFailed = Boolean(panel.imageErrorMessage || panel.videoErrorMessage)
      const shotPresentation = shotFailed
        ? workspaceCanvasFailedResourcePresentation()
        : previewImageUrl
          ? workspaceCanvasSucceededResourcePresentation()
          : workspaceCanvasPendingResourcePresentation()
      nodes.push(createMediaNode({
        id: nodeId,
        position: layoutPosition(savedLayouts, nodeId, gridPosition({
          index,
          columns: SHOT_GRID_COLUMNS,
          startX: SHOT_GRID_START_X,
          startY: SHOT_GRID_START_Y,
          itemWidth: WORKSPACE_CANVAS_SHOT_NODE_SIZE.width,
          columnGapX: SHOT_GRID_GAP_X,
          rowStepY: SHOT_GRID_GAP_Y,
        })),
        width: WORKSPACE_CANVAS_SHOT_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_SHOT_NODE_SIZE.height,
        loadingContext: { styleImageUrl: stylePreviewImageUrl },
        data: {
          projectId,
          episodeName,
          kind: 'shot',
          layoutNodeType: 'shot',
          targetType: 'panel',
          targetId: panel.id,
          storyboardId: panel.storyboardId,
          panelIndex: panel.panelIndex,
          title: translate('nodes.shot.title', { shot: shotNumber }),
          eyebrow: translate('nodes.shot.eyebrow'),
          body: panel.description ?? translate('empty.panel'),
          meta: panel.location ?? translate('empty.location'),
          ...shotPresentation,
          previewImageUrl,
          previewAspectRatio,
          runtimeTargets: runtimeTargets(
            TASK_RUNTIME_TARGETS.projectPanelImageOperations(panel.id),
            TASK_RUNTIME_TARGETS.projectPanelVideo(panel.id),
          ),
          actionLabel: translate(previewImageUrl ? 'actions.regenerateImage' : 'actions.generateImage'),
          action: { type: 'generate_image', panelId: panel.id },
          shotDetails: shotDetails(panel),
          imageDetails: imageDetails(panel),
          videoDetails: {
            videoPrompt: panel.videoPrompt,
            lastVideoGenerationOptions: [],
            videoUrl: panel.videoMedia?.url ?? panel.videoUrl,
            videoModel: panel.videoModel,
            errorMessage: panel.videoErrorMessage ?? null,
          },
          onAction,
        },
      }))
      const panelEditScriptId = storyboardEditScriptIdById.get(panel.storyboardId) ?? null
      const panelSourceNodeId = panelEditScriptId
        ? executionNodeIdsByEditScriptId.get(panelEditScriptId)
          ?? editScriptNodeIdsByScriptId.get(panelEditScriptId)
          ?? storyboardSourceNodeId
        : storyboardSourceNodeId
      edges.push(createEdge(`edge:${panelSourceNodeId}:${nodeId}`, panelSourceNodeId, nodeId))
    })
  }
  const storyboardStageBottomY = maxNodeBottomY(nodes, 'shot') ?? defaultStoryboardBottomY(visibleStoryboardPanelCount)
  const videoPlanStartY = nextDefaultStageY(storyboardStageBottomY)

  if (editScript?.generationSegments.length && editFirstCanvasVisibility.videoPlan) {
    editScript.generationSegments.forEach((segment, index) => {
      const nodeId = workspaceNodeId.videoPlan(editScript.id, index + 1)
      const videoGroup = videoGroupForShotIds(videoGroups, segment.shotIds)
      const details = videoPlanDetails({
        editScript,
        segmentIndex: index,
        videoGroup,
        panelsByShot,
        requirements: editScript.requirements,
        defaultVideoModel: defaultSequenceVideoModel ?? defaultVideoModel,
      })
      const gridMode = inferGridMode(segment.shotIds.length)
      const canGenerateGroup = Boolean(gridMode && details.sourceImages.every((image) => Boolean(image.imageUrl)))
      const videoGroupPresentation = videoGroup
        ? resourcePresentationFromStatus(videoGroup.status)
          ?? workspaceCanvasPendingResourcePresentation()
        : null
      nodes.push(createMediaNode({
        id: nodeId,
        position: layoutPosition(savedLayouts, nodeId, gridPosition({
          index,
          columns: VIDEO_PLAN_GRID_COLUMNS,
          startX: SHOT_GRID_START_X,
          startY: videoPlanStartY,
          itemWidth: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.width,
          columnGapX: SHOT_GRID_GAP_X,
          rowStepY: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.height + VIDEO_PLAN_GRID_GAP_Y,
        })),
        width: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.width,
        height: WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.height,
        loadingContext: { styleImageUrl: stylePreviewImageUrl },
        data: {
          projectId,
          episodeName,
          kind: 'videoPlan',
          layoutNodeType: 'videoPlan',
          targetType: 'videoGroup',
          targetId: videoGroup?.id ?? `${editScript.id}:generationSegment:${index + 1}`,
          title: translate('nodes.videoPlan.title', { index: index + 1 }),
          eyebrow: translate('nodes.videoPlan.eyebrow'),
          body: segment.continuity,
          meta: translate('nodes.videoPlan.meta', {
            mode: translate('nodeFields.videoPlanGroup'),
            shots: segment.shotIds.length,
            duration: details.durationSec,
          }),
          ...(videoGroupPresentation ?? workspaceCanvasPendingResourcePresentation()),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectVideoGroup(videoGroup?.id ?? null)),
          actionLabel: canGenerateGroup
            ? translate(details.outputUrl ? 'actions.regenerateVideo' : 'actions.generateVideo')
            : undefined,
          action: canGenerateGroup && gridMode
            ? {
                type: 'generate_video_group',
                gridMode,
                shotIds: segment.shotIds,
              }
            : undefined,
          videoPlanDetails: details,
          onAction,
        },
      }))
      segment.shotIds.forEach((shotId) => {
        const shotNodeId = shotNodeIdsByShotId.get(shotId)
        if (shotNodeId) edges.push(createEdge(`edge:${shotNodeId}:${nodeId}:${shotId}`, shotNodeId, nodeId))
      })
      if (!segment.shotIds.some((shotId) => shotNodeIdsByShotId.has(shotId)) && executionNodeId) {
        edges.push(createEdge(`edge:${executionNodeId}:${nodeId}`, executionNodeId, nodeId))
      }
    })
  }
  const videoPlanStageBottomY = maxNodeBottomY(nodes, 'videoPlan')
  const bgmScoreDefaultY = nextDefaultStageY(Math.max(
    storyboardStageBottomY,
    videoPlanStageBottomY ?? storyboardStageBottomY,
  ))

  let bgmNodeId: string | null = null
  const bgmDetails = bgmScoreDetails(finalVideo)
  const bgmProjection = resolveWorkspaceCanvasNodeMaterialization('bgmScore', activeTaskTargets, {
    identityAvailable: true,
    workflowVisible: editFirstCanvasVisibility.bgmScore,
    resourceAvailable: Boolean(bgmDetails),
    streamAvailable: hasStreamTarget(streamTargets, 'bgmScore', episodeId),
    submissionAvailable: false,
    targetId: episodeId,
  })
  if (bgmProjection.materialized) {
    bgmNodeId = workspaceNodeId.bgmScore(episodeId)
    const bgmPresentation = bgmDetails
      ? resourcePresentationFromStatus(bgmDetails.status)
        ?? workspaceCanvasPendingResourcePresentation()
      : null
    const bgmReadyForGeneration = bgmDetails?.hasPromptDesign === true
      && bgmDetails.status !== 'planning'
      && bgmDetails.status !== 'generating'
    const bgmActionAvailable = bgmReadyForGeneration
      || editFirstWorkflow.allowedOperationIds.includes('plan_episode_bgm_score')
      || editFirstWorkflow.allowedOperationIds.includes('generate_episode_bgm_score')
    nodes.push(createMediaNode({
      id: bgmNodeId,
      position: layoutPosition(savedLayouts, bgmNodeId, { x: SHOT_GRID_START_X, y: bgmScoreDefaultY }),
      width: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height,
      loadingContext: { styleImageUrl: stylePreviewImageUrl },
      data: {
        projectId,
        episodeName,
        kind: 'bgmScore',
        layoutNodeType: 'bgmScore',
        targetType: 'episode',
        targetId: episodeId,
        title: translate('nodes.bgmScore.title'),
        eyebrow: translate('nodes.bgmScore.eyebrow'),
        body: bgmDetails?.scoreOverview ?? translate('nodes.bgmScore.body', { videos: videoGroups.length }),
        meta: bgmDetails?.musicModel ?? '',
        ...(bgmPresentation ?? workspaceCanvasPendingResourcePresentation()),
        ...(bgmActionAvailable ? {
          actionLabel: translate(
            bgmReadyForGeneration
              ? bgmDetails?.mixUrl ? 'actions.regenerateBgmScore' : 'actions.generateBgmScore'
              : 'actions.planBgmScore',
          ),
          action: bgmReadyForGeneration
            ? { type: 'generate_bgm_score' as const }
            : { type: 'plan_bgm_score' as const },
        } : {}),
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeBgmScore(episodeId)),
        bgmScoreDetails: bgmDetails,
        onAction,
      },
    }))
  }
  let soundscapeNodeId: string | null = null
  const projectedSoundscapeDetails = soundscapeDetails(
    finalVideo,
    editScripts.length > 0 ? editScripts : editScript ? [editScript] : [],
  )
  const soundscapeProjection = resolveWorkspaceCanvasNodeMaterialization('soundscape', activeTaskTargets, {
    identityAvailable: true,
    workflowVisible: editFirstCanvasVisibility.soundscape,
    resourceAvailable: Boolean(projectedSoundscapeDetails),
    streamAvailable: hasStreamTarget(streamTargets, 'soundscape', episodeId),
    submissionAvailable: false,
    targetId: episodeId,
  })
  if (soundscapeProjection.materialized) {
    soundscapeNodeId = workspaceNodeId.soundscape(episodeId)
    const details = projectedSoundscapeDetails
    const soundscapeReadyForGeneration = details?.decision === 'soundscape'
      && details.status !== 'planning'
      && details.status !== 'generating'
    const soundscapePresentation = details
      ? resourcePresentationFromStatus(details.status)
        ?? workspaceCanvasPendingResourcePresentation()
      : null
    const soundscapeActionAvailable = Boolean(details)
      || editFirstWorkflow.allowedOperationIds.includes('plan_episode_soundscape')
      || editFirstWorkflow.allowedOperationIds.includes('generate_episode_soundscape')
    nodes.push(createMediaNode({
      id: soundscapeNodeId,
      position: layoutPosition(savedLayouts, soundscapeNodeId, {
        x: SHOT_GRID_START_X + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.width + SHOT_GRID_GAP_X,
        y: bgmScoreDefaultY,
      }),
      width: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height,
      loadingContext: { styleImageUrl: stylePreviewImageUrl },
      data: {
        projectId,
        episodeName,
        kind: 'soundscape',
        layoutNodeType: 'soundscape',
        targetType: 'episode',
        targetId: episodeId,
        title: translate('nodes.soundscape.title'),
        eyebrow: translate('nodes.soundscape.eyebrow'),
        body: details?.decision === 'none_needed'
          ? translate('nodes.soundscape.noneNeededBody')
          : translate('nodes.soundscape.body', { videos: videoGroups.length }),
        meta: details?.soundEffectModel ?? '',
        ...(soundscapePresentation ?? workspaceCanvasPendingResourcePresentation()),
        ...(soundscapeActionAvailable ? {
          actionLabel: translate(
            soundscapeReadyForGeneration
              ? details?.mixUrl ? 'actions.regenerateSoundscape' : 'actions.generateSoundscape'
              : 'actions.planSoundscape',
          ),
          action: soundscapeReadyForGeneration
            ? { type: 'generate_soundscape' as const }
            : { type: 'plan_soundscape' as const },
        } : {}),
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeSoundscape(episodeId)),
        soundscapeDetails: details,
        onAction,
      },
    }))
  }
  const bgmStageBottomY = Math.max(
    maxNodeBottomY(nodes, 'bgmScore') ?? (bgmScoreDefaultY + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height),
    maxNodeBottomY(nodes, 'soundscape') ?? (bgmScoreDefaultY + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height),
  )

  let finalNodeId: string | null = null
  if (editFirstCanvasVisibility.finalTimeline) {
    const finalEditScripts = editScripts.length > 0 ? editScripts : editScript ? [editScript] : []
    const finalShotNumberById = new Map(finalEditScripts.flatMap((script) => (
      script.shots.map((shot) => [shot.shotId, shot.shotNumber] as const)
    )))
    finalNodeId = workspaceNodeId.finalTimeline(episodeId)
    const finalPresentation = finalVideo?.outputUrl
      ? workspaceCanvasSucceededResourcePresentation()
      : finalVideo?.renderStatus
        ? resourcePresentationFromStatus(finalVideo.renderStatus)
          ?? workspaceCanvasPendingResourcePresentation()
        : null
    nodes.push(createMediaNode({
      id: finalNodeId,
      position: layoutPosition(savedLayouts, finalNodeId, { x: SHOT_GRID_START_X, y: bgmStageBottomY + FINAL_TIMELINE_GAP_Y }),
      width: WORKSPACE_CANVAS_FINAL_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_FINAL_NODE_SIZE.height,
      loadingContext: { styleImageUrl: stylePreviewImageUrl },
      data: {
        projectId,
        episodeName,
        kind: 'finalTimeline',
        layoutNodeType: 'finalTimeline',
        targetType: 'episode',
        targetId: episodeId,
        title: translate('nodes.finalTimeline.title'),
        eyebrow: translate('nodes.finalTimeline.eyebrow'),
        body: finalVideo?.outputUrl ?? translate('nodes.finalTimeline.body'),
        meta: finalVideo?.renderStatus ?? '',
        ...(finalPresentation ?? workspaceCanvasPendingResourcePresentation()),
        actionLabel: translate('actions.renderFinalVideo'),
        action: { type: 'render_final_video' },
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeFinalRender(episodeId)),
        finalDetails: {
          totalShots: finalEditScripts.length > 0
            ? finalEditScripts.reduce((sum, script) => sum + script.shotCount, 0)
            : panelList.length,
          totalImages: panelList.filter((panel) => Boolean(primaryPanelImageUrl(panel))).length,
          totalVideos: panelList.filter((panel) => Boolean(panel.videoMedia?.url ?? panel.videoUrl)).length + videoGroups.filter((group) => Boolean(group.videoMedia?.url ?? group.videoUrl)).length,
          totalDuration: finalEditScripts.length > 0
            ? finalEditScripts.reduce((sum, script) => sum + script.durationSec, 0)
            : null,
          orderedVideoLabels: [
            ...videoGroups.map((group) => readShotIds(group.shotIds)
              .map((shotId) => {
                const shotNumber = finalShotNumberById.get(shotId)
                if (!shotNumber) throw new Error(`FINAL_VIDEO_TIMELINE_SHOT_UNKNOWN:${shotId}`)
                return shotNumber
              })
              .join(', ')),
            ...panelList.filter((panel) => Boolean(panel.videoMedia?.url ?? panel.videoUrl)).map((panel) => String(resolvePanelShotNumber(panel))),
          ],
          outputUrl: finalVideo?.outputUrl,
          renderStatus: finalVideo?.renderStatus,
        },
        onAction,
      },
    }))
  }

  if (finalNodeId && editScript?.generationSegments.length && editFirstCanvasVisibility.videoPlan) {
    editScript.generationSegments.forEach((_segment, index) => {
      edges.push(createEdge(`edge:video-plan-final:${index}`, workspaceNodeId.videoPlan(editScript.id, index + 1), finalNodeId))
    })
  }
  if (bgmNodeId && finalNodeId) {
    edges.push(createEdge(`edge:bgm-final:${episodeId}`, bgmNodeId, finalNodeId))
  }
  if (soundscapeNodeId && finalNodeId) {
    edges.push(createEdge(`edge:soundscape-final:${episodeId}`, soundscapeNodeId, finalNodeId))
  }

  return { nodes, edges }
}
