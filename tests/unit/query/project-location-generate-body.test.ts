import { describe, expect, it } from 'vitest'
import { buildProjectLocationGenerateImageBody } from '@/lib/query/mutations/location-image-mutations'

describe('buildProjectLocationGenerateImageBody', () => {
  it('does not include legacy artStyle in project location image generation', () => {
    expect(buildProjectLocationGenerateImageBody({
      projectId: 'project-1',
      locationId: 'location-1',
      count: 1,
    })).toEqual({
      scope: 'project',
      kind: 'location',
      projectId: 'project-1',
      imageIndex: undefined,
      count: 1,
    })
  })
})
