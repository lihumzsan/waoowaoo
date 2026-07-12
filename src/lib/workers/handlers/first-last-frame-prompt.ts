import type { Job } from 'bullmq'
import { jsonrepair } from 'jsonrepair'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { getProjectModelConfig } from '@/lib/config-service'
import {
  buildFirstLastFramePromptFingerprint,
  getFirstLastFramePromptTiming,
  loadAdjacentFirstLastFramePanels,
  type FirstLastFramePromptReason,
} from '@/lib/novel-promotion/first-last-frame-prompt'
import { buildDefaultFirstLastFramePrompt } from '@/lib/novel-promotion/panel-continuity'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { prisma } from '@/lib/prisma'
import { extractStorageKey, getSignedObjectUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'

export type GenerateFirstLastFramePromptResult = {
  prompt: string
  sourceFingerprint: string
  applied: boolean
  fallbackUsed: boolean
  warnings: string[]
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function panelContext(panel: Record<string, unknown>) {
  return JSON.stringify({
    description: panel.description || null,
    image_prompt: panel.imagePrompt || null,
    video_prompt: panel.videoPrompt || null,
    shot_type: panel.shotType || null,
    camera_move: panel.cameraMove || null,
    location: panel.location || null,
    characters: panel.characters || null,
    props: panel.props || null,
    source_text: panel.srtSegment || null,
    scene_type: panel.sceneType || null,
  }, null, 2)
}

const NON_ENGLISH_SCRIPT_PATTERN = /[\u0400-\u052f\u0600-\u06ff\u3400-\u9fff]/u
const CUT_OR_SCENE_TRANSITION_PATTERN = /\b(?:(?:(?:hard|smash|jump|match|abrupt|sudden)\s+)?cut(?:s|ting)?|(?:dissolv(?:e|es|ed|ing)|fade(?:s|d|ing)?|transition(?:s|ed|ing)?)\s+(?:to|into)|scene\s+(?:changes?|shifts?|transitions?)\s+(?:to|into))\b/i
const INVENTED_SUBJECT_PATTERN = /\b(?:a|an|another)\s+(?:new\s+)?(?:stranger|person|character|man|woman|child|figure)\s+(?:enters?|appears?|emerges?|arrives?)\b/i
const INVENTED_PROP_PATTERN = /\b(?:(?:carrying|holding|wielding)\s+(?:a|an)\s+)?(?:new|newly\s+introduced)\s+(?:prop|object|sword|weapon|knife|gun|bag|tool)\b/i

function hasEnglishSignal(prompt: string) {
  const latinLetterCount = (prompt.match(/[A-Za-z]/g) || []).length
  const nonWhitespaceCount = (prompt.match(/\S/g) || []).length
  return latinLetterCount >= 140
    && nonWhitespaceCount > 0
    && latinLetterCount / nonWhitespaceCount >= 0.45
}

function parseModelOutput(text: string): { prompt: string; warnings: string[] } | null {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!unfenced) return null
  try {
    const parsed = JSON.parse(jsonrepair(unfenced)) as Record<string, unknown>
    const prompt = stringValue(parsed.transition_prompt)
    const wordCount = prompt.split(/\s+/u).filter(Boolean).length
    if (!prompt || wordCount < 70 || wordCount > 160) return null
    if (NON_ENGLISH_SCRIPT_PATTERN.test(prompt) || !hasEnglishSignal(prompt)) return null
    if (
      CUT_OR_SCENE_TRANSITION_PATTERN.test(prompt)
      || INVENTED_SUBJECT_PATTERN.test(prompt)
      || INVENTED_PROP_PATTERN.test(prompt)
    ) return null
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.map(stringValue).filter(Boolean)
      : []
    return { prompt, warnings }
  } catch {
    return null
  }
}

function resolveStoredImageKey(panel: { imageUrl?: string | null; imageMedia?: { storageKey?: string | null } | null }) {
  return stringValue(panel.imageMedia?.storageKey) || extractStorageKey(panel.imageUrl) || ''
}

function panelVersion(value: unknown): number | null {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? timestamp : null
  }
  return null
}

function isSerializableConflict(error: unknown) {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2034'
}

