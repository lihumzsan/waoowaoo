import { describe, expect, it } from 'vitest'
import {
  buildH3PromptGraph,
  resolveH3ContinuationDurationFrames,
} from '@/lib/ai-providers/comfyui/profiles'
import { H3_CONTINUATION_GUIDE_FRAMES } from '@/lib/video-generation/h3-timeline'

const continuationFrameFilenames = Array.from(
  { length: 22 },
  (_, index) => `waoowaoo/prompt/continuation-${String(index).padStart(2, '0')}.png`,
)

describe('MiniMax H3 continuation profile', () => {
  it('adds a 22-frame guide before the first novel frame', () => {
    expect(H3_CONTINUATION_GUIDE_FRAMES).toBe(22)
    expect(resolveH3ContinuationDurationFrames(4)).toBe(124)

    const built = buildH3PromptGraph({
      mode: 'continuation',
      prompt: 'subject_definitions:\nContinue the established subject.',
      durationSeconds: 4,
      aspectRatio: '16:9',
      seed: 17,
      continuationFrameFilenames,
    })
    const graph = built.graph
    const loadNodes = Object.values(graph).filter((node) => node.class_type === 'LoadImage')
    const batchNodes = Object.values(graph).filter((node) => node.class_type === 'ImageBatch')
    const guideEntries = Object.entries(graph).filter(([, node]) => node.class_type === 'MiniMaxH3AddGuide')

    expect(built.profile.id).toBe('h3-continuation-dual-stage-2mp')
    expect(graph['309']?.inputs.length).toBe(124)
    expect(graph['309']?.inputs.first_frame).toBeUndefined()
    expect(graph['309']?.inputs.last_frame).toBeUndefined()
    expect(loadNodes).toHaveLength(22)
    expect(loadNodes.map((node) => node.inputs.image)).toEqual(continuationFrameFilenames)
    expect(batchNodes).toHaveLength(21)
    expect(guideEntries).toHaveLength(1)
    const [guideId, guide] = guideEntries[0]!
    expect(guide.inputs).toMatchObject({
      positive: ['309', 0],
      latent: ['309', 1],
      vae: ['119', 0],
      frame_idx: 0,
    })
    expect(graph['126']?.inputs.conditioning).toEqual([guideId, 0])
    expect(graph['232']?.inputs.conditioning).toEqual([guideId, 0])
  })

  it('rejects any guide batch that is not exactly 22 unique filenames', () => {
    expect(() => buildH3PromptGraph({
      mode: 'continuation',
      prompt: 'subject_definitions:\nContinue the established subject.',
      durationSeconds: 4,
      aspectRatio: '16:9',
      seed: 17,
      continuationFrameFilenames: continuationFrameFilenames.slice(0, 21),
    })).toThrow('COMFYUI_H3_CONTINUATION_FRAME_COUNT_INVALID')

    expect(() => buildH3PromptGraph({
      mode: 'continuation',
      prompt: 'subject_definitions:\nContinue the established subject.',
      durationSeconds: 4,
      aspectRatio: '16:9',
      seed: 17,
      continuationFrameFilenames: continuationFrameFilenames.map((name, index) => (
        index === 21 ? continuationFrameFilenames[20]! : name
      )),
    })).toThrow('COMFYUI_H3_CONTINUATION_FRAME_DUPLICATE')
  })
})
