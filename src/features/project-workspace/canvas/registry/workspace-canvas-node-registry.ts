import type { WorkspaceResourceName } from '@/lib/task/types'
import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'
import type { WorkspaceCanvasStreamKind } from '../structured-stream/workspace-structured-stream-runtime-types'

type Capability<T> =
  | { readonly kind: 'supported'; readonly value: T }
  | { readonly kind: 'notApplicable'; readonly reason: string }

export interface WorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind = WorkspaceCanvasNodeKind> {
  readonly kind: K
  readonly identityScope: 'episode' | 'resource' | 'panel' | 'videoGroup' | 'aggregate'
  readonly resource: Capability<WorkspaceResourceName>
  readonly runtime: Capability<'taskTarget'>
  readonly stream: Capability<WorkspaceCanvasStreamKind>
  readonly terminalHandoff: Capability<WorkspaceResourceName>
  readonly rendererKey: K
  readonly focus: Capability<'operation'>
  readonly conformanceFixture: K
}

const supported = <T>(value: T): Capability<T> => ({ kind: 'supported', value })
const notApplicable = <T>(reason: string): Capability<T> => ({ kind: 'notApplicable', reason })

export const WORKSPACE_CANVAS_NODE_DEFINITIONS = {
  shot: {
    kind: 'shot', identityScope: 'panel', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: notApplicable('Panel generation streams provider progress, not structured card content.'),
    terminalHandoff: supported('episodeData'), rendererKey: 'shot', focus: supported('operation'), conformanceFixture: 'shot',
  },
  imageAsset: {
    kind: 'imageAsset', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: notApplicable('Image assets have no structured text stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'imageAsset', focus: supported('operation'), conformanceFixture: 'imageAsset',
  },
  videoClip: {
    kind: 'videoClip', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: notApplicable('Video clips have provider progress but no structured text stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'videoClip', focus: supported('operation'), conformanceFixture: 'videoClip',
  },
  finalTimeline: {
    kind: 'finalTimeline', identityScope: 'episode', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: notApplicable('Final rendering has no structured text stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'finalTimeline', focus: supported('operation'), conformanceFixture: 'finalTimeline',
  },
  editSourceScript: {
    kind: 'editSourceScript', identityScope: 'episode', resource: supported('editBible'), runtime: supported('taskTarget'),
    stream: supported('editSourceScript'), terminalHandoff: supported('editBible'), rendererKey: 'editSourceScript',
    focus: supported('operation'), conformanceFixture: 'editSourceScript',
  },
  editBible: {
    kind: 'editBible', identityScope: 'episode', resource: supported('editBible'), runtime: supported('taskTarget'),
    stream: supported('editBible'), terminalHandoff: supported('editBible'), rendererKey: 'editBible',
    focus: supported('operation'), conformanceFixture: 'editBible',
  },
  editStylePreview: {
    kind: 'editStylePreview', identityScope: 'resource', resource: supported('editBible'), runtime: supported('taskTarget'),
    stream: notApplicable('Style preview images do not expose structured text items.'), terminalHandoff: supported('editBible'),
    rendererKey: 'editStylePreview', focus: supported('operation'), conformanceFixture: 'editStylePreview',
  },
  editStyleBible: {
    kind: 'editStyleBible', identityScope: 'resource', resource: supported('editBible'), runtime: notApplicable('Confirmed style is persisted content.'),
    stream: notApplicable('Confirmed style has no active structured stream.'), terminalHandoff: supported('editBible'),
    rendererKey: 'editStyleBible', focus: supported('operation'), conformanceFixture: 'editStyleBible',
  },
  editPipelineStep: {
    kind: 'editPipelineStep', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: notApplicable('Generic pipeline steps are represented by their concrete node kinds.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'editPipelineStep', focus: supported('operation'), conformanceFixture: 'editPipelineStep',
  },
  editProcessGroup: {
    kind: 'editProcessGroup', identityScope: 'aggregate', resource: supported('episodeData'), runtime: notApplicable('Process groups aggregate child states.'),
    stream: notApplicable('Process groups aggregate child streams.'), terminalHandoff: notApplicable('Children own terminal handoff.'),
    rendererKey: 'editProcessGroup', focus: notApplicable('Focus follows concrete child artifacts.'), conformanceFixture: 'editProcessGroup',
  },
  editScript: {
    kind: 'editScript', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: supported('editScript'), terminalHandoff: supported('episodeData'), rendererKey: 'editScript',
    focus: supported('operation'), conformanceFixture: 'editScript',
  },
  editShotExecutionPlan: {
    kind: 'editShotExecutionPlan', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: supported('editShotExecutionPlan'), terminalHandoff: supported('episodeData'), rendererKey: 'editShotExecutionPlan',
    focus: supported('operation'), conformanceFixture: 'editShotExecutionPlan',
  },
  videoPlan: {
    kind: 'videoPlan', identityScope: 'videoGroup', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: notApplicable('Video generation has no structured text card stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'videoPlan', focus: supported('operation'), conformanceFixture: 'videoPlan',
  },
  bgmScore: {
    kind: 'bgmScore', identityScope: 'episode', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: supported('bgmScore'), terminalHandoff: supported('episodeData'), rendererKey: 'bgmScore',
    focus: supported('operation'), conformanceFixture: 'bgmScore',
  },
  soundscape: {
    kind: 'soundscape', identityScope: 'episode', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: supported('soundscape'), terminalHandoff: supported('episodeData'), rendererKey: 'soundscape',
    focus: supported('operation'), conformanceFixture: 'soundscape',
  },
  editRequiredAsset: {
    kind: 'editRequiredAsset', identityScope: 'resource', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: notApplicable('Asset generation has no structured text card stream.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'editRequiredAsset', focus: supported('operation'), conformanceFixture: 'editRequiredAsset',
  },
  editAssetGroup: {
    kind: 'editAssetGroup', identityScope: 'aggregate', resource: supported('episodeData'), runtime: supported('taskTarget'),
    stream: notApplicable('Asset groups aggregate task-backed asset items.'), terminalHandoff: supported('episodeData'),
    rendererKey: 'editAssetGroup', focus: supported('operation'), conformanceFixture: 'editAssetGroup',
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodeDefinition>

export function getWorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind>(
  kind: K,
): (typeof WORKSPACE_CANVAS_NODE_DEFINITIONS)[K] {
  return WORKSPACE_CANVAS_NODE_DEFINITIONS[kind]
}
