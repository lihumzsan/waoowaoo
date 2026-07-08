import { describe, expect, it } from 'vitest'
import {
  buildFinalRenderClips,
  buildFinalRenderMusicPrompt,
  parseFinalRenderEditScriptCore,
  parseFinalRenderEditScriptShots,
  resolveFinalRenderDimensions,
  type FinalRenderEditScriptInput,
  type FinalRenderPanelInput,
} from '@/lib/video-compose/final-render-plan'

const editScript: FinalRenderEditScriptInput = {
  id: 'edit-script-1',
  userPrompt: 'Make a tense neon rooftop chase.',
  durationSec: 8,
  shots: [
    {
      shotId: 'shot-1',
      shotNumber: 1,
      shotPurpose: 'action',
      durationSec: 3,
      scene: { locationId: 'location-1', name: 'Neon rooftop', subScene: 'Neon rooftop' },
      action: 'Runner looks over the roof edge',
      characters: [
        {
          characterId: 'character-1',
          name: 'Runner',
          visibility: 'visible',
          role: 'focus',
          performance: 'checks the drop below',
        },
      ],
      keyObjects: [],
      dialogue: [],
      sound: 'quiet suspense, sparse piano, low synth pulse',
    },
    {
      shotId: 'shot-2',
      shotNumber: 2,
      shotPurpose: 'action',
      durationSec: 5,
      scene: { locationId: 'location-1', name: 'Neon rooftop', subScene: 'Neon rooftop' },
      action: 'Runner sprints and jumps',
      characters: [
        {
          characterId: 'character-1',
          name: 'Runner',
          visibility: 'visible',
          role: 'focus',
          performance: 'commits to the jump',
        },
      ],
      keyObjects: [],
      dialogue: [],
      sound: 'urgent percussion, rising strings, faster rhythm',
    },
  ],
  generationSegments: [
    {
      shotIds: ['shot-1', 'shot-2'],
      continuity: 'continuous rooftop movement and escalating danger',
    },
  ],
}

function panel(input: {
  readonly id: string
  readonly panelNumber: number
  readonly duration?: number
  readonly videoUrl?: string
  readonly storyboardTextJson?: string
}): FinalRenderPanelInput {
  return {
    id: input.id,
    panelIndex: input.panelNumber - 1,
    panelNumber: input.panelNumber,
    duration: input.duration ?? null,
    description: `panel ${input.panelNumber}`,
    videoUrl: input.videoUrl ?? `videos/${input.id}.mp4`,
    storyboard: {
      id: `storyboard-${input.id}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      storyboardTextJson: input.storyboardTextJson ?? JSON.stringify({ editScriptId: editScript.id }),
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
          shotIds: ['shot-1', 'shot-2'],
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

    expect(prompt).toContain('Core edit plan JSON')
    expect(prompt).toContain('Project configuration JSON')
    expect(prompt).toContain('Actual rendered media timeline JSON')
    expect(prompt).toContain('"generationSegments"')
    expect(prompt).toContain('continuous rooftop movement')
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
    const corePlan = {
      shots: editScript.shots,
      generationSegments: editScript.generationSegments,
    }
    const shots = parseFinalRenderEditScriptShots(corePlan)

    expect(shots).toHaveLength(2)
    expect(shots[0]?.shotNumber).toBe(1)
    expect(parseFinalRenderEditScriptShots([{ shotNumber: 1 }])).toEqual([])
  })

  it('parses persisted edit script core plan through the shared schema', () => {
    const core = parseFinalRenderEditScriptCore({
      shots: editScript.shots,
      generationSegments: editScript.generationSegments,
    })

    expect(core?.generationSegments).toEqual([
      { shotIds: ['shot-1', 'shot-2'], continuity: 'continuous rooftop movement and escalating danger' },
    ])
  })
})
