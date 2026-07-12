import { describe, expect, it } from 'vitest'
import { normalizeSourceScriptSegments } from '@/lib/edit-bible/source-script-segments'
import type { SourceScriptSceneSegment } from '@/lib/edit-bible/schemas'

function segment(sceneIndex: number, overrides: Partial<SourceScriptSceneSegment> = {}): SourceScriptSceneSegment {
  return {
    episodeIndex: 0,
    episodeTitle: 'Episode',
    episodeSummary: 'Episode summary',
    actIndex: 0,
    actTitle: 'Act',
    actSummary: 'Act summary',
    sceneIndex,
    title: `Scene ${sceneIndex + 1}`,
    location: 'Room',
    timeOfDay: 'Night',
    characters: ['A'],
    summary: `Summary ${sceneIndex + 1}`,
    body: `Scene body ${sceneIndex + 1}`,
    beats: [{ beatIndex: 0, title: 'Beat', summary: 'Beat summary' }],
    ...overrides,
  }
}

describe('source script scene segment normalizer', () => {
  it('derives both normalizedText and nested structure from one scene-level source', () => {
    const result = normalizeSourceScriptSegments({
      title: 'Script',
      summary: 'Script summary',
      segments: [segment(0), segment(1)],
    })

    expect(result.normalizedText).toBe('Scene body 1\n\nScene body 2')
    expect(result.structure.episodes[0]?.acts[0]?.scenes.map((scene) => scene.sceneIndex)).toEqual([0, 1])
  })

  it('rejects duplicate and non-contiguous scene indexes', () => {
    expect(() => normalizeSourceScriptSegments({
      title: 'Script', summary: 'Summary', segments: [segment(0), segment(0)],
    })).toThrow('EDIT_SOURCE_SCRIPT_SEGMENT_DUPLICATE:0:0:0')
    expect(() => normalizeSourceScriptSegments({
      title: 'Script', summary: 'Summary', segments: [segment(0), segment(2)],
    })).toThrow('EDIT_SOURCE_SCRIPT_SCENE_INDEX_NON_CONTIGUOUS:0:0:2')
  })

  it('rejects conflicting parent metadata', () => {
    expect(() => normalizeSourceScriptSegments({
      title: 'Script',
      summary: 'Summary',
      segments: [segment(0), segment(1, { actTitle: 'Conflicting Act' })],
    })).toThrow('EDIT_SOURCE_SCRIPT_ACT_METADATA_CONFLICT:0:0')
  })
})
