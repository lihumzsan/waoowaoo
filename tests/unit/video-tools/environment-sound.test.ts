import { describe, expect, it } from 'vitest'
import {
  ENVIRONMENT_SOUND_DEFAULT_NEGATIVE_PROMPT,
  buildEnvironmentSoundOutputKey,
  buildEnvironmentSoundPieces,
  parseEnvironmentSoundPlan,
  parseEnvironmentSoundSubmission,
  validateEnvironmentSoundVoiceUpload,
} from '@/lib/video-tools/environment-sound'

const validPlan = {
  durationSeconds: 220,
  summaryZh: '夜晚森林逐渐过渡到木屋内部。',
  zones: [
    {
      id: 'forest',
      startSeconds: 0,
      endSeconds: 170,
      sceneZh: '夜晚森林',
      ambienceZh: '风吹树叶与远处虫鸣',
      eventSoundsZh: ['偶尔树枝轻响'],
      avoidSoundsZh: ['音乐', '对白'],
      promptEn: 'Continuous realistic night forest ambience with soft wind moving through leaves and distant insects in a wide outdoor stereo space, no music or voices.',
      negativePromptEn: 'music, melody, speech, dialogue, vocals, narration',
      transitionToNext: 'smooth',
    },
    {
      id: 'cabin',
      startSeconds: 170,
      endSeconds: 220,
      sceneZh: '安静木屋',
      ambienceZh: '轻微木材热胀冷缩声与壁炉声',
      eventSoundsZh: [],
      avoidSoundsZh: ['人声'],
      promptEn: 'Continuous realistic quiet wooden cabin ambience with subtle timber creaks and a gentle nearby fireplace in an intimate dry stereo interior, no music or voices.',
      negativePromptEn: '',
      transitionToNext: 'hard',
    },
  ],
}

