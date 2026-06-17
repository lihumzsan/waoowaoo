import { describe, expect, it } from 'vitest'
import {
  buildFinalRenderClips,
  buildFinalRenderMusicPrompt,
  parseFinalRenderEditScriptShots,
  parseFinalRenderEditScriptVideoBlocks,
  resolveFinalRenderDimensions,
  selectFinalRenderMusicDurationSeconds,
  type FinalRenderEditScriptInput,
  type FinalRenderPanelInput,
} from '@/lib/video-compose/final-render-plan'

const editScript: FinalRenderEditScriptInput = {
  id: 'edit-script-1',
  userPrompt: 'Make a tense neon rooftop chase.',
  title: 'Rooftop Chase',
  logline: 'A runner escapes through a neon city.',
  durationSec: 8,
  videoBlocks: [
    {
      kind: 'group',
      shotNumbers: [1, 2],
      gridMode: '2x2',
      reason: 'continuous rooftop movement and escalating danger',
      prompt: 'Full-screen continuous rooftop chase with neon reflections and fast physical motion.',
    },
  ],
  shots: [
    {
      shotNumber: 1,
      durationSec: 3,
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: 'Runner looks over the roof edge',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
      charactersAndScene: 'Runner on rooftop',
      sound: 'quiet suspense, sparse piano, low synth pulse',
    },
    {
      shotNumber: 2,
      durationSec: 5,
      dramaticPurpose: 'test dramatic purpose',
      visibleAction: 'Runner sprints and jumps',
      audienceFocus: 'test audience focus',
      viewpoint: 'test viewpoint',
      revealPlan: 'test reveal plan',
      performanceBeat: 'test performance beat',
      continuityIn: 'test continuity in',
      continuityOut: 'test continuity out',
      charactersAndScene: 'Runner crossing rooftops',
      sound: 'urgent percussion, rising strings, faster rhythm',
    },
  ],
}

