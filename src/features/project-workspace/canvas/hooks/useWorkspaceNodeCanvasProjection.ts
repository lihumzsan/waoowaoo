'use client'

import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { CanvasNodeLayout } from '@/lib/project-canvas/layout/canvas-layout.types'
import { TASK_RUNTIME_TARGETS, type TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import type {
  Location,
  ProjectEditAssetRequirement,
  ProjectEditScreenplay,
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
  WORKSPACE_CANVAS_EDIT_ASSET_GRID_COLUMNS,
  WORKSPACE_CANVAS_EDIT_ASSET_GRID_GAP_Y,
  WORKSPACE_CANVAS_EDIT_ASSET_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_NODE_WIDTH,
  WORKSPACE_CANVAS_EDIT_SCREENPLAY_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH,
  WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y,
  WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE,
  WORKSPACE_CANVAS_FINAL_NODE_SIZE,
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
  readonly storyText: string
  readonly locations?: readonly Location[]
  readonly storyboards: readonly ProjectStoryboard[]
  readonly editScreenplay?: ProjectEditScreenplay | null
  readonly editScript?: ProjectEditScript | null
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
const SHOT_GRID_GAP_X = 44
const SHOT_GRID_GAP_Y = 620
const SHOT_NODE_HEIGHT = 560
const ASSET_GROUP_Y_OFFSET = WORKSPACE_CANVAS_EDIT_SCRIPT_TO_ASSET_GAP_Y

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

function uniqueNumbers(values: readonly number[]): number[] {
  const seen = new Set<number>()
  const output: number[] = []
  values.forEach((value) => {
    if (!Number.isInteger(value) || seen.has(value)) return
    seen.add(value)
    output.push(value)
  })
  return output
}

function readShotNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return uniqueNumbers(value.flatMap((item) => (typeof item === 'number' ? [item] : [])))
}

function sameShotNumbers(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false
  return left.every((shotNumber, index) => shotNumber === right[index])
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

function resolvePanelShotNumber(panel: ProjectPanel): number {
  return panel.sourceShotNumber ?? panel.panelNumber ?? panel.panelIndex + 1
}

function collectPanels(storyboards: readonly ProjectStoryboard[]): ProjectPanel[] {
  return storyboards.flatMap((storyboard) => storyboard.panels ?? [])
}

function panelByShotNumber(storyboards: readonly ProjectStoryboard[]): ReadonlyMap<number, ProjectPanel> {
  const panels = new Map<number, ProjectPanel>()
  collectPanels(storyboards).forEach((panel) => {
    const shotNumber = resolvePanelShotNumber(panel)
    if (!panels.has(shotNumber)) panels.set(shotNumber, panel)
  })
  return panels
}

function videoGroupForShotNumbers(
  videoGroups: readonly ProjectVideoGroup[],
  shotNumbers: readonly number[],
): ProjectVideoGroup | null {
  return videoGroups.find((group) => sameShotNumbers(readShotNumbers(group.shotNumbers), shotNumbers)) ?? null
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

function confirmedStylePreviewImageUrl(screenplay: ProjectEditScreenplay | null | undefined): string | null {
  return screenplay?.stylePreviews?.find((preview) => (
    preview.status === 'confirmed' && Boolean(stringValue(preview.imageUrl))
  ))?.imageUrl ?? null
}

function locationPreviewUrl(location: Location): string | null {
  const selected = location.images.find((image) => image.id === location.selectedImageId)
  const first = selected ?? location.images.find((image) => Boolean(image.imageUrl || image.media?.url))
  return first?.media?.url ?? first?.imageUrl ?? null
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
    title: translate('generationSegmentArrangement.shotTitle', { shot: shot.shotNumber }),
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
  const bgmScore = finalVideo?.bgmScore
  if (!bgmScore) return undefined
  return {
    status: bgmScore.status,
    durationSeconds: bgmScore.durationSeconds,
    musicModel: bgmScore.musicModel,
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
  readonly panelsByShot: ReadonlyMap<number, ProjectPanel>
  readonly requirements: readonly ProjectEditAssetRequirement[]
  readonly defaultVideoModel?: string | null
}): WorkspaceCanvasVideoPlanDetails {
  const segment = input.editScript.generationSegments[input.segmentIndex]
  if (!segment) throw new Error(`GENERATION_SEGMENT_MISSING:${input.segmentIndex}`)
  const durationSec = segment.shotNumbers.reduce((total, shotNumber) => {
    const shot = input.editScript.shots.find((candidate) => candidate.shotNumber === shotNumber)
    return total + (shot?.durationSec ?? 0)
  }, 0)
  const sourceImages = segment.shotNumbers.map((shotNumber) => {
    const panel = input.panelsByShot.get(shotNumber) ?? null
    return {
      panelId: panel?.id ?? null,
      storyboardId: panel?.storyboardId ?? null,
      panelIndex: panel?.panelIndex ?? null,
      shotNumber,
      imageUrl: primaryPanelImageUrl(panel),
      aspectRatio: null,
    }
  })
  return {
    editScriptId: input.editScript.id,
    segmentIndex: input.segmentIndex,
    kind: 'group',
    videoGroupId: input.videoGroup?.id ?? null,
    shotNumbers: segment.shotNumbers,
    durationSec,
    gridMode: inferGridMode(segment.shotNumbers.length),
    continuity: segment.continuity,
    prompt: input.videoGroup?.prompt ?? null,
    assetReferenceVideoModel: input.defaultVideoModel ?? null,
    outputUrl: input.videoGroup?.videoMedia?.url ?? input.videoGroup?.videoUrl ?? null,
    outputAspectRatio: null,
    errorMessage: input.videoGroup?.errorMessage ?? null,
    sourceImages,
    assetReferences: input.requirements
      .filter((requirement) => requirement.shotNumbers.some((shotNumber) => segment.shotNumbers.includes(shotNumber)))
      .map((requirement) => ({
        id: requirement.id,
        name: requirement.name,
        kind: requirement.kind,
        imageUrl: assetPreviewUrl(requirement),
        shotNumbers: requirement.shotNumbers,
      })),
    validationMessage: null,
  }
}

export function buildWorkspaceNodeCanvasProjection(input: BuildWorkspaceNodeCanvasProjectionInput): WorkspaceCanvasProjection {
  const {
    projectId,
    episodeId,
    episodeName,
    storyText,
    locations = [],
    storyboards,
    editScreenplay = null,
    editScript = null,
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
  const panelsByShot = panelByShotNumber(storyboards)
  const styleBibleDetails = buildStyleBibleDetails(editScreenplay?.styleBible)
  const stylePreviewImageUrl = confirmedStylePreviewImageUrl(editScreenplay)
  const screenplayRunning = activeAssistantOperationId === 'generate_edit_screenplay'
    || (editScreenplay ? hasStreamTarget(streamTargets, 'editScreenplay', editScreenplay.id) : false)
  const phaseLabels = artifactPhaseLabels(translate)

  const analysisNodeId = workspaceNodeId.analysis(episodeId)
  nodes.push(createNode({
    id: analysisNodeId,
    position: layoutPosition(savedLayouts, analysisNodeId, { x: STORY_COLUMN_X, y: 120 }),
    width: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.width,
    height: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.height,
    data: {
      projectId,
      episodeName,
      kind: 'analysis',
      layoutNodeType: 'analysis',
      targetType: 'episode',
      targetId: episodeId,
      title: translate('nodes.analysis.title'),
      eyebrow: translate('nodes.analysis.eyebrow'),
      body: storyText?.trim() || translate('empty.screenplay'),
      meta: episodeName ?? translate('nodes.analysis.meta'),
      ...(storyText?.trim()
        ? workspaceCanvasSucceededPresentation(phaseLabels)
        : {
            statusLabel: '',
            isRunning: false,
          }),
      onAction,
    },
  }))

  let screenplayNodeId: string | null = null
  if (editScreenplay || editScriptPending || screenplayRunning) {
    const screenplayPresentation = screenplayRunning || !editScreenplay
      ? workspaceCanvasRunningPresentation(phaseLabels)
      : artifactPresentationFromTaskBackedStatus(editScreenplay.status, phaseLabels)
        ?? workspaceCanvasFailedPresentation(phaseLabels)
    screenplayNodeId = editScreenplay
      ? workspaceNodeId.editScreenplay(editScreenplay.id)
      : workspaceNodeId.editScreenplay(`pending:${episodeId}`)
    nodes.push(createNode({
      id: screenplayNodeId,
      position: layoutPosition(savedLayouts, screenplayNodeId, { x: STORY_COLUMN_X, y: 120 + ROW_GAP_Y + 80 }),
      width: WORKSPACE_CANVAS_EDIT_SCREENPLAY_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_SCREENPLAY_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editScreenplay',
        layoutNodeType: 'editScreenplay',
        targetType: 'editScreenplay',
        targetId: editScreenplay?.id ?? `pending:${episodeId}`,
        title: translate('nodes.editScreenplay.title'),
        eyebrow: translate('nodes.editScreenplay.eyebrow'),
        body: editScreenplay?.screenplayText ?? translate('nodes.editScreenplay.pendingBody'),
        meta: screenplayPresentation.statusLabel,
        ...screenplayPresentation,
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditScreenplay(editScreenplay?.id ?? null)),
        editScreenplayDetails: editScreenplay
          ? {
              screenplayText: editScreenplay.screenplayText,
              userPrompt: editScreenplay.userPrompt,
            }
          : undefined,
        onAction,
      },
    }))
    edges.push(createEdge(`edge:${analysisNodeId}:${screenplayNodeId}`, analysisNodeId, screenplayNodeId))
  }

  let styleBibleNodeId: string | null = null
  if (styleBibleDetails && editScreenplay) {
    styleBibleNodeId = workspaceNodeId.editStyleBible(editScreenplay.id)
    nodes.push(createNode({
      id: styleBibleNodeId,
      position: layoutPosition(savedLayouts, styleBibleNodeId, { x: STORY_COLUMN_X, y: 120 + (ROW_GAP_Y + 80) * 2 }),
      width: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE.width,
      height: WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE.height,
      data: {
        projectId,
        episodeName,
        kind: 'editStyleBible',
        layoutNodeType: 'editStyleBible',
        targetType: 'editStyleBible',
        targetId: editScreenplay.id,
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
    edges.push(createEdge(`edge:${screenplayNodeId ?? analysisNodeId}:${styleBibleNodeId}`, screenplayNodeId ?? analysisNodeId, styleBibleNodeId))
  }

  let editScriptNodeId: string | null = null
  if (editScript || editScriptPending) {
    const editScriptTargetId = editScript?.id ?? `pending:${episodeId}`
    editScriptNodeId = workspaceNodeId.editScript(episodeId)
    const editScriptRunning = activeAssistantOperationId === 'generate_edit_script'
      || (editScript ? hasStreamTarget(streamTargets, 'editScript', editScript.id) : false)
      || editScriptPending
    const editScriptPresentation = editScriptRunning || !editScript
      ? workspaceCanvasRunningPresentation(phaseLabels)
      : artifactPresentationFromTaskBackedStatus(editScript.status, phaseLabels)
        ?? workspaceCanvasFailedPresentation(phaseLabels)
    const editScriptDetails = editScript
      ? {
          screenplayText: editScript.screenplayText,
          durationSec: editScript.durationSec,
          shotCount: editScript.shotCount,
          shots: editScript.shots.map((shot) => {
            const panel = panelsByShot.get(shot.shotNumber) ?? null
            return {
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
      : undefined
    nodes.push(createNode({
      id: editScriptNodeId,
      position: layoutPosition(savedLayouts, editScriptNodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X, y: 120 }),
      width: WORKSPACE_CANVAS_EDIT_SCRIPT_TABLE_NODE_WIDTH,
      height: 420,
      data: {
        projectId,
        episodeName,
        kind: 'editScript',
        layoutNodeType: 'editScript',
        targetType: 'editScript',
        targetId: editScriptTargetId,
        title: translate('nodes.editScript.title'),
        eyebrow: translate('nodes.editScript.eyebrow'),
        body: editScript?.shots.slice(0, 4).map((shot) => `${shot.shotNumber}. ${shot.action}`).join('\n')
          ?? translate('nodes.editScript.pendingBody'),
        meta: editScript
          ? translate('nodes.editScript.meta', {
              shots: editScript.shotCount,
              duration: editScript.durationSec,
              assets: editScript.requirements.length,
              completed: countCompletedEditAssetRequirements(editScript.requirements),
            })
          : translate('nodes.editScript.pendingMeta'),
        ...editScriptPresentation,
        runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEpisodeEditScriptGeneration(episodeId)),
        actionLabel: editScript ? undefined : translate('actions.generateEditScript'),
        action: editScreenplay && !editScript ? { type: 'generate_edit_script', screenplayId: editScreenplay.id } : undefined,
        actionDisabled: !editScreenplay,
        editScriptDetails,
        onAction,
      },
    }))
    edges.push(createEdge(`edge:${styleBibleNodeId ?? screenplayNodeId ?? analysisNodeId}:${editScriptNodeId}`, styleBibleNodeId ?? screenplayNodeId ?? analysisNodeId, editScriptNodeId))
  }

  let assetGroupNodeId: string | null = null
  if (editScript) {
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
      position: layoutPosition(savedLayouts, assetGroupNodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X, y: 120 + 420 + ASSET_GROUP_Y_OFFSET }),
      width: 720,
      height: Math.max(300, Math.ceil(editScript.requirements.length / WORKSPACE_CANVAS_EDIT_ASSET_GRID_COLUMNS) * WORKSPACE_CANVAS_EDIT_ASSET_NODE_SIZE.height + WORKSPACE_CANVAS_EDIT_ASSET_GRID_GAP_Y),
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
            shotNumbers: requirement.shotNumbers,
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
  if (editScript) {
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
      position: layoutPosition(savedLayouts, executionNodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X * 2, y: 120 }),
      width: WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_NODE_WIDTH,
      height: 420,
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
    edges.push(createEdge(`edge:${assetGroupNodeId ?? editScriptNodeId}:${executionNodeId}`, assetGroupNodeId ?? editScriptNodeId ?? analysisNodeId, executionNodeId))
  }

  const storyboardGenerationNodeIds = new Map<string, string>()
  if (editScript && executionNodeId) {
    storyboards.forEach((storyboard, index) => {
      const nodeId = workspaceNodeId.storyboardPanelGeneration(storyboard.id)
      const storyboardPresentation = storyboard.storyboardTaskRunning
        ? workspaceCanvasRunningPresentation(phaseLabels)
        : storyboard.lastError
          ? workspaceCanvasFailedPresentation(phaseLabels)
          : workspaceCanvasSucceededPresentation(phaseLabels)
      storyboardGenerationNodeIds.set(storyboard.id, nodeId)
      nodes.push(createNode({
        id: nodeId,
        position: layoutPosition(savedLayouts, nodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X * 3, y: 120 + index * 260 }),
        width: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.width,
        height: 260,
        data: {
          projectId,
          episodeName,
          kind: 'storyboardPanelGeneration',
          layoutNodeType: 'storyboardPanelGeneration',
          targetType: 'storyboardPanelGeneration',
          targetId: storyboard.id,
          title: translate('nodes.storyboardPanelGeneration.title'),
          eyebrow: translate('nodes.storyboardPanelGeneration.eyebrow'),
          body: storyboard.lastError ?? translate('nodes.storyboardPanelGeneration.body'),
          meta: translate('nodes.storyboardPanelGeneration.meta', { panels: storyboard.panels?.length ?? storyboard.panelCount }),
          ...storyboardPresentation,
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectStoryboardPanelGeneration(storyboard.id)),
          onAction,
        },
      }))
      edges.push(createEdge(`edge:${executionNodeId}:${nodeId}`, executionNodeId, nodeId))
    })

    if (storyboards.length === 0) {
      const nodeId = workspaceNodeId.storyboardPanelGeneration(editScript.id)
      nodes.push(createNode({
        id: nodeId,
        position: layoutPosition(savedLayouts, nodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X * 3, y: 120 }),
        width: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.width,
        height: 260,
        data: {
          projectId,
          episodeName,
          kind: 'storyboardPanelGeneration',
          layoutNodeType: 'storyboardPanelGeneration',
          targetType: 'storyboardPanelGeneration',
          targetId: editScript.id,
          title: translate('nodes.storyboardPanelGeneration.title'),
          eyebrow: translate('nodes.storyboardPanelGeneration.eyebrow'),
          body: translate('nodes.storyboardPanelGeneration.body'),
          meta: '',
          statusLabel: '',
          isRunning: false,
          actionLabel: translate('actions.generateStoryboard'),
          action: { type: 'generate_edit_storyboard', editScriptId: editScript.id },
          onAction,
        },
      }))
      edges.push(createEdge(`edge:${executionNodeId}:${nodeId}`, executionNodeId, nodeId))
    }
  }

  const panelList = collectPanels(storyboards)
  const shotNodeIdsByShotNumber = new Map<number, string>()
  panelList.forEach((panel, index) => {
    const shotNumber = resolvePanelShotNumber(panel)
    const nodeId = workspaceNodeId.shot(panel.id)
    shotNodeIdsByShotNumber.set(shotNumber, nodeId)
    const column = index % SHOT_GRID_COLUMNS
    const row = Math.floor(index / SHOT_GRID_COLUMNS)
    const previewImageUrl = primaryPanelImageUrl(panel)
    const storyboardSourceNodeId = storyboardGenerationNodeIds.get(panel.storyboardId) ?? executionNodeId ?? editScriptNodeId ?? analysisNodeId
    const shotRunning = panel.imageTaskRunning || panel.videoTaskRunning
    const shotFailed = Boolean(panel.imageErrorMessage || panel.videoErrorMessage)
    const shotPresentation = shotRunning
      ? workspaceCanvasRunningPresentation(phaseLabels)
      : shotFailed
        ? workspaceCanvasFailedPresentation(phaseLabels)
        : workspaceCanvasSucceededPresentation(phaseLabels)
    nodes.push(createNode({
      id: nodeId,
      position: layoutPosition(savedLayouts, nodeId, {
        x: STORY_COLUMN_X + COLUMN_GAP_X * 3 + column * (WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.width + SHOT_GRID_GAP_X),
        y: 460 + row * SHOT_GRID_GAP_Y,
      }),
      width: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.width,
      height: SHOT_NODE_HEIGHT,
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

  if (editScript?.generationSegments.length) {
    editScript.generationSegments.forEach((segment, index) => {
      const nodeId = workspaceNodeId.videoPlan(editScript.id, index + 1)
      const videoGroup = videoGroupForShotNumbers(videoGroups, segment.shotNumbers)
      const details = videoPlanDetails({
        editScript,
        segmentIndex: index,
        videoGroup,
        panelsByShot,
        requirements: editScript.requirements,
        defaultVideoModel: defaultSequenceVideoModel ?? defaultVideoModel,
      })
      const gridMode = inferGridMode(segment.shotNumbers.length)
      const canGenerateGroup = Boolean(gridMode && details.sourceImages.every((image) => Boolean(image.imageUrl)))
      const videoGroupPresentation = videoGroup
        ? artifactPresentationFromTaskBackedStatus(videoGroup.status, phaseLabels)
          ?? workspaceCanvasFailedPresentation(phaseLabels)
        : null
      nodes.push(createNode({
        id: nodeId,
        position: layoutPosition(savedLayouts, nodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X * 5, y: 120 + index * (WORKSPACE_CANVAS_VIDEO_PLAN_NODE_SIZE.height + 80) }),
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
            shots: segment.shotNumbers.length,
            duration: details.durationSec,
          }),
          ...(videoGroupPresentation ?? { statusLabel: '', isRunning: false }),
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectVideoGroup(videoGroup?.id ?? null)),
          actionLabel: canGenerateGroup ? translate('actions.generateVideo') : undefined,
          action: canGenerateGroup && gridMode
            ? {
                type: 'generate_video_group',
                gridMode,
                shotNumbers: segment.shotNumbers,
              }
            : undefined,
          secondaryActionLabel: translate('actions.arrangeGenerationSegments'),
          secondaryAction: { type: 'open_video_block_arrangement', editScriptId: editScript.id, segmentIndex: index },
          tertiaryActionLabel: canGenerateGroup ? translate('actions.generateStoryboardGridImages') : undefined,
          tertiaryAction: canGenerateGroup
            ? {
                type: 'generate_storyboard_grid_images',
                episodeId,
                editScriptId: editScript.id,
                sourceGenerationSegmentId: `${editScript.id}:generationSegment:${index + 1}`,
                panelIds: details.sourceImages.flatMap((image) => (image.panelId ? [image.panelId] : [])),
                generationMode: 'grid',
              }
            : undefined,
          videoPlanDetails: details,
          onAction,
        },
      }))
      segment.shotNumbers.forEach((shotNumber) => {
        const shotNodeId = shotNodeIdsByShotNumber.get(shotNumber)
        if (shotNodeId) edges.push(createEdge(`edge:${shotNodeId}:${nodeId}:${shotNumber}`, shotNodeId, nodeId))
      })
      if (!segment.shotNumbers.some((shotNumber) => shotNodeIdsByShotNumber.has(shotNumber)) && executionNodeId) {
        edges.push(createEdge(`edge:${executionNodeId}:${nodeId}`, executionNodeId, nodeId))
      }
    })
  }

  const bgmNodeId = workspaceNodeId.bgmScore(episodeId)
  const bgmDetails = bgmScoreDetails(finalVideo)
  const bgmPresentation = bgmDetails
    ? artifactPresentationFromTaskBackedStatus(bgmDetails.status, phaseLabels)
      ?? workspaceCanvasFailedPresentation(phaseLabels)
    : null
  nodes.push(createNode({
    id: bgmNodeId,
    position: layoutPosition(savedLayouts, bgmNodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X * 6, y: 120 }),
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

  const finalNodeId = workspaceNodeId.finalTimeline(episodeId)
  const finalPresentation = finalVideo?.outputUrl
    ? workspaceCanvasSucceededPresentation(phaseLabels)
    : finalVideo?.renderStatus
      ? artifactPresentationFromTaskBackedStatus(finalVideo.renderStatus, phaseLabels)
        ?? workspaceCanvasFailedPresentation(phaseLabels)
      : null
  nodes.push(createNode({
    id: finalNodeId,
    position: layoutPosition(savedLayouts, finalNodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X * 6, y: 120 + WORKSPACE_CANVAS_BGM_SCORE_NODE_SIZE.height + 120 }),
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
          ...videoGroups.map((group) => group.shotNumbers).map((shotNumbers) => readShotNumbers(shotNumbers).join(', ')),
          ...panelList.filter((panel) => Boolean(panel.videoMedia?.url ?? panel.videoUrl)).map((panel) => String(resolvePanelShotNumber(panel))),
        ],
        outputUrl: finalVideo?.outputUrl,
        renderStatus: finalVideo?.renderStatus,
      },
      onAction,
    },
  }))

  if (editScript?.generationSegments.length) {
    editScript.generationSegments.forEach((_segment, index) => {
      edges.push(createEdge(`edge:video-plan-final:${index}`, workspaceNodeId.videoPlan(editScript.id, index + 1), finalNodeId))
    })
  }
  edges.push(createEdge(`edge:bgm-final:${episodeId}`, bgmNodeId, finalNodeId))

  locations.forEach((location, index) => {
    const preview = locationPreviewUrl(location)
    if (!preview) return
    const nodeId = `location-asset:${location.id}`
    nodes.push(createNode({
      id: nodeId,
      position: layoutPosition(savedLayouts, nodeId, { x: STORY_COLUMN_X + COLUMN_GAP_X, y: 860 + index * 260 }),
      width: WORKSPACE_CANVAS_DEFAULT_NODE_SIZE.width,
      height: 240,
      data: {
        projectId,
        episodeName,
        kind: 'imageAsset',
        layoutNodeType: 'imageAsset',
        targetType: 'projectLocation',
        targetId: location.id,
        title: location.name,
        eyebrow: translate('nodeFields.location'),
        body: location.summary ?? '',
        meta: '',
        ...workspaceCanvasSucceededPresentation(phaseLabels),
        previewImageUrl: preview,
        onAction,
      },
    }))
  })

  return { nodes, edges }
}

export function useWorkspaceNodeCanvasProjection(input: BuildWorkspaceNodeCanvasProjectionInput): WorkspaceCanvasProjection {
  const {
    projectId,
    episodeId,
    episodeName,
    storyText,
    locations,
    storyboards,
    editScreenplay,
    editScript,
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
    storyText,
    locations,
    storyboards,
    editScreenplay,
    editScript,
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
    storyText,
    locations,
    storyboards,
    editScreenplay,
    editScript,
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
