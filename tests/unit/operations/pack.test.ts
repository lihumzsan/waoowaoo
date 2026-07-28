import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { withOperationPack } from '@/lib/operations/pack'
import type { OperationPackDefaults } from '@/lib/operations/pack'
import type {
  OperationChannels,
  OperationEffects,
  OperationToolExposure,
  ProjectAgentOperationDefinitionBase,
  ProjectAgentOperationRegistryDraft,
  ProjectAgentToolInputSchema,
} from '@/lib/operations/types'

const NOOP_EFFECTS: OperationEffects = {
  writes: false,
  billable: false,
  destructive: false,
  overwrite: false,
  bulk: false,
  externalSideEffects: false,
  longRunning: false,
}

function createNoopOperation(params: {
  id: string
  groupPath?: string[]
  channels?: OperationChannels
  toolExposure?: OperationToolExposure
  bindToolInputSchema?: boolean
  toolInputSchema?: ProjectAgentToolInputSchema
}): ProjectAgentOperationDefinitionBase<unknown, unknown> {
  return {
    id: params.id,
    summary: params.id,
    intent: 'act',
    groupPath: params.groupPath,
    channels: params.channels,
    toolExposure: params.toolExposure,
    ...(params.bindToolInputSchema
      ? {
          bindToolInputSchema: async () => ({
            inputSchema: z.object({}).strict(),
          }),
        }
      : {}),
    toolInputSchema: params.toolInputSchema,
    effects: NOOP_EFFECTS,
    confirmation: { kind: 'none', required: false },
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async () => null,
  }
}

describe('withOperationPack', () => {
  it('throws when operation groupPath folder differs from pack defaults', () => {
    const draft: ProjectAgentOperationRegistryDraft = {
      ok: createNoopOperation({ id: 'ok', groupPath: ['asset', 'edit'] }),
      bad: createNoopOperation({ id: 'bad', groupPath: ['unknown', 'edit'] }),
    }

    const defaults: OperationPackDefaults = {
      groupPath: ['asset', 'edit'],
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'optional' },
      confirmation: { kind: 'none', required: false },
    }

    expect(() => withOperationPack(draft, defaults)).toThrow(
      /PROJECT_AGENT_OPERATION_GROUP_PATH_FOLDER_MISMATCH:operationId=bad:/,
    )
  })

  it('uses default groupPath when operation groupPath is omitted', () => {
    const draft: ProjectAgentOperationRegistryDraft = {
      ok: createNoopOperation({ id: 'ok' }),
    }

    const defaults: OperationPackDefaults = {
      groupPath: ['project', 'read'],
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'optional' },
      confirmation: { kind: 'none', required: false },
    }

    const registry = withOperationPack(draft, defaults)
    expect(registry.ok.groupPath).toEqual(['project', 'read'])
  })

  it('allows groupPath overrides only under the pack groupPath prefix', () => {
    const draft: ProjectAgentOperationRegistryDraft = {
      ok: createNoopOperation({ id: 'ok', groupPath: ['asset', 'edit', 'character'] }),
    }

    const defaults: OperationPackDefaults = {
      groupPath: ['asset', 'edit'],
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'optional' },
      confirmation: { kind: 'none', required: false },
    }

    const registry = withOperationPack(draft, defaults)
    expect(registry.ok.groupPath).toEqual(['asset', 'edit', 'character'])
  })

  it('throws with an actionable message when groupPath drifts across sibling groups', () => {
    const draft: ProjectAgentOperationRegistryDraft = {
      bad: createNoopOperation({ id: 'bad', groupPath: ['asset-hub', 'prop-library'] }),
    }

    const defaults: OperationPackDefaults = {
      groupPath: ['asset-hub', 'character'],
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'optional' },
      confirmation: { kind: 'none', required: false },
    }

    expect(
      () => withOperationPack(draft, defaults),
      'If this fails, it likely means a refactor accidentally moved an operation into the wrong groupPath, causing tools to be injected under the wrong prompt section.',
    ).toThrow(/reason=operation groupPath must start with pack groupPath/)
  })

  it('allows dynamic schema binders only on tool-visible on-demand operations', () => {
    const defaults: OperationPackDefaults = {
      groupPath: ['asset', 'edit'],
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'optional' },
      confirmation: { kind: 'none', required: false },
    }

    expect(() => withOperationPack({
      no_tool_channel: createNoopOperation({
        id: 'no_tool_channel',
        channels: { tool: false, api: true },
        bindToolInputSchema: true,
      }),
    }, defaults)).toThrow(
      'PROJECT_AGENT_OPERATION_BOUND_TOOL_CHANNEL_REQUIRED:no_tool_channel',
    )

    expect(() => withOperationPack({
      direct_tool: createNoopOperation({
        id: 'direct_tool',
        toolExposure: 'direct',
        bindToolInputSchema: true,
      }),
    }, defaults)).toThrow(
      'PROJECT_AGENT_OPERATION_BOUND_TOOL_ON_DEMAND_REQUIRED:direct_tool',
    )
  })

  it('rejects a second hand-authored JSON schema beside a dynamic runtime binder', () => {
    const defaults: OperationPackDefaults = {
      groupPath: ['asset', 'edit'],
      channels: { tool: true, api: false },
      prerequisites: { episodeId: 'optional' },
      confirmation: { kind: 'none', required: false },
    }
    const explicitSchema: ProjectAgentToolInputSchema = {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    }

    expect(() => withOperationPack({
      ambiguous: createNoopOperation({
        id: 'ambiguous',
        bindToolInputSchema: true,
        toolInputSchema: explicitSchema,
      }),
    }, defaults)).toThrow(
      'PROJECT_AGENT_OPERATION_BOUND_TOOL_SCHEMA_AMBIGUOUS:ambiguous',
    )
  })
})