export async function handleFirstLastFramePromptTask(
  job: Job<TaskJobData>,
): Promise<GenerateFirstLastFramePromptResult> {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const firstPanelId = stringValue(payload.firstPanelId) || job.data.targetId
  const lastPanelId = stringValue(payload.lastPanelId)
  const reason = stringValue(payload.reason) as FirstLastFramePromptReason
  if (!firstPanelId || !lastPanelId || !['link', 'source_change', 'manual'].includes(reason)) {
    throw new Error('generate_first_last_frame_prompt requires firstPanelId, lastPanelId, and reason')
  }

  await reportTaskProgress(job, 15, { stage: 'first_last_frame_prompt_prepare' })
  const start = await loadAdjacentFirstLastFramePanels({
    projectId: job.data.projectId,
    firstPanelId,
    lastPanelId,
    episodeId: job.data.episodeId,
    requireLinked: true,
  })
  const firstImageKey = resolveStoredImageKey(start.firstPanel)
  const lastImageKey = resolveStoredImageKey(start.lastPanel)
  if (!firstImageKey || !lastImageKey) throw new Error('First or last panel is missing stored image')

  const [firstFrameSignedUrl, lastFrameSignedUrl] = await Promise.all([
    getSignedObjectUrl(firstImageKey),
    getSignedObjectUrl(lastImageKey),
  ])
  const sourceFingerprint = buildFirstLastFramePromptFingerprint(
    start.firstPanel as unknown as Record<string, unknown>,
    start.lastPanel as unknown as Record<string, unknown>,
  )
  const startFirstVersion = panelVersion(start.firstPanel.updatedAt)
  const startLastVersion = panelVersion(start.lastPanel.updatedAt)
  const timing = getFirstLastFramePromptTiming(start.firstPanel as unknown as Record<string, unknown>)
  const modelConfig = await getProjectModelConfig(job.data.projectId, job.data.userId)
  if (!modelConfig.analysisModel) throw new Error('Analysis model not configured')

  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_FIRST_LAST_FRAME_TRANSITION,
    locale: job.data.locale,
    variables: {
      first_panel_context: panelContext(start.firstPanel as unknown as Record<string, unknown>),
      last_panel_context: panelContext(start.lastPanel as unknown as Record<string, unknown>),
      duration_seconds: String(timing.durationSeconds),
      fps: String(timing.fps),
      goon_key: timing.workflowKey,
    },
  })

  await reportTaskProgress(job, 45, { stage: 'first_last_frame_prompt_generate' })
  let generated: { prompt: string; warnings: string[] } | null = null
  let fallbackWarning = ''
  try {
    const completion = await executeAiVisionStep({
      userId: job.data.userId,
      model: modelConfig.analysisModel,
      prompt,
      imageUrls: [firstFrameSignedUrl, lastFrameSignedUrl],
      projectId: job.data.projectId,
      action: 'first_last_frame_transition_prompt',
      meta: {
        stepId: 'first_last_frame_transition_prompt',
        stepTitle: 'First/last frame transition prompt',
        stepIndex: 1,
        stepTotal: 1,
      },
    })
    generated = parseModelOutput(completion.text)
    if (!generated) fallbackWarning = 'Vision model returned an invalid transition prompt; deterministic bridge used.'
  } catch (error) {
    fallbackWarning = `Vision prompt generation failed; deterministic bridge used: ${error instanceof Error ? error.message : String(error)}`
  }

  const fallbackUsed = !generated
  const resultPrompt = generated?.prompt || buildDefaultFirstLastFramePrompt({
    firstPanel: start.firstPanel,
    lastPanel: start.lastPanel,
  })
  const warnings = generated?.warnings || [fallbackWarning]

  await reportTaskProgress(job, 80, { stage: 'first_last_frame_prompt_persist' })
  await assertTaskActive(job, 'first_last_frame_prompt_persist')
  let applied = false
  try {
    applied = await prisma.$transaction(async (tx) => {
      const latest = await loadAdjacentFirstLastFramePanels({
        projectId: job.data.projectId,
        firstPanelId,
        lastPanelId,
        episodeId: job.data.episodeId,
        requireLinked: true,
        db: tx,
      })
      const latestFingerprint = buildFirstLastFramePromptFingerprint(
        latest.firstPanel as unknown as Record<string, unknown>,
        latest.lastPanel as unknown as Record<string, unknown>,
      )
      const versionsMatch = panelVersion(latest.firstPanel.updatedAt) === startFirstVersion
        && panelVersion(latest.lastPanel.updatedAt) === startLastVersion
      if (latestFingerprint !== sourceFingerprint || !versionsMatch) return false
      if (reason === 'link' && latest.firstPanel.firstLastFramePromptEditedByUser) return false

      const write = await tx.novelPromotionPanel.updateMany({
        where: {
          id: firstPanelId,
          linkedToNextPanel: true,
          updatedAt: start.firstPanel.updatedAt,
        },
        data: {
          firstLastFramePrompt: resultPrompt,
          firstLastFramePromptEditedByUser: false,
          firstLastFramePromptSourceFingerprint: sourceFingerprint,
        },
      })
      return write.count === 1
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (!isSerializableConflict(error)) throw error
  }

  return { prompt: resultPrompt, sourceFingerprint, applied, fallbackUsed, warnings }
}
