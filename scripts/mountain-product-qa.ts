import { prisma } from '@/lib/prisma'
import { buildImageTaskPayload, getProjectModelConfig, resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { resolveBuiltinCapabilitiesByModelKey } from '@/lib/model-capabilities/lookup'
import { imageQueue, textQueue, videoQueue, voiceQueue } from '@/lib/task/queues'
import { submitTask } from '@/lib/task/submitter'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import { queueRedis, redis } from '@/lib/redis'
import { resolvePanelVideoReadinessIssue, summarizeVideoReadinessIssues } from '@/lib/novel-promotion/video-readiness'
import { buildPanelContinuityPacket, isStructuredMultiShotPrompt, renderPanelContinuityPrompt } from '@/lib/novel-promotion/panel-continuity'
import { estimateVoiceLineMaxSeconds } from '@/lib/voice/generate-voice-line'
import { generateUniqueKey, uploadObject } from '@/lib/storage'
import { resolveMediaContentType, resolveMediaExt } from '@/lib/media-process'

const DEFAULT_PROJECT_ID = '8cc23f52-531c-45f5-8ada-8eaac1666b25'
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'dismissed'])

type Stage =
  | 'global'
  | 'profiles'
  | 'clips'
  | 'screenplay'
  | 'storyboard'
  | 'assets'
  | 'images'
  | 'voices'
  | 'videos'
  | 'qa'
  | 'episode1'

type Args = {
  projectId: string
  episodeNumber: number
  stage: Stage
  imageLimit: number | null
  videoLimit: number | null
  timeoutMs: number
}

type SubmittedTask = {
  taskId: string
  type: string
  targetId: string
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  let projectId = DEFAULT_PROJECT_ID
  let episodeNumber = 1
  let stage: Stage = 'episode1'
  let imageLimit: number | null = null
  let videoLimit: number | null = null
  let timeoutMs = 30 * 60 * 1000

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const readValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${token}`)
      index += 1
      return value
    }

    if (token === '--projectId') {
      projectId = readValue()
    } else if (token === '--episodeNumber') {
      episodeNumber = Number(readValue())
    } else if (token === '--stage') {
      stage = readValue() as Stage
    } else if (token === '--imageLimit') {
      imageLimit = Number(readValue())
    } else if (token === '--videoLimit') {
      videoLimit = Number(readValue())
    } else if (token === '--timeoutMinutes') {
      timeoutMs = Number(readValue()) * 60 * 1000
    } else {
      throw new Error(`Unknown argument: ${token}`)
    }
  }

  if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) {
    throw new Error('--episodeNumber must be a positive number')
  }
  if (imageLimit !== null && (!Number.isFinite(imageLimit) || imageLimit < 0)) {
    throw new Error('--imageLimit must be a non-negative number')
  }
  if (videoLimit !== null && (!Number.isFinite(videoLimit) || videoLimit < 0)) {
    throw new Error('--videoLimit must be a non-negative number')
  }

  return {
    projectId,
    episodeNumber: Math.floor(episodeNumber),
    stage,
    imageLimit: imageLimit === null ? null : Math.floor(imageLimit),
    videoLimit: videoLimit === null ? null : Math.floor(videoLimit),
    timeoutMs,
  }
}

function write(event: string, payload: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ event, ...payload })}\n`)
}

async function waitForTask(taskId: string, timeoutMs: number) {
  const startedAt = Date.now()
  let lastStatus = ''
  let lastProgress = -1

  while (Date.now() - startedAt < timeoutMs) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        type: true,
        targetId: true,
        status: true,
        progress: true,
        result: true,
        errorCode: true,
        errorMessage: true,
      },
    })
    if (!task) throw new Error(`Task not found: ${taskId}`)
    if (task.status !== lastStatus || task.progress !== lastProgress) {
      write('task_progress', {
        taskId,
        type: task.type,
        targetId: task.targetId,
        status: task.status,
        progress: task.progress,
      })
      lastStatus = task.status
      lastProgress = task.progress
    }
    if (TERMINAL_STATUSES.has(task.status)) {
      if (task.status !== 'completed') {
        throw new Error(`Task ${taskId} ${task.status}: ${task.errorMessage || task.errorCode || 'unknown error'}`)
      }
      return task
    }
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  throw new Error(`Task timeout after ${Math.round(timeoutMs / 1000)}s: ${taskId}`)
}

