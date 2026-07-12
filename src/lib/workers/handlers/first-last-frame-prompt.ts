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

function parseModelOutput(text: string): { prompt: string; warnings: string[] } | null {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!unfenced) return null
  try {
    const parsed = JSON.parse(jsonrepair(unfenced)) as Record<string, unknown>
    const prompt = stringValue(parsed.transition_prompt)
    const wordCount = prompt.split(/\s+/u).filter(Boolean).length
    if (!prompt || wordCount < 70 || wordCount > 160 || /[\u3400-\u9fff]/u.test(prompt)) return null
    if (/\b(?:cut to|scene changes? to|introduce(?:s|d)? (?:a )?new (?:person|character|prop))\b/i.test(prompt)) return null
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
  const latest = await loadAdjacentFirstLastFramePanels({
    projectId: job.data.projectId,
    firstPanelId,
    lastPanelId,
    episodeId: job.data.episodeId,
    requireLinked: true,
  })
  const latestFingerprint = buildFirstLastFramePromptFingerprint(
    latest.firstPanel as unknown as Record<string, unknown>,
    latest.lastPanel as unknown as Record<string, unknown>,
  )
  if (latestFingerprint !== sourceFingerprint) {
    return { prompt: resultPrompt, sourceFingerprint, applied: false, fallbackUsed, warnings }
  }
  if (reason === 'link' && latest.firstPanel.firstLastFramePromptEditedByUser) {
    return { prompt: resultPrompt, sourceFingerprint, applied: false, fallbackUsed, warnings }
  }

  await assertTaskActive(job, 'first_last_frame_prompt_persist')
  await prisma.novelPromotionPanel.update({
    where: { id: firstPanelId },
    data: {
      firstLastFramePrompt: resultPrompt,
      firstLastFramePromptEditedByUser: false,
      firstLastFramePromptSourceFingerprint: sourceFingerprint,
    },
  })

  return { prompt: resultPrompt, sourceFingerprint, applied: true, fallbackUsed, warnings }
}
