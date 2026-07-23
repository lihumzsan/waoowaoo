import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
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

const deleteMediaObjectIfUnreferencedMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/media/unreferenced-cleanup', () => ({
  deleteMediaObjectIfUnreferenced: deleteMediaObjectIfUnreferencedMock,
}))

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
      guardedCoverMediaObjectIds: [],
    },
    guardedCoverMedia: [],
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

  it('keeps cover media ids and storage keys out of destructive bulk reset sets', async () => {
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
        audioUrl: 'episode-cover/episode-1.png',
        audioMediaId: 'media-cover-1',
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
    expect(plan.ids.mediaObjectIds).toEqual([])
    expect(plan.ids.guardedCoverMediaObjectIds).toEqual(['media-cover-1'])
    expect(plan.guardedCoverMedia).toEqual([{
      id: 'media-cover-1',
      storageKey: 'episode-cover/episode-1.png',
    }])
    expect(plan.storageKeys).not.toContain('episode-cover/episode-1.png')
  })

  it('clears Episode cover pointers before guarded cleanup and preserves a shared cover', async () => {
    deleteMediaObjectIfUnreferencedMock.mockReset()
    const events: string[] = []
    deleteMediaObjectIfUnreferencedMock.mockImplementation(async () => {
      events.push('guarded-cover-checked')
      return 'referenced'
    })
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
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const deleteMediaRows = vi.fn(async () => ({ count: 1 }))
    const db = {
      $transaction: vi.fn(async (callback) => {
        const result = await callback(tx)
        events.push('reset-transaction-committed')
        return result
      }),
      mediaObject: { deleteMany: deleteMediaRows },
    }
    const plan = makePlan({
      ids: {
        ...makePlan().ids,
        mediaObjectIds: [],
        guardedCoverMediaObjectIds: ['media-cover-1'],
      },
      guardedCoverMedia: [{
        id: 'media-cover-1',
        storageKey: 'episode-cover/episode-1.png',
      }],
    })

    const result = await executeMountainReset(db as never, plan)

    expect(tx.novelPromotionEpisode.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['episode-1'] } },
      data: expect.objectContaining({ coverImageMediaId: null }),
    })
    expect(deleteMediaRows).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenCalledWith('media-cover-1')
    expect(events).toEqual(['reset-transaction-committed', 'guarded-cover-checked'])
    expect(result.coverMediaObjects).toMatchObject({
      attempted: 1,
      deleted: 0,
      referenced: 1,
      missing: 0,
      failed: 0,
      skipped: 0,
    })
  })

  it('guards a cover published after planning but before reset execution', async () => {
    deleteMediaObjectIfUnreferencedMock.mockReset()
    const events: string[] = []
    deleteMediaObjectIfUnreferencedMock.mockImplementation(async (mediaId: string) => {
      events.push(`guarded-cover-checked:${mediaId}`)
      return 'deleted'
    })
    const deleteModel = () => ({ deleteMany: vi.fn(async () => ({ count: 0 })) })
    const tx = {
      graphArtifact: deleteModel(),
      graphCheckpoint: deleteModel(),
      graphStepAttempt: deleteModel(),
      graphStep: deleteModel(),
      graphEvent: deleteModel(),
      graphRun: deleteModel(),
      taskEvent: deleteModel(),
      task: {
        deleteMany: vi.fn(async () => {
          events.push('project-tasks-deleted')
          return { count: 1 }
        }),
      },
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
        findMany: vi.fn(async () => {
          events.push('current-cover-read')
          return [{
            coverImageMediaId: 'media-cover-m1',
            coverImageMedia: { storageKey: 'episode-cover/m1.png' },
          }]
        }),
        updateMany: vi.fn(async () => {
          events.push('cover-pointer-cleared')
          return { count: 1 }
        }),
      },
    }
    const deleteMediaRows = vi.fn(async () => ({ count: 1 }))
    const db = {
      $transaction: vi.fn(async (callback) => {
        const result = await callback(tx)
        events.push('reset-transaction-committed')
        return result
      }),
      mediaObject: { deleteMany: deleteMediaRows },
    }
    const plan = makePlan({
      ids: {
        ...makePlan().ids,
        mediaObjectIds: ['media-cover-m1'],
        guardedCoverMediaObjectIds: ['media-cover-m0'],
      },
      guardedCoverMedia: [{
        id: 'media-cover-m0',
        storageKey: 'episode-cover/m0.png',
      }],
      storageKeys: ['episode-cover/m1.png', 'other/reset-object.png'],
    })

    const result = await executeMountainReset(db as never, plan)

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    })
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenNthCalledWith(1, 'media-cover-m0')
    expect(deleteMediaObjectIfUnreferencedMock).toHaveBeenNthCalledWith(2, 'media-cover-m1')
    expect(deleteMediaRows).not.toHaveBeenCalled()
    expect(result.plan.ids.mediaObjectIds).not.toContain('media-cover-m1')
    expect(result.plan.storageKeys).toEqual(['other/reset-object.png'])
    expect(events).toEqual([
      'project-tasks-deleted',
      'current-cover-read',
      'cover-pointer-cleared',
      'reset-transaction-committed',
      'guarded-cover-checked:media-cover-m0',
      'guarded-cover-checked:media-cover-m1',
    ])
    expect(result.coverMediaObjects).toMatchObject({
      attempted: 2,
      deleted: 2,
      failed: 0,
      skipped: 0,
    })
  })

  it('preserves guarded cover rows and storage when storage deletion is disabled', async () => {
    deleteMediaObjectIfUnreferencedMock.mockReset()
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
        findMany: vi.fn(async () => [{
          coverImageMediaId: 'media-cover-m1',
          coverImageMedia: { storageKey: 'episode-cover/m1.png' },
        }]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const deleteMediaRows = vi.fn(async () => ({ count: 0 }))
    const db = {
      $transaction: vi.fn(async (callback) => await callback(tx)),
      mediaObject: { deleteMany: deleteMediaRows },
    }
    const plan = makePlan({
      deleteStorage: false,
      ids: {
        ...makePlan().ids,
        mediaObjectIds: ['media-cover-m1'],
        guardedCoverMediaObjectIds: ['media-cover-m0'],
      },
      guardedCoverMedia: [{
        id: 'media-cover-m0',
        storageKey: 'episode-cover/m0.png',
      }],
      storageKeys: ['episode-cover/m1.png', 'other/reset-object.png'],
    })

    const result = await executeMountainReset(db as never, plan)

    expect(deleteMediaRows).not.toHaveBeenCalled()
    expect(deleteMediaObjectIfUnreferencedMock).not.toHaveBeenCalled()
    expect(result.plan.ids.mediaObjectIds).not.toContain('media-cover-m1')
    expect(result.plan.ids.guardedCoverMediaObjectIds).toEqual([
      'media-cover-m0',
      'media-cover-m1',
    ])
    expect(result.plan.storageKeys).toEqual(['other/reset-object.png'])
    expect(result.coverMediaObjects).toMatchObject({
      attempted: 2,
      deleted: 0,
      referenced: 0,
      missing: 0,
      failed: 0,
      skipped: 2,
    })
  })

  it('uses the execution-time effective plan for script bulk storage deletion', () => {
    const script = readFileSync('scripts/reset-mountain-pipeline.ts', 'utf8')

    expect(script).toContain('deleteObjects(result.plan.storageKeys)')
    expect(script).not.toContain('deleteObjects(plan.storageKeys)')
  })
})
