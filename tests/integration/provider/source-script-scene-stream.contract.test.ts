import { describe, expect, it } from 'vitest'
import {
  appendStructuredJsonChunk,
  createStructuredStreamParseState,
} from '@/lib/structured-stream/incremental-json'
import { sourceScriptSceneSegmentSchema } from '@/lib/edit-bible/schemas'

describe('source script provider scene stream contract', () => {
  it('emits each complete scene segment without waiting for the whole response', () => {
    const first = {
      episodeIndex: 0,
      episodeTitle: 'Episode',
      episodeSummary: 'Summary',
      actIndex: 0,
      actTitle: 'Act',
      actSummary: 'Act summary',
      sceneIndex: 0,
      title: 'Scene 1',
      location: 'Room',
      timeOfDay: 'Night',
      characters: ['A'],
      summary: 'A enters.',
      body: 'A enters the room.',
      beats: [{ beatIndex: 0, title: 'Enter', summary: 'A enters.' }],
    }
    const second = { ...first, sceneIndex: 1, title: 'Scene 2', body: 'A finds the letter.' }
    const firstJson = JSON.stringify(first)
    const secondJson = JSON.stringify(second)
    let state = createStructuredStreamParseState(['segments'])

    let result = appendStructuredJsonChunk(
      state,
      `{"version":1,"title":"Script","summary":"Summary","segments":[${firstJson},`,
    )
    expect(result.items.map((item) => sourceScriptSceneSegmentSchema.parse(item))).toEqual([first])
    expect(result.state.complete).toBe(false)

    state = result.state
    result = appendStructuredJsonChunk(state, `${secondJson}]}`)
    expect(result.items.map((item) => sourceScriptSceneSegmentSchema.parse(item))).toEqual([second])
    expect(result.state.complete).toBe(true)
  })
})
