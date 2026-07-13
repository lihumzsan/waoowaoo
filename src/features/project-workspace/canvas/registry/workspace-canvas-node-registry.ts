import type { TaskRuntimeTarget } from '@/lib/task/runtime-targets'
import { TASK_TYPE, type TaskType, type WorkspaceResourceName } from '@/lib/task/types'
import type { AppIconName } from '@/components/ui/icons'
import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'
import type { WorkspaceCanvasStreamKind } from '../structured-stream/workspace-structured-stream-runtime-types'

type Capability<T> = { readonly kind: 'supported'; readonly value: T } | { readonly kind: 'notApplicable'; readonly reason: string }

interface WorkspaceCanvasTaskMaterialization {
  readonly targetType: string
  readonly taskTypes: readonly TaskType[]
}

export type WorkspaceCanvasRuntimeAggregation = 'failureDominant' | 'resourceAggregate'
export type WorkspaceCanvasProjectionOwner = 'planning' | 'assetExecution' | 'storyboardVideo' | 'audioFinal'

interface WorkspaceCanvasTaskRuntime {
  readonly source: 'taskTarget'
  readonly aggregation: WorkspaceCanvasRuntimeAggregation
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
  readonly runtime: Capability<WorkspaceCanvasTaskRuntime>
  readonly materializeFromTask: Capability<WorkspaceCanvasTaskMaterialization>
  readonly stream: Capability<WorkspaceCanvasStreamKind>
  readonly terminalHandoff: Capability<WorkspaceResourceName>
  readonly rendererKey: K
  readonly presentation: {
    readonly iconName: AppIconName
    readonly showsMetaFooter: boolean
    readonly hasSourceHandle: boolean
    readonly usesInlineTaskProgress: boolean
    readonly actionPlacement: 'header' | 'footer'
    readonly showsLargeTitle: boolean
    readonly usesGridAutoHeightShell: boolean
    readonly showsMetaText: boolean
    readonly runningRenderer: 'default' | 'mediaPreview'
  }
  readonly projection: Capability<WorkspaceCanvasProjectionOwner>
  readonly focus: Capability<'operation'>
  readonly conformanceFixture: K
}

const supported = <T>(value: T): Capability<T> => ({ kind: 'supported', value })
const notApplicable = <T>(reason: string): Capability<T> => ({ kind: 'notApplicable', reason })
const taskRuntime = (aggregation: WorkspaceCanvasRuntimeAggregation = 'failureDominant'): Capability<WorkspaceCanvasTaskRuntime> =>
  supported({ source: 'taskTarget', aggregation })
const materializeFromTask = (targetType: string, ...taskTypes: readonly TaskType[]): Capability<WorkspaceCanvasTaskMaterialization> =>
  supported({ targetType, taskTypes })
const resourceRequired = (reason: string): Capability<WorkspaceCanvasTaskMaterialization> => notApplicable(reason)

