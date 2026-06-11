import type { UIMessage, UIMessageStreamWriter } from 'ai'
import type { FlexibleSchema } from '@ai-sdk/provider-utils'
import type { NextRequest } from 'next/server'
import type { ProjectAgentContext, WorkspaceAssistantPartType } from '@/lib/project-agent/types'

export type ProjectAgentOperationId = string

export interface ProjectAgentOperationContext {
  request: NextRequest
  userId: string
  projectId: string
  context: ProjectAgentContext
  /**
   * Operation invocation source (entry semantics).
   * - assistant-panel: initiated by assistant tools in chat
   * - project-ui/api: initiated by explicit GUI/API actions
   */
  source: string
  writer?: UIMessageStreamWriter<UIMessage> | null
  toolCallId?: string | null
}

type BivariantOperationExecute<Input, Output> = {
  bivarianceHack(context: ProjectAgentOperationContext, input: Input): Promise<Output>
}['bivarianceHack']

export type OperationIntent = 'query' | 'plan' | 'act'

export type OperationGroupPath = string[]

export interface OperationPrerequisites {
  episodeId: 'required' | 'optional' | 'forbidden'
}

export interface OperationChannels {
  tool: boolean
  api: boolean
}

export interface OperationEffects {
  writes: boolean
  billable: boolean
  destructive: boolean
  overwrite: boolean
  bulk: boolean
  externalSideEffects: boolean
  longRunning: boolean
}

export interface OperationConfirmation {
  required: boolean
  summary?: string | null
  budget?: {
    key?: string
    estimatedCostUnits?: number
  } | null
}

export type RuntimeSchemaSafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: unknown } }

export type RuntimeSchema<T> = FlexibleSchema<T> & {
  safeParse: (input: unknown) => RuntimeSchemaSafeParseResult<T>
}

export type ProjectAgentToolErrorCode =
  | 'CONFIRMATION_REQUIRED'
  | 'OPERATION_NOT_ALLOWED'
  | 'OPERATION_EXECUTION_FAILED'
  | 'OPERATION_INPUT_INVALID'
  | 'OPERATION_NOT_FOUND'
  | 'OPERATION_PREREQUISITE_MISSING'
  | 'OPERATION_OUTPUT_INVALID'

export interface ProjectAgentToolError {
  code: ProjectAgentToolErrorCode
  message: string
  operationId?: ProjectAgentOperationId
  details?: Record<string, unknown> | null
  issues?: unknown
}

export type ProjectAgentToolResult<T> =
  | {
      ok: true
      data: T
    }
  | {
      ok: false
      confirmationRequired?: boolean
      error: ProjectAgentToolError
    }

export interface ProjectAgentOperationDefinitionBase<Input = unknown, Output = unknown> {
  id: ProjectAgentOperationId
  /**
   * Command-style summary used for tool prompt, logs, and review.
   * Must be a non-empty string after trimming.
   */
  summary: string
  intent: OperationIntent
  groupPath?: OperationGroupPath
  channels?: OperationChannels
  prerequisites?: Partial<OperationPrerequisites>
  effects: OperationEffects
  confirmation?: OperationConfirmation
  inputSchema: RuntimeSchema<Input>
  outputSchema: RuntimeSchema<Output>
  execute: BivariantOperationExecute<Input, Output>
}

export interface ProjectAgentOperationDefinition<Input = unknown, Output = unknown>
  extends ProjectAgentOperationDefinitionBase<Input, Output> {
  groupPath: OperationGroupPath
  channels: OperationChannels
  prerequisites: OperationPrerequisites
  confirmation: OperationConfirmation
}

export type ProjectAgentOperationRegistryDraft = Record<ProjectAgentOperationId, ProjectAgentOperationDefinitionBase>

export type ProjectAgentOperationRegistry = Record<ProjectAgentOperationId, ProjectAgentOperationDefinition>

export function writeOperationDataPart<T>(
  writer: UIMessageStreamWriter<UIMessage> | null | undefined,
  type: WorkspaceAssistantPartType,
  data: T,
) {
  if (!writer) return
  writer.write({
    type,
    data,
  })
}
