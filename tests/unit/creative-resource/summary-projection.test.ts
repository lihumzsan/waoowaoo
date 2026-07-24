import { describe, expect, it } from 'vitest'
import type {
  CreativeResourceRevisionContent,
  CreativeResourceView,
} from '@/lib/creative-resource/contracts'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { projectCreativeResourceSummary } from '@/lib/creative-resource/summary-projection'

function resourceView(input: {
  readonly schemaId: string
  readonly content: CreativeResourceRevisionContent | null
  readonly pendingPrompt?: string | null
  readonly mediaType?: CreativeResourceView['mediaType']
}): CreativeResourceView {
  return {
    resourceId: 'resource-1',
    origin: null,
    scope: {
      kind: 'project',
      id: 'project-1',
      userId: 'user-1',
      projectId: 'project-1',
      episodeId: null,
    },
    mediaType: input.mediaType ?? 'text',
    schemaId: input.schemaId,
    name: 'Resource',
    status: input.content ? 'ready' : 'pending',
    candidateSetId: null,
    candidateIndex: null,
    creativeDataVersion: 0,
    creativeDataKeys: [],
    headRevision: input.content
      ? {
          revisionId: 'revision-1',
          revision: 1,
          content: input.content,
          provenance: {
            operationId: null,
            inputHash: null,
            taskId: null,
            operationExecutionId: null,
            executionSegmentId: null,
            toolCallId: null,
            prompt: null,
            modelKey: null,
            generationOptions: null,
          },
          inputs: [],
          createdAt: '2026-07-24T00:00:00.000Z',
        }
      : null,
    pendingGeneration: input.pendingPrompt
      ? {
          taskId: 'task-1',
          operationId: null,
          prompt: input.pendingPrompt,
          modelKey: null,
          generationOptions: null,
          inputs: [],
        }
      : null,
    bindings: [],
    error: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:00.000Z',
  }
}

describe('Creative Resource summary projection', () => {
  it('uses the registered semantic field for structured content', () => {
    const resource = resourceView({
      schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
      content: {
        kind: 'structured',
        data: {
          styleSummary: 'Ink animation with restrained motion.',
          visual: {
            visualStyle: 'Full structured detail is not the collapsed summary.',
          },
        },
      },
    })

    expect(projectCreativeResourceSummary(resource)).toEqual({
      kind: 'text',
      text: 'Ink animation with restrained motion.',
    })
  })

  it('falls back from screenplay semantics to the beginning of its structured text', () => {
    const resource = resourceView({
      schemaId: CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
      content: {
        kind: 'structured',
        data: {
          logline: null,
          synopsis: '',
          screenplayText: 'INT. STATION — NIGHT\nThe last train arrives.',
        },
      },
    })

    expect(projectCreativeResourceSummary(resource)).toEqual({
      kind: 'text',
      text: 'INT. STATION — NIGHT\nThe last train arrives.',
    })
  })

  it('returns a neutral structural fallback without exposing raw JSON keys', () => {
    const resource = resourceView({
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_TEXT,
      content: {
        kind: 'structured',
        data: {
          internalKey: 'value',
          anotherInternalKey: true,
        },
      },
    })

    expect(projectCreativeResourceSummary(resource)).toEqual({
      kind: 'structured',
      entryCount: 2,
    })
  })

  it('uses the frozen prompt while a Resource has no head Revision', () => {
    const resource = resourceView({
      schemaId: CREATIVE_RESOURCE_SCHEMA.GENERIC_IMAGE,
      mediaType: 'image',
      content: null,
      pendingPrompt: 'A lantern in heavy rain.',
    })

    expect(projectCreativeResourceSummary(resource)).toEqual({
      kind: 'text',
      text: 'A lantern in heavy rain.',
    })
  })
})
