import { describe, expect, it } from 'vitest'
import {
  DIALOGUE_BEAT_BUDGET_SECONDS,
  alignStoryboardPanelsToDialogueBeats,
  buildDialogueBeatsFromScreenplay,
  buildVoiceLineRowsFromDialogueBeats,
  estimateDialogueDurationSeconds,
  splitDialogueTextIntoBudgetedChunks,
  validateStoryboardDialogueBudget,
} from '@/lib/novel-promotion/dialogue-beats'

describe('dialogue beats', () => {
  it('splits long Chinese dialogue into budgeted beats', () => {
    const text = '陈迹你好，我现在需要问你一些问题，可以吗？你不用紧张，只要按照自己的理解回答就好。这个过程不会影响你的判断，我们只是确认几个关键事实。'
    const chunks = splitDialogueTextIntoBudgetedChunks(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) =>
      estimateDialogueDurationSeconds(chunk) <= DIALOGUE_BEAT_BUDGET_SECONDS,
    )).toBe(true)
    expect(chunks.join('')).toBe(text)
  })

  it('keeps compact dialogue as a single beat', () => {
    expect(splitDialogueTextIntoBudgetedChunks('我不记仇。')).toEqual(['我不记仇。'])
  })

  it('builds dialogue beats from screenplay dialogue and voiceover rows', () => {
    const beats = buildDialogueBeatsFromScreenplay({
      clipId: 'clip-1',
      screenplay: {
        scenes: [
          {
            heading: { location: '诊室', time: '夜晚' },
            content: [
              { type: 'dialogue', character: '陈迹', parenthetical: '平静', lines: '那没有。' },
              { type: 'voiceover', character: '旁白', text: '他想起很多年前的一次谈话。' },
            ],
          },
        ],
      },
    })

    expect(beats).toHaveLength(2)
    expect(beats[0]).toMatchObject({
      beatId: 'clip-1:dialogue:1',
      speaker: '陈迹',
      exactText: '那没有。',
      scene: '诊室 夜晚',
      emotion: '平静',
      isVoiceover: false,
    })
    expect(beats[1]).toMatchObject({
      speaker: '旁白',
      isVoiceover: true,
    })
  })

  it('fails validation when one panel explicitly binds multiple dialogue beats', () => {
    const dialogueBeats = buildDialogueBeatsFromScreenplay({
      clipId: 'clip-1',
      screenplay: {
        scenes: [
          {
            content: [
              { type: 'dialogue', character: 'A', lines: '第一句。' },
              { type: 'dialogue', character: 'A', lines: '第二句。' },
            ],
          },
        ],
      },
    })

    const issues = validateStoryboardDialogueBudget({
      dialogueBeats,
      panels: [
        {
          panel_number: 1,
          description: 'A speaks both lines.',
          source_text: '第一句。第二句。',
          dialogueBeatIds: dialogueBeats.map((beat) => beat.beatId),
        },
      ],
    })

    expect(issues.some((issue) => issue.code === 'panel_multiple_dialogue_beats')).toBe(true)
  })

  it('aligns inferred dialogue panels and creates deterministic voice line rows', () => {
    const dialogueBeats = buildDialogueBeatsFromScreenplay({
      clipId: 'clip-1',
      screenplay: {
        scenes: [
          {
            content: [
              { type: 'dialogue', character: 'Doctor', lines: '你是否记仇？' },
            ],
          },
        ],
      },
    })
    const panels = alignStoryboardPanelsToDialogueBeats({
      dialogueBeats,
      panels: [
        {
          panel_number: 1,
          description: 'Doctor speaks.',
          source_text: '你是否记仇？',
          characters: [{ name: 'Doctor' }],
        },
      ],
    })

    expect(panels[0]).toMatchObject({
      dialogueBeatId: 'clip-1:dialogue:1',
      dialogueSpeaker: 'Doctor',
      source_text: '你是否记仇？',
    })

    const rows = buildVoiceLineRowsFromDialogueBeats({
      clipPanels: [{ clipId: 'clip-1', finalPanels: panels }],
      dialogueBeatsByClipId: { 'clip-1': dialogueBeats },
    })

    expect(rows).toEqual([
      expect.objectContaining({
        lineIndex: 1,
        speaker: 'Doctor',
        content: '你是否记仇？',
        dialogueBeatId: 'clip-1:dialogue:1',
        matchedPanel: {
          storyboardId: 'clip-1',
          panelIndex: 0,
        },
      }),
    ])
  })

  it('keeps only the first panel when a dialogue beat id is duplicated', () => {
    const dialogueBeats = buildDialogueBeatsFromScreenplay({
      clipId: 'clip-1',
      screenplay: {
        scenes: [
          {
            content: [
              { type: 'dialogue', character: 'Doctor', lines: 'Can you answer?' },
            ],
          },
        ],
      },
    })

    const panels = alignStoryboardPanelsToDialogueBeats({
      dialogueBeats,
      panels: [
        {
          panel_number: 1,
          description: 'Doctor speaks.',
          source_text: 'Can you answer?',
          dialogueBeatId: dialogueBeats[0].beatId,
        },
        {
          panel_number: 2,
          description: 'Reaction shot with the same dialogue context.',
          source_text: 'Can you answer?',
          dialogueBeatId: dialogueBeats[0].beatId,
        },
      ],
    })

    expect(panels[0]).toMatchObject({ dialogueBeatId: dialogueBeats[0].beatId })
    expect(panels[1]).not.toHaveProperty('dialogueBeatId')
    expect(validateStoryboardDialogueBudget({ dialogueBeats, panels })).toEqual([])
  })

  it('does not infer the same dialogue beat onto repeated reaction panels', () => {
    const dialogueBeats = buildDialogueBeatsFromScreenplay({
      clipId: 'clip-1',
      screenplay: {
        scenes: [
          {
            content: [
              { type: 'dialogue', character: 'Doctor', lines: 'Can you answer?' },
            ],
          },
        ],
      },
    })

    const panels = alignStoryboardPanelsToDialogueBeats({
      dialogueBeats,
      panels: [
        {
          panel_number: 1,
          description: 'Doctor speaks.',
          source_text: 'Can you answer?',
        },
        {
          panel_number: 2,
          description: 'Reaction shot that repeats source context.',
          source_text: 'Can you answer?',
        },
      ],
    })

    expect(panels[0]).toMatchObject({ dialogueBeatId: dialogueBeats[0].beatId })
    expect(panels[1]).not.toHaveProperty('dialogueBeatId')
    expect(validateStoryboardDialogueBudget({ dialogueBeats, panels })).toEqual([])
  })

  it('normalizes duplicated dialogue beat ids across alternate model fields', () => {
    const dialogueBeats = buildDialogueBeatsFromScreenplay({
      clipId: 'clip-1',
      screenplay: {
        scenes: [
          {
            content: [
              { type: 'dialogue', character: 'Doctor', lines: 'First line.' },
              { type: 'dialogue', character: 'Patient', lines: 'Second line.' },
            ],
          },
        ],
      },
    })

    const panels = alignStoryboardPanelsToDialogueBeats({
      dialogueBeats,
      panels: [
        {
          panel_number: 1,
          description: 'Doctor speaks.',
          source_text: 'First line.',
          dialogueBeatId: dialogueBeats[0].beatId,
        },
        {
          panel_number: 2,
          description: 'Reaction shot repeats the first line.',
          source_text: 'First line.',
          dialogue_beat_id: dialogueBeats[0].beatId,
        },
        {
          panel_number: 3,
          description: 'Panel incorrectly carries both ids.',
          source_text: 'First line. Second line.',
          dialogueBeatIds: [dialogueBeats[0].beatId, dialogueBeats[1].beatId],
        },
      ],
    })

    expect(panels.filter((panel) => panel.dialogueBeatId === dialogueBeats[0].beatId)).toHaveLength(1)
    expect(panels.filter((panel) => panel.dialogueBeatId === dialogueBeats[1].beatId)).toHaveLength(1)
    expect(validateStoryboardDialogueBudget({ dialogueBeats, panels })).toEqual([])
  })
})
