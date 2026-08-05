import type {
  OperationApprovalKind,
  OperationChannels,
  OperationChannelsDraft,
  OperationConfirmation,
  OperationGroupPath,
  ProjectAgentToolInputSchema,
  ProjectAgentOperationRegistry,
  ProjectAgentOperationRegistryDraft,
} from './types'
import { createProjectAgentToolInputSchema } from './tool-input-schema'

export interface OperationPackDefaults {
  groupPath: OperationGroupPath
  channels: OperationChannelsDraft
  confirmation: OperationConfirmation
}

function normalizeGroupPath(groupPath: OperationGroupPath): OperationGroupPath {
  const normalized = groupPath.map((segment) => segment.trim()).filter((segment) => segment.length > 0)
  if (normalized.length === 0) {
    throw new Error('PROJECT_AGENT_OPERATION_GROUP_PATH_EMPTY')
  }
  return normalized
}

function normalizeOperationSummary(operation: { id: string; summary: string }): string {
  const trimmed = operation.summary.trim()
  if (!trimmed) {
    throw new Error(`PROJECT_AGENT_OPERATION_SUMMARY_MISSING:${String(operation.id)}`)
  }
  return trimmed
}

function normalizeChannels(channels: OperationChannelsDraft): OperationChannels {
  return {
    tool: channels.tool === true,
    api: channels.api === true,
    mcp: channels.mcp === true,
  }
}

function mergeConfirmation(
  operation: {
    confirmation?: Omit<OperationConfirmation, 'kind'> & {
      kind?: OperationApprovalKind
    }
    effects: { billable: boolean; destructive: boolean; overwrite: boolean }
  },
  defaults: OperationPackDefaults,
): OperationConfirmation {
  const base = operation.confirmation ?? defaults.confirmation
  const required = base.required === true
  const kind =
    base.kind ??
    (!required
      ? 'none'
      : operation.effects.destructive || operation.effects.overwrite
        ? 'destructive'
        : operation.effects.billable
          ? 'billable_media'
          : 'destructive')
  return {
    kind,
    required,
    summary: base.summary ?? null,
    budget: base.budget ?? null,
  }
}

function createEmptyToolInputSchema(): ProjectAgentToolInputSchema {
  return {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  }
}

function assertOperationFolderGroupConsistency(params: {
  operationId: string
  groupPath: OperationGroupPath
  defaultsGroupPath: OperationGroupPath
}): void {
  const operationPath = params.groupPath
  const defaultsPath = params.defaultsGroupPath

  if (operationPath.length < defaultsPath.length) {
    throw new Error(
      [
        'PROJECT_AGENT_OPERATION_GROUP_PATH_FOLDER_MISMATCH',
        `operationId=${params.operationId}`,
        `operationGroupPath=${operationPath.join('/')}`,
        `packGroupPath=${defaultsPath.join('/')}`,
        'reason=operation groupPath must start with pack groupPath to avoid cross-pack semantic drift',
      ].join(':'),
    )
  }

  for (let i = 0; i < defaultsPath.length; i += 1) {
    if (operationPath[i] !== defaultsPath[i]) {
      throw new Error(
        [
          'PROJECT_AGENT_OPERATION_GROUP_PATH_FOLDER_MISMATCH',
          `operationId=${params.operationId}`,
          `operationGroupPath=${operationPath.join('/')}`,
          `packGroupPath=${defaultsPath.join('/')}`,
          'reason=operation groupPath must start with pack groupPath to avoid cross-pack semantic drift',
        ].join(':'),
      )
    }
  }
}

export function withOperationPack(
  registry: ProjectAgentOperationRegistryDraft,
  defaults: OperationPackDefaults,
): ProjectAgentOperationRegistry {
  const normalizedDefaults: OperationPackDefaults = {
    groupPath: normalizeGroupPath(defaults.groupPath),
    channels: normalizeChannels(defaults.channels),
    confirmation: defaults.confirmation,
  }

  const out: ProjectAgentOperationRegistry = {}
  for (const [operationId, operation] of Object.entries(registry)) {
    const groupPath = normalizeGroupPath(operation.groupPath ?? normalizedDefaults.groupPath)
    assertOperationFolderGroupConsistency({
      operationId,
      groupPath,
      defaultsGroupPath: normalizedDefaults.groupPath,
    })
    const channels = normalizeChannels(operation.channels ?? normalizedDefaults.channels)
    const planContractRevision = 'planContractRevision' in operation
      ? operation.planContractRevision
      : undefined
    const toolContractRevision =
      channels.tool && operation.effects.writes
        ? operation.confirmation?.kind === 'billable_media'
          ? planContractRevision
          : operation.assistantWriteAuthority?.kind
              === 'temporal_operation_execution'
            ? operation.assistantWriteAuthority.contractRevision
            : operation.toolContractRevision
        : null
    const toolExposure = operation.toolExposure ?? 'on_demand'
    if (toolExposure === 'direct' && !channels.tool) {
      throw new Error(`PROJECT_AGENT_OPERATION_DIRECT_TOOL_CHANNEL_REQUIRED:${operationId}`)
    }
    const normalized = {
      ...operation,
      summary: normalizeOperationSummary(operation),
      groupPath,
      channels,
      toolExposure,
      // Recoverable is the safe default: shedding a re-issuable read or a
      // receipt whose outcome survives costs at most one extra call. Only a
      // result that exists nowhere else must opt out.
      modelResultRetention: operation.modelResultRetention ?? 'recoverable',
      confirmation: mergeConfirmation(operation, normalizedDefaults),
      resourceContract: operation.resourceContract ?? {
        kind: 'none' as const,
        reason: 'operation does not create a Creative Resource',
      },
      toolContractRevision,
      toolInputSchema: channels.tool
        ? createProjectAgentToolInputSchema({
            operationId,
            inputSchema: operation.toolInputCanonicalizer?.inputSchema ?? operation.inputSchema,
            explicitToolInputSchema: operation.toolInputSchema,
          })
        : createEmptyToolInputSchema(),
    }
    out[operationId] = normalized as ProjectAgentOperationRegistry[string]
  }
  return out
}
