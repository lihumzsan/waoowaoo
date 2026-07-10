import type {
  OperationChannels,
  OperationConfirmation,
  OperationEffects,
  OperationAgentFlow,
  OperationGroupPath,
  OperationIntent,
  OperationPrerequisites,
  ProjectAgentOperationContext,
  ProjectAgentOperationDefinition,
  RuntimeSchema,
} from '@/lib/operations/types'
import { createProjectAgentToolInputSchema } from '@/lib/operations/tool-input-schema'

export const EFFECTS_NONE: OperationEffects = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
}

export const EFFECTS_WRITE: OperationEffects = {
  ...EFFECTS_NONE,
  writes: true,
}

export const EFFECTS_BILLABLE: OperationEffects = {
  ...EFFECTS_NONE,
  billable: true,
  externalSideEffects: true,
  longRunning: true,
}

export function makeTestOperation<Input, Output>(params: {
  id: string
  summary?: string
  intent?: OperationIntent
  groupPath?: OperationGroupPath
  channels?: OperationChannels
  prerequisites?: OperationPrerequisites
  effects?: OperationEffects
  confirmation?: OperationConfirmation
  agentFlow?: OperationAgentFlow
  inputSchema: RuntimeSchema<Input>
  outputSchema: RuntimeSchema<Output>
  plan?: ProjectAgentOperationDefinition<Input, Output>['plan']
  commit?: ProjectAgentOperationDefinition<Input, Output>['commit']
  execute?: (ctx: ProjectAgentOperationContext, input: Input) => Promise<Output>
}): ProjectAgentOperationDefinition<Input, Output> {
  const confirmation = params.confirmation ?? {
    kind: 'none' as const,
    required: false,
  }
  const common = {
    id: params.id,
    summary: params.summary ?? `Test operation: ${params.id}`,
    intent: params.intent ?? 'query',
    groupPath: params.groupPath ?? ['test'],
    channels: params.channels ?? { tool: true, api: true },
    prerequisites: params.prerequisites ?? { episodeId: 'optional' },
    effects: params.effects ?? EFFECTS_NONE,
    confirmation,
    ...(params.agentFlow ? { agentFlow: params.agentFlow } : {}),
    toolInputSchema: createProjectAgentToolInputSchema({
      operationId: params.id,
      inputSchema: params.inputSchema as RuntimeSchema<unknown>,
    }),
    inputSchema: params.inputSchema,
    outputSchema: params.outputSchema,
    ...(params.plan ? { plan: params.plan } : {}),
    ...(params.commit ? { commit: params.commit } : {}),
  }
  if (confirmation.kind === 'billable_media') {
    if (!params.plan || !params.commit || params.execute) {
      throw new Error(`TEST_BILLABLE_OPERATION_MUST_BE_PLAN_COMMIT_ONLY:${params.id}`)
    }
    return common as ProjectAgentOperationDefinition<Input, Output>
  }
  if (!params.execute) throw new Error(`TEST_DIRECT_OPERATION_EXECUTOR_REQUIRED:${params.id}`)
  return {
    ...common,
    execute: params.execute,
  } as ProjectAgentOperationDefinition<Input, Output>
}
