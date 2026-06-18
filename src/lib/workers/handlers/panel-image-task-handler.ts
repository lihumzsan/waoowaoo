import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import { type TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '../shared'
import {
  assertTaskActive,
  getProjectModels,
  resolveImageSourceFromGeneration,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
} from '../utils'
import {
  AnyObj,
  buildImageProviderRuntimeOptions,
  clampCount,
  collectPanelReferenceImageItemsWithDiagnostics,
  normalizeReferenceImageItemsForGeneration,
  type ReferenceImageItem,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import type { OutboundImageNormalizationIssue } from '@/lib/media/outbound-image'
import {
  appendStyleBiblePromptBlock,
  resolveEditScriptStyleBibleForStoryboardTask,
} from '@/lib/edit-script/style-bible-prompt'
import { buildPanelPrompt, buildPanelPromptContext } from './panel-image-prompt'
import { parseStoryboardGridPayload, handlePanelGridImageTask } from './panel-grid-image-handler'
import {
  applyPanelPromptFieldOmissions,
  parseStoryboardPromptFieldOmissions,
} from '@/lib/storyboard/prompt-field-selection'

const EMPTY_PANEL_REFERENCE_COLLECTION = {
  items: [],
  diagnostics: [],
  issues: [],
  expectedCharacterReferenceCount: 0,
} satisfies Awaited<ReturnType<typeof collectPanelReferenceImageItemsWithDiagnostics>>

export async function handlePanelImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const promptFieldOmissions = payload.compareOnly === true
    ? parseStoryboardPromptFieldOmissions(payload.promptFieldOmissions)
    : []
  const gridPayload = parseStoryboardGridPayload(payload.storyboardGrid)
  if (gridPayload) {
    return await handlePanelGridImageTask(job, payload, gridPayload)
  }

  const panelId = pickFirstString(payload.panelId, job.data.targetId)
  if (!panelId) throw new Error('panelId missing')

  const panel = await prisma.projectPanel.findUnique({
    where: { id: panelId },
  })

  if (!panel) throw new Error('Panel not found')

  const projectData = await resolveNovelData(job.data.projectId, job.data.userId)
  const modelConfig = await getProjectModels(job.data.projectId, job.data.userId)
  const modelKey = modelConfig.storyboardModel
  if (!modelKey) throw new Error('Storyboard model not configured')

  const candidateCount = clampCount(payload.candidateCount ?? payload.count, 1, 4, 1)
  const referenceMode = payload.referenceMode === 'storyboard' ? 'storyboard' : 'asset'
  const refCollection = referenceMode === 'storyboard'
    ? EMPTY_PANEL_REFERENCE_COLLECTION
    : await collectPanelReferenceImageItemsWithDiagnostics(projectData, panel, { strict: true })
  const referenceImageItems: ReferenceImageItem[] = [...refCollection.items]
  if (Array.isArray(payload.referencePanelImageUrls)) {
    for (const [index, url] of payload.referencePanelImageUrls.entries()) {
      const signed = toSignedUrlIfCos(typeof url === 'string' ? url : null, 3600)
      if (signed) {
        referenceImageItems.push({
          url: signed,
          role: 'source_panel',
          name: `previous storyboard panel ${index + 1}`,
        })
      }
    }
  }
  if (Array.isArray(payload.extraImageUrls)) {
    for (const [index, url] of payload.extraImageUrls.entries()) {
      if (typeof url === 'string' && url.trim()) {
        referenceImageItems.push({
          url: url.trim(),
          role: 'extra',
          name: `extra reference ${index + 1}`,
        })
      }
    }
  }
  const referenceImageNotes = Array.isArray(payload.referenceImageNotes)
    ? payload.referenceImageNotes
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 16)
    : []
  const normalizationIssues: OutboundImageNormalizationIssue[] = []
  const { referenceImages, referenceImagesMap } = await normalizeReferenceImageItemsForGeneration(referenceImageItems, {
    locale: job.data.locale,
    onIssue: (issue) => {
      normalizationIssues.push(issue)
    },
    context: { taskType: String(job.data.type), scope: 'panel-image.refs' },
  })
  const failedCharacterReferenceIssues = refCollection.diagnostics.filter((diagnostic) =>
    diagnostic.kind === 'character'
    && typeof diagnostic.inputIndex === 'number'
    && normalizationIssues.some((issue) => issue.index === diagnostic.inputIndex),
  )
  if (failedCharacterReferenceIssues.length > 0) {
    throw new Error(`PANEL_CHARACTER_REFERENCE_NORMALIZE_FAILED:${failedCharacterReferenceIssues.map((issue) => `${issue.name || issue.characterId}:${issue.appearance || issue.appearanceId}`).join('; ')}`)
  }

  const logger = createScopedLogger({
    module: 'worker.panel-image',
    action: 'panel_image_generate',
    requestId: job.data.trace?.requestId || undefined,
    taskId: job.data.taskId,
    projectId: job.data.projectId,
    userId: job.data.userId,
  })
  logger.info({
    message: 'panel image generation started',
    details: {
      panelId,
      modelKey,
      candidateCount,
      referenceImagesRawCount: referenceImageItems.length,
      referenceImagesNormalizedCount: referenceImages.length,
      referenceImageNotes,
      expectedCharacterReferenceCount: refCollection.expectedCharacterReferenceCount,
      referenceMode,
      referenceImageDiagnostics: refCollection.diagnostics,
      referenceImageNormalizationIssues: normalizationIssues,
      rawUrls: referenceImageItems.map((item) => item.url.substring(0, 100)),
      normalizedUrls: referenceImages.map((u) => u.substring(0, 100)),
      referenceImagesMap,
      panelCharacters: panel.characters,
      panelLocation: panel.location,
    },
  })

  const imageRuntimeOptions = buildImageProviderRuntimeOptions({
    generationOptions: payload.generationOptions,
    context: 'panel_image',
  })
  const aspectRatio = imageRuntimeOptions.aspectRatio
  const promptContext = buildPanelPromptContext({
    panel: {
      id: panel.id,
      shotType: panel.shotType,
      cameraMove: panel.cameraMove,
      description: panel.description,
      imagePrompt: panel.imagePrompt,
      videoPrompt: panel.videoPrompt,
      location: panel.location,
      characters: panel.characters,
      srtSegment: panel.srtSegment,
      photographyRules: panel.photographyRules,
      actingNotes: panel.actingNotes,
    },
    projectData,
    referenceImageNotes,
    referenceImagesMap,
  })
  const selectedPromptContext = applyPanelPromptFieldOmissions(promptContext, promptFieldOmissions)
  const contextJson = JSON.stringify(selectedPromptContext, null, 2)
  const sourceText = promptFieldOmissions.includes('panel.source_text')
    ? ''
    : panel.srtSegment || panel.description || ''
  const promptBase = buildPanelPrompt({
    locale: job.data.locale,
    aspectRatio,
    styleText: '',
    sourceText,
    contextJson,
  })
  const styleBible = await resolveEditScriptStyleBibleForStoryboardTask({
    projectId: job.data.projectId,
    episodeId: job.data.episodeId,
    storyboardId: panel.storyboardId,
  })
  const prompt = promptFieldOmissions.includes('style_bible')
    ? promptBase
    : appendStyleBiblePromptBlock({
      prompt: promptBase,
      styleBible,
      usage: 'storyboardImage',
      locale: job.data.locale,
    })
  logger.info({
    message: 'panel image prompt resolved',
    details: {
      promptLength: prompt.length,
    },
  })

  const candidates: string[] = []
  const effectiveReferenceImages = promptFieldOmissions.includes('context.reference_images') ? [] : referenceImages

  for (let i = 0; i < candidateCount; i++) {
    await reportTaskProgress(job, 18 + Math.floor((i / Math.max(candidateCount, 1)) * 58), {
      stage: 'generate_panel_candidate',
      candidateIndex: i,
    })

    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: modelKey,
      prompt,
      options: {
        ...imageRuntimeOptions,
        referenceImages: effectiveReferenceImages,
      },
      // 单个任务内会串行生成多候选，若允许按 task.externalId 续接会复用上一候选外部任务结果。
      allowTaskExternalIdResume: candidateCount === 1,
      pollProgress: { start: 30, end: 90 },
    })

    const cosKey = await uploadImageSourceToCos(source, 'panel-candidate', `${panel.id}-${i}`)
    candidates.push(cosKey)
  }

  if (payload.compareOnly === true) {
    return {
      panelId: panel.id,
      candidateCount: candidates.length,
      imageUrl: candidates[0] || null,
      imageUrls: candidates,
      compareOnly: true,
      promptDebug: {
        omittedFields: promptFieldOmissions,
        prompt,
        contextJson,
        sourceText,
        referenceImageCount: effectiveReferenceImages.length,
      },
    }
  }

  const isFirstGeneration = !panel.imageUrl

  await assertTaskActive(job, 'persist_panel_image')
  if (isFirstGeneration) {
    await prisma.projectPanel.update({
      where: { id: panel.id },
      data: {
        imageUrl: candidates[0] || null,
        candidateImages: candidateCount > 1 ? JSON.stringify(candidates) : null,
      },
    })
  } else {
    await prisma.projectPanel.update({
      where: { id: panel.id },
      data: {
        previousImageUrl: panel.imageUrl,
        candidateImages: JSON.stringify(candidates),
      },
    })
  }

  return {
    panelId: panel.id,
    candidateCount: candidates.length,
    imageUrl: isFirstGeneration ? candidates[0] || null : null,
  }
}