async function waitForTasks(tasks: SubmittedTask[], timeoutMs: number): Promise<void> {
  for (const task of tasks) {
    await waitForTask(task.taskId, timeoutMs)
  }
}

async function getProjectAndEpisode(projectId: string, episodeNumber: number) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      novelPromotionData: {
        include: {
          episodes: {
            where: { episodeNumber },
            take: 1,
          },
        },
      },
    },
  })
  if (!project?.novelPromotionData) throw new Error(`Project not found: ${projectId}`)
  const episode = project.novelPromotionData.episodes[0]
  if (!episode) throw new Error(`Episode ${episodeNumber} not found`)
  return { project, novelProject: project.novelPromotionData, episode }
}

async function submitTextTask(params: {
  projectId: string
  userId: string
  episodeId?: string | null
  type: TaskType
  targetType: string
  targetId: string
  dedupeKey: string
  priority?: number
  payload?: Record<string, unknown>
}) {
  const config = await getProjectModelConfig(params.projectId, params.userId)
  if (!config.analysisModel) throw new Error('analysisModel not configured')
  const payload = {
    ...(params.payload || {}),
    model: config.analysisModel,
    analysisModel: config.analysisModel,
    displayMode: 'detail',
    sync: 1,
  }
  const submitted = await submitTask({
    userId: params.userId,
    locale: 'zh',
    projectId: params.projectId,
    episodeId: params.episodeId || null,
    type: params.type,
    targetType: params.targetType,
    targetId: params.targetId,
    payload,
    dedupeKey: params.dedupeKey,
    priority: params.priority,
  })
  return submitted.taskId
}

async function runGlobalAnalysis(projectId: string, userId: string, timeoutMs: number): Promise<void> {
  const taskId = await submitTextTask({
    projectId,
    userId,
    type: TASK_TYPE.ANALYZE_GLOBAL,
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    dedupeKey: `analyze_global:${projectId}`,
  })
  await waitForTask(taskId, timeoutMs)
}

async function runCharacterProfiles(projectId: string, userId: string, timeoutMs: number): Promise<void> {
  const taskId = await submitTextTask({
    projectId,
    userId,
    type: TASK_TYPE.CHARACTER_PROFILE_BATCH_CONFIRM,
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    dedupeKey: `character_profile_batch_confirm:${projectId}`,
  })
  await waitForTask(taskId, timeoutMs)
}

async function runClips(projectId: string, userId: string, episodeId: string, timeoutMs: number): Promise<void> {
  const taskId = await submitTextTask({
    projectId,
    userId,
    episodeId,
    type: TASK_TYPE.CLIPS_BUILD,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    dedupeKey: `clips_build:${episodeId}`,
    priority: 1,
    payload: { episodeId },
  })
  await waitForTask(taskId, timeoutMs)
}

async function runScreenplay(projectId: string, userId: string, episodeId: string, timeoutMs: number): Promise<void> {
  const taskId = await submitTextTask({
    projectId,
    userId,
    episodeId,
    type: TASK_TYPE.SCREENPLAY_CONVERT,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    dedupeKey: `screenplay_convert:${episodeId}`,
    priority: 2,
    payload: { episodeId },
  })
  await waitForTask(taskId, timeoutMs)
}

async function runStoryboard(projectId: string, userId: string, episodeId: string, timeoutMs: number): Promise<void> {
  const taskId = await submitTextTask({
    projectId,
    userId,
    episodeId,
    type: TASK_TYPE.SCRIPT_TO_STORYBOARD_RUN,
    targetType: 'NovelPromotionEpisode',
    targetId: episodeId,
    dedupeKey: `script_to_storyboard_run:${episodeId}`,
    priority: 2,
    payload: { episodeId },
  })
  await waitForTask(taskId, timeoutMs)
}

