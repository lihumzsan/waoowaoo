import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findMany: vi.fn(),
  },
  novelPromotionEpisode: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  buildFirstLastFramePromptFingerprint,
  FirstLastFramePromptValidationError,
  loadAdjacentFirstLastFramePanels,
} from '@/lib/novel-promotion/first-last-frame-prompt'

function panel(id: string, storyboardId: string, panelIndex: number, projectId = 'project-1') {
  return {
    id,
    storyboardId,
    panelIndex,
    linkedToNextPanel: id === 'panel-1',
    imageUrl: `images/${id}.png`,
    imageMediaId: `media-${id}`,
    imageMedia: {
      id: `media-${id}`,
      publicId: `public-${id}`,
      storageKey: `images/${id}.png`,
      sha256: `sha-${id}`,
    },
    storyboard: {
      episodeId: 'episode-1',
      episode: {
        novelPromotionProject: { projectId },
      },
    },
  }
}

describe('loadAdjacentFirstLastFramePanels', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([
      panel('panel-1', 'storyboard-1', 1),
      panel('panel-2', 'storyboard-2', 0),
    ])
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValue({
      id: 'episode-1',
      clips: [
        { storyboard: { panels: [{ id: 'panel-0' }, { id: 'panel-1' }] } },
        { storyboard: { panels: [{ id: 'panel-2' }, { id: 'panel-3' }] } },
      ],
    })
  })

  it('accepts consecutive panels across storyboard boundaries', async () => {
    const result = await loadAdjacentFirstLastFramePanels({
      projectId: 'project-1',
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      episodeId: 'episode-1',
    })

    expect(result.firstPanel.id).toBe('panel-1')
    expect(result.lastPanel.id).toBe('panel-2')
    expect(result.episodeId).toBe('episode-1')
  })

  it.each([
    ['missing panel', [panel('panel-1', 'storyboard-1', 1)]],
    ['cross-project panel', [
      panel('panel-1', 'storyboard-1', 1),
      panel('panel-2', 'storyboard-2', 0, 'project-2'),
    ]],
  ])('rejects %s', async (_label, panels) => {
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce(panels)

    await expect(loadAdjacentFirstLastFramePanels({
      projectId: 'project-1',
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
    })).rejects.toThrow()
  })

  it('rejects panels that are not consecutive in episode order', async () => {
    prismaMock.novelPromotionEpisode.findUnique.mockResolvedValueOnce({
      id: 'episode-1',
      clips: [{ storyboard: { panels: [
        { id: 'panel-1' },
        { id: 'panel-between' },
        { id: 'panel-2' },
      ] } }],
    })

    const result = loadAdjacentFirstLastFramePanels({
      projectId: 'project-1',
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
    })
    await expect(result).rejects.toBeInstanceOf(FirstLastFramePromptValidationError)
    await expect(result).rejects.toThrow('Panels are not adjacent')
  })

  it('rejects a removed link when link validation is requested', async () => {
    const unlinked = panel('panel-1', 'storyboard-1', 1)
    unlinked.linkedToNextPanel = false
    prismaMock.novelPromotionPanel.findMany.mockResolvedValueOnce([
      unlinked,
      panel('panel-2', 'storyboard-2', 0),
    ])

    await expect(loadAdjacentFirstLastFramePanels({
      projectId: 'project-1',
      firstPanelId: 'panel-1',
      lastPanelId: 'panel-2',
      requireLinked: true,
    })).rejects.toThrow('First/last frame link was removed')
  })
})

describe('buildFirstLastFramePromptFingerprint', () => {
  it('ignores signed URL query strings while tracking stable source context', () => {
    const first = {
      ...panel('panel-1', 'storyboard-1', 0),
      imageMedia: null,
      imageMediaId: null,
      imageUrl: 'https://cdn.example/images/panel-1.png?token=one',
      videoPrompt: 'walk toward the window',
      videoDurationBinding: JSON.stringify({ targetDurationSeconds: 8 }),
    }
    const last = {
      ...panel('panel-2', 'storyboard-1', 1),
      imageMedia: null,
      imageMediaId: null,
      imageUrl: 'https://cdn.example/images/panel-2.png?token=one',
      videoPrompt: 'pause at the window',
    }

    const original = buildFirstLastFramePromptFingerprint(first, last)
    const resigned = buildFirstLastFramePromptFingerprint(
      { ...first, imageUrl: 'https://cdn.example/images/panel-1.png?token=two' },
      { ...last, imageUrl: 'https://cdn.example/images/panel-2.png?token=two' },
    )
    const changed = buildFirstLastFramePromptFingerprint(
      { ...first, videoPrompt: 'turn away from the window' },
      last,
    )

    expect(resigned).toBe(original)
    expect(changed).not.toBe(original)
  })
})
