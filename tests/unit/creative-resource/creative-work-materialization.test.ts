import { describe, expect, it } from 'vitest'
import { planCreativeWorkResourceMaterialization } from '@/lib/creative-resource/creative-work-materialization'
import { CREATIVE_RESOURCE_SCHEMA } from '@/lib/creative-resource/schema-registry'
import { screenplaySchema } from '@/lib/screenplay'
import {
  CREATIVE_WORK_TASK_PROTOCOL,
  creativeWorkOutputSchemas,
  type CreativeWorkRequest,
} from '@/lib/creative-worker'

type TestOutputKind = 'screenplay' | 'creative_direction' | 'chapter_plan' | 'asset_manifest'

const creativeDirection = {
  rawUserStyle: null,
  styleSummary: 'Ink and paper animation',
  visual: {
    visualStyle: 'Hand-painted ink animation with restrained motion.',
    assetImageStyle: {
      lighting: 'Soft directional light',
      texture: 'Fibrous paper',
    },
  },
  narrative: 'Reveal information through observed behavior and withheld context.',
  directing: 'Prefer locked compositions; move only when character motion motivates it.',
  editing: 'Use measured hard cuts and reserve dissolves for explicit time shifts.',
  sound: 'Keep a dry room tone, close voices, and intentional silence.',
  assetPolicy: 'Design reusable silhouettes and preserve paper texture across assets.',
}

function taskPayload(
  outputKind: TestOutputKind,
  sourceMaterials: CreativeWorkRequest['context']['sourceMaterials'] = [{
    label: 'Exact source',
    kind: 'text',
    content: 'source text',
    provenance: {
      kind: 'resource',
      revisionId: 'source-revision',
    },
  }],
  injectedDirection: CreativeWorkRequest['creativeDirection'] = null,
) {
  return {
    protocol: CREATIVE_WORK_TASK_PROTOCOL,
    requestKey: 'request-1',
    request: {
      outputKind,
      goal: 'Create the requested work.',
      context: {
        userRequest: 'Please create it.',
        sourceMaterials,
        constraints: [],
      },
      creativeDirection: injectedDirection,
      productionContext: { video: null },
    },
    modelKey: 'provider:model',
    inputFingerprint: 'input-fingerprint',
    origin: { runId: 'run-1', toolCallId: 'tool-call-1' },
    lifecycleProjection: {
      requestKey: 'request-1',
      outputKind,
      goal: 'Create the requested work.',
      events: [],
    },
  }
}

function taskResult(
  outputKind: TestOutputKind,
  output: Record<string, unknown>,
) {
  const lifecycleProjection = {
    requestKey: 'request-1',
    outputKind,
    goal: 'Create the requested work.',
    events: [],
  }
  return {
    requestKey: 'request-1',
    outputKind,
    summary: 'done',
    continuationProjection: {
      requestKey: 'request-1',
      outputKind,
      summary: 'done',
    },
    lifecycleProjection,
    creativeWorkResult: {
      outputKind,
      output,
      skillTrace: [],
      metrics: {
        readCalls: 0,
        skillContentChars: 0,
        webSearchCalls: outputKind === 'creative_direction' ? 2 : 0,
        webSearchSources: outputKind === 'creative_direction' ? 2 : 0,
      },
      budgets: {
        maxTurns: 8,
        maxReadCalls: 12,
        maxWebSearchCalls: 4,
        maxSkillContentChars: 80_000,
        maxSingleSkillResourceChars: 24_000,
        maxInputChars: 300_000,
        maxOutputChars: 120_000,
      },
      research: outputKind === 'creative_direction'
        ? {
            status: 'completed',
            provider: 'tavily',
            notice: null,
            budget: { maxCalls: 4, usedCalls: 2 },
            queries: [{
              ordinal: 1,
              query: 'analog horror directing grammar',
              status: 'completed',
              searchDepth: 'advanced',
              topic: 'general',
              sources: [{
                title: 'Analog horror reference',
                url: 'https://example.com/analog-horror',
              }],
            }, {
              ordinal: 2,
              query: 'analog horror community anti patterns',
              status: 'completed',
              searchDepth: 'basic',
              topic: 'general',
              sources: [{
                title: 'Community discussion',
                url: 'https://example.com/community',
              }],
            }],
          }
        : null,
    },
  }
}

