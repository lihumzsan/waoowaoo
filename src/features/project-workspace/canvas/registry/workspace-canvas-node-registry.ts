import type { AppIconName } from '@/components/ui/icons'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import type { WorkspaceCanvasNodeKind } from '../node-canvas-types'

interface WorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind = WorkspaceCanvasNodeKind> {
  readonly kind: K
  readonly identityScope: 'resource'
  readonly taskTargetType: 'CreativeResource'
  readonly taskTypes: readonly TaskType[]
  readonly rendererKey: K
  /**
   * Card chrome declaration. Domain identifiers (schemaId, resource IDs)
   * never appear as card copy (CN-05); category naming, when needed, must be
   * an i18n declaration here — never a raw registry/schema value.
   */
  readonly presentation: {
    readonly iconName: AppIconName
    readonly hasSourceHandle: boolean
  }
  readonly conformanceFixture: K
}

export const WORKSPACE_CANVAS_NODE_DEFINITIONS = {
  resourceCard: {
    kind: 'resourceCard',
    identityScope: 'resource',
    taskTargetType: 'CreativeResource',
    taskTypes: [
      TASK_TYPE.CREATIVE_RESOURCE_IMAGE,
      TASK_TYPE.CREATIVE_RESOURCE_AUDIO,
      TASK_TYPE.CREATIVE_RESOURCE_VOICE,
      TASK_TYPE.CREATIVE_RESOURCE_VIDEO,
      TASK_TYPE.CREATIVE_RESOURCE_VIDEO_MERGE,
      TASK_TYPE.CREATIVE_RESOURCE_WEB_REFERENCE,
    ],
    rendererKey: 'resourceCard',
    presentation: {
      iconName: 'package',
      hasSourceHandle: true,
    },
    conformanceFixture: 'resourceCard',
  },
} as const satisfies Record<WorkspaceCanvasNodeKind, WorkspaceCanvasNodeDefinition>

export function getWorkspaceCanvasNodeDefinition<K extends WorkspaceCanvasNodeKind>(
  kind: K,
): (typeof WORKSPACE_CANVAS_NODE_DEFINITIONS)[K] {
  return WORKSPACE_CANVAS_NODE_DEFINITIONS[kind]
}
