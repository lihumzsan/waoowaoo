import { describe, expect, it, vi } from 'vitest'
import {
  MOUNTAIN_RESET_CONFIRMATION,
  assertMountainResetCanExecute,
  buildMountainResetPlan,
  createMountainResetSnapshot,
  defaultExtractStorageKey,
  executeMountainReset,
  parseMountainResetArgs,
  type MountainResetPlan,
} from '@/lib/novel-promotion/mountain-reset'

function makePlan(overrides: Partial<MountainResetPlan> = {}): MountainResetPlan {
  return {
    projectId: 'project-1',
    novelPromotionProjectId: 'novel-project-1',
    userId: 'user-1',
    projectName: 'mountain',
    dryRun: true,
    deleteStorage: true,
    forceActiveTasks: false,
    activeTasks: [],
    preserved: {
      project: {
        id: 'project-1',
        name: 'mountain',
        description: null,
        userId: 'user-1',
      },
      novelPromotionProject: {
        id: 'novel-project-1',
        projectId: 'project-1',
        analysisModel: 'openrouter::model',
        imageModel: 'image-model',
        videoModel: 'video-model',
        audioModel: null,
        characterModel: null,
        locationModel: null,
        storyboardModel: null,
        editModel: null,
        videoRatio: '16:9',
        videoResolution: '720p',
        imageResolution: '2K',
        workflowMode: 'srt',
        artStyle: 'american-comic',
        artStylePrompt: '',
        globalAssetText: '',
        capabilityOverrides: null,
      },
      episodes: [
        {
          id: 'episode-1',
          episodeNumber: 1,
          name: 'Episode 1',
          novelText: 'source text',
          novelTextLength: 11,
        },
      ],
    },
    counts: {
      episodes: 1,
      clips: 2,
      panels: 8,
      mediaObjects: 4,
      storageKeys: 4,
      activeTasks: 0,
    },
    ids: {
      episodeIds: ['episode-1'],
      storyboardIds: ['storyboard-1'],
      characterIds: ['character-1'],
      locationIds: ['location-1'],
      graphRunIds: [],
      mediaObjectIds: ['media-1', 'media-2'],
    },
    storageKeys: ['images/a.png', 'videos/b.mp4'],
    ...overrides,
  }
}

