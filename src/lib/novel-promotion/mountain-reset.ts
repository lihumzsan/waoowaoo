import type { Prisma, PrismaClient } from '@prisma/client'
import { deleteMediaObjectIfUnreferenced } from '@/lib/media/unreferenced-cleanup'

export const MOUNTAIN_RESET_CONFIRMATION = 'mountain'

export const MOUNTAIN_RESET_ACTIVE_TASK_STATUSES = [
  'queued',
  'processing',
  'running',
  'active',
] as const

type ResetDb = PrismaClient | Prisma.TransactionClient

export type MountainResetArgs = {
  projectId: string
  confirm?: string
  dryRun: boolean
  deleteStorage: boolean
  forceActiveTasks: boolean
}

export type MountainResetCounts = Record<string, number>

export type MountainResetPlan = {
  projectId: string
  novelPromotionProjectId: string
  userId: string
  projectName: string
  dryRun: boolean
  deleteStorage: boolean
  forceActiveTasks: boolean
  activeTasks: Array<{
    id: string
    type: string
    targetType: string
    targetId: string
    status: string
  }>
  preserved: {
    project: {
      id: string
      name: string
      description: string | null
      userId: string
    }
    novelPromotionProject: {
      id: string
      projectId: string
      analysisModel: string | null
      imageModel: string | null
      videoModel: string | null
      audioModel: string | null
      characterModel: string | null
      locationModel: string | null
      storyboardModel: string | null
      editModel: string | null
      videoRatio: string
      videoResolution: string
      imageResolution: string
      workflowMode: string
      artStyle: string
      artStylePrompt: string | null
      globalAssetText: string | null
      capabilityOverrides: string | null
    }
    episodes: Array<{
      id: string
      episodeNumber: number
      name: string
      novelText: string | null
      novelTextLength: number
    }>
  }
  counts: MountainResetCounts
  ids: {
    episodeIds: string[]
    storyboardIds: string[]
    characterIds: string[]
    locationIds: string[]
    graphRunIds: string[]
    mediaObjectIds: string[]
    guardedCoverMediaObjectIds: string[]
  }
  guardedCoverMedia: Array<{
    id: string
    storageKey: string
  }>
  storageKeys: string[]
}

export type MountainResetResult = {
  plan: MountainResetPlan
  deletedCounts: MountainResetCounts
  mediaObjects: {
    attempted: number
    deleted: number
    error?: string
  }
  coverMediaObjects: {
    attempted: number
    deleted: number
    referenced: number
    missing: number
    failed: number
    skipped: number
    errors?: Array<{
      mediaId: string
      storageKey?: string
      error: string
    }>
  }
}

export type MountainResetCliOptions = {
  defaultProjectId?: string
  argv?: string[]
}

type ExtractStorageKey = (input: string | null | undefined) => string | null