describe('environment sound contract', () => {
  it('merges synchronized prompts by exact zone id so edited Chinese facts can reach generation', async () => {
    const environmentSoundModule = await import('@/lib/video-tools/environment-sound') as typeof import('@/lib/video-tools/environment-sound') & {
      applyEnvironmentSoundPromptSync?: (plan: unknown, response: unknown) => ReturnType<typeof parseEnvironmentSoundPlan>
    }
    expect(environmentSoundModule.applyEnvironmentSoundPromptSync).toBeTypeOf('function')

    const editedPlan = structuredClone(validPlan)
    editedPlan.zones[0]!.ambienceZh = '暴雨砸在铁皮屋顶，近处积水持续飞溅'
    const synchronized = environmentSoundModule.applyEnvironmentSoundPromptSync!(editedPlan, {
      zones: [
        {
          id: 'forest',
          promptEn: 'Continuous realistic torrential rain striking a corrugated metal roof with close puddle splashes in stereo, no music or voices.',
          negativePromptEn: 'music, melody, speech, dialogue, vocals, narration',
        },
        {
          id: 'cabin',
          promptEn: editedPlan.zones[1]!.promptEn,
          negativePromptEn: editedPlan.zones[1]!.negativePromptEn,
        },
      ],
    })

    expect(synchronized.zones[0]!.ambienceZh).toContain('铁皮屋顶')
    expect(buildEnvironmentSoundPieces(synchronized)[0]!.promptEn).toContain('corrugated metal roof')
    expect(() => environmentSoundModule.applyEnvironmentSoundPromptSync!(editedPlan, { zones: [] }))
      .toThrow('ENVIRONMENT_SOUND_PROMPT_SYNC_ZONES_INVALID')
  })

  it('accepts an owned stitched-video analysis request', () => {
    expect(parseEnvironmentSoundSubmission('user-1', {
      action: 'analyze',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: ' final.mp4 ',
      scriptDialogue: '  角色在森林里找到木屋。  ',
      voiceKey: 'video-tools/user-1/voice-inputs/voice-1.mp3',
    })).toEqual({
      action: 'analyze',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      scriptDialogue: '角色在森林里找到木屋。',
      voiceKey: 'video-tools/user-1/voice-inputs/voice-1.mp3',
    })
  })

  it('rejects cross-user video and voice keys', () => {
    expect(() => parseEnvironmentSoundSubmission('user-1', {
      action: 'analyze',
      videoKey: 'video-tools/user-2/outputs/final.mp4',
      videoName: 'final.mp4',
    })).toThrow('ENVIRONMENT_SOUND_VIDEO_NOT_OWNED')

    expect(() => parseEnvironmentSoundSubmission('user-1', {
      action: 'analyze',
      videoKey: 'video-tools/user-1/outputs/final.mp4',
      videoName: 'final.mp4',
      voiceKey: 'video-tools/user-2/voice-inputs/voice-1.mp3',
    })).toThrow('ENVIRONMENT_SOUND_VOICE_NOT_OWNED')
  })

  it('validates contiguous zones and applies the required negative prompt', () => {
    const plan = parseEnvironmentSoundPlan(validPlan)

    expect(plan.zones).toHaveLength(2)
    expect(plan.zones[1]?.negativePromptEn).toBe(ENVIRONMENT_SOUND_DEFAULT_NEGATIVE_PROMPT)
  })

  it('preserves custom negative terms while restoring mandatory no-music and no-voice constraints', () => {
    const customNegativePlan = structuredClone(validPlan)
    customNegativePlan.zones[0]!.negativePromptEn = 'low quality, clipping'

    const negativePrompt = parseEnvironmentSoundPlan(customNegativePlan).zones[0]!.negativePromptEn

    expect(negativePrompt).toContain('low quality, clipping')
    for (const term of ['music', 'melody', 'speech', 'dialogue', 'vocals', 'narration']) {
      expect(negativePrompt.toLowerCase()).toContain(term)
    }
  })

  it('restores no-music and no-voice wording in an otherwise valid English positive prompt', () => {
    const unconstrainedPlan = structuredClone(validPlan)
    unconstrainedPlan.zones[0]!.promptEn = 'Continuous realistic thunderstorm ambience with distant rolling thunder in a wide stereo exterior'

    const prompt = parseEnvironmentSoundPlan(unconstrainedPlan).zones[0]!.promptEn.toLowerCase()

    expect(prompt).toContain('no music')
    expect(prompt).toContain('no voices')
  })

  it('rejects gaps, overlaps, duration drift, and non-English generation prompts', () => {
    const withGap = structuredClone(validPlan)
    withGap.zones[1]!.startSeconds = 171
    expect(() => parseEnvironmentSoundPlan(withGap)).toThrow('ENVIRONMENT_SOUND_PLAN_NOT_CONTIGUOUS')

    const withOverlap = structuredClone(validPlan)
    withOverlap.zones[1]!.startSeconds = 169
    expect(() => parseEnvironmentSoundPlan(withOverlap)).toThrow('ENVIRONMENT_SOUND_PLAN_NOT_CONTIGUOUS')

    const withDrift = structuredClone(validPlan)
    withDrift.durationSeconds = 221
    expect(() => parseEnvironmentSoundPlan(withDrift)).toThrow('ENVIRONMENT_SOUND_PLAN_DURATION_MISMATCH')

    const withChinesePrompt = structuredClone(validPlan)
    withChinesePrompt.zones[0]!.promptEn = '夜晚森林里的风声和虫鸣'
    expect(() => parseEnvironmentSoundPlan(withChinesePrompt)).toThrow('ENVIRONMENT_SOUND_PLAN_PROMPT_NOT_ENGLISH')
  })

  it('rejects small per-zone timing gaps when their cumulative drift exceeds tolerance', () => {
    const zoneTemplate = structuredClone(validPlan.zones[0]!)
    const accumulatedGapPlan = {
      durationSeconds: 40,
      summaryZh: '多个连续声场。',
      zones: [
        { ...structuredClone(zoneTemplate), id: 'z1', startSeconds: 0, endSeconds: 10 },
        { ...structuredClone(zoneTemplate), id: 'z2', startSeconds: 10.09, endSeconds: 20 },
        { ...structuredClone(zoneTemplate), id: 'z3', startSeconds: 20.09, endSeconds: 30 },
        { ...structuredClone(zoneTemplate), id: 'z4', startSeconds: 30.09, endSeconds: 40 },
      ],
    }

    expect(() => parseEnvironmentSoundPlan(accumulatedGapPlan))
      .toThrow('ENVIRONMENT_SOUND_PLAN_DURATION_MISMATCH')
  })

  it('splits long zones under the 150-second generation limit with deterministic seeds', () => {
    const plan = parseEnvironmentSoundPlan(validPlan)
    const pieces = buildEnvironmentSoundPieces(plan)

    expect(pieces).toHaveLength(3)
    expect(pieces.map((piece) => piece.timelineDurationSeconds)).toEqual([149, 21, 50])
    expect(pieces.map((piece) => piece.transitionSeconds)).toEqual([1, 1, 0])
    expect(pieces.every((piece) => piece.generationDurationSeconds <= 150)).toBe(true)
    expect(buildEnvironmentSoundPieces(plan).map((piece) => piece.seed))
      .toEqual(pieces.map((piece) => piece.seed))
  })

  it('parses an owned generation request and builds a scoped MP3 output key', () => {
    const submission = parseEnvironmentSoundSubmission('user-1', {
      action: 'generate',
      videoKey: 'video-tools/user-1/inputs/final.mov',
      videoName: 'final.mov',
      plan: validPlan,
    })

    expect(submission.action).toBe('generate')
    if (submission.action !== 'generate') throw new Error('expected generate submission')
    expect(submission.plan.durationSeconds).toBe(220)
    expect(buildEnvironmentSoundOutputKey('user-1', 'sound-1'))
      .toBe('video-tools/user-1/environment-sounds/sound-1.mp3')
  })

  it('accepts common voice formats and rejects oversized or non-audio uploads', () => {
    expect(validateEnvironmentSoundVoiceUpload({
      name: 'dialogue.m4a',
      type: 'audio/mp4',
      size: 1024,
    })).toEqual({ extension: 'm4a', mimeType: 'audio/mp4' })

    expect(() => validateEnvironmentSoundVoiceUpload({
      name: 'dialogue.txt',
      type: 'text/plain',
      size: 10,
    })).toThrow('ENVIRONMENT_SOUND_VOICE_UNSUPPORTED')

    expect(() => validateEnvironmentSoundVoiceUpload({
      name: 'dialogue.wav',
      type: 'audio/wav',
      size: 65 * 1024 * 1024,
    })).toThrow('ENVIRONMENT_SOUND_VOICE_TOO_LARGE')
  })
})