function panel(input: {
  readonly id: string
  readonly panelNumber: number
  readonly duration?: number
  readonly videoUrl?: string
  readonly storyboardTextJson?: string
  readonly photographyRules?: string
}): FinalRenderPanelInput {
  return {
    id: input.id,
    panelIndex: input.panelNumber - 1,
    panelNumber: input.panelNumber,
    duration: input.duration ?? null,
    description: `panel ${input.panelNumber}`,
    videoUrl: input.videoUrl ?? `videos/${input.id}.mp4`,
    photographyRules: input.photographyRules ?? null,
    storyboard: {
      id: `storyboard-${input.id}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      storyboardTextJson: input.storyboardTextJson ?? JSON.stringify({ editScriptId: editScript.id }),
      clip: { createdAt: new Date('2026-01-01T00:00:00.000Z') },
    },
  }
}

describe('final render plan', () => {
  it('builds edit-first clip order and uses shot sound directions', () => {
    const clips = buildFinalRenderClips({
      editScript,
      panels: [
        panel({ id: 'shot-2', panelNumber: 2, duration: 5 }),
        panel({ id: 'unrelated', panelNumber: 9, storyboardTextJson: '{}' }),
        panel({ id: 'shot-1', panelNumber: 1, duration: 2.5 }),
      ],
    })

    expect(clips.map((clip) => clip.panelId)).toEqual(['shot-1', 'shot-2'])
    expect(clips.map((clip) => clip.durationSeconds)).toEqual([2.5, 5])
    expect(clips.map((clip) => clip.sound)).toEqual([
      'quiet suspense, sparse piano, low synth pulse',
      'urgent percussion, rising strings, faster rhythm',
    ])
  })

  it('selects final render dimensions from the project ratio', () => {
    expect(resolveFinalRenderDimensions('9:16')).toEqual({ width: 1080, height: 1920 })
    expect(resolveFinalRenderDimensions('16:9')).toEqual({ width: 1920, height: 1080 })
    expect(resolveFinalRenderDimensions('21:9')).toEqual({ width: 2560, height: 1080 })
  })

  it('uses completed video groups and skips covered panel clips', () => {
    const clips = buildFinalRenderClips({
      editScript,
      videoGroups: [
        {
          id: 'group-1',
          gridMode: '2x2',
          shotNumbers: [1, 2],
          durationSec: 8,
          status: 'completed',
          videoUrl: 'videos/group-1.mp4',
        },
      ],
      panels: [
        panel({ id: 'shot-1', panelNumber: 1 }),
        panel({ id: 'shot-2', panelNumber: 2 }),
      ],
    })

    expect(clips).toHaveLength(1)
    expect(clips[0]).toEqual(expect.objectContaining({
      sourceKind: 'videoGroup',
      groupId: 'group-1',
      panelId: 'group-1',
      source: 'videos/group-1.mp4',
      durationSeconds: 8,
      shotNumber: 1,
    }))
  })

  it('rejects persisted videoBlocks that reorder edit-first shots', () => {
    expect(() => parseFinalRenderEditScriptVideoBlocks({
      value: [
        {
          kind: 'single',
          shotNumbers: [2],
          reason: 'manual first beat',
          prompt: 'shot 2 first',
        },
        {
          kind: 'single',
          shotNumbers: [1],
          reason: 'manual second beat',
          prompt: 'shot 1 second',
        },
      ],
      shots: editScript.shots,
    })).toThrow('VIDEO_BLOCK_PLAN_SHOT_COVERAGE_INVALID')
  })

  it('selects supported Lyria durations without exceeding Pro limits', () => {
    expect(selectFinalRenderMusicDurationSeconds('google::lyria-3-clip-preview', 118)).toBe(30)
    expect(selectFinalRenderMusicDurationSeconds('google::lyria-3-pro-preview', 31)).toBe(60)
    expect(selectFinalRenderMusicDurationSeconds('fal::fal-ai/lyria3/pro', 121)).toBe(180)
    expect(selectFinalRenderMusicDurationSeconds('google::lyria-3-pro-preview', 181)).toBe(180)
  })

  it('writes a music prompt from shot emotions, rhythm, structure, and instrumentation', () => {
    const clips = buildFinalRenderClips({
      editScript,
      panels: [panel({ id: 'shot-1', panelNumber: 1 }), panel({ id: 'shot-2', panelNumber: 2 })],
    })
    const prompt = buildFinalRenderMusicPrompt({
      editScript,
      projectContext: {
        videoRatio: '9:16',
      },
      clips,
      totalDurationSeconds: 9,
    })

    expect(prompt).toContain('Complete edit-first core table JSON')
    expect(prompt).toContain('Project configuration JSON')
    expect(prompt).toContain('Actual rendered media timeline JSON')
    expect(prompt).toContain('"kind": "group"')
    expect(prompt).toContain('Full-screen continuous rooftop chase')
    expect(prompt).toContain('"styleBible": null')
    expect(prompt).not.toContain('artStylePrompt')
    expect(prompt).not.toContain('visualStylePreset')
    expect(prompt).toContain('Instrumentation')
    expect(prompt).toContain('Tempo and rhythm')
    expect(prompt).toContain('quiet suspense, sparse piano, low synth pulse')
    expect(prompt).toContain('urgent percussion, rising strings, faster rhythm')
    expect(prompt).toContain('no vocals, no lyrics')
  })

  it('parses persisted edit script shots through the shared edit script schema', () => {
    const shots = parseFinalRenderEditScriptShots(editScript.shots)

    expect(shots).toHaveLength(2)
    expect(shots[0]?.shotNumber).toBe(1)
    expect(parseFinalRenderEditScriptShots([{ shotNumber: 1 }])).toEqual([])
  })

  it('parses persisted edit script videoBlocks through the shared video block planner', () => {
    const blocks = parseFinalRenderEditScriptVideoBlocks({
      value: [
        {
          type: 'group',
          shotNumbers: [1, 2],
          gridMode: '2x2',
          reason: 'continuous rooftop movement',
          prompt: 'combined group prompt',
        },
      ],
      shots: editScript.shots,
    })

    expect(blocks).toEqual([
      {
        kind: 'group',
        shotNumbers: [1, 2],
        gridMode: '2x2',
        reason: 'continuous rooftop movement',
        prompt: 'combined group prompt',
      },
    ])
  })
})
