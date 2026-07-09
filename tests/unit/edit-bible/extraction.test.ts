import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AI_PROMPT_IDS } from '@/lib/ai-prompts'

type MockStructuredInput = {
  readonly action: string
  readonly validate?: (parsed: unknown) => unknown
}

const structuredStepMock = vi.hoisted(() => {
  const outputs = new Map<string, unknown>()
  return {
    outputs,
    executeAiStructuredTextStep: vi.fn(async (input: MockStructuredInput) => {
      const raw = outputs.get(input.action)
      if (raw === undefined) {
        throw new Error(`TEST_OUTPUT_MISSING:${input.action}`)
      }
      const data = input.validate ? input.validate(raw) : raw
      return {
        text: JSON.stringify(raw),
        reasoning: '',
        usage: {
          promptTokens: 1,
          completionTokens: 1,
          totalTokens: 2,
        },
        completion: {
          id: 'chatcmpl-edit-bible-extraction-test',
          object: 'chat.completion',
          created: 0,
          model: 'test-model',
          choices: [],
        },
        data,
        repairRounds: 0,
      }
    }),
  }
})

vi.mock('@/lib/ai-exec/structured-step', () => ({
  executeAiStructuredTextStep: structuredStepMock.executeAiStructuredTextStep,
}))

vi.mock('@/lib/billing', () => ({
  withTextBilling: vi.fn(async (...args: readonly unknown[]) => {
    const runCompletion = args[4]
    if (typeof runCompletion !== 'function') {
      throw new Error('TEST_BILLING_RUN_COMPLETION_MISSING')
    }
    return await (runCompletion as () => Promise<unknown>)()
  }),
}))

import {
  generateEditBibleArtifacts,
  readEditBibleExtractionDiagnostics,
} from '@/lib/edit-bible/extraction'

function installValidOutputs() {
  structuredStepMock.outputs.set(AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL, {
    synopsis: '主角发现情感正在消失。',
    characters: [],
    locations: [],
    worldRules: [],
    styleGuide: {},
  })
  structuredStepMock.outputs.set(AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET, {
    beats: [{
      beatId: 'beat_001',
      title: '发现异常',
      summary: '主角意识到情感正在消失。',
      sourceAnchor: {
        startBlockId: 'p0001',
        startQuote: '1',
        endBlockId: 'p0001',
        endQuote: '5',
      },
      estimatedDurationSec: 30,
      persistentFactsIntroduced: [],
    }],
  })
  structuredStepMock.outputs.set(AI_PROMPT_IDS.EDIT_BIBLE_LEDGER, {
    events: [],
  })
  structuredStepMock.outputs.set(AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE, {
    cues: [{
      cueId: 'cue_001',
      mood: '压抑',
      intensity: 0.7,
      musicPolicy: 'underscore',
      sourceAnchor: {
        startBlockId: 'p0001',
        startQuote: '1',
        endBlockId: 'p0001',
        endQuote: '5',
      },
    }],
  })
}

describe('edit bible extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    structuredStepMock.outputs.clear()
    installValidOutputs()
  })

  it('reports source anchor errors at the failing extraction step boundary', async () => {
    structuredStepMock.outputs.set(AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE, {
      cues: [{
        cueId: 'cue_001',
        mood: '压抑',
        intensity: 0.7,
        musicPolicy: 'underscore',
        sourceAnchor: {
          startBlockId: 'p0001',
          startQuote: '1',
          endBlockId: 'p9999',
          endQuote: '5',
        },
      }],
    })

    let caught: unknown = null
    try {
      await generateEditBibleArtifacts({
        userId: 'user-1',
        projectId: 'project-1',
        model: 'analysis-model',
        locale: 'zh',
        sourceDocument: '12345',
      })
    } catch (error: unknown) {
      caught = error
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('EDIT_BIBLE_EXTRACTION_FAILED')
    expect(readEditBibleExtractionDiagnostics(caught)).toEqual({
      emotionalCurve: {
        error: 'EDIT_SOURCE_ANCHOR_BLOCK_NOT_FOUND:p9999',
      },
    })
  })
})