export function parseMountainResetArgs(options: MountainResetCliOptions = {}): MountainResetArgs {
  const argv = options.argv ?? process.argv.slice(2)
  let projectId = options.defaultProjectId ?? ''
  let confirm: string | undefined
  let dryRun = true
  let deleteStorage = true
  let forceActiveTasks = false

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${token}`)
      }
      index += 1
      return value
    }

    if (token === '--projectId') {
      projectId = readValue()
    } else if (token?.startsWith('--projectId=')) {
      projectId = token.slice('--projectId='.length)
    } else if (token === '--confirm') {
      confirm = readValue()
      dryRun = false
    } else if (token?.startsWith('--confirm=')) {
      confirm = token.slice('--confirm='.length)
      dryRun = false
    } else if (token === '--dryRun' || token === '--dry-run') {
      dryRun = true
    } else if (token === '--skipStorage' || token === '--skip-storage') {
      deleteStorage = false
    } else if (token === '--forceActiveTasks' || token === '--force-active-tasks') {
      forceActiveTasks = true
    } else if (token === '--help' || token === '-h') {
      throw new Error([
        'Usage:',
        '  npx tsx scripts/reset-mountain-pipeline.ts --projectId <id>',
        '  npx tsx scripts/reset-mountain-pipeline.ts --projectId <id> --confirm mountain',
      ].join('\n'))
    } else {
      throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (!projectId) {
    throw new Error('Missing required --projectId')
  }

  return {
    projectId,
    confirm,
    dryRun,
    deleteStorage,
    forceActiveTasks,
  }
}

export function assertMountainResetCanExecute(args: MountainResetArgs, plan: MountainResetPlan): void {
  if (args.dryRun) return

  if (args.confirm !== MOUNTAIN_RESET_CONFIRMATION) {
    throw new Error(`Formal reset requires --confirm ${MOUNTAIN_RESET_CONFIRMATION}`)
  }

  if (plan.activeTasks.length > 0 && !args.forceActiveTasks) {
    throw new Error(`Project has ${plan.activeTasks.length} active task(s); rerun with --force-active-tasks after confirming they can be discarded`)
  }
}

export function createMountainResetSnapshot(plan: MountainResetPlan): Record<string, unknown> {
  return {
    createdAt: new Date().toISOString(),
    projectId: plan.projectId,
    novelPromotionProjectId: plan.novelPromotionProjectId,
    userId: plan.userId,
    preserved: plan.preserved,
    counts: plan.counts,
    activeTasks: plan.activeTasks,
    mediaObjectIds: plan.ids.mediaObjectIds,
    guardedCoverMediaObjectIds: plan.ids.guardedCoverMediaObjectIds,
    storageKeys: plan.storageKeys,
  }
}

export function defaultExtractStorageKey(input: string | null | undefined): string | null {
  const value = input?.trim()
  if (!value) return null

  if (value.startsWith('/api/files/')) {
    return decodeURIComponent(value.slice('/api/files/'.length)).replace(/^\/+/, '')
  }

  if (!value.startsWith('http://') && !value.startsWith('https://') && !value.startsWith('/')) {
    return value.replace(/^\/+/, '')
  }

  try {
    const parsed = new URL(value)
    return decodeURIComponent(parsed.pathname).replace(/^\/+/, '') || null
  } catch {
    return null
  }
}

export async function buildMountainResetPlan(
  db: ResetDb,
  args: MountainResetArgs,
  extractStorageKey: ExtractStorageKey = defaultExtractStorageKey,
): Promise<MountainResetPlan> {
  const novelProject = await db.novelPromotionProject.findUnique({
    where: { projectId: args.projectId },
    select: {
      id: true,
      projectId: true,
      analysisModel: true,
      imageModel: true,
      videoModel: true,
      audioModel: true,
      characterModel: true,
      locationModel: true,
      storyboardModel: true,
      editModel: true,
      videoRatio: true,
      videoResolution: true,
      imageResolution: true,
      workflowMode: true,
      artStyle: true,
      artStylePrompt: true,
      globalAssetText: true,
      capabilityOverrides: true,
      project: {
        select: {
          id: true,
          name: true,
          description: true,
          userId: true,
        },
      },
      episodes: {
        orderBy: { episodeNumber: 'asc' },
        select: {
          id: true,
          episodeNumber: true,
          name: true,
          novelText: true,
          description: true,
          audioUrl: true,
          audioMediaId: true,
          coverImageMediaId: true,
          srtContent: true,
          speakerVoices: true,
        },
      },
    },
  })

  if (!novelProject) {
    throw new Error(`Novel promotion project not found for projectId ${args.projectId}`)
  }

  const episodeIds = novelProject.episodes.map((episode) => episode.id)

  const [
    storyboards,
    panels,
    supplementaryPanels,
    clips,
    shots,
    voiceLines,
    editorProjects,
    characters,
    locations,
    tasks,
    taskEventsCount,
    graphRuns,
    graphEventsCount,
  ] = await Promise.all([
    db.novelPromotionStoryboard.findMany({
      where: { episodeId: { in: episodeIds } },
      select: {
        id: true,
        storyboardImageUrl: true,
        imageHistory: true,
        candidateImages: true,
      },
    }),
    db.novelPromotionPanel.findMany({
      where: { storyboard: { episodeId: { in: episodeIds } } },
      select: {
        id: true,
        imageUrl: true,
        imageMediaId: true,
        imageHistory: true,
        videoUrl: true,
        videoMediaId: true,
        lipSyncVideoUrl: true,
        lipSyncVideoMediaId: true,
        sketchImageUrl: true,
        sketchImageMediaId: true,
        previousImageUrl: true,
        previousImageMediaId: true,
        candidateImages: true,
      },
    }),
    db.supplementaryPanel.findMany({
      where: { storyboard: { episodeId: { in: episodeIds } } },
      select: {
        id: true,
        imageUrl: true,
        imageMediaId: true,
      },
    }),
    db.novelPromotionClip.findMany({
      where: { episodeId: { in: episodeIds } },
      select: { id: true },
    }),
    db.novelPromotionShot.findMany({
      where: { episodeId: { in: episodeIds } },
      select: {
        id: true,
        imageUrl: true,
        imageMediaId: true,
      },
    }),
    db.novelPromotionVoiceLine.findMany({
      where: { episodeId: { in: episodeIds } },
      select: {
        id: true,
        audioUrl: true,
        audioMediaId: true,
      },
    }),
    db.videoEditorProject.findMany({
      where: { episodeId: { in: episodeIds } },
      select: {
        id: true,
        outputUrl: true,
      },
    }),
    db.novelPromotionCharacter.findMany({
      where: { novelPromotionProjectId: novelProject.id },
      select: {
        id: true,
        customVoiceUrl: true,
        customVoiceMediaId: true,
        appearances: {
          select: {
            id: true,
            imageUrl: true,
            imageUrls: true,
            imageMediaId: true,
            previousImageUrl: true,
            previousImageUrls: true,
          },
        },
      },
    }),
    db.novelPromotionLocation.findMany({
      where: { novelPromotionProjectId: novelProject.id },
      select: {
        id: true,
        selectedImageId: true,
        images: {
          select: {
            id: true,
            imageUrl: true,
            imageMediaId: true,
            previousImageUrl: true,
          },
        },
      },
    }),
    db.task.findMany({
      where: { projectId: args.projectId },
      select: {
        id: true,
        type: true,
        targetType: true,
        targetId: true,
        status: true,
      },
    }),
    db.taskEvent.count({ where: { projectId: args.projectId } }),
    db.graphRun.findMany({
      where: { projectId: args.projectId },
      select: { id: true },
    }),
    db.graphEvent.count({ where: { projectId: args.projectId } }),
  ])

  const storyboardIds = storyboards.map((storyboard) => storyboard.id)
  const characterIds = characters.map((character) => character.id)
  const locationIds = locations.map((location) => location.id)
  const graphRunIds = graphRuns.map((run) => run.id)
  const mediaIds = new Set<string>()
  const guardedCoverMediaIds = new Set<string>()
  const storageKeys = new Set<string>()

  const addMediaId = (id: string | null | undefined) => {
    if (id) mediaIds.add(id)
  }
  const addStorageKey = (value: string | null | undefined) => {
    const key = extractStorageKey(value)
    if (key) storageKeys.add(key)
  }
  const addJsonStorageKeys = (value: string | null | undefined) => {
    if (!value) return
    try {
      const parsed = JSON.parse(value) as unknown
      collectStorageKeysFromUnknown(parsed, addStorageKey)
    } catch {
      addStorageKey(value)
    }
  }

  for (const episode of novelProject.episodes) {
    addMediaId(episode.audioMediaId)
    if (episode.coverImageMediaId) guardedCoverMediaIds.add(episode.coverImageMediaId)
    addStorageKey(episode.audioUrl)
  }

  for (const panel of panels) {
    addMediaId(panel.imageMediaId)
    addMediaId(panel.videoMediaId)
    addMediaId(panel.lipSyncVideoMediaId)
    addMediaId(panel.sketchImageMediaId)
    addMediaId(panel.previousImageMediaId)
    addStorageKey(panel.imageUrl)
    addStorageKey(panel.videoUrl)
    addStorageKey(panel.lipSyncVideoUrl)
    addStorageKey(panel.sketchImageUrl)
    addStorageKey(panel.previousImageUrl)
    addJsonStorageKeys(panel.imageHistory)
    addJsonStorageKeys(panel.candidateImages)
  }

  for (const storyboard of storyboards) {
    addStorageKey(storyboard.storyboardImageUrl)
    addJsonStorageKeys(storyboard.imageHistory)
    addJsonStorageKeys(storyboard.candidateImages)
  }

  for (const supplementaryPanel of supplementaryPanels) {
    addMediaId(supplementaryPanel.imageMediaId)
    addStorageKey(supplementaryPanel.imageUrl)
  }

  for (const shot of shots) {
    addMediaId(shot.imageMediaId)
    addStorageKey(shot.imageUrl)
  }

  for (const voiceLine of voiceLines) {
    addMediaId(voiceLine.audioMediaId)
    addStorageKey(voiceLine.audioUrl)
  }

  for (const editorProject of editorProjects) {
    addStorageKey(editorProject.outputUrl)
  }

  for (const character of characters) {
    addMediaId(character.customVoiceMediaId)
    addStorageKey(character.customVoiceUrl)
    for (const appearance of character.appearances) {
      addMediaId(appearance.imageMediaId)
      addStorageKey(appearance.imageUrl)
      addStorageKey(appearance.previousImageUrl)
      addJsonStorageKeys(appearance.imageUrls)
      addJsonStorageKeys(appearance.previousImageUrls)
    }
  }

  for (const location of locations) {
    for (const image of location.images) {
      addMediaId(image.imageMediaId)
      addStorageKey(image.imageUrl)
      addStorageKey(image.previousImageUrl)
    }
  }

  for (const coverMediaId of guardedCoverMediaIds) {
    mediaIds.delete(coverMediaId)
  }

  const allMediaIds = [...new Set([...mediaIds, ...guardedCoverMediaIds])]
  const allMediaObjects = allMediaIds.length > 0
    ? await db.mediaObject.findMany({
      where: { id: { in: allMediaIds } },
      select: {
        id: true,
        storageKey: true,
      },
    })
    : []

  const guardedCoverMedia = allMediaObjects.filter((mediaObject) => (
    guardedCoverMediaIds.has(mediaObject.id)
  ))
  const mediaObjects = allMediaObjects.filter((mediaObject) => !guardedCoverMediaIds.has(mediaObject.id))

  for (const mediaObject of mediaObjects) {
    storageKeys.add(mediaObject.storageKey)
  }
  for (const coverMedia of guardedCoverMedia) {
    storageKeys.delete(coverMedia.storageKey)
  }

  const activeStatuses = new Set<string>(MOUNTAIN_RESET_ACTIVE_TASK_STATUSES)
  const activeTasks = tasks
    .filter((task) => activeStatuses.has(task.status))
    .map((task) => ({
      id: task.id,
      type: task.type,
      targetType: task.targetType,
      targetId: task.targetId,
      status: task.status,
    }))

  return {
    projectId: args.projectId,
    novelPromotionProjectId: novelProject.id,
    userId: novelProject.project.userId,
    projectName: novelProject.project.name,
    dryRun: args.dryRun,
    deleteStorage: args.deleteStorage,
    forceActiveTasks: args.forceActiveTasks,
    activeTasks,
    preserved: {
      project: novelProject.project,
      novelPromotionProject: {
        id: novelProject.id,
        projectId: novelProject.projectId,
        analysisModel: novelProject.analysisModel,
        imageModel: novelProject.imageModel,
        videoModel: novelProject.videoModel,
        audioModel: novelProject.audioModel,
        characterModel: novelProject.characterModel,
        locationModel: novelProject.locationModel,
        storyboardModel: novelProject.storyboardModel,
        editModel: novelProject.editModel,
        videoRatio: novelProject.videoRatio,
        videoResolution: novelProject.videoResolution,
        imageResolution: novelProject.imageResolution,
        workflowMode: novelProject.workflowMode,
        artStyle: novelProject.artStyle,
        artStylePrompt: novelProject.artStylePrompt,
        globalAssetText: novelProject.globalAssetText,
        capabilityOverrides: novelProject.capabilityOverrides,
      },
      episodes: novelProject.episodes.map((episode) => ({
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        novelText: episode.novelText,
        novelTextLength: episode.novelText?.length ?? 0,
      })),
    },
    counts: {
      episodes: novelProject.episodes.length,
      clips: clips.length,
      storyboards: storyboards.length,
      panels: panels.length,
      supplementaryPanels: supplementaryPanels.length,
      shots: shots.length,
      voiceLines: voiceLines.length,
      videoEditorProjects: editorProjects.length,
      characters: characters.length,
      characterAppearances: characters.reduce((sum, character) => sum + character.appearances.length, 0),
      locations: locations.length,
      locationImages: locations.reduce((sum, location) => sum + location.images.length, 0),
      tasks: tasks.length,
      taskEvents: taskEventsCount,
      graphRuns: graphRuns.length,
      graphEvents: graphEventsCount,
      mediaObjects: allMediaObjects.length,
      storageKeys: storageKeys.size,
      activeTasks: activeTasks.length,
    },
    ids: {
      episodeIds,
      storyboardIds,
      characterIds,
      locationIds,
      graphRunIds,
      mediaObjectIds: mediaObjects.map((mediaObject) => mediaObject.id),
      guardedCoverMediaObjectIds: [...guardedCoverMediaIds],
    },
    guardedCoverMedia,
    storageKeys: [...storageKeys].sort(),
  }
}

export async function executeMountainReset(db: PrismaClient, plan: MountainResetPlan): Promise<MountainResetResult> {
  const resetResult = await db.$transaction(async (tx: Prisma.TransactionClient) => {
    const counts: MountainResetCounts = {}
    const episodeWhere = { episodeId: { in: plan.ids.episodeIds } }
    const storyboardWhere = { storyboardId: { in: plan.ids.storyboardIds } }
    const runWhere = { runId: { in: plan.ids.graphRunIds } }

    counts.graphArtifacts = (await tx.graphArtifact.deleteMany({ where: runWhere })).count
    counts.graphCheckpoints = (await tx.graphCheckpoint.deleteMany({ where: runWhere })).count
    counts.graphStepAttempts = (await tx.graphStepAttempt.deleteMany({ where: runWhere })).count
    counts.graphSteps = (await tx.graphStep.deleteMany({ where: runWhere })).count
    counts.graphEvents = (await tx.graphEvent.deleteMany({ where: { projectId: plan.projectId } })).count
    counts.graphRuns = (await tx.graphRun.deleteMany({ where: { projectId: plan.projectId } })).count

    counts.taskEvents = (await tx.taskEvent.deleteMany({ where: { projectId: plan.projectId } })).count
    counts.tasks = (await tx.task.deleteMany({ where: { projectId: plan.projectId } })).count

    const currentCoverMedia = await tx.novelPromotionEpisode.findMany({
      where: { id: { in: plan.ids.episodeIds } },
      select: {
        coverImageMediaId: true,
        coverImageMedia: { select: { storageKey: true } },
      },
    })

    counts.videoEditorProjects = (await tx.videoEditorProject.deleteMany({
      where: { episodeId: { in: plan.ids.episodeIds } },
    })).count
    counts.voiceLines = (await tx.novelPromotionVoiceLine.deleteMany({ where: episodeWhere })).count
    counts.supplementaryPanels = (await tx.supplementaryPanel.deleteMany({ where: storyboardWhere })).count
    counts.panels = (await tx.novelPromotionPanel.deleteMany({ where: storyboardWhere })).count
    counts.shots = (await tx.novelPromotionShot.deleteMany({ where: episodeWhere })).count
    counts.storyboards = (await tx.novelPromotionStoryboard.deleteMany({ where: episodeWhere })).count
    counts.clips = (await tx.novelPromotionClip.deleteMany({ where: episodeWhere })).count

    counts.characterAppearances = (await tx.characterAppearance.deleteMany({
      where: { characterId: { in: plan.ids.characterIds } },
    })).count
    counts.characters = (await tx.novelPromotionCharacter.deleteMany({
      where: { novelPromotionProjectId: plan.novelPromotionProjectId },
    })).count

    await tx.novelPromotionLocation.updateMany({
      where: { id: { in: plan.ids.locationIds } },
      data: { selectedImageId: null },
    })
    counts.locationImages = (await tx.locationImage.deleteMany({
      where: { locationId: { in: plan.ids.locationIds } },
    })).count
    counts.locations = (await tx.novelPromotionLocation.deleteMany({
      where: { novelPromotionProjectId: plan.novelPromotionProjectId },
    })).count

    counts.episodesUpdated = (await tx.novelPromotionEpisode.updateMany({
      where: { id: { in: plan.ids.episodeIds } },
      data: {
        description: null,
        audioUrl: null,
        audioMediaId: null,
        coverImageMediaId: null,
        srtContent: null,
        speakerVoices: null,
      },
    })).count

    return { counts, currentCoverMedia }
  }, { isolationLevel: 'Serializable' })

  const guardedCoverMediaById = new Map(
    plan.guardedCoverMedia.map((media) => [media.id, media]),
  )
  const guardedCoverMediaObjectIds = new Set(plan.ids.guardedCoverMediaObjectIds)
  for (const currentCover of resetResult.currentCoverMedia) {
    if (!currentCover.coverImageMediaId) continue
    guardedCoverMediaObjectIds.add(currentCover.coverImageMediaId)
    if (currentCover.coverImageMedia) {
      guardedCoverMediaById.set(currentCover.coverImageMediaId, {
        id: currentCover.coverImageMediaId,
        storageKey: currentCover.coverImageMedia.storageKey,
      })
    }
  }
  const guardedStorageKeys = new Set(
    [...guardedCoverMediaById.values()].map((media) => media.storageKey),
  )
  const effectivePlan: MountainResetPlan = {
    ...plan,
    ids: {
      ...plan.ids,
      mediaObjectIds: plan.ids.mediaObjectIds.filter((id) => !guardedCoverMediaObjectIds.has(id)),
      guardedCoverMediaObjectIds: [...guardedCoverMediaObjectIds],
    },
    guardedCoverMedia: [...guardedCoverMediaById.values()],
    storageKeys: plan.storageKeys.filter((key) => !guardedStorageKeys.has(key)),
  }
  const deletedCounts = resetResult.counts

  let mediaObjects: MountainResetResult['mediaObjects'] = {
    attempted: effectivePlan.ids.mediaObjectIds.length,
    deleted: 0,
  }

  if (effectivePlan.ids.mediaObjectIds.length > 0) {
    try {
      const result = await db.mediaObject.deleteMany({
        where: { id: { in: effectivePlan.ids.mediaObjectIds } },
      })
      mediaObjects = {
        attempted: effectivePlan.ids.mediaObjectIds.length,
        deleted: result.count,
      }
    } catch (error) {
      mediaObjects = {
        attempted: effectivePlan.ids.mediaObjectIds.length,
        deleted: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const coverMediaObjects: MountainResetResult['coverMediaObjects'] = {
    attempted: effectivePlan.ids.guardedCoverMediaObjectIds.length,
    deleted: 0,
    referenced: 0,
    missing: 0,
    failed: 0,
    skipped: effectivePlan.deleteStorage ? 0 : effectivePlan.ids.guardedCoverMediaObjectIds.length,
  }

  if (effectivePlan.deleteStorage) {
    const storageKeysById = new Map(effectivePlan.guardedCoverMedia.map((media) => [media.id, media.storageKey]))
    const errors: NonNullable<MountainResetResult['coverMediaObjects']['errors']> = []
    for (const mediaId of effectivePlan.ids.guardedCoverMediaObjectIds) {
      try {
        const result = await deleteMediaObjectIfUnreferenced(mediaId)
        coverMediaObjects[result] += 1
      } catch (error) {
        coverMediaObjects.failed += 1
        errors.push({
          mediaId,
          storageKey: storageKeysById.get(mediaId),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (errors.length > 0) coverMediaObjects.errors = errors
  }

  return {
    plan: effectivePlan,
    deletedCounts,
    mediaObjects,
    coverMediaObjects,
  }
}

function collectStorageKeysFromUnknown(value: unknown, addStorageKey: (value: string) => void): void {
  if (typeof value === 'string') {
    addStorageKey(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStorageKeysFromUnknown(item, addStorageKey)
    }
    return
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStorageKeysFromUnknown(item, addStorageKey)
    }
  }
}
