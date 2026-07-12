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
import {
  buildFirstLastFrameSmartDurationFingerprint,
  computeFirstLastFrameSmartDuration,
  parseFirstLastFrameDurationAnalysis,
  resolveFirstLastFrameSmartDurationBinding,
  type FirstLastFrameDurationAnalysis,
  type FirstLastFrameSmartDurationRecommendation,
} from '@/lib/novel-promotion/first-last-frame-smart-duration'
import { buildDefaultFirstLastFramePrompt } from '@/lib/novel-promotion/panel-continuity'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { prisma } from '@/lib/prisma'
import { extractStorageKey, getSignedObjectUrl } from '@/lib/storage'
import type { TaskJobData } from '@/lib/task/types'
import { parseVideoDurationBinding } from '@/lib/video-duration/audio-binding'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS } from '@/lib/providers/comfyui/ltx23-workflow-profiles'

export type GenerateFirstLastFramePromptResult = {
  prompt: string
  sourceFingerprint: string
  applied: boolean
  fallbackUsed: boolean
  warnings: string[]
  smartDuration?: FirstLastFrameSmartDurationRecommendation
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
const NEW_ENTITY_PATTERN = /\b(?:another|new|second)\s+(?:stranger|person|character|man|woman|child|boy|girl|figure|animal|dog|cat|horse|vehicle|car)\b/i
const ENTITY_ARRIVAL_PATTERN = /\b(?:(a|an|the|another|new|second)\s+)?(stranger|person|people|character|man|woman|child|boy|girl|figure|animal|dog|cat|horse|vehicle|car)\s+(?:enters?|appears?|emerges?|arrives?)\b/gi
const ENTITY_REVEAL_PATTERN = /\b(?:reveals?|introduces?)\s+(?:(?:a|an|the)\s+)?(?:(?:another|new|second)\s+)?(?:stranger|person|character|man|woman|child|boy|girl|figure|animal|dog|cat|horse)\b/i
const ANOTHER_LOCATION_PATTERN = /\b(?:shot|scene|camera|view|image)\s+(?:switches|moves|shifts|changes)\s+to\s+(?:(?:a|an|the)\s+)?(?:another|new|second|different)\s+(?:room|location|place|setting|space|area|scene)\b/i
const INVENTED_PROP_PATTERN = /\b(?:(?:carrying|holding|wielding)\s+(?:a|an)\s+)?(?:new|newly\s+introduced)\s+(?:prop|object|sword|weapon|knife|gun|bag|tool)\b/i
const PROP_ACQUISITION_PATTERN = /\b(?:picks?\s+up|grabs?|draws?|carries?)\s+([^,.!?;]+?)(?=\s+(?:from|off|out|through|across|beside|near|while|and|then|before|after|toward|towards|into|onto|at|as)\b|[,.!?;]|$)/gi

const ENGLISH_GRAMMAR_MARKERS = new Set([
  'the', 'and', 'or', 'but', 'as', 'while', 'when', 'where', 'with', 'without',
  'to', 'from', 'of', 'in', 'into', 'on', 'at', 'by', 'for', 'through', 'across',
  'she', 'he', 'it', 'they', 'her', 'his', 'their', 'this', 'that', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'being', 'has', 'have', 'had', 'does', 'do',
  'can', 'will', 'would', 'should', 'then', 'after', 'before', 'until', 'toward', 'towards',
])
const NON_ENGLISH_FUNCTION_MARKERS = new Set([
  'la', 'el', 'los', 'las', 'una', 'uno', 'ella', 'mientras', 'hacia', 'con', 'sin', 'que', 'por', 'del',
  'le', 'les', 'une', 'elle', 'tandis', 'dans', 'avec', 'vers', 'sans', 'des', 'du', 'un',
  'dan', 'yang', 'dengan', 'dari', 'untuk', 'pada', 'ini', 'itu', 'saat', 'dia', 'menuju', 'sambil', 'tanpa',
])

function wordTokens(text: string) {
  return (text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [])
}

function hasEnglishLanguageSignal(prompt: string) {
  const tokens = wordTokens(prompt)
  const englishMarkers = tokens.filter((token) => ENGLISH_GRAMMAR_MARKERS.has(token))
  const nonEnglishMarkerCount = tokens.filter((token) => NON_ENGLISH_FUNCTION_MARKERS.has(token)).length
  const uniqueEnglishMarkers = new Set(englishMarkers)
  const englishDensity = englishMarkers.length / tokens.length
  const nonEnglishDensity = nonEnglishMarkerCount / tokens.length
  return tokens.length >= 60
    && englishMarkers.length >= 8
    && uniqueEnglishMarkers.size >= 5
    && englishDensity >= 0.08
    && nonEnglishDensity < 0.1
}

function introducesContextAbsentProp(prompt: string, sourceContext: string) {
  const sourceTokens = new Set(wordTokens(sourceContext))
  for (const match of prompt.matchAll(PROP_ACQUISITION_PATTERN)) {
    const phraseTokens = wordTokens(match[1]).filter((token) => ![
      'a', 'an', 'the', 'her', 'his', 'their', 'its', 'new', 'small', 'large', 'old',
    ].includes(token))
    const prop = phraseTokens.at(-1)
    if (prop && !sourceTokens.has(prop)) return true
  }
  return false
}

function introducesContextAbsentArrivingEntity(prompt: string, sourceContext: string) {
  const sourceTokens = new Set(wordTokens(sourceContext))
  for (const match of prompt.matchAll(ENTITY_ARRIVAL_PATTERN)) {
    const qualifier = match[1]?.toLowerCase()
    const entity = match[2]?.toLowerCase()
    if ((qualifier && ['another', 'new', 'second'].includes(qualifier)) || (entity && !sourceTokens.has(entity))) {
      return true
    }
  }
  return false
}

function parseModelOutput(
  text: string,
  sourceContext: string,
): { prompt: string; warnings: string[]; durationAnalysis: FirstLastFrameDurationAnalysis | null } | null {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  if (!unfenced) return null
  try {
    const parsed = JSON.parse(jsonrepair(unfenced)) as Record<string, unknown>
    const prompt = stringValue(parsed.transition_prompt)
    const wordCount = prompt.split(/\s+/u).filter(Boolean).length
    if (!prompt || wordCount < 70 || wordCount > 160) return null
    if (NON_ENGLISH_SCRIPT_PATTERN.test(prompt) || !hasEnglishLanguageSignal(prompt)) return null
    if (
      CUT_OR_SCENE_TRANSITION_PATTERN.test(prompt)
      || NEW_ENTITY_PATTERN.test(prompt)
      || introducesContextAbsentArrivingEntity(prompt, sourceContext)
      || ENTITY_REVEAL_PATTERN.test(prompt)
      || ANOTHER_LOCATION_PATTERN.test(prompt)
      || INVENTED_PROP_PATTERN.test(prompt)
      || introducesContextAbsentProp(prompt, sourceContext)
    ) return null
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.map(stringValue).filter(Boolean)
      : []
    return {
      prompt,
      warnings,
      durationAnalysis: parseFirstLastFrameDurationAnalysis(parsed.duration_analysis ?? parsed.durationAnalysis),
    }
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
  const smartDurationFingerprint = buildFirstLastFrameSmartDurationFingerprint({
    sourceFingerprint,
    workflowKey: getFirstLastFramePromptTiming(start.firstPanel as unknown as Record<string, unknown>).workflowKey,
    fps: getFirstLastFramePromptTiming(start.firstPanel as unknown as Record<string, unknown>).fps,
  })
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
      duration_seconds: String(COMFYUI_LTX23_GOON_DEFAULT_DURATION_SECONDS),
      fps: String(timing.fps),
      goon_key: timing.workflowKey,
    },
  })
  const sourceContext = [
    panelContext(start.firstPanel as unknown as Record<string, unknown>),
    panelContext(start.lastPanel as unknown as Record<string, unknown>),
  ].join('\n')

  await reportTaskProgress(job, 45, { stage: 'first_last_frame_prompt_generate' })
  let generated: {
    prompt: string
    warnings: string[]
    durationAnalysis: FirstLastFrameDurationAnalysis | null
  } | null = null
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
    generated = parseModelOutput(completion.text, sourceContext)
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
  const smartDuration = computeFirstLastFrameSmartDuration({
    analysis: generated?.durationAnalysis ?? null,
    fingerprint: smartDurationFingerprint,
    fallbackReason: 'invalid_analysis',
  })

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
      const latestBinding = parseVideoDurationBinding(latest.firstPanel.videoDurationBinding)
      const nextDurationBinding = latestBinding.durationSource === 'manual'
        ? latestBinding
        : resolveFirstLastFrameSmartDurationBinding(smartDuration)
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
          videoDurationBinding: JSON.stringify(nextDurationBinding),
        },
      })
      return write.count === 1
    }, { isolationLevel: 'Serializable' })
  } catch (error) {
    if (!isSerializableConflict(error)) throw error
  }

  return { prompt: resultPrompt, sourceFingerprint, applied, fallbackUsed, warnings, smartDuration }
}