async function submitAssetImages(projectId: string, userId: string, timeoutMs: number): Promise<void> {
  const config = await getProjectModelConfig(projectId, userId)
  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: { include: { appearances: { orderBy: { appearanceIndex: 'asc' } } } },
      locations: { include: { images: { orderBy: { imageIndex: 'asc' } } } },
    },
  })
  if (!novelProject) throw new Error('Novel promotion project not found')

  const tasks: SubmittedTask[] = []
  for (const character of novelProject.characters) {
    for (const appearance of character.appearances) {
      const payloadBase = {
        id: character.id,
        type: 'character',
        appearanceId: appearance.id,
        count: 1,
      }
      const payload = await buildImageTaskPayload({
        projectId,
        userId,
        imageModel: config.characterModel,
        basePayload: payloadBase,
      })
      const submitted = await submitTask({
        userId,
        locale: 'zh',
        projectId,
        type: TASK_TYPE.IMAGE_CHARACTER,
        targetType: 'CharacterAppearance',
        targetId: appearance.id,
        payload,
        dedupeKey: `${TASK_TYPE.IMAGE_CHARACTER}:${appearance.id}:1`,
      })
      tasks.push({ taskId: submitted.taskId, type: TASK_TYPE.IMAGE_CHARACTER, targetId: appearance.id })
    }
  }

  for (const location of novelProject.locations) {
    if (location.images.length === 0) continue
    const payloadBase = {
      id: location.id,
      type: location.assetKind === 'prop' ? 'prop' : 'location',
      count: 1,
    }
    const payload = await buildImageTaskPayload({
      projectId,
      userId,
      imageModel: config.locationModel,
      basePayload: payloadBase,
    })
    const submitted = await submitTask({
      userId,
      locale: 'zh',
      projectId,
      type: TASK_TYPE.IMAGE_LOCATION,
      targetType: 'LocationImage',
      targetId: location.id,
      payload,
      dedupeKey: `${TASK_TYPE.IMAGE_LOCATION}:${location.id}:1`,
    })
    tasks.push({ taskId: submitted.taskId, type: TASK_TYPE.IMAGE_LOCATION, targetId: location.id })
  }

  write('asset_tasks_submitted', { total: tasks.length })
  await waitForTasks(tasks, timeoutMs)
}

async function listEpisodePanels(episodeId: string) {
  const storyboards = await prisma.novelPromotionStoryboard.findMany({
    where: { episodeId },
    orderBy: { createdAt: 'asc' },
    include: {
      clip: true,
      panels: {
        orderBy: { panelIndex: 'asc' },
        include: {
          matchedVoiceLines: true,
          storyboard: {
            select: {
              clip: {
                select: { content: true },
              },
            },
          },
        },
      },
    },
  })
  return storyboards.flatMap((storyboard) => storyboard.panels)
}

async function submitPanelImages(
  projectId: string,
  userId: string,
  episodeId: string,
  timeoutMs: number,
  limit: number | null,
): Promise<void> {
  const config = await getProjectModelConfig(projectId, userId)
  const imageModel = config.storyboardModel
  if (!imageModel) throw new Error('storyboardModel not configured')
  const capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId,
    userId,
    modelType: 'image',
    modelKey: imageModel,
  })
  const panels = (await listEpisodePanels(episodeId))
    .filter((panel) => !panel.imageUrl)
    .slice(0, limit ?? undefined)
  const tasks: SubmittedTask[] = []

  for (const panel of panels) {
    const payload = {
      panelId: panel.id,
      count: 1,
      candidateCount: 1,
      imageModel,
      ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {}),
    }
    const submitted = await submitTask({
      userId,
      locale: 'zh',
      projectId,
      episodeId,
      type: TASK_TYPE.IMAGE_PANEL,
      targetType: 'NovelPromotionPanel',
      targetId: panel.id,
      payload,
      dedupeKey: `image_panel:${panel.id}:1`,
    })
    tasks.push({ taskId: submitted.taskId, type: TASK_TYPE.IMAGE_PANEL, targetId: panel.id })
  }

  write('panel_image_tasks_submitted', { total: tasks.length })
  await waitForTasks(tasks, timeoutMs)
}

