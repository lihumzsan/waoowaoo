import { describe, expect, it } from 'vitest'
import {
  applyCreativeResourceDataEdits,
  parseCreativeResourceDataValueJson,
} from '@/lib/creative-resource/creative-data'

describe('Creative Resource editable data', () => {
  it('applies minimal object-path edits while preserving unrelated data', () => {
    const result = applyCreativeResourceDataEdits({
      video: { prompt: 'old', durationSeconds: 15 },
      preserved: { note: 'keep' },
    }, [
      {
        op: 'set',
        path: ['video', 'prompt'],
        value: 'new',
      },
      {
        op: 'set',
        path: ['video', 'references'],
        value: [{
          $resourceRef: {
            revisionId: 'revision:image',
          },
        }],
      },
      { op: 'remove', path: ['video', 'durationSeconds'] },
    ])

    expect(result).toEqual({
      document: {
        video: {
          prompt: 'new',
          references: [{
            $resourceRef: {
              revisionId: 'revision:image',
            },
          }],
        },
        preserved: { note: 'keep' },
      },
      changedPaths: ['/video/prompt', '/video/references', '/video/durationSeconds'],
    })
  })

  it('accepts arbitrary JSON values without adding domain-specific fields to the tool', () => {
    expect(parseCreativeResourceDataValueJson(JSON.stringify({
      futureCapability: {
        cameraLanguage: ['locked-off', 'slow push'],
        confidence: 0.85,
      },
    }))).toEqual({
      futureCapability: {
        cameraLanguage: ['locked-off', 'slow push'],
        confidence: 0.85,
      },
    })
  })

  it('does not create empty parents when removing a missing path', () => {
    expect(applyCreativeResourceDataEdits({ preserved: true }, [{
      op: 'remove',
      path: ['missing', 'field'],
    }])).toEqual({
      document: { preserved: true },
      changedPaths: [],
    })
  })

  it('rejects unsafe object paths instead of mutating object prototypes', () => {
    expect(() => applyCreativeResourceDataEdits({}, [{
      op: 'set',
      path: ['__proto__', 'polluted'],
      value: true,
    }])).toThrow()
  })
})