export const WORKSPACE_CANVAS_NODE_DEFINITIONS = {
  shot: {
    kind: 'shot',
    identityScope: 'panel',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('A persisted panel is required before projecting a shot node.'),
    stream: notApplicable('Panel generation streams provider progress, not structured card content.'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'shot',
    presentation: {
      iconName: 'clapperboard',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: false,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('storyboardVideo'),
    focus: supported('operation'),
    conformanceFixture: 'shot',
  },
  imageAsset: {
    kind: 'imageAsset',
    identityScope: 'resource',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('A persisted image asset is required before projecting its node.'),
    stream: notApplicable('Image assets have no structured text stream.'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'imageAsset',
    presentation: {
      iconName: 'image',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'mediaPreview',
    },
    projection: notApplicable('Image assets are embedded compatibility node data and have no production projector.'),
    focus: supported('operation'),
    conformanceFixture: 'imageAsset',
  },
  videoClip: {
    kind: 'videoClip',
    identityScope: 'resource',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('A persisted video clip is required before projecting its node.'),
    stream: notApplicable('Video clips have provider progress but no structured text stream.'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'videoClip',
    presentation: {
      iconName: 'video',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'mediaPreview',
    },
    projection: notApplicable('Video clips are embedded in shot and video-plan projections.'),
    focus: supported('operation'),
    conformanceFixture: 'videoClip',
  },
  finalTimeline: {
    kind: 'finalTimeline',
    identityScope: 'episode',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('The workflow materializes the final timeline before its render Task.'),
    stream: notApplicable('Final rendering has no structured text stream.'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'finalTimeline',
    presentation: {
      iconName: 'film',
      showsMetaFooter: true,
      hasSourceHandle: false,
      usesInlineTaskProgress: true,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('audioFinal'),
    focus: supported('operation'),
    conformanceFixture: 'finalTimeline',
  },
  editSourceScript: {
    kind: 'editSourceScript',
    identityScope: 'episode',
    resource: supported('editBible'),
    runtime: taskRuntime(),
    materializeFromTask: materializeFromTask('ProjectEditSourceScript', TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE),
    stream: supported('editSourceScript'),
    terminalHandoff: supported('editBible'),
    rendererKey: 'editSourceScript',
    presentation: {
      iconName: 'clipboardCheck',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: true,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('planning'),
    focus: supported('operation'),
    conformanceFixture: 'editSourceScript',
  },
  editBible: {
    kind: 'editBible',
    identityScope: 'episode',
    resource: supported('editBible'),
    runtime: taskRuntime(),
    materializeFromTask: materializeFromTask('ProjectEditBible', TASK_TYPE.EDIT_BIBLE_GENERATE),
    stream: supported('editBible'),
    terminalHandoff: supported('editBible'),
    rendererKey: 'editBible',
    presentation: {
      iconName: 'bookOpen',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: true,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('planning'),
    focus: supported('operation'),
    conformanceFixture: 'editBible',
  },
  editStyleBible: {
    kind: 'editStyleBible',
    identityScope: 'resource',
    resource: supported('editBible'),
    runtime: taskRuntime('resourceAggregate'),
    materializeFromTask: materializeFromTask('ProjectEditBible', TASK_TYPE.EDIT_STYLE_PREVIEW_OPTIONS_GENERATE),
    stream: notApplicable('Style preview image tasks expose runtime state but no structured text items.'),
    terminalHandoff: supported('editBible'),
    rendererKey: 'editStyleBible',
    presentation: {
      iconName: 'sparklesAlt',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('planning'),
    focus: supported('operation'),
    conformanceFixture: 'editStyleBible',
  },
  editPipelineStep: {
    kind: 'editPipelineStep',
    identityScope: 'resource',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('Concrete pipeline node kinds own Task materialization.'),
    stream: notApplicable('Generic pipeline steps are represented by their concrete node kinds.'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'editPipelineStep',
    presentation: {
      iconName: 'chart',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: notApplicable('Concrete execution-plan nodes own pipeline-step projection.'),
    focus: supported('operation'),
    conformanceFixture: 'editPipelineStep',
  },
  editProcessGroup: {
    kind: 'editProcessGroup',
    identityScope: 'aggregate',
    resource: supported('episodeData'),
    runtime: notApplicable('Process groups aggregate child states.'),
    materializeFromTask: resourceRequired('Process groups materialize from their projected children.'),
    stream: notApplicable('Process groups aggregate child streams.'),
    terminalHandoff: notApplicable('Children own terminal handoff.'),
    rendererKey: 'editProcessGroup',
    presentation: {
      iconName: 'grid',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: notApplicable('No production projector emits the aggregate process-group node.'),
    focus: notApplicable('Focus follows concrete child artifacts.'),
    conformanceFixture: 'editProcessGroup',
  },
  editScript: {
    kind: 'editScript',
    identityScope: 'resource',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('Confirmed chapter resources establish edit-script node identities before Tasks run.'),
    stream: supported('editScript'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'editScript',
    presentation: {
      iconName: 'clipboardCheck',
      showsMetaFooter: false,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: true,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('planning'),
    focus: supported('operation'),
    conformanceFixture: 'editScript',
  },
  editShotExecutionPlan: {
    kind: 'editShotExecutionPlan',
    identityScope: 'resource',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: materializeFromTask('ProjectEditScript', TASK_TYPE.EDIT_SHOT_EXECUTION_PLAN_GENERATE),
    stream: supported('editShotExecutionPlan'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'editShotExecutionPlan',
    presentation: {
      iconName: 'image',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('assetExecution'),
    focus: supported('operation'),
    conformanceFixture: 'editShotExecutionPlan',
  },
  videoPlan: {
    kind: 'videoPlan',
    identityScope: 'videoGroup',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('Generation segments establish video-plan nodes before video Tasks run.'),
    stream: notApplicable('Video generation has no structured text card stream.'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'videoPlan',
    presentation: {
      iconName: 'clapperboard',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: true,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('storyboardVideo'),
    focus: supported('operation'),
    conformanceFixture: 'videoPlan',
  },
  bgmScore: {
    kind: 'bgmScore',
    identityScope: 'episode',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: materializeFromTask('ProjectEpisode', TASK_TYPE.MUSIC_SCORE_PLAN, TASK_TYPE.MUSIC_SCORE_GENERATE),
    stream: supported('bgmScore'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'bgmScore',
    presentation: {
      iconName: 'audioWave',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: true,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('audioFinal'),
    focus: supported('operation'),
    conformanceFixture: 'bgmScore',
  },
  soundscape: {
    kind: 'soundscape',
    identityScope: 'episode',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: materializeFromTask('ProjectEpisode', TASK_TYPE.SOUNDSCAPE_PLAN, TASK_TYPE.SOUNDSCAPE_GENERATE),
    stream: supported('soundscape'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'soundscape',
    presentation: {
      iconName: 'audioWave',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: true,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('audioFinal'),
    focus: supported('operation'),
    conformanceFixture: 'soundscape',
  },
  editRequiredAsset: {
    kind: 'editRequiredAsset',
    identityScope: 'resource',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('A persisted character or location establishes each asset item node.'),
    stream: notApplicable('Asset generation has no structured text card stream.'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'editRequiredAsset',
    presentation: {
      iconName: 'package',
      showsMetaFooter: false,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'header',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: false,
      runningRenderer: 'mediaPreview',
    },
    projection: notApplicable('Required assets are embedded in the projected asset group.'),
    focus: supported('operation'),
    conformanceFixture: 'editRequiredAsset',
  },
  editAssetGroup: {
    kind: 'editAssetGroup',
    identityScope: 'aggregate',
    resource: supported('episodeData'),
    runtime: taskRuntime(),
    materializeFromTask: resourceRequired('The asset group materializes from persisted asset children.'),
    stream: notApplicable('Asset groups aggregate task-backed asset items.'),
    terminalHandoff: supported('episodeData'),
    rendererKey: 'editAssetGroup',
    presentation: {
      iconName: 'package',
      showsMetaFooter: true,
      hasSourceHandle: true,
      usesInlineTaskProgress: false,
      actionPlacement: 'footer',
      showsLargeTitle: true,
      usesGridAutoHeightShell: false,
      showsMetaText: true,
      runningRenderer: 'default',
    },
    projection: supported('assetExecution'),
    focus: supported('operation'),
    conformanceFixture: 'editAssetGroup',
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodeDefinition>

export function getWorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind>(kind: K): (typeof WORKSPACE_CANVAS_NODE_DEFINITIONS)[K] {
  return WORKSPACE_CANVAS_NODE_DEFINITIONS[kind]
}

export function resolveWorkspaceCanvasNodeMaterialization<T extends TaskRuntimeTarget>(
  kind: WorkspaceCanvasNodeKind,
  targets: readonly T[],
  facts: WorkspaceCanvasMaterializationFacts,
): WorkspaceCanvasMaterialization<T> {
  const capability: Capability<WorkspaceCanvasTaskMaterialization> = WORKSPACE_CANVAS_NODE_DEFINITIONS[kind].materializeFromTask
  const activeTaskTargets =
    capability.kind === 'supported'
      ? targets.filter(
          (target) =>
            target.targetType === capability.value.targetType &&
            (facts.targetId === null || target.targetId === facts.targetId) &&
            capability.value.taskTypes.some((taskType) => target.types?.includes(taskType)),
        )
      : []
  return {
    activeTaskTargets,
    materialized:
      facts.identityAvailable &&
      (facts.workflowVisible || facts.resourceAvailable || facts.streamAvailable || facts.submissionAvailable || activeTaskTargets.length > 0),
  }
}
