'use client'

import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'
import { resolveEditFirstCanvasVisibility } from '@/lib/project-workflow/edit-first-canvas-visibility'
import { TASK_RUNTIME_TARGETS, type TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type {
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
  WorkspaceCanvasNodeActionHandler,
  WorkspaceCanvasNodeData,
  WorkspaceCanvasProjection,
  WorkspaceCanvasShotDetails,
  WorkspaceCanvasStyleBibleDetails,
  WorkspaceCanvasVideoPlanDetails,
} from '../node-canvas-types'
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
import type { WorkspaceCanvasStreamTarget } from '../structured-stream/workspace-structured-stream-runtime-types'
import {
  type WorkspaceCanvasArtifactPhaseLabels,
  workspaceCanvasArtifactPhaseFromTaskBackedStatus,
  workspaceCanvasArtifactPresentation,
  workspaceCanvasFailedPresentation,
  workspaceCanvasRunningPresentation,
  workspaceCanvasSucceededPresentation,
} from '../artifact-phase'

interface TranslateValues {
  readonly [key: string]: string | number
}

type Translate = (key: string, values?: TranslateValues) => string

export interface BuildWorkspaceNodeCanvasProjectionInput {
  readonly projectId?: string
  readonly episodeId: string
  readonly episodeName?: string
  readonly storyboards: readonly ProjectStoryboard[]
  readonly editFirstWorkflow: EditFirstWorkflowState
  readonly editBible?: ProjectEditBible | null
  readonly editScript?: ProjectEditScript | null
  readonly editScripts?: readonly ProjectEditScript[]
  readonly editShotExecutionPlan?: ProjectEditShotExecutionPlan | null
  readonly activeAssistantOperationId?: string | null
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

function artifactPhaseLabels(translate: Translate): WorkspaceCanvasArtifactPhaseLabels {
  return {
    running: translate('status.processing'),
    succeeded: translate('status.succeeded'),
    failed: translate('status.failed'),
  }
}

function artifactPresentationFromTaskBackedStatus(
  status: string | null | undefined,
  labels: WorkspaceCanvasArtifactPhaseLabels,
) {
  const phase = workspaceCanvasArtifactPhaseFromTaskBackedStatus(status)
  return phase ? workspaceCanvasArtifactPresentation(phase, labels) : null
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

function createNode(input: {
  readonly id: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: Omit<WorkspaceCanvasNodeData, 'nodeId' | 'width' | 'height'>
  readonly width: number
  readonly height: number
}): WorkspaceCanvasFlowNode {
  const data = {
    ...input.data,
    nodeId: input.id,
    width: input.width,
    height: input.height,
    layoutBasePosition: input.position,
  } as WorkspaceCanvasNodeData
  return {
    id: input.id,
    type: 'workspaceNode',
    position: input.position,
    style: styleForNode(input.width, input.height),
    data,
  }
}

function executionItems(plan: ProjectEditShotExecutionPlan, translate: Translate): WorkspaceCanvasEditPipelineStepItem[] {
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
      ...shot.blocking.characters.map((character) => `${character.name} / ${character.visibility}`),
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

function countEditAssetRequirements(
  requirements: readonly ProjectEditAssetRequirement[],
  kind: ProjectEditAssetRequirement['kind'],
): number {
  return requirements.filter((requirement) => requirement.kind === kind).length
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
    editShotExecutionPlan = null,
    activeAssistantOperationId = null,
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
  const editFirstCanvasVisibility = resolveEditFirstCanvasVisibility(editFirstWorkflow)
  const styleBibleDetails = buildStyleBibleDetails(editBible?.styleBible)
  const stylePreviewImageUrl = confirmedStylePreviewImageUrl(editBible)
  const stylePreviewAspectRatio = confirmedStylePreviewAspectRatio(editBible)
  const bibleRunning = activeAssistantOperationId === 'ingest_script'
    || (editBible ? hasStreamTarget(streamTargets, 'editBible', editBible.id) : false)
  const phaseLabels = artifactPhaseLabels(translate)

  let bibleNodeId: string | null = null
  if (editBible || editScriptPending || bibleRunning) {
    const biblePresentation = bibleRunning || !editBible
      ? workspaceCanvasRunningPresentation(phaseLabels)
      : artifactPresentationFromTaskBackedStatus(editBible.status, phaseLabels)
        ?? workspaceCanvasFailedPresentation(phaseLabels)
    bibleNodeId = editBible
      ? workspaceNodeId.editBible(episodeId)
      : workspaceNodeId.editBible(episodeId)
    nodes.push(createNode({
      id: bibleNodeId,
      position: layoutPosition(savedLayouts, bibleNodeId, { x: STORY_COLUMN_X, y: STAGE_START_Y }),
      width: WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editBible',
        layoutNodeType: 'editBible',
        targetType: 'editBible',
        targetId: editBible?.id ?? episodeId,
        title: translate('nodes.editBible.title'),
        eyebrow: translate('nodes.editBible.eyebrow'),
        body: editBiblePreviewText(editBible) || translate('nodes.editBible.pendingBody'),
        meta: '',
        ...biblePresentation,
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditBible(editBible?.id ?? null)),
        editBibleDetails: editBible
          ? {
              bibleText: editBiblePreviewText(editBible),
              userPrompt: editBible.sourceDocumentId,
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
  }

  let styleBibleNodeId: string | null = null
  if (styleBibleDetails && editBible) {
    styleBibleNodeId = workspaceNodeId.editStyleBible(editBible.id)
    nodes.push(createNode({
      id: styleBibleNodeId,
      position: layoutPosition(savedLayouts, styleBibleNodeId, { x: STORY_COLUMN_X, y: STAGE_START_Y + (ROW_GAP_Y + 80) * 2 }),
      width: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editStyleBible',
        layoutNodeType: 'editStyleBible',
        targetType: 'editStyleBible',
        targetId: editBible.id,
        title: translate('nodes.editStyleBible.title'),
        eyebrow: translate('nodes.editStyleBible.eyebrow'),
        body: styleBibleDetails.styleSummary ?? translate('nodes.editStyleBible.body'),
        meta: translate('status.succeeded'),
        ...workspaceCanvasSucceededPresentation(phaseLabels),
        previewImageUrl: stylePreviewImageUrl,
        loadingStyleImageUrl: stylePreviewImageUrl,
        styleBibleDetails,
        onAction,
      },
    }))
    if (bibleNodeId) edges.push(createEdge(`edge:${bibleNodeId}:${styleBibleNodeId}`, bibleNodeId, styleBibleNodeId))
  }

  let editScriptNodeId: string | null = null
  if (editFirstCanvasVisibility.editScript || editScript || editScripts.length > 0 || editScriptPending) {
    const scriptNodes = editScripts.length > 0 ? editScripts : editScript ? [editScript] : []
    if (scriptNodes.length > 0) {
      scriptNodes.forEach((script, index) => {
        const nodeId = workspaceNodeId.editScript(episodeId, script.chapterId ?? null)
        const scriptChapterId = script.chapterId ?? null
        if (editScript?.id === script.id || (!editScriptNodeId && index === 0)) editScriptNodeId = nodeId
        const editScriptRunning = activeAssistantOperationId === 'generate_edit_script'
          || (scriptChapterId ? hasStreamTarget(streamTargets, 'editScript', scriptChapterId) : false)
          || (editScriptPending && script.status === 'generating')
        const editScriptPresentation = editScriptRunning
          ? workspaceCanvasRunningPresentation(phaseLabels)
          : artifactPresentationFromTaskBackedStatus(script.status, phaseLabels)
            ?? workspaceCanvasFailedPresentation(phaseLabels)
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
            title: translate('nodes.editScript.title'),
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
    } else {
      editScriptNodeId = workspaceNodeId.editScript(episodeId, null)
      const pendingChapterId = editBible?.chapters?.length === 1 ? editBible.chapters[0]?.id ?? null : null
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
          ...(editScriptPending ? workspaceCanvasRunningPresentation(phaseLabels) : {
            statusLabel: translate('status.pending'),
            isRunning: false,
          }),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditChapterScriptGeneration(pendingChapterId)),
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
  if (editScript && editFirstCanvasVisibility.editAssetGroup) {
    assetGroupNodeId = workspaceNodeId.editAssetGroup(editScript.id)
    const characterRequirements = countEditAssetRequirements(editScript.requirements, 'character')
    const locationRequirements = countEditAssetRequirements(editScript.requirements, 'location')
    const assetsReady = editScript.requirements.length > 0
      && editScript.requirements.every((requirement) => requirement.status === 'completed')
    const assetsRunning = editScript.requirements.some((requirement) => requirement.status === 'generating')
    const assetsFailed = editScript.requirements.some((requirement) => requirement.status === 'failed')
    const assetGroupPresentation = assetsRunning
      ? workspaceCanvasRunningPresentation(phaseLabels)
      : assetsFailed
        ? workspaceCanvasFailedPresentation(phaseLabels)
        : assetsReady
          ? workspaceCanvasSucceededPresentation(phaseLabels)
          : null
    nodes.push(createNode({
      id: assetGroupNodeId,
      position: layoutPosition(savedLayouts, assetGroupNodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X, y: STAGE_START_Y + 420 + ASSET_GROUP_Y_OFFSET }),
      width: 720,
      height: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editAssetGroup',
        layoutNodeType: 'editAssetGroup',
        targetType: 'editAssetRequirement',
        targetId: editScript.id,
        title: translate('nodes.editAssetGroup.title'),
        eyebrow: translate('nodes.editAssetGroup.eyebrow'),
        body: editScript.requirements.map((requirement) => `${requirement.name} / ${requirement.kind}`).join('\n') || translate('empty.editAsset'),
        meta: translate('nodes.editAssetGroup.meta', {
          characters: characterRequirements,
          locations: locationRequirements,
        }),
        ...(assetGroupPresentation ?? { statusLabel: '', isRunning: false }),
        actionLabel: assetsReady ? undefined : translate('actions.generateEditAssets'),
        action: { type: 'generate_edit_assets', editScriptId: editScript.id },
        editAssetGroupDetails: {
          editScriptId: editScript.id,
          assets: editScript.requirements.map((requirement) => ({
            requirementId: requirement.id,
            kind: requirement.kind,
            name: requirement.name,
            eyebrow: requirement.kind,
            description: requirement.description,
            shotIds: requirement.shotIds,
            shotNumbers: requirement.shotIds
              .map((shotId) => editScript.shots.find((shot) => shot.shotId === shotId)?.shotNumber ?? null)
              .filter((value): value is number => typeof value === 'number'),
            statusLabel: artifactPresentationFromTaskBackedStatus(requirement.status, phaseLabels)?.statusLabel ?? '',
            isRunning: requirement.status === 'generating',
            previewImageUrl: assetPreviewUrl(requirement),
            runtimeTarget: TASK_RUNTIME_TARGETS.projectEditAssetImage(requirement.taskTargetType ?? null, requirement.taskTargetId ?? null),
            taskProgress: null,
            action: requirement.status === 'completed'
              ? { type: 'regenerate_edit_asset_image', assetId: requirement.targetId ?? requirement.id, kind: requirement.kind }
              : { type: 'generate_edit_asset', editScriptId: editScript.id, requirementId: requirement.id },
            actionLabel: requirement.status === 'completed' ? translate('actions.regenerateImage') : translate('actions.generateEditAsset'),
          })),
        },
        onAction,
      },
    }))
    if (editScriptNodeId) edges.push(createEdge(`edge:${editScriptNodeId}:${assetGroupNodeId}`, editScriptNodeId, assetGroupNodeId))
  }

  let executionNodeId: string | null = null
  if (editScript && editFirstCanvasVisibility.editShotExecutionPlan) {
    const matchingExecutionPlan = editShotExecutionPlan?.editScriptId === editScript.id ? editShotExecutionPlan : null
    const executionRunning = activeAssistantOperationId === 'generate_edit_shot_execution_plan'
      || hasStreamTarget(streamTargets, 'editShotExecutionPlan', editScript.id)
    const executionPresentation = executionRunning
      ? workspaceCanvasRunningPresentation(phaseLabels)
      : matchingExecutionPlan
        ? artifactPresentationFromTaskBackedStatus(matchingExecutionPlan.status, phaseLabels)
          ?? workspaceCanvasFailedPresentation(phaseLabels)
        : null
    executionNodeId = workspaceNodeId.editShotExecutionPlan(editScript.id)
    nodes.push(createNode({
      id: executionNodeId,
      position: layoutPosition(savedLayouts, executionNodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X * 2, y: STAGE_START_Y }),
      width: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editShotExecutionPlan',
        layoutNodeType: 'editShotExecutionPlan',
        targetType: 'editShotExecutionPlan',
        targetId: editScript.id,
        title: translate('nodes.editShotExecutionPlan.title'),
        eyebrow: translate('nodes.editShotExecutionPlan.eyebrow'),
        body: matchingExecutionPlan
          ? matchingExecutionPlan.shots.slice(0, 4).map((shot) => `${shot.shotNumber}. ${shot.camera.shotScale} / ${shot.blocking.spatialNote}`).join('\n')
          : translate('nodes.editShotExecutionPlan.pendingBody'),
        meta: matchingExecutionPlan
          ? translate('nodes.editShotExecutionPlan.meta', { shots: matchingExecutionPlan.shots.length })
          : '',
        ...(executionPresentation ?? { statusLabel: '', isRunning: false }),
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditShotExecutionPlan(editScript.id)),
        actionLabel: matchingExecutionPlan ? undefined : translate('actions.generateShotExecutionPlan'),
        action: matchingExecutionPlan ? undefined : { type: 'generate_edit_shot_execution_plan', editScriptId: editScript.id },
        editPipelineStepDetails: matchingExecutionPlan ? { items: executionItems(matchingExecutionPlan, translate) } : undefined,
        onAction,
      },
    }))
    if (assetGroupNodeId) {
      edges.push(createEdge(`edge:${assetGroupNodeId}:${executionNodeId}`, assetGroupNodeId, executionNodeId))
    } else if (editScriptNodeId) {
      edges.push(createEdge(`edge:${editScriptNodeId}:${executionNodeId}`, editScriptNodeId, executionNodeId))
    }
  }

  const panelList = collectPanels(storyboards)
  const shotNodeIdsByShotId = new Map<string, string>()
  let storyboardSourceNodeId: string | null = null
  if (executionNodeId) {
    storyboardSourceNodeId = executionNodeId
  } else if (editScriptNodeId) {
    storyboardSourceNodeId = editScriptNodeId
  }
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
      const shotRunning = panel.imageTaskRunning || panel.videoTaskRunning
      const shotFailed = Boolean(panel.imageErrorMessage || panel.videoErrorMessage)
      const shotPresentation = shotRunning
        ? workspaceCanvasRunningPresentation(phaseLabels)
        : shotFailed
          ? workspaceCanvasFailedPresentation(phaseLabels)
          : workspaceCanvasSucceededPresentation(phaseLabels)
      nodes.push(createNode({
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
          loadingStyleImageUrl: stylePreviewImageUrl,
          runtimeTargets: runtimeTargets(
            TASK_RUNTIME_TARGETS.projectPanelImageOperations(panel.id),
            TASK_RUNTIME_TARGETS.projectPanelVideo(panel.id),
          ),
          actionLabel: translate('actions.generateImage'),
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
      edges.push(createEdge(`edge:${storyboardSourceNodeId}:${nodeId}`, storyboardSourceNodeId, nodeId))
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
        ? artifactPresentationFromTaskBackedStatus(videoGroup.status, phaseLabels)
          ?? workspaceCanvasFailedPresentation(phaseLabels)
        : null
      nodes.push(createNode({
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
          ...(videoGroupPresentation ?? { statusLabel: '', isRunning: false }),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectVideoGroup(videoGroup?.id ?? null)),
          actionLabel: canGenerateGroup ? translate('actions.generateVideo') : undefined,
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
  if (editFirstCanvasVisibility.bgmScore) {
    bgmNodeId = workspaceNodeId.bgmScore(episodeId)
    const bgmDetails = bgmScoreDetails(finalVideo)
    const bgmPresentation = bgmDetails
      ? artifactPresentationFromTaskBackedStatus(bgmDetails.status, phaseLabels)
        ?? workspaceCanvasFailedPresentation(phaseLabels)
      : null
    nodes.push(createNode({
      id: bgmNodeId,
      position: layoutPosition(savedLayouts, bgmNodeId, { x: SHOT_GRID_START_X, y: bgmScoreDefaultY }),
      width: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height,
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
        ...(bgmPresentation ?? { statusLabel: '', isRunning: false }),
        actionLabel: translate('actions.generateBgmScore'),
        action: { type: 'generate_bgm_score' },
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeBgmScore(episodeId)),
        bgmScoreDetails: bgmDetails,
        onAction,
      },
    }))
  }
  const bgmStageBottomY = maxNodeBottomY(nodes, 'bgmScore')
    ?? (bgmScoreDefaultY + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height)

  let finalNodeId: string | null = null
  if (editFirstCanvasVisibility.finalTimeline) {
    finalNodeId = workspaceNodeId.finalTimeline(episodeId)
    const finalPresentation = finalVideo?.outputUrl
      ? workspaceCanvasSucceededPresentation(phaseLabels)
      : finalVideo?.renderStatus
        ? artifactPresentationFromTaskBackedStatus(finalVideo.renderStatus, phaseLabels)
          ?? workspaceCanvasFailedPresentation(phaseLabels)
        : null
    nodes.push(createNode({
      id: finalNodeId,
      position: layoutPosition(savedLayouts, finalNodeId, { x: SHOT_GRID_START_X, y: bgmStageBottomY + FINAL_TIMELINE_GAP_Y }),
      width: WORKSPACE_CANVAS_FINAL_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_FINAL_NODE_SIZE.height,
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
        ...(finalPresentation ?? { statusLabel: '', isRunning: false }),
        actionLabel: translate('actions.renderFinalVideo'),
        action: { type: 'render_final_video' },
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeFinalRender(episodeId)),
        finalDetails: {
          totalShots: editScript?.shotCount ?? panelList.length,
          totalImages: panelList.filter((panel) => Boolean(primaryPanelImageUrl(panel))).length,
          totalVideos: panelList.filter((panel) => Boolean(panel.videoMedia?.url ?? panel.videoUrl)).length + videoGroups.filter((group) => Boolean(group.videoMedia?.url ?? group.videoUrl)).length,
          totalDuration: editScript?.durationSec ?? null,
          orderedVideoLabels: [
            ...videoGroups.map((group) => readShotIds(group.shotIds)
              .map((shotId) => editScript?.shots.find((shot) => shot.shotId === shotId)?.shotNumber ?? shotId)
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

  return { nodes, edges }
}

export function useWorkspaceNodeCanvasProjection(input: BuildWorkspaceNodeCanvasProjectionInput): WorkspaceCanvasProjection {
  const {
    projectId,
    episodeId,
    episodeName,
    storyboards,
    editFirstWorkflow,
    editBible,
    editScript,
    editScripts,
    editShotExecutionPlan,
    activeAssistantOperationId,
    editScriptPending,
    streamTargets,
    finalVideo,
    videoGroups,
    defaultVideoModel,
    defaultSequenceVideoModel,
    savedLayouts,
    translate,
    onAction,
  } = input

  return useMemo(() => buildWorkspaceNodeCanvasProjection({
    projectId,
    episodeId,
    episodeName,
    storyboards,
    editFirstWorkflow,
    editBible,
    editScript,
    editScripts,
    editShotExecutionPlan,
    activeAssistantOperationId,
    editScriptPending,
    streamTargets,
    finalVideo,
    videoGroups,
    defaultVideoModel,
    defaultSequenceVideoModel,
    savedLayouts,
    translate,
    onAction,
  }), [
    projectId,
    episodeId,
    episodeName,
    storyboards,
    editFirstWorkflow,
    editBible,
    editScript,
    editScripts,
    editShotExecutionPlan,
    activeAssistantOperationId,
    editScriptPending,
    streamTargets,
    finalVideo,
    videoGroups,
    defaultVideoModel,
    defaultSequenceVideoModel,
    savedLayouts,
    translate,
    onAction,
  ])
}
