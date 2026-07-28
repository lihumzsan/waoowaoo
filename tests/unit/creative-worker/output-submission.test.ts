import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type {
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
} from '@openai/agents'
import {
  buildCreativeWorkerCanonicalOutputSchema,
  createCreativeWorkerOutputSubmission,
  creativeWorkOutputRegistry,
  runCreativeWorker,
} from '@/lib/creative-worker'
import { createCreativeWorkerTools } from '@/lib/creative-worker/tools'
import type {
  CreativeWorkerEvent,
  CreativeWorkRequest,
} from '@/lib/creative-worker/types'

const screenplayRequest: CreativeWorkRequest = {
  outputKind: 'screenplay',
  goal: 'Write the supplied one-scene story.',
  context: {
    userRequest: 'Write one concise scene.',
    sourceMaterials: [],
    constraints: [],
  },
  creativeDirection: null,
  productionContext: { video: null },
}

const validScreenplayOutput = {
  kind: 'screenplay' as const,
  title: 'The Red Observatory',
  logline: 'An astronomer confronts an impossible reflection.',
  synopsis: 'One continuous observatory scene resolves a supernatural warning.',
  screenplayText: 'INT. OBSERVATORY - NIGHT\nMara aligns the telescope and sees her reflection move alone.',
  source: {
    kind: 'generated' as const,
    label: 'Unit test request',
  },
  assumptions: [],
  openQuestions: [],
}

const emptyUsage = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
}

function findStringContaining(value: unknown, token: string): string | null {
  if (typeof value === 'string') return value.includes(token) ? value : null
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringContaining(entry, token)
      if (found) return found
    }
    return null
  }
  if (!value || typeof value !== 'object') return null
  for (const child of Object.values(value)) {
    const found = findStringContaining(child, token)
    if (found) return found
  }
  return null
}

class CorrectingSubmissionModel implements Model {
  readonly requests: ModelRequest[] = []

  async getResponse(): Promise<ModelResponse> {
    throw new Error('NON_STREAMING_MODEL_CALL_FORBIDDEN')
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    this.requests.push(request)
    const ordinal = this.requests.length
    const output = ordinal === 1
      ? [{
          type: 'function_call' as const,
          callId: 'read-story-skill',
          name: 'read_skill',
          arguments: JSON.stringify({ skillId: 'story-development' }),
        }]
      : ordinal === 2
        ? [{
            type: 'function_call' as const,
            callId: 'submit-invalid',
            name: 'submit_result',
            arguments: JSON.stringify({
              output: {
                ...validScreenplayOutput,
                title: '',
              },
            }),
          }]
        : [{
            type: 'function_call' as const,
            callId: 'submit-corrected',
            name: 'submit_result',
            arguments: JSON.stringify({
              output: validScreenplayOutput,
            }),
          }]
    yield { type: 'response_started' }
    yield {
      type: 'response_done',
      response: {
        id: `response-${String(ordinal)}`,
        usage: emptyUsage,
        output,
      },
    }
  }
}

