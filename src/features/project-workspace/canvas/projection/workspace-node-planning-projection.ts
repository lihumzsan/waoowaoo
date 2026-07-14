import type { ProjectEditAssetRequirement, ProjectEditBible, ProjectEditScriptShot } from '@/types/project'
import type { WorkspaceCanvasStyleBibleDetails } from '../node-canvas-types'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import {
  COLUMN_GAP_X,
  ROW_GAP_Y,
  STAGE_START_Y,
  STORY_COLUMN_X,
  TASK_RUNTIME_TARGETS,
  WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_SCRIPT_COLLAPSED_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_STYLE_BIBLE_NODE_SIZE,
  createEdge,
  createMediaNode,
  createNode,
  findStreamTarget,
  hasStreamTarget,
  isEditFirstWorkflowPosition,
  layoutPosition,
  readJsonRecord,
  resolveWorkspaceCanvasNodeMaterialization,
  resourcePresentationFromStatus,
  runtimeTargets,
  stringValue,
  workspaceCanvasFailedResourcePresentation,
  workspaceCanvasPendingResourcePresentation,
  workspaceCanvasSucceededResourcePresentation,
  workspaceNodeId,
} from './workspace-node-projection-shared'

export interface WorkspacePlanningProjection {
  readonly bibleNodeId: string | null
  readonly editScriptNodeId: string | null
  readonly editScriptNodeIdsByScriptId: ReadonlyMap<string, string>
}

function styleBibleHasPolicyText(details: WorkspaceCanvasStyleBibleDetails): boolean {
  return [
    details.rawUserStyle,
    details.styleSummary,
    details.visualStyle,
    ...Object.values(details.assetImageStyle ?? {}),
  ].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  )
}