function buildVoicePrompt(speaker: string, profileData: string | null | undefined): string {
  const normalized = speaker.trim()
  const profileText = typeof profileData === 'string' ? profileData : ''
  if (profileText.includes('老') || normalized.includes('刘')) {
    return 'Mandarin Chinese elderly male psychiatrist voice, calm, low, controlled, professional, slightly tired, realistic dialogue delivery.'
  }
  if (profileText.includes('年轻') || normalized.includes('陈迹')) {
    return 'Mandarin Chinese young male voice, quiet, restrained, numb, hesitant, low energy, realistic natural dialogue delivery.'
  }
  return `Mandarin Chinese realistic short-drama voice for ${normalized}, natural emotion, clear articulation, restrained performance.`
}

function buildPreviewText(lines: Array<{ content: string }>, fallbackName: string): string {
  const first = lines.map((line) => line.content.trim()).find((line) => line.length >= 5)
  if (first) return first.slice(0, 200)
  return `${fallbackName}，现在开始进行对话测试，请保持自然平稳的语气。`
}

async function ensureSpeakerVoiceReferences(
  projectId: string,
  userId: string,
  episodeId: string,
  timeoutMs: number,
): Promise<void> {
  const novelProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
    },
  })
  if (!novelProject) throw new Error('Novel promotion project not found')

  const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: { episodeId },
    orderBy: { lineIndex: 'asc' },
    select: { id: true, speaker: true, content: true },
  })
  const linesBySpeaker = new Map<string, Array<{ id: string; content: string }>>()
  for (const line of voiceLines) {
    const speaker = line.speaker.trim()
    if (!speaker) continue
    const list = linesBySpeaker.get(speaker) || []
    list.push({ id: line.id, content: line.content })
    linesBySpeaker.set(speaker, list)
  }

  for (const [speaker, lines] of linesBySpeaker.entries()) {
    const character = novelProject.characters.find((item) => item.name === speaker)
      || novelProject.characters.find((item) => item.name.includes(speaker) || speaker.includes(item.name))
    if (!character) {
      write('voice_reference_skipped', { speaker, reason: 'character_not_found' })
      continue
    }
    if (character.customVoiceUrl || character.voiceId) {
      write('voice_reference_ready', { speaker, characterId: character.id, source: 'existing_character_voice' })
      continue
    }

    const payload = {
      voicePrompt: buildVoicePrompt(speaker, character.profileData),
      previewText: buildPreviewText(lines, speaker),
      characterId: character.id,
      preferredName: speaker,
      language: 'zh',
      displayMode: 'detail',
    }
    const submitted = await submitTask({
      userId,
      locale: 'zh',
      projectId,
      type: TASK_TYPE.VOICE_DESIGN,
      targetType: 'NovelPromotionProject',
      targetId: projectId,
      payload,
      dedupeKey: `${TASK_TYPE.VOICE_DESIGN}:mountain:${episodeId}:${speaker}`,
    })
    write('voice_reference_task_submitted', { speaker, characterId: character.id, taskId: submitted.taskId })
    const task = await waitForTask(submitted.taskId, timeoutMs)
    const result = task.result as Record<string, unknown> | null
    const voiceId = typeof result?.voiceId === 'string' ? result.voiceId : ''
    const audioBase64 = typeof result?.audioBase64 === 'string' ? result.audioBase64 : ''
    if (!voiceId || !audioBase64) {
      throw new Error(`VOICE_DESIGN_EMPTY_RESULT: ${speaker}`)
    }

    const audioBuffer = Buffer.from(audioBase64, 'base64')
    const audioExt = resolveMediaExt('audio', audioBuffer, null)
    const key = generateUniqueKey(`voice/custom/${projectId}/${character.id}`, audioExt)
    const cosUrl = await uploadObject(audioBuffer, key, undefined, resolveMediaContentType(audioExt))
    await prisma.novelPromotionCharacter.update({
      where: { id: character.id },
      data: {
        voiceType: 'designed',
        voiceId,
        customVoiceUrl: cosUrl,
      },
    })
    write('voice_reference_ready', { speaker, characterId: character.id, source: 'designed', audioUrl: cosUrl })
  }
}

