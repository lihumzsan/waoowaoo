import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  useQueryClientMock,
  useMutationMock,
  requestJsonWithErrorMock,
} = vi.hoisted(() => ({
  useQueryClientMock: vi.fn(() => ({ invalidateQueries: vi.fn() })),
  useMutationMock: vi.fn((options: unknown) => options),
  requestJsonWithErrorMock: vi.fn(),
}))

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => useQueryClientMock(),
  useMutation: (options: unknown) => useMutationMock(options),
}))

vi.mock('@/lib/query/mutations/mutation-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/query/mutations/mutation-shared')>(
    '@/lib/query/mutations/mutation-shared',
  )
  return {
    ...actual,
    invalidateQueryTemplates: vi.fn(),
    requestJsonWithError: requestJsonWithErrorMock,
  }
})

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string | number>) => {
    if (values && 'name' in values) {
      return `${key}:${String(values.name)}`
    }
    return key
  },
}))

import { useConfirmProjectLocationSelection } from '@/lib/query/mutations/location-management-mutations'
import {
  hasScriptArtifacts,
  hasStoryboardArtifacts,
  hasVideoArtifacts,
  resolveEpisodeArtifactReadiness,
} from '@/lib/project-workflow/episode-artifact-readiness'

interface ConfirmLocationSelectionMutation {
  mutationFn: (variables: { locationId: string }) => Promise<unknown>
}

describe('project location-backed confirm mutations', () => {
  beforeEach(() => {
    useQueryClientMock.mockClear()
    useMutationMock.mockClear()
    requestJsonWithErrorMock.mockReset()
    requestJsonWithErrorMock.mockResolvedValue({ success: true })
  })

  it('routes prop confirmation to the unified asset select-render endpoint', async () => {
    const mutation = useConfirmProjectLocationSelection('project-1', 'prop') as unknown as ConfirmLocationSelectionMutation

    await mutation.mutationFn({ locationId: 'prop-1' })

    expect(requestJsonWithErrorMock).toHaveBeenCalledTimes(1)
    expect(requestJsonWithErrorMock).toHaveBeenCalledWith(
      '/api/assets/prop-1/select-render',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'project',
          kind: 'prop',
          projectId: 'project-1',
          confirm: true,
        }),
      },
      '确认选择失败',
    )
  })
})

describe('episode artifact readiness', () => {
  it('treats script as ready only when edit-first script text exists', () => {
    expect(hasScriptArtifacts(null)).toBe(false)
    expect(hasScriptArtifacts({ bible: '' })).toBe(false)
    expect(hasScriptArtifacts({ bible: '  {"scenes":[]}' })).toBe(true)
  })

  it('treats storyboard as ready only when at least one storyboard has panels', () => {
    expect(hasStoryboardArtifacts([])).toBe(false)
    expect(hasStoryboardArtifacts([{ panels: [] }])).toBe(false)
    expect(hasStoryboardArtifacts([{ panels: [{ id: 'panel-1' }] }])).toBe(true)
  })

  it('treats video as ready only when at least one panel has videoUrl', () => {
    expect(hasVideoArtifacts([{ panels: [{ id: 'panel-1', videoUrl: '' }] }])).toBe(false)
    expect(hasVideoArtifacts([{ panels: [{ id: 'panel-1', videoUrl: 'https://example.com/video.mp4' }] }])).toBe(true)
  })

  it('derives full episode artifact readiness from persisted outputs', () => {
    const readiness = resolveEpisodeArtifactReadiness({
      novelText: 'story',
      editScript: { bible: '{"scenes":[]}' },
      storyboards: [
        {
          id: 'sb-1',
          episodeId: 'ep-1',
          storyboardTextJson: null,
          panelCount: 1,
          storyboardImageUrl: null,
          panels: [{
            id: 'panel-1',
            storyboardId: 'sb-1',
            panelIndex: 0,
            panelNumber: 1,
            shotType: null,
            cameraMove: null,
            description: null,
            location: null,
            characters: null,
            props: null,
            srtSegment: null,
            srtStart: null,
            srtEnd: null,
            duration: null,
            imagePrompt: null,
            videoPrompt: null,
            imageUrl: null,
            videoUrl: 'https://example.com/video.mp4',
            actingNotes: null,
          }],
        },
      ],
    })

    expect(readiness).toEqual({
      hasStory: true,
      hasScript: true,
      hasStoryboard: true,
      hasVideo: true,
    })
  })
})
