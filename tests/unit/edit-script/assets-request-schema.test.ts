import { describe, expect, it } from 'vitest'
import { generateEditAssetsRequestSchema } from '@/lib/edit-script/types'

describe('edit script assets request schema', () => {
  it('rejects wildcard requirement ids and uses omitted requirementId for all requirements', () => {
    expect(generateEditAssetsRequestSchema.safeParse({
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      requirementId: '*',
    }).success).toBe(false)

    expect(generateEditAssetsRequestSchema.safeParse({
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
    }).success).toBe(true)

    expect(generateEditAssetsRequestSchema.safeParse({
      episodeId: 'episode-1',
      editScriptId: 'edit-1',
      requirementId: 'req-1',
    }).success).toBe(true)
  })
})