describe('Creative Worker result submission contract', () => {
  it('supplies the complete canonical JSON Schema as model input data without removing business limits', () => {
    const schema = z.object({
      kind: z.literal('screenplay'),
      title: z.string().min(3).max(80),
      beats: z.array(z.number().int().min(2).max(8)).min(2).max(4),
    }).strict()

    const document = buildCreativeWorkerCanonicalOutputSchema({
      kind: 'screenplay',
      schema,
    })

    expect(document).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'title', 'beats'],
      properties: {
        title: { type: 'string', minLength: 3, maxLength: 80 },
        beats: {
          type: 'array',
          minItems: 2,
          maxItems: 4,
          items: {
            type: 'integer',
            minimum: 2,
            maximum: 8,
          },
        },
      },
    })

    for (const definition of Object.values(creativeWorkOutputRegistry)) {
      expect(buildCreativeWorkerCanonicalOutputSchema(definition)).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: expect.any(Object),
        },
      })
    }
  })

  it('rejects invalid output with field issues and accepts a corrected submission through one validator', () => {
    const submission = createCreativeWorkerOutputSubmission({
      request: screenplayRequest,
      definition: creativeWorkOutputRegistry.screenplay,
      maxOutputChars: 120_000,
    })

    expect(submission.submit({
      ...validScreenplayOutput,
      title: '',
    })).toMatchObject({
      accepted: false,
      code: 'CREATIVE_WORK_OUTPUT_INVALID',
      issues: [{
        path: '$.title',
        code: 'too_small',
      }],
    })

    expect(submission.submit(validScreenplayOutput)).toEqual({
      accepted: true,
      outputKind: 'screenplay',
      outputChars: JSON.stringify(validScreenplayOutput).length,
    })
    expect(submission.readAcceptedOutput()).toEqual(validScreenplayOutput)
  })

  it('uses the same submission boundary for frozen contextual video constraints', () => {
    const imageResourceId = 'r_AAAAAAAAAAAAAAAAAAAAAA'
    const audioResourceId = 'r_BBBBBBBBBBBBBBBBBBBBBB'
    const request: CreativeWorkRequest = {
      outputKind: 'video_prompt_set',
      goal: 'Build two executable generation segments.',
      durationIntent: { mode: 'fixed', seconds: 10 },
      context: {
        userRequest: 'Make a ten-second video.',
        sourceMaterials: [
          {
            label: 'Hero portrait',
            kind: 'image',
            content: 'The exact approved hero appearance.',
            provenance: { kind: 'resource', resourceId: imageResourceId },
          },
          {
            label: 'Hero voice',
            kind: 'audio',
            content: 'The exact approved hero voice.',
            provenance: { kind: 'resource', resourceId: audioResourceId },
          },
        ],
        constraints: [],
      },
      creativeDirection: null,
      productionContext: {
        video: {
          aspectRatio: '16:9',
          allowedSegmentDurationsSeconds: [4, 6],
          minSegmentDurationSeconds: 4,
          maxSegmentDurationSeconds: 6,
          maxReferenceImages: 4,
          maxReferenceAudios: 1,
        },
      },
    }
    const submission = createCreativeWorkerOutputSubmission({
      request,
      definition: creativeWorkOutputRegistry.video_prompt_set,
      maxOutputChars: 120_000,
    })

    expect(submission.submit({
      kind: 'video_prompt_set',
      segments: [
        { key: 'same-key', durationSeconds: 4, prompt: 'First action.', mediaResourceIds: [] },
        { key: 'same-key', durationSeconds: 4, prompt: 'Second action.', mediaResourceIds: [] },
      ],
    })).toMatchObject({
      accepted: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          path: '$.segments[1].key',
          code: 'duplicate',
        }),
        expect.objectContaining({
          path: '$.segments',
          code: 'duration_total_mismatch',
        }),
      ]),
    })

    const validVideoOutput = {
      kind: 'video_prompt_set',
      segments: [
        {
          key: 'opening',
          durationSeconds: 4,
          prompt: 'First action.',
          mediaResourceIds: [imageResourceId, audioResourceId],
        },
        {
          key: 'ending',
          durationSeconds: 6,
          prompt: 'Second action.',
          mediaResourceIds: [imageResourceId],
        },
      ],
    } as const
    expect(submission.submit(validVideoOutput)).toEqual({
      accepted: true,
      outputKind: 'video_prompt_set',
      outputChars: JSON.stringify(validVideoOutput).length,
    })
  })

  it('rejects guessed, duplicate, and audio-only Prompt Set Resource references', () => {
    const imageResourceId = 'r_AAAAAAAAAAAAAAAAAAAAAA'
    const audioResourceId = 'r_BBBBBBBBBBBBBBBBBBBBBB'
    const request: CreativeWorkRequest = {
      outputKind: 'video_prompt_set',
      goal: 'Build one executable video segment.',
      durationIntent: { mode: 'fixed', seconds: 4 },
      context: {
        userRequest: 'Make a four-second video.',
        sourceMaterials: [
          {
            label: 'Hero portrait',
            kind: 'image',
            content: 'The exact approved hero appearance.',
            provenance: { kind: 'resource', resourceId: imageResourceId },
          },
          {
            label: 'Hero voice',
            kind: 'audio',
            content: 'The exact approved hero voice.',
            provenance: { kind: 'resource', resourceId: audioResourceId },
          },
        ],
        constraints: [],
      },
      creativeDirection: null,
      productionContext: {
        video: {
          aspectRatio: '16:9',
          allowedSegmentDurationsSeconds: [4],
          minSegmentDurationSeconds: 4,
          maxSegmentDurationSeconds: 4,
          maxReferenceImages: 4,
          maxReferenceAudios: 1,
        },
      },
    }

    for (const mediaResourceIds of [
      ['r_CCCCCCCCCCCCCCCCCCCCCC'],
      [imageResourceId, imageResourceId],
      [audioResourceId],
    ]) {
      const submission = createCreativeWorkerOutputSubmission({
        request,
        definition: creativeWorkOutputRegistry.video_prompt_set,
        maxOutputChars: 120_000,
      })
      expect(submission.submit({
        kind: 'video_prompt_set',
        segments: [{
          key: 'only',
          durationSeconds: 4,
          prompt: 'One exact executable segment.',
          mediaResourceIds,
        }],
      })).toMatchObject({
        accepted: false,
        code: 'CREATIVE_WORK_OUTPUT_INVALID',
      })
    }
  })

  it('gives submit_result a direct structured output object derived from the canonical schema', () => {
    const accept = () => ({
      accepted: true as const,
      outputKind: 'screenplay' as const,
      outputChars: 1,
    })
    const screenplaySubmission = createCreativeWorkerOutputSubmission({
      request: screenplayRequest,
      definition: creativeWorkOutputRegistry.screenplay,
      maxOutputChars: 120_000,
    })
    const withoutSearch = createCreativeWorkerTools({
      workerTools: [],
      professionalSkillId: 'story-development',
      submissionToolSchema: screenplaySubmission.toolSchema,
      submitOutput: accept,
    }).find((tool) => tool.name === 'submit_result')
    const withSearch = createCreativeWorkerTools({
      workerTools: ['web_search'],
      professionalSkillId: 'story-development',
      submissionToolSchema: screenplaySubmission.toolSchema,
      submitOutput: accept,
    }).find((tool) => tool.name === 'submit_result')
    if (withoutSearch?.type !== 'function' || withSearch?.type !== 'function') {
      throw new Error('SUBMIT_RESULT_FUNCTION_TOOL_REQUIRED')
    }

    expect(withoutSearch?.parameters).toEqual(withSearch?.parameters)
    expect(withoutSearch).toMatchObject({
      type: 'function',
      name: 'submit_result',
      strict: true,
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['output'],
        properties: {
          output: {
            type: 'object',
            additionalProperties: false,
            required: [
              'kind',
              'title',
              'logline',
              'synopsis',
              'screenplayText',
              'source',
              'assumptions',
              'openQuestions',
            ],
          },
        },
      },
    })
  })

  it('bounds model-visible validation issues', () => {
    const submission = createCreativeWorkerOutputSubmission({
      request: {
        ...screenplayRequest,
        outputKind: 'asset_manifest',
      },
      definition: creativeWorkOutputRegistry.asset_manifest,
      maxOutputChars: 120_000,
    })

    const result = submission.submit({
      kind: 'asset_manifest',
      overview: 'Manifest overview.',
      assets: Array.from({ length: 100 }, () => ({})),
      assumptions: [],
      warnings: [],
    })
    expect(result.accepted).toBe(false)
    if (result.accepted) return
    expect(result.issues).toHaveLength(64)
    expect(result.issues.every((issue) => issue.message.length <= 500)).toBe(true)
  })

  it('returns canonical field errors to the model and accepts its correction in the same Worker run', async () => {
    const model = new CorrectingSubmissionModel()
    const events: CreativeWorkerEvent[] = []
    const result = await runCreativeWorker({
      model,
      signal: new AbortController().signal,
      request: screenplayRequest,
      onEvent: (event) => {
        events.push(event)
      },
    })

    expect(result.output).toEqual(validScreenplayOutput)
    expect(model.requests).toHaveLength(3)
    expect(model.requests.every((request) => (
      request.modelSettings.toolChoice === 'required'
      && request.outputType === 'text'
    ))).toBe(true)

    const serializedWorkerInput = findStringContaining(
      model.requests[0]?.input,
      '"outputSubmission"',
    )
    expect(serializedWorkerInput).not.toBeNull()
    if (!serializedWorkerInput) return
    const workerInput = JSON.parse(serializedWorkerInput) as {
      outputSubmission?: {
        toolName?: unknown
        outputSchema?: Record<string, unknown>
      }
    }
    expect(workerInput.outputSubmission?.toolName).toBe('submit_result')
    expect(workerInput.outputSubmission?.outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
    })

    expect(JSON.stringify(model.requests[2]?.input)).toContain('CREATIVE_WORK_OUTPUT_INVALID')
    expect(JSON.stringify(model.requests[2]?.input)).toContain('$.title')
    expect(events.filter((event) => event.kind === 'submission_rejected')).toHaveLength(1)
    expect(events.filter((event) => event.kind === 'submission_accepted')).toHaveLength(1)
    expect(events.flatMap((event) => (
      event.kind === 'generation' && event.status === 'running'
        ? [event.phase]
        : []
    ))).toEqual([
      'preparing',
      'creating_output',
      'correcting_output',
    ])
  })
})