async function submitVoiceLines(
  projectId: string,
  userId: string,
  episodeId: string,
  timeoutMs: number,
): Promise<void> {
  const config = await getProjectModelConfig(projectId, userId)
  const audioModel = config.audioModel
  if (!audioModel) throw new Error('audioModel not configured')

  await ensureSpeakerVoiceReferences(projectId, userId, episodeId, timeoutMs)

  const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: { episodeId, audioUrl: null },
    orderBy: { lineIndex: 'asc' },
    select: { id: true, content: true },
  })
  const tasks: SubmittedTask[] = []
  for (const line of voiceLines) {
    const payload = {
      episodeId,
      lineId: line.id,
      maxSeconds: estimateVoiceLineMaxSeconds(line.content),
      audioModel,
    }
    const submitted = await submitTask({
      userId,
      locale: 'zh',
      projectId,
      episodeId,
      type: TASK_TYPE.VOICE_LINE,
      targetType: 'NovelPromotionVoiceLine',
      targetId: line.id,
      payload,
      dedupeKey: `voice_line:${line.id}`,
    })
    tasks.push({ taskId: submitted.taskId, type: TASK_TYPE.VOICE_LINE, targetId: line.id })
  }

  write('voice_line_tasks_submitted', { total: tasks.length })
  await waitForTasks(tasks, timeoutMs)
}

async function submitPanelVideos(
  projectId: string,
  userId: string,
  episodeId: string,
  timeoutMs: number,
  limit: number | null,
): Promise<void> {
  const config = await getProjectModelConfig(projectId, userId)
  const videoModel = config.videoModel
  if (!videoModel) throw new Error('videoModel not configured')
  const generationOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId,
    userId,
    modelType: 'video',
    modelKey: videoModel,
    runtimeSelections: { generationMode: 'normal' },
  })
  const capabilities = resolveBuiltinCapabilitiesByModelKey('video', videoModel)
  const panels = (await listEpisodePanels(episodeId))
    .filter((panel) => !panel.videoUrl)
  const readiness = panels.map((panel) => ({
    panel,
    issue: resolvePanelVideoReadinessIssue(panel, {
      payload: { videoModel, generationOptions },
      modelKey: videoModel,
      durationOptions: capabilities?.video?.durationOptions,
    }),
  }))
  const readyPanels = readiness
    .filter((item) => item.issue === null)
    .map((item) => item.panel)
    .slice(0, limit ?? undefined)
  const skippedReasons = summarizeVideoReadinessIssues(readiness.map((item) => item.issue))
  const tasks: SubmittedTask[] = []

  for (const panel of readyPanels) {
    const payload = {
      videoModel,
      generationOptions,
    }
    const submitted = await submitTask({
      userId,
      locale: 'zh',
      projectId,
      episodeId,
      type: TASK_TYPE.VIDEO_PANEL,
      targetType: 'NovelPromotionPanel',
      targetId: panel.id,
      payload,
      dedupeKey: `video_panel:${panel.id}`,
    })
    tasks.push({ taskId: submitted.taskId, type: TASK_TYPE.VIDEO_PANEL, targetId: panel.id })
  }

  write('panel_video_tasks_submitted', {
    total: tasks.length,
    skipped: panels.length - readyPanels.length,
    skippedReasons,
  })
  await waitForTasks(tasks, timeoutMs)
}

