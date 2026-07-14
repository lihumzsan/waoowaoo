import type { ProjectEditScript, ProjectEditShotExecutionPlan } from '@/types/project'
import type { WorkspaceCanvasEditPipelineStepItem } from '../node-canvas-types'
import type { WorkspaceNodeProjectionContext } from './workspace-node-projection-shared'
import type { WorkspacePlanningProjection } from './workspace-node-planning-projection'
import {
  ASSET_GROUP_Y_OFFSET,
  COLUMN_GAP_X,
  STAGE_START_Y,
  STORY_COLUMN_X,
  TASK_RUNTIME_TARGETS,
  WORKSPACE_CANVAS_DEFAULT_NODE_SIZE,
  WORKSPACE_CANVAS_EDIT_CINEMATOGRAPHY_COLLAPSED_NODE_SIZE,
  assetPreviewUrl,
  createEdge,
  createMediaNode,
  createNode,
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

type Translate = WorkspaceNodeProjectionContext['translate']

export interface WorkspaceAssetExecutionProjection {
  readonly executionNodeId: string | null
  readonly executionNodeIdsByEditScriptId: ReadonlyMap<string, string>
}

function planningEntityNameSet(value: unknown, key: 'characters' | 'locations'): ReadonlySet<string> {
  const record = readJsonRecord(value)
  const collection = record?.[key]
  if (!Array.isArray(collection)) return new Set()
  return new Set(
    collection.flatMap((item) => {
      const name = stringValue(readJsonRecord(item)?.name)
      return name ? [name.replace(/\s+/g, ' ').toLocaleLowerCase()] : []
    }),
  )
}

function executionItems(plan: ProjectEditShotExecutionPlan, editScript: ProjectEditScript, translate: Translate): WorkspaceCanvasEditPipelineStepItem[] {
  const shotById = new Map(editScript.shots.map((shot) => [shot.shotId, shot] as const))
  return plan.generationSegments.flatMap((segment) => segment.shots.map((execution) => {
    const shot = shotById.get(execution.shotId)
    if (!shot) throw new Error(`EDIT_SHOT_EXECUTION_SHOT_UNKNOWN:${execution.shotId}`)
    return {
    title: translate('nodeFields.shotIndex', { index: shot.shotNumber }),
    fields: [
      { label: translate('nodeFields.shotScale'), value: execution.shotScale },
      { label: translate('nodeFields.cameraMovement'), value: execution.cameraMovement.movement },
      { label: translate('nodeFields.cameraStability'), value: execution.cameraMovement.stability },
    ],
    body: shot.action,
    chips: shot.characters.map((character) => character.name),
  }
  }))
}

export function appendWorkspaceAssetExecutionProjection(
  context: WorkspaceNodeProjectionContext,
  planning: WorkspacePlanningProjection,
): WorkspaceAssetExecutionProjection {
  const {
    projectId,
    episodeId,
    episodeName,
    editBible,
    editScript,
    editScripts,
    editShotExecutionPlans,
    projectCharacters,
    projectLocations,
    activeTaskTargets,
    streamTargets,
    savedLayouts,
    translate,
    onAction,
    nodes,
    edges,
    projectedEditScripts,
    chapterIndexById,
    editFirstCanvasVisibility,
    stylePreviewImageUrl,
    editFirstWorkflow,
  } = context
  const { bibleNodeId, editScriptNodeIdsByScriptId } = planning

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
        const image =
          location.images.find((item) => item.id === location.selectedImageId) ?? location.images.find((item) => item.isSelected) ?? location.images[0] ?? null
        return {
          id: location.id,
          kind: 'location' as const,
          name: location.name,
          description: location.summary || image?.description || location.name,
          previewImageUrl: image?.imageUrl || image?.media?.url || null,
          errorMessage: image?.imageErrorMessage ?? null,
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
  const fallbackAssetsByIdentity = new Map<
    string,
    {
      readonly id: string
      readonly kind: 'character' | 'location'
      readonly name: string
      readonly description: string
      readonly previewImageUrl: string | null
      readonly errorMessage: string | null
      readonly taskTargetType: 'CharacterAppearance' | 'LocationImage'
      readonly taskTargetId: string
    }
  >()
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
  const displayedAssets = plannedAssets.length > 0 ? plannedAssets : [...fallbackAssetsByIdentity.values()]
  const assetGenerationAvailable = editFirstWorkflow.operationPolicy.allowedOperationIds.includes('generate_edit_script_assets')
  if (editFirstCanvasVisibility.editAssetGroup && displayedAssets.length > 0) {
    const nodeId = workspaceNodeId.editAssetGroup(episodeId)
    assetGroupNodeId = nodeId
    const primaryScript = editScript ?? assetGroupScripts[0] ?? null
    const characterRequirements = displayedAssets.filter((asset) => asset.kind === 'character').length
    const locationRequirements = displayedAssets.filter((asset) => asset.kind === 'location').length
    const assetsReady = displayedAssets.every((asset) => Boolean(asset.previewImageUrl))
    const assetsFailed =
      displayedAssets.some((asset) => Boolean(asset.errorMessage)) || allAssetRequirements.some(({ requirement }) => requirement.status === 'failed')
    const assetGroupPresentation = assetsFailed
      ? workspaceCanvasFailedResourcePresentation()
      : assetsReady
        ? workspaceCanvasSucceededResourcePresentation()
        : null
    nodes.push(
      createMediaNode({
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
          body: displayedAssets.map((asset) => `${asset.name} / ${asset.kind}`).join('\n') || translate('empty.editAsset'),
          meta: translate('nodes.editAssetGroup.meta', {
            characters: characterRequirements,
            locations: locationRequirements,
          }),
          ...(assetGroupPresentation ?? workspaceCanvasPendingResourcePresentation()),
          actionLabel: assetGenerationAvailable && !assetsReady && primaryScript ? translate('actions.generateEditAssets') : undefined,
          action: assetGenerationAvailable && !assetsReady && primaryScript
            ? { type: 'generate_edit_assets', editScriptId: primaryScript.id }
            : undefined,
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
                lifecycle:
                  asset.errorMessage || requirement?.status === 'failed'
                    ? workspaceCanvasFailedResourcePresentation().lifecycle
                    : asset.previewImageUrl
                      ? workspaceCanvasSucceededResourcePresentation().lifecycle
                      : (resourcePresentationFromStatus(requirement?.status)?.lifecycle ?? workspaceCanvasPendingResourcePresentation().lifecycle),
                previewImageUrl: asset.previewImageUrl,
                runtimeTarget: TASK_RUNTIME_TARGETS.projectEditAssetImage(asset.taskTargetType, asset.taskTargetId),
                action: asset.previewImageUrl
                  ? { type: 'regenerate_edit_asset_image', assetId: asset.id, kind: asset.kind }
                  : assetGenerationAvailable && requirement && script
                    ? { type: 'generate_edit_asset', editScriptId: script.id, requirementId: requirement.id }
                    : undefined,
                actionLabel: asset.previewImageUrl
                  ? translate('actions.regenerateImage')
                  : assetGenerationAvailable && requirement && script
                    ? translate('actions.generateEditAsset')
                    : undefined,
              }
            }),
          },
          onAction,
        },
      }),
    )
    const sourceNodeId = primaryScript ? workspaceNodeId.editScript(episodeId, primaryScript.chapterId ?? null) : bibleNodeId
    if (sourceNodeId) {
      edges.push(createEdge(`edge:${sourceNodeId}:${nodeId}`, sourceNodeId, nodeId))
    }
  }

  let executionNodeId: string | null = null
  const executionNodeIdsByEditScriptId = new Map<string, string>()
  const executionPlanByEditScriptId = new Map(editShotExecutionPlans.map((plan) => [plan.editScriptId, plan] as const))
  const streamedExecutionPlanTargetIds = new Set(
    streamTargets.filter((target) => target.streamKind === 'editShotExecutionPlan').map((target) => target.targetId),
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
      ? (resourcePresentationFromStatus(matchingExecutionPlan.status) ?? workspaceCanvasPendingResourcePresentation())
      : null
    const nodeId = workspaceNodeId.editShotExecutionPlan(script.id)
    executionNodeIdsByEditScriptId.set(script.id, nodeId)
    if (editScript?.id === script.id || executionNodeId === null) executionNodeId = nodeId
    const chapterIndex = script.chapterId ? chapterIndexById.get(script.chapterId) : undefined
    nodes.push(
      createNode({
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
          title:
            chapterIndex === undefined
              ? translate('nodes.editShotExecutionPlan.title')
              : translate('nodes.editShotExecutionPlan.titleWithChapterNumber', { chapter: chapterIndex + 1 }),
          eyebrow: translate('nodes.editShotExecutionPlan.eyebrow'),
          body: matchingExecutionPlan
            ? matchingExecutionPlan.generationSegments.flatMap((segment) => segment.shots)
                .slice(0, 4)
                .map((shot) => `${shot.shotNumber}. ${shot.shotScale} / ${shot.cameraMovement.movement}`)
                .join('\n')
            : translate('nodes.editShotExecutionPlan.pendingBody'),
          meta: matchingExecutionPlan
            ? translate('nodes.editShotExecutionPlan.meta', {
                shots: matchingExecutionPlan.generationSegments.reduce((total, segment) => total + segment.shots.length, 0),
              })
            : '',
          ...(executionPresentation ?? workspaceCanvasPendingResourcePresentation()),
          terminalHandoffTaskId: matchingExecutionPlan?.generationTaskId ?? null,
          runtimeTargets: runtimeTargets(TASK_RUNTIME_TARGETS.projectEditShotExecutionPlan(script.id)),
          actionLabel: matchingExecutionPlan ? undefined : translate('actions.generateShotExecutionPlan'),
          action: matchingExecutionPlan ? undefined : { type: 'generate_edit_shot_execution_plan', editScriptId: script.id },
          editPipelineStepDetails: matchingExecutionPlan ? { items: executionItems(matchingExecutionPlan, script, translate) } : undefined,
          onAction,
        },
      }),
    )
    const sourceNodeId = assetGroupNodeId ?? editScriptNodeIdsByScriptId.get(script.id) ?? null
    if (sourceNodeId) {
      edges.push(createEdge(`edge:${sourceNodeId}:${nodeId}`, sourceNodeId, nodeId))
    }
  })

  return { executionNodeId, executionNodeIdsByEditScriptId }
}
