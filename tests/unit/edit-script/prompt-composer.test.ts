import { describe, expect, it } from 'vitest'
import {
  validateImagePromptComposerOutput,
  validateVideoPromptComposerOutput,
  type PanelPromptFactInput,
  type SegmentPromptFactInput,
} from '@/lib/edit-script/prompt-composer/validation'

function panelFact(shotNumber: number, characters: readonly {
  readonly name: string
  readonly visibility: string
}[]): PanelPromptFactInput {
  return {
    panelId: `panel-${shotNumber}`,
    shotNumber,
    renderFacts: {
      CHARACTER_GRAPH: characters,
      STILL_FRAME: {
        shotNumber,
        action: `shot ${shotNumber}`,
      },
    },
  }
}

describe('prompt composer validation', () => {
  it('accepts image prompts only when every panel is covered and hidden subjects remain named', () => {
    const promptByShot = validateImagePromptComposerOutput({
      panels: [
        panelFact(11, [
          { name: '伪装的外婆', visibility: 'hidden' },
        ]),
        panelFact(12, [
          { name: '安娜', visibility: 'visible' },
          { name: '伪装的外婆', visibility: 'hidden' },
        ]),
      ],
      output: [
        {
          shotNumber: 11,
          imagePrompt: '木屋客厅里高背椅遮住伪装的外婆，她是 hidden hidden_subject。',
        },
        {
          shotNumber: 12,
          imagePrompt: '安娜从左侧靠近，高背椅内的伪装的外婆仍然 hidden。',
        },
      ],
    })

    expect(promptByShot.get(11)).toContain('伪装的外婆')
    expect(promptByShot.get(12)).toContain('安娜')
  })

  it('rejects image prompts that drop a hidden in-scene character', () => {
    expect(() => validateImagePromptComposerOutput({
      panels: [
        panelFact(11, [
          { name: '伪装的外婆', visibility: 'hidden' },
        ]),
      ],
      output: [
        {
          shotNumber: 11,
          imagePrompt: '木屋客厅里只有一张高背椅，没有提到椅中人物。',
        },
      ],
    })).toThrow('IMAGE_PROMPT_COMPOSER_CHARACTER_MISSING:11:伪装的外婆')
  })

  it('validates video shot prompts and generation segment prompts against exact coverage', () => {
    const panels = [
      panelFact(1, [
        { name: 'A', visibility: 'visible' },
        { name: 'B', visibility: 'partial' },
      ]),
      panelFact(2, [
        { name: 'A', visibility: 'visible' },
        { name: 'B', visibility: 'visible' },
      ]),
    ]
    const segments: readonly SegmentPromptFactInput[] = [
      {
        sourceGenerationSegmentId: 'edit-1:generationSegment:1',
        shotNumbers: [1, 2],
        facts: {
          GENERATION_SEGMENT: {
            continuity: 'A and B remain in the same room while the focus changes.',
          },
        },
      },
    ]

    const result = validateVideoPromptComposerOutput({
      panels,
      segments,
      shotOutputs: [
        { shotNumber: 1, videoPrompt: 'A speaks while B remains partial in the room.' },
        { shotNumber: 2, videoPrompt: 'B responds while A remains visible.' },
      ],
      segmentOutputs: [
        {
          sourceGenerationSegmentId: 'edit-1:generationSegment:1',
          shotNumbers: [1, 2],
          prompt: 'Continuous two-shot segment: A and B stay present and keep their spatial relation.',
        },
      ],
    })

    expect(result.shotPrompts.get(1)).toContain('B')
    expect(result.segmentPrompts.get('edit-1:generationSegment:1')).toContain('A and B')
  })

  it('rejects video segment prompts that change segment shot coverage', () => {
    expect(() => validateVideoPromptComposerOutput({
      panels: [
        panelFact(1, [{ name: 'A', visibility: 'visible' }]),
        panelFact(2, [{ name: 'B', visibility: 'visible' }]),
      ],
      segments: [
        {
          sourceGenerationSegmentId: 'edit-1:generationSegment:1',
          shotNumbers: [1, 2],
          facts: {},
        },
      ],
      shotOutputs: [
        { shotNumber: 1, videoPrompt: 'A is visible.' },
        { shotNumber: 2, videoPrompt: 'B is visible.' },
      ],
      segmentOutputs: [
        {
          sourceGenerationSegmentId: 'edit-1:generationSegment:1',
          shotNumbers: [2, 1],
          prompt: 'A and B are visible.',
        },
      ],
    })).toThrow('VIDEO_PROMPT_COMPOSER_SEGMENT_SHOTS_INVALID')
  })
})
