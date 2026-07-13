import type { TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import { TASK_TYPE, type TaskType, type WorkspaceResourceName } from '@/lib/task/types'
import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'
import type { WorkspaceCanvasStreamKind } from '../structured-stream/workspace-structured-stream-runtime-types'

type Capability<T> =
  | { readonly kind: 'supported'; readonly value: T }
  | { readonly kind: 'notApplicable'; readonly reason: string }

interface WorkspaceCanvasTaskMaterialization {
  readonly targetType: string
  readonly taskTypes: readonly TaskType[]
}

interface WorkspaceCanvasMaterializationFacts {
  readonly identityAvailable: boolean
  readonly workflowVisible: boolean
  readonly resourceAvailable: boolean
  readonly streamAvailable: boolean
  readonly submissionAvailable: boolean
  readonly targetId: string | null
}

export interface WorkspaceCanvasMaterialization<T extends TaskRuntimeTarget> {
  readonly materialized: boolean
  readonly activeTaskTargets: readonly T[]
}

export interface WorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind = WorkspaceCanvasNodeKind> {
  readonly kind: K
  readonly identityScope: 'episode' | 'resource' | 'panel' | 'videoGroup' | 'aggregate'
  readonly resource: Capability<WorkspaceResourceName>
  readonly runtime: Capability<'taskTarget'>
  readonly materializeFromTask: Capability<WorkspaceCanvasTaskMaterialization>
  readonly stream: Capability<WorkspaceCanvasStreamKind>
  readonly terminalHandoff: Capability<WorkspaceResourceName>
  readonly rendererKey: K
  readonly focus: Capability<'operation'>
  readonly conformanceFixture: K
}

const supported = <T>(value: T): Capability<T> => ({ kind: 'supported', value })
const notApplicable = <T>(reason: string): Capability<T> => ({ kind: 'notApplicable', reason })
const materializeFromTask = (
  targetType: string,
  ...taskTypes: readonly TaskType[]
): Capability<WorkspaceCanvasTaskMaterialization> => supported({ targetType, taskTypes })
const resourceRequired = (reason: string): Capability<WorkspaceCanvasTaskMaterialization> => notApplicable(reason)

export const WORKSPACE_CANVAS_NODE_DEFINITIONS = {
  shot: {
    kind: 'shot', identityScope: 'panel', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('A persisted panel is required before projecting a shot node.'),
    stream: notApplicable('Panel generation streams provider progress, not structured card content.'),
    terminalHandoff: supported('episodeData'), rendererKey: 'shot', focus: supported('operation'), conformanceFixture: 'shot',
  },
  imageAsset: {
    kind: 'imageAsset', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('A persisted image asset is required before projecting its node.'),
    stream: notApplicable('Image assets have no structured text stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'imageAsset', focus: supported('operation'), conformanceFixture: 'imageAsset',
  },
  videoClip: {
    kind: 'videoClip', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('A persisted video clip is required before projecting its node.'),
    stream: notApplicable('Video clips have provider progress but no structured text stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'videoClip', focus: supported('operation'), conformanceFixture: 'videoClip',
  },
  finalTimeline: {
    kind: 'finalTimeline', identityScope: 'episode', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('The workflow materializes the final timeline before its render Task.'),
    stream: notApplicable('Final rendering has no structured text stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'finalTimeline', focus: supported('operation'), conformanceFixture: 'finalTimeline',
  },
  editSourceScript: {
    kind: 'editSourceScript', identityScope: 'episode', resource: supported('editBible'), runtime: supported('taskTarget'),
    materializeFromTask: materializeFromTask('ProjectEditSourceScript', TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE),
    stream: supported('editSourceScript'), terminalHandoff: supported('editBible'), rendererKey: 'editSourceScript',
    focus: supported('operation'), conformanceFixture: 'editSourceScript',
  },
  editBible: {
    kind: 'editBible', identityScope: 'episode', resource: supported('editBible'), runtime: supported('taskTarget'),
    materializeFromTask: materializeFromTask('ProjectEditBible', TASK_TYPE.EDIT_BIBLE_GENERATE),
    stream: supported('editBible'), terminalHandoff: supported('editBible'), rendererKey: 'editBible',
    focus: supported('operation'), conformanceFixture: 'editBible',
  },
  editStyleBible: {
    kind: 'editStyleBible', identityScope: 'resource', resource: supported('editBible'), runtime: supported('taskTarget'),
    materializeFromTask: materializeFromTask('ProjectEditBible', TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE),
    stream: notApplicable('Style preview image tasks expose runtime state but no structured text items.'), terminalHandoff: supported('editBible'),
    rendererKey: 'editStyleBible', focus: supported('operation'), conformanceFixture: 'editStyleBible',
  },
  editPipelineStep: {
    kind: 'editPipelineStep', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('Concrete pipeline node kinds own Task materialization.'),
    stream: notApplicable('Generic pipeline steps are represented by their concrete node kinds.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'editPipelineStep', focus: supported('operation'), conformanceFixture: 'editPipelineStep',
  },
  editProcessGroup: {
    kind: 'editProcessGroup', identityScope: 'aggregate', resource: supported('episodeData'), runtime: notApplicable('Process groups aggregate child states.'),
    materializeFromTask: resourceRequired('Process groups materialize from their projected children.'),
    stream: notApplicable('Process groups aggregate child streams.'), terminalHandoff: notApplicable('Children own terminal handoff.'),
    rendererKey: 'editProcessGroup', focus: notApplicable('Focus follows concrete child artifacts.'), conformanceFixture: 'editProcessGroup',
  },
  editScript: {
    kind: 'editScript', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('Confirmed chapter resources establish edit-script node identities before Tasks run.'),
    stream: supported('editScript'), terminalHandoff: supported('episodeData'), rendererKey: 'editScript',
    focus: supported('operation'), conformanceFixture: 'editScript',
  },
  editShotExecutionPlan: {
    kind: 'editShotExecutionPlan', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: materializeFromTask('ProjectEditScript', TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE),
    stream: supported('editShotExecutionPlan'), terminalHandoff: supported('episodeData'), rendererKey: 'editShotExecutionPlan',
    focus: supported('operation'), conformanceFixture: 'editShotExecutionPlan',
  },
  videoPlan: {
    kind: 'videoPlan', identityScope: 'videoGroup', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('Generation segments establish video-plan nodes before video Tasks run.'),
    stream: notApplicable('Video generation has no structured text card stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'videoPlan', focus: supported('operation'), conformanceFixture: 'videoPlan',
  },
  bgmScore: {
    kind: 'bgmScore', identityScope: 'episode', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: materializeFromTask('ProjectEpisode', TASK_TYPE.MUSIC_SCORE_PLAN),
    stream: supported('bgmScore'), terminalHandoff: supported('episodeData'), rendererKey: 'bgmScore',
    focus: supported('operation'), conformanceFixture: 'bgmScore',
  },
  soundscape: {
    kind: 'soundscape', identityScope: 'episode', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: materializeFromTask(
      'ProjectEpisode',
      TASK_TYPE.SOUNDSCAPE_PLAN,
      TASK_TYPE.SOUNDSCAPE_GENERATE,
    ),
    stream: supported('soundscape'), terminalHandoff: supported('episodeData'), rendererKey: 'soundscape',
    focus: supported('operation'), conformanceFixture: 'soundscape',
  },
  editRequiredAsset: {
    kind: 'editRequiredAsset', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('A persisted character or location establishes each asset item node.'),
    stream: notApplicable('Asset generation has no structured text card stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'editRequiredAsset', focus: supported('operation'), conformanceFixture: 'editRequiredAsset',
  },
  editAssetGroup: {
    kind: 'editAssetGroup', identityScope: 'aggregate', resource: supported('episodeData'), runtime: supported('taskTarget'),
    materializeFromTask: resourceRequired('The asset group materializes from persisted asset children.'),
    stream: notApplicable('Asset groups aggregate task-backed asset items.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'editAssetGroup', focus: supported('operation'), conformanceFixture: 'editAssetGroup',
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodeDefinition>

export function getWorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind>(
  kind: K,
): (typeof WORKSPACE_CANVAS_NODE_DEFINITIONS)[K] {
  return WORKSPACE_CANVAS_NODE_DEFINITIONS[kind]
}

export function resolveWorkspaceCanvasNodeMaterialization<T extends TaskRuntimeTarget>(
  kind: WorkspaceCanvasNodeKind,
  targets: readonly T[],
  facts: WorkspaceCanvasMaterializationFacts,
): WorkspaceCanvasMaterialization<T> {
  const capability: Capability<WorkspaceCanvasTaskMaterialization> = WORKSPACE_CANVAS_NODE_DEFINITIONS[kind].materializeFromTask
  const activeTaskTargets = capability.kind === 'supported'
    ? targets.filter((target) => (
        target.targetType === capability.value.targetType
        && (facts.targetId === null || target.targetId === facts.targetId)
        && capability.value.taskTypes.some((taskType) => target.types?.includes(taskType))
      ))
    : []
  return {
    activeTaskTargets,
    materialized: facts.identityAvailable && (
      facts.workflowVisible
      || facts.resourceAvailable
      || facts.streamAvailable
      || facts.submissionAvailable
      || activeTaskTargets.length > 0
    ),
  }
}