describe('Creative Task Resource materialization planning', () => {
  it('accepts a model-authored variable candidate set without preview-image prompts', () => {
    const candidates = ['ink', 'paper_cut', 'stylized_3d', 'charcoal'].map((candidateKey) => ({
      candidateKey,
      title: candidateKey,
      summary: `${candidateKey} summary`,
      creativeDirection: { ...creativeDirection, styleSummary: candidateKey },
    }))
    const output = creativeWorkOutputSchemas.creative_direction.parse({
      kind: 'creative_direction',
      design: { mode: 'candidates', candidates },
      assumptions: [],
      warnings: [],
    })

    const plan = planCreativeWorkResourceMaterialization({
      taskId: 'style-task',
      payload: taskPayload('creative_direction'),
      result: taskResult('creative_direction', output),
    })

    expect(plan.resourceScope).toBe('project')
    expect(plan.outputs).toHaveLength(4)
    expect(plan.outputs.map((candidate) => candidate.candidateKey)).toEqual([
      'ink',
      'paper_cut',
      'stylized_3d',
      'charcoal',
    ])
    expect(plan.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        schemaId: CREATIVE_RESOURCE_SCHEMA.CREATIVE_DIRECTION,
        candidateSetId: 'style-task',
      }),
    ]))
    expect(JSON.stringify(plan)).not.toContain('gridImagePrompt')
    expect(plan.outputs[0]?.generationOptions).toMatchObject({
      research: {
        status: 'completed',
        provider: 'tavily',
        queries: expect.arrayContaining([
          expect.objectContaining({
            query: 'analog horror directing grammar',
            sources: [expect.objectContaining({
              url: 'https://example.com/analog-horror',
            })],
          }),
        ]),
      },
    })
  })

  it('rejects duplicate model-authored candidate keys', () => {
    const candidate = {
      candidateKey: 'ink',
      title: 'Ink',
      summary: 'Ink summary',
      creativeDirection,
    }
    expect(() => creativeWorkOutputSchemas.creative_direction.parse({
      kind: 'creative_direction',
      design: { mode: 'candidates', candidates: [candidate, candidate] },
      assumptions: [],
      warnings: [],
    })).toThrow('CREATIVE_DIRECTION_CANDIDATE_KEY_DUPLICATE')
  })

  it('projects a screenplay as one exact source-script revision plan with Task lineage', () => {
    const screenplayText = 'INT. STATION — NIGHT\nThe doors close behind the traveler.'
    const output = creativeWorkOutputSchemas.screenplay.parse({
      kind: 'screenplay',
      title: 'The Station',
      logline: null,
      synopsis: 'A traveler enters an abandoned station.',
      screenplayText,
      source: { kind: 'generated', label: 'Creative Task' },
      assumptions: [],
      openQuestions: [],
    })

    const plan = planCreativeWorkResourceMaterialization({
      taskId: 'screenplay-task',
      payload: taskPayload('screenplay'),
      result: taskResult('screenplay', output),
    })

    expect(plan).toMatchObject({
      resourceScope: 'project',
      inputFingerprint: 'input-fingerprint',
      modelKey: 'provider:model',
      toolCallId: 'tool-call-1',
      inputs: [{
        revisionId: 'source-revision',
      }],
      outputs: [{
        schemaId: CREATIVE_RESOURCE_SCHEMA.SCREENPLAY,
        sourceType: 'CreativeWorkResult',
        sourceId: 'screenplay-task',
        candidateKey: null,
        content: {
          kind: 'structured',
          data: expect.objectContaining({
            kind: 'screenplay',
            screenplayText,
          }),
        },
      }],
    })
  })

  it('materializes a Chapter plan as a Resource with exact screenplay lineage', () => {
    const output = creativeWorkOutputSchemas.chapter_plan.parse({
      kind: 'chapter_plan',
      rationale: 'Two complete narrative movements can run as bounded production contexts.',
      chapters: [
        {
          chapterIndex: 0,
          title: 'Arrival',
          summary: 'The traveler enters the station.',
          sourceStart: 0,
          sourceEnd: 30,
          targetDurationSec: 90,
        },
        {
          chapterIndex: 1,
          title: 'Departure',
          summary: 'The traveler escapes after the reveal.',
          sourceStart: 31,
          sourceEnd: 70,
          targetDurationSec: 120,
        },
      ],
      assumptions: [],
      warnings: [],
    })

    const plan = planCreativeWorkResourceMaterialization({
      taskId: 'chapter-plan-task',
      payload: taskPayload('chapter_plan'),
      result: taskResult('chapter_plan', output),
    })

    expect(plan).toMatchObject({
      resourceScope: 'episode',
      inputs: [{
        revisionId: 'source-revision',
      }],
      outputs: [{
        schemaId: CREATIVE_RESOURCE_SCHEMA.CHAPTER_PLAN,
        sourceType: 'CreativeWorkResult',
        sourceId: 'chapter-plan-task',
        content: { kind: 'structured', data: output },
      }],
    })
  })

  it('materializes one source-grounded asset manifest with the server-frozen Creative Direction lineage without generating images', () => {
    const screenplayText = 'INT. STATION — NIGHT\nThe traveler holds a letter.'
    const screenplay = screenplaySchema.parse({
      kind: 'screenplay',
      title: 'The Station',
      logline: null,
      synopsis: 'A traveler arrives with a letter.',
      screenplayText,
      source: { kind: 'generated', label: 'Creative Task' },
      assumptions: [],
      openQuestions: [],
    })
    const output = creativeWorkOutputSchemas.asset_manifest.parse({
      kind: 'asset_manifest',
      overview: 'Only reusable production assets grounded in the screenplay.',
      assets: [{
        kind: 'character',
        canonicalName: 'Traveler',
        aliases: [],
        sourceRefs: [{
          sourceExcerpt: 'The traveler holds a letter.',
          reason: 'The speaking lead needs cross-shot identity continuity.',
        }],
        stableDescription: 'A tired traveler.',
        generationPrompt: 'Styled design for Traveler',
        negativePrompt: null,
        referenceRequirements: [],
        continuityRequirements: [],
      }],
      assumptions: [],
      warnings: [],
    })
    const plan = planCreativeWorkResourceMaterialization({
      taskId: 'asset-manifest-task',
      payload: taskPayload('asset_manifest', [
        {
          label: 'Screenplay',
          kind: 'structured',
          content: JSON.stringify(screenplay),
          provenance: { kind: 'resource', revisionId: 'screenplay-r1' },
        },
      ], {
        revisionId: 'direction-r1',
        direction: {
          visual: creativeDirection.visual,
          assetPolicy: creativeDirection.assetPolicy,
        },
      }),
      result: taskResult('asset_manifest', output),
    })

    expect(plan).toMatchObject({
      resourceScope: 'project',
      inputs: [
        { revisionId: 'screenplay-r1', role: 'source_material' },
        { revisionId: 'direction-r1', role: 'creative_direction' },
      ],
      outputs: [{
        schemaId: CREATIVE_RESOURCE_SCHEMA.ASSET_MANIFEST,
        sourceType: 'CreativeWorkResult',
        sourceId: 'asset-manifest-task',
        content: {
          kind: 'structured',
          data: expect.objectContaining({
            assets: [expect.objectContaining({
              canonicalName: 'Traveler',
              manifestAssetId: expect.stringMatching(/^ASSET_CHAR_/),
            })],
          }),
        },
        generationOptions: {
          screenplayRevisionId: 'screenplay-r1',
          creativeDirectionRevisionId: 'direction-r1',
        },
      }],
    })
    expect(JSON.stringify(plan)).not.toContain('imageGeneration')
  })
})