async function runQa(projectId: string, episodeId: string): Promise<void> {
  const panels = await listEpisodePanels(episodeId)
  const stalePromptPanels = panels.filter((panel) =>
    isStructuredMultiShotPrompt(panel.videoPrompt)
    || isStructuredMultiShotPrompt(panel.firstLastFramePrompt))
  const missingSourceText = panels.filter((panel) => !panel.srtSegment && !panel.description)
  const packets = panels.map((panel, index) => {
    const previousPanel = index > 0 ? panels[index - 1] : null
    const nextPanel = index < panels.length - 1 ? panels[index + 1] : null
    const packet = buildPanelContinuityPacket({
      panel,
      previousPanel,
      nextPanel,
      dialogueLines: panel.matchedVoiceLines.map((line) => ({
        id: line.id,
        speaker: line.speaker,
        content: line.content,
        audioDuration: line.audioDuration,
      })),
      targetDurationSeconds: panel.duration,
    })
    return {
      panelId: panel.id,
      panelIndex: panel.panelIndex,
      currentAction: packet.currentAction,
      prompt: renderPanelContinuityPrompt({
        packet,
        basePrompt: packet.currentAction,
        generationMode: 'normal',
        userEdited: Boolean(panel.videoPromptEditedByUser),
      }),
    }
  })
  const readiness = panels.map((panel) => ({
    panelId: panel.id,
    issue: resolvePanelVideoReadinessIssue(panel),
  }))

  write('qa_summary', {
    projectId,
    episodeId,
    panels: panels.length,
    images: panels.filter((panel) => panel.imageUrl).length,
    videos: panels.filter((panel) => panel.videoUrl).length,
    voiceLines: panels.reduce((sum, panel) => sum + panel.matchedVoiceLines.length, 0),
    stalePromptPanels: stalePromptPanels.length,
    missingSourceText: missingSourceText.length,
    readinessIssues: summarizeVideoReadinessIssues(readiness.map((item) => item.issue)),
    samplePackets: packets.slice(0, 4).map((packet) => ({
      panelIndex: packet.panelIndex,
      currentAction: packet.currentAction,
      promptPreview: packet.prompt.slice(0, 600),
    })),
  })
}

async function main(): Promise<void> {
  const args = parseArgs()
  const { project, episode } = await getProjectAndEpisode(args.projectId, args.episodeNumber)
  const userId = project.userId

  write('start', {
    projectId: args.projectId,
    episodeId: episode.id,
    episodeNumber: episode.episodeNumber,
    stage: args.stage,
  })

  if (args.stage === 'global' || args.stage === 'episode1') {
    await runGlobalAnalysis(args.projectId, userId, args.timeoutMs)
  }
  if (args.stage === 'profiles' || args.stage === 'episode1') {
    await runCharacterProfiles(args.projectId, userId, args.timeoutMs)
  }
  if (args.stage === 'clips' || args.stage === 'episode1') {
    await runClips(args.projectId, userId, episode.id, args.timeoutMs)
  }
  if (args.stage === 'screenplay' || args.stage === 'episode1') {
    await runScreenplay(args.projectId, userId, episode.id, args.timeoutMs)
  }
  if (args.stage === 'storyboard' || args.stage === 'episode1') {
    await runStoryboard(args.projectId, userId, episode.id, args.timeoutMs)
  }
  if (args.stage === 'assets' || args.stage === 'episode1') {
    await submitAssetImages(args.projectId, userId, args.timeoutMs)
  }
  if (args.stage === 'images' || args.stage === 'episode1') {
    await submitPanelImages(args.projectId, userId, episode.id, args.timeoutMs, args.imageLimit)
  }
  if (args.stage === 'voices' || args.stage === 'episode1') {
    await submitVoiceLines(args.projectId, userId, episode.id, args.timeoutMs)
  }
  if (args.stage === 'videos' || args.stage === 'episode1') {
    await submitPanelVideos(args.projectId, userId, episode.id, args.timeoutMs, args.videoLimit)
  }
  if (args.stage === 'qa' || args.stage === 'episode1') {
    await runQa(args.projectId, episode.id)
  }
}

main()
  .catch((error) => {
    write('error', { message: error instanceof Error ? error.message : String(error) })
    process.exitCode = 1
  })
  .finally(async () => {
    await Promise.allSettled([
      imageQueue.close(),
      textQueue.close(),
      videoQueue.close(),
      voiceQueue.close(),
      queueRedis.quit(),
      redis.quit(),
    ])
    await prisma.$disconnect()
  })