function buildStyleBibleDetails(value: unknown): WorkspaceCanvasStyleBibleDetails | null {
  const root = readJsonRecord(value)
  if (!root) return null
  const assetImageStyle = readJsonRecord(root.assetImageStyle)
  const details: WorkspaceCanvasStyleBibleDetails = {
    rawUserStyle: stringValue(root.rawUserStyle),
    styleSummary: stringValue(root.styleSummary),
    visualStyle: stringValue(root.visualStyle),
    assetImageStyle: assetImageStyle
      ? {
          lighting: stringValue(assetImageStyle.lighting) ?? '',
          texture: stringValue(assetImageStyle.texture) ?? '',
          composition: stringValue(assetImageStyle.composition) ?? '',
        }
      : null,
  }
  return styleBibleHasPolicyText(details) ? details : null
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

function shotCharacters(shot: ProjectEditScriptShot): string[] {
  return shot.characters.map((character) => `${character.name} / ${character.performance}`)
}

function shotDialogue(shot: ProjectEditScriptShot): string[] {
  const characterNameById = new Map(shot.characters.map((character) => [character.characterId, character.name]))
  return shot.dialogue.map((line) => {
    const speaker = characterNameById.get(line.characterId)
    if (!speaker) throw new Error(`EDIT_SCRIPT_DIALOGUE_CHARACTER_UNKNOWN:${shot.shotNumber}:${line.characterId}`)
    return `${speaker}: ${line.line}`
  })
}

function countCompletedEditAssetRequirements(requirements: readonly ProjectEditAssetRequirement[]): number {
  return requirements.filter((requirement) => requirement.status === 'completed').length
}

export function appendWorkspacePlanningProjection(context: WorkspaceNodeProjectionContext): WorkspacePlanningProjection {
  const {
    projectId,
    episodeId,
    episodeName,
    editFirstWorkflow,
    editBible,
    editScript,
    editScripts,
    activeTaskTargets,
    editScriptPending,
    streamTargets,
    savedLayouts,
    translate,
    onAction,
    nodes,
    edges,
    projectedEditScripts,
    chapterIndexById,
    editFirstCanvasVisibility,
    stylePreviewSetView,
    stylePreviewImageUrl,
  } = context
  const styleBibleDetails = buildStyleBibleDetails(editBible?.styleBible)

  const editSourceScriptStreamTarget = findStreamTarget(streamTargets, 'editSourceScript', episodeId)
  const editBibleStreamTarget = findStreamTarget(streamTargets, 'editBible', episodeId)
  const sourceScriptMaterialized = Boolean(
    editBible?.sourceKind === 'prompt_generated_script' &&
    ((typeof editBible.sourceText === 'string' && editBible.sourceText.trim().length > 0) || editBible.scriptStructure),
  )
  const sourceScriptFailed = Boolean(editBible?.status === 'failed' && editBible.sourceKind === 'prompt_generated_outline' && !sourceScriptMaterialized)
  const sourceScriptStreamAvailable =
    Boolean(editSourceScriptStreamTarget) || (editBible ? hasStreamTarget(streamTargets, 'editSourceScript', editBible.id) : false)
  const sourceScriptProjection = resolveWorkspaceCanvasNodeMaterialization('editSourceScript', activeTaskTargets, {
    identityAvailable: true,
    workflowVisible: editFirstCanvasVisibility.editSourceScript,
    resourceAvailable: Boolean(editBible && (editBible.sourceKind === 'prompt_generated_outline' || editBible.sourceKind === 'prompt_generated_script')),
    streamAvailable: sourceScriptStreamAvailable,
    submissionAvailable: false,
    targetId: editBible?.id ?? null,
  })
  const activeSourceScriptTaskTarget = sourceScriptProjection.activeTaskTargets[0] ?? null
  const sourceScriptRuntimeTargetId = editBible?.id ?? activeSourceScriptTaskTarget?.targetId ?? editSourceScriptStreamTarget?.targetId ?? null
  const sourceScriptRunning = !sourceScriptMaterialized && (sourceScriptProjection.activeTaskTargets.length > 0 || sourceScriptStreamAvailable)
  const hasProductionPlanningArtifact = Boolean(
    editBible &&
    (editBible.bible ||
      editBible.beatSheet ||
      editBible.ledger ||
      editBible.emotionalCurve ||
      (editBible.chapters?.length ?? 0) > 0 ||
      editBible.status === 'ready_for_review' ||
      editBible.status === 'confirmed' ||
      (editBible.status === 'failed' && editBible.sourceKind !== 'prompt_generated_outline')),
  )
  const bibleStreamAvailable = Boolean(editBibleStreamTarget) || (editBible ? hasStreamTarget(streamTargets, 'editBible', editBible.id) : false)
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
    nodes.push(
      createNode({
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
          terminalHandoffTaskId: editBible?.generationTaskId ?? null,
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditSourceScript(sourceScriptRuntimeTargetId)),
          sourceScriptDetails: {
            sourceDocumentId: editBible?.sourceDocumentId ?? null,
            sourceText,
            scriptStructure: editBible?.scriptStructure ?? null,
          },
          onAction,
        },
      }),
    )
  }

  let bibleNodeId: string | null = null
  if (bibleProjection.materialized) {
    const biblePresentation = editBible
      ? (resourcePresentationFromStatus(editBible.status) ?? workspaceCanvasPendingResourcePresentation())
      : workspaceCanvasPendingResourcePresentation()
    bibleNodeId = workspaceNodeId.editBible(episodeId)
    const productionNodeY = sourceScriptNodeId ? STAGE_START_Y + WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height + 96 : STAGE_START_Y
    nodes.push(
      createNode({
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
          terminalHandoffTaskId: editBible?.generationTaskId ?? null,
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
      }),
    )
    if (sourceScriptNodeId) edges.push(createEdge(`edge:${sourceScriptNodeId}:${bibleNodeId}`, sourceScriptNodeId, bibleNodeId))
  }

  const stylePreviewStartY =
    (sourceScriptNodeId ? STAGE_START_Y + WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height + 96 : STAGE_START_Y) +
    ROW_GAP_Y +
    WORKSPACE_CANVAS_EDIT_BIBLE_NODE_SIZE.height
  let styleBibleNodeId: string | null = null
  const styleBibleProjection = resolveWorkspaceCanvasNodeMaterialization('editStyleBible', activeTaskTargets, {
    identityAvailable: Boolean(editBible),
    workflowVisible: isEditFirstWorkflowPosition(editFirstWorkflow, 'visual_style', 'processing'),
    resourceAvailable: Boolean(styleBibleDetails || stylePreviewSetView),
    streamAvailable: false,
    submissionAvailable: false,
    targetId: editBible?.id ?? null,
  })
  const stylePreviewOptionsRunning =
    styleBibleProjection.activeTaskTargets.length > 0 || (isEditFirstWorkflowPosition(editFirstWorkflow, 'visual_style', 'processing') && !stylePreviewSetView)
  if (editBible && styleBibleProjection.materialized) {
    styleBibleNodeId = workspaceNodeId.editStyleBible(editBible.id)
    const stylePreviewRuntimeTargets =
      stylePreviewSetView?.allCandidates.flatMap((candidate) => {
        const target = TASK_RUNTIME_TARGETS.projectEditStylePreviewImage(candidate.id)
        return target ? [target] : []
      }) ?? []
    const hasGeneratingPreview = stylePreviewOptionsRunning || (stylePreviewSetView?.hasGeneratingPreview ?? false)
    const hasUsablePreview = stylePreviewSetView?.hasUsablePreview ?? false
    const hasFailedPreview = stylePreviewSetView?.hasFailedPreview ?? false
    nodes.push(
      createMediaNode({
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
          title: translate(
            styleBibleDetails
              ? 'nodes.editStyleBible.title'
              : hasGeneratingPreview
                ? 'nodes.editStyleBible.pendingTitle'
                : hasFailedPreview && !hasUsablePreview
                  ? 'nodes.editStyleBible.failedTitle'
                  : 'nodes.editStyleBible.waitingTitle',
          ),
          eyebrow: translate('nodes.editStyleBible.eyebrow'),
          body:
            styleBibleDetails?.styleSummary ??
            translate(
              hasGeneratingPreview
                ? 'nodes.editStyleBible.pendingBody'
                : hasFailedPreview && !hasUsablePreview
                  ? 'nodes.editStyleBible.failedBody'
                  : 'nodes.editStyleBible.waitingBody',
            ),
          meta: styleBibleDetails ? translate('status.succeeded') : '',
          ...(styleBibleDetails || hasUsablePreview
            ? workspaceCanvasSucceededResourcePresentation()
            : hasFailedPreview && !hasGeneratingPreview
              ? workspaceCanvasFailedResourcePresentation()
              : workspaceCanvasPendingResourcePresentation()),
          previewImageUrl: stylePreviewImageUrl,
          styleBibleDetails: styleBibleDetails ?? undefined,
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditStylePreviewOptions(editBible.id), ...stylePreviewRuntimeTargets),
          onAction,
        },
      }),
    )
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
        const editScriptPresentation = resourcePresentationFromStatus(script.status) ?? workspaceCanvasPendingResourcePresentation()
        const editScriptDetails = {
          bibleText: script.sourceText ?? '',
          durationSec: script.durationSec,
          shotCount: script.shotCount,
          shots: script.shots.map((shot) => ({
              shotId: shot.shotId,
              shotNumber: shot.shotNumber,
              durationSec: shot.durationSec,
              sceneName: shot.scene.name,
              action: shot.action,
              characters: shotCharacters(shot),
              dialogue: shotDialogue(shot),
              synchronousSound: shot.synchronousSound,
            })),
        }
        nodes.push(
          createNode({
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
              body:
                script.shots
                  .slice(0, 4)
                  .map((shot) => `${shot.shotNumber}. ${shot.action}`)
                  .join('\n') || translate('nodes.editScript.pendingBody'),
              meta: translate('nodes.editScript.meta', {
                shots: script.shotCount,
                duration: script.durationSec,
                assets: script.requirements.length,
                completed: countCompletedEditAssetRequirements(script.requirements),
              }),
              ...editScriptPresentation,
              terminalHandoffTaskId: script.generationTaskId ?? null,
              runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditChapterScriptGeneration(scriptChapterId)),
              editScriptDetails,
              onAction,
            },
          }),
        )
        if (styleBibleNodeId) {
          edges.push(createEdge(`edge:${styleBibleNodeId}:${nodeId}`, styleBibleNodeId, nodeId))
        } else if (bibleNodeId) {
          edges.push(createEdge(`edge:${bibleNodeId}:${nodeId}`, bibleNodeId, nodeId))
        }
      })
      pendingChapters.forEach((chapter, pendingIndex) => {
        const index = scriptNodes.length + pendingIndex
        const nodeId = workspaceNodeId.editScript(episodeId, chapter.id)
        nodes.push(
          createNode({
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
          }),
        )
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
        nodes.push(
          createNode({
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
          }),
        )
        if (styleBibleNodeId) {
          edges.push(createEdge(`edge:${styleBibleNodeId}:${nodeId}`, styleBibleNodeId, nodeId))
        } else if (bibleNodeId) {
          edges.push(createEdge(`edge:${bibleNodeId}:${nodeId}`, bibleNodeId, nodeId))
        }
      })
    } else {
      editScriptNodeId = workspaceNodeId.editScript(episodeId, null)
      nodes.push(
        createNode({
          id: editScriptNodeId,
          position: layoutPosition(savedLayouts, editScriptNodeId, {
            x: STORY_COLUMN_X + COLUMN_GAP_X,
            y: STAGE_START_Y,
          }),
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
        }),
      )
      if (styleBibleNodeId) {
        edges.push(createEdge(`edge:${styleBibleNodeId}:${editScriptNodeId}`, styleBibleNodeId, editScriptNodeId))
      } else if (bibleNodeId) {
        edges.push(createEdge(`edge:${bibleNodeId}:${editScriptNodeId}`, bibleNodeId, editScriptNodeId))
      }
    }
  }

  return {
    bibleNodeId,
    editScriptNodeId,
    editScriptNodeIdsByScriptId,
  }
}