describe('mountain reset planning helpers', () => {
  it('defaults to dry-run and requires an explicit project id', () => {
    expect(parseMountainResetArgs({ argv: ['--projectId', 'project-1'] })).toMatchObject({
      projectId: 'project-1',
      dryRun: true,
      deleteStorage: true,
    })

    expect(() => parseMountainResetArgs({ argv: [] })).toThrow('Missing required --projectId')
  })

  it('turns confirmation into formal reset mode', () => {
    expect(parseMountainResetArgs({
      argv: ['--projectId=project-1', '--confirm', MOUNTAIN_RESET_CONFIRMATION, '--skip-storage'],
    })).toMatchObject({
      projectId: 'project-1',
      confirm: MOUNTAIN_RESET_CONFIRMATION,
      dryRun: false,
      deleteStorage: false,
    })
  })

  it('blocks formal reset without the exact confirmation token', () => {
    const plan = makePlan({ dryRun: false })

    expect(() => assertMountainResetCanExecute({
      projectId: 'project-1',
      dryRun: false,
      deleteStorage: true,
      forceActiveTasks: false,
      confirm: 'wrong',
    }, plan)).toThrow('Formal reset requires')
  })

  it('blocks active tasks unless the caller explicitly forces discard', () => {
    const plan = makePlan({
      activeTasks: [{
        id: 'task-1',
        type: 'video_panel',
        targetType: 'panel',
        targetId: 'panel-1',
        status: 'queued',
      }],
    })

    expect(() => assertMountainResetCanExecute({
      projectId: 'project-1',
      dryRun: false,
      deleteStorage: true,
      forceActiveTasks: false,
      confirm: MOUNTAIN_RESET_CONFIRMATION,
    }, plan)).toThrow('active task')

    expect(() => assertMountainResetCanExecute({
      projectId: 'project-1',
      dryRun: false,
      deleteStorage: true,
      forceActiveTasks: true,
      confirm: MOUNTAIN_RESET_CONFIRMATION,
    }, plan)).not.toThrow()
  })

  it('snapshots preserved source data without derived row payloads', () => {
    const snapshot = createMountainResetSnapshot(makePlan())

    expect(snapshot).toMatchObject({
      projectId: 'project-1',
      novelPromotionProjectId: 'novel-project-1',
      counts: expect.objectContaining({
        clips: 2,
        panels: 8,
      }),
      preserved: expect.objectContaining({
        episodes: [{
          id: 'episode-1',
          episodeNumber: 1,
          name: 'Episode 1',
          novelText: 'source text',
          novelTextLength: 11,
        }],
      }),
      storageKeys: ['images/a.png', 'videos/b.mp4'],
    })
  })

  it('extracts storage keys from local and fetchable URLs', () => {
    expect(defaultExtractStorageKey('/api/files/images%2Fa.png')).toBe('images/a.png')
    expect(defaultExtractStorageKey('videos/b.mp4')).toBe('videos/b.mp4')
    expect(defaultExtractStorageKey('https://cdn.example.com/uploads/c.png')).toBe('uploads/c.png')
    expect(defaultExtractStorageKey('/not-a-storage-route/c.png')).toBeNull()
  })

  it('collects Episode cover media ids and storage keys in the reset plan', async () => {
    const findNovelProject = vi.fn(async () => ({
      id: 'novel-project-1',
      projectId: 'project-1',
      analysisModel: null,
      imageModel: null,
      videoModel: null,
      audioModel: null,
      characterModel: null,
      locationModel: null,
      storyboardModel: null,
      editModel: null,
      videoRatio: '16:9',
      videoResolution: '720p',
      imageResolution: '2K',
      workflowMode: 'srt',
      artStyle: 'realistic',
      artStylePrompt: null,
      globalAssetText: null,
      capabilityOverrides: null,
      project: {
        id: 'project-1',
        name: 'Project 1',
        description: null,
        userId: 'user-1',
      },
      episodes: [{
        id: 'episode-1',
        episodeNumber: 1,
        name: 'Episode 1',
        novelText: 'source',
        description: null,
        audioUrl: null,
        audioMediaId: null,
        coverImageMediaId: 'media-cover-1',
        srtContent: null,
        speakerVoices: null,
      }],
    }))
    const findMediaObjects = vi.fn(async () => [{
      id: 'media-cover-1',
      storageKey: 'episode-cover/episode-1.png',
    }])
    const db = {
      novelPromotionProject: { findUnique: findNovelProject },
      novelPromotionStoryboard: { findMany: vi.fn(async () => []) },
      novelPromotionPanel: { findMany: vi.fn(async () => []) },
      supplementaryPanel: { findMany: vi.fn(async () => []) },
      novelPromotionClip: { findMany: vi.fn(async () => []) },
      novelPromotionShot: { findMany: vi.fn(async () => []) },
      novelPromotionVoiceLine: { findMany: vi.fn(async () => []) },
      videoEditorProject: { findMany: vi.fn(async () => []) },
      novelPromotionCharacter: { findMany: vi.fn(async () => []) },
      novelPromotionLocation: { findMany: vi.fn(async () => []) },
      task: { findMany: vi.fn(async () => []) },
      taskEvent: { count: vi.fn(async () => 0) },
      graphRun: { findMany: vi.fn(async () => []) },
      graphEvent: { count: vi.fn(async () => 0) },
      mediaObject: { findMany: findMediaObjects },
    }

    const plan = await buildMountainResetPlan(db as never, {
      projectId: 'project-1',
      dryRun: true,
      deleteStorage: true,
      forceActiveTasks: false,
    })

    expect(findNovelProject).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        episodes: expect.objectContaining({
          select: expect.objectContaining({ coverImageMediaId: true }),
        }),
      }),
    }))
    expect(findMediaObjects).toHaveBeenCalledWith({
      where: { id: { in: ['media-cover-1'] } },
      select: { id: true, storageKey: true },
    })
    expect(plan.ids.mediaObjectIds).toEqual(['media-cover-1'])
    expect(plan.storageKeys).toContain('episode-cover/episode-1.png')
  })

  it('clears Episode cover pointers before deleting reset media rows', async () => {
    const deleteModel = () => ({ deleteMany: vi.fn(async () => ({ count: 0 })) })
    const tx = {
      graphArtifact: deleteModel(),
      graphCheckpoint: deleteModel(),
      graphStepAttempt: deleteModel(),
      graphStep: deleteModel(),
      graphEvent: deleteModel(),
      graphRun: deleteModel(),
      taskEvent: deleteModel(),
      task: deleteModel(),
      videoEditorProject: deleteModel(),
      novelPromotionVoiceLine: deleteModel(),
      supplementaryPanel: deleteModel(),
      novelPromotionPanel: deleteModel(),
      novelPromotionShot: deleteModel(),
      novelPromotionStoryboard: deleteModel(),
      novelPromotionClip: deleteModel(),
      characterAppearance: deleteModel(),
      novelPromotionCharacter: deleteModel(),
      novelPromotionLocation: {
        ...deleteModel(),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
      locationImage: deleteModel(),
      novelPromotionEpisode: {
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const deleteMediaRows = vi.fn(async () => ({ count: 1 }))
    const db = {
      $transaction: vi.fn(async (callback) => await callback(tx)),
      mediaObject: { deleteMany: deleteMediaRows },
    }
    const plan = makePlan({
      ids: {
        ...makePlan().ids,
        mediaObjectIds: ['media-cover-1'],
      },
    })

    await executeMountainReset(db as never, plan)

    expect(tx.novelPromotionEpisode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['episode-1'] } },
      data: expect.objectContaining({ coverImageMediaId: null }),
    })
    expect(tx.novelPromotionEpisode.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      deleteMediaRows.mock.invocationCallOrder[0]!,
    )
  })
})
