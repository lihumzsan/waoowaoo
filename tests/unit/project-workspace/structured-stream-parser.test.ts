import { describe, expect, it } from 'vitest'
import {
  appendStructuredJsonChunk,
  createStructuredStreamObjectParseState,
  createStructuredStreamParseState,
} from '@/lib/structured-stream/incremental-json'

describe('incremental structured JSON parser', () => {
  it('emits array objects only after each item closes across chunks', () => {
    let state = createStructuredStreamParseState(['shots'])
    let result = appendStructuredJsonChunk(state, '{"shots":[{"shotNumber":1,')
    expect(result.items).toEqual([])

    state = result.state
    result = appendStructuredJsonChunk(state, '"title":"A"},{"shotNumber":2,"title":"B"}]}')

    expect(result.items).toEqual([
      { shotNumber: 1, title: 'A' },
      { shotNumber: 2, title: 'B' },
    ])
  })

  it('keeps escaped strings and nested objects intact', () => {
    let state = createStructuredStreamParseState(['cameraPlanOutput', 'panels'])
    let result = appendStructuredJsonChunk(state, '{"cameraPlanOutput":{"panels":[{"panelIndex":0,"note":"he said \\"go\\"",')
    expect(result.items).toEqual([])

    state = result.state
    result = appendStructuredJsonChunk(state, '"blocking":{"depth":["front","back"]}}]}}')

    expect(result.items).toEqual([
      {
        panelIndex: 0,
        note: 'he said "go"',
        blocking: { depth: ['front', 'back'] },
      },
    ])
  })

  it('does not emit incomplete objects', () => {
    const state = createStructuredStreamParseState(['items'])
    const result = appendStructuredJsonChunk(state, '{"items":[{"id":"one","nested":{"value":1}')

    expect(result.items).toEqual([])
    expect(result.state.complete).toBe(false)
  })

  it('fails explicitly when a balanced item is invalid JSON', () => {
    const state = createStructuredStreamParseState(['items'])

    expect(() => appendStructuredJsonChunk(state, '{"items":[{"id":,}]}'))
      .toThrow(/STRUCTURED_STREAM_JSON_ITEM_INVALID/)
  })

  it('emits a single object path only after the object closes', () => {
    let state = createStructuredStreamObjectParseState(['styleBible'])
    let result = appendStructuredJsonChunk(state, '{"styleBible":{"styleSummary":')
    expect(result.items).toEqual([])

    state = result.state
    result = appendStructuredJsonChunk(state, '"quiet noir"}}')

    expect(result.items).toEqual([{ styleSummary: 'quiet noir' }])
    expect(result.state.complete).toBe(true)
  })
})
