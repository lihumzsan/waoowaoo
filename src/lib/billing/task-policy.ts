import {
  calcImage,
  calcMusic,
  calcText,
  calcVideo,
} from './cost'
import { BUILTIN_PRICING_VERSION } from '@/lib/ai-registry/pricing-resolution'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { TASK_TYPE, type TaskType } from '@/lib/task/types'
import type { TaskBillingInfo } from './types'

type AnyPayload = Record<string, unknown> | null | undefined

const BILLABLE_TASK_TYPES = new Set<TaskType>([
  TASK_TYPE.IMAGE_PANEL,
  TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE,
  TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE,
  TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN,
  TASK_TYPE.IMAGE_CHARACTER,
  TASK_TYPE.IMAGE_LOCATION,
  TASK_TYPE.MUSIC_GENERATE,
  TASK_TYPE.BGM_SCORE_GENERATE,
  TASK_TYPE.VIDEO_PANEL,
  TASK_TYPE.VIDEO_GROUP,
  TASK_TYPE.REGENERATE_STORYBOARD_TEXT,
  TASK_TYPE.INSERT_PANEL,
  TASK_TYPE.PANEL_VARIANT,
  TASK_TYPE.MODIFY_ASSET_IMAGE,
  TASK_TYPE.REGENERATE_GROUP,
  TASK_TYPE.ASSET_HUB_IMAGE,
  TASK_TYPE.ASSET_HUB_MODIFY,
  TASK_TYPE.ANALYZE_NOVEL,
  TASK_TYPE.CLIPS_BUILD,
  TASK_TYPE.SCREENPLAY_CONVERT,
  TASK_TYPE.ANALYZE_GLOBAL,
  TASK_TYPE.AI_MODIFY_APPEARANCE,
  TASK_TYPE.AI_MODIFY_LOCATION,
  TASK_TYPE.AI_MODIFY_PROP,
  TASK_TYPE.AI_MODIFY_SHOT_PROMPT,
  TASK_TYPE.ANALYZE_SHOT_VARIANTS,
  TASK_TYPE.AI_CREATE_CHARACTER,
  TASK_TYPE.AI_CREATE_LOCATION,
  TASK_TYPE.REFERENCE_TO_CHARACTER,
  TASK_TYPE.EPISODE_SPLIT_LLM,
  TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER,
  TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION,
  TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER,
  TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION,
  TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP,
  TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER,
])

function toNumber(value: unknown, fallback: number) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return n
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function pickFirstString(values: unknown[]): string | null {
  for (const value of values) {
    const next = readString(value)
    if (next) return next
  }
  return null
}

function buildTextTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const inputTokens = Math.max(0, Math.floor(toNumber(payload?.maxInputTokens, 3000)))
  const model = pickFirstString([payload?.analysisModel, payload?.model])
  if (!model) return null

  const maxFrozenCost = calcText(model, inputTokens, 0)

  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'text',
    model,
    quantity: inputTokens,
    unit: 'token',
    maxFrozenCost,
    pricingVersion: BUILTIN_PRICING_VERSION,
    action: String(taskType),
    metadata: { inputTokens },
    status: 'quoted',
  }
}

function buildImageTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const model = pickFirstString([payload?.imageModel, payload?.modelId, payload?.model])
  if (!model) return null
  const quantity = Math.max(1, Math.floor(toNumber(payload?.candidateCount ?? payload?.count, 1)))
  const generationOptions = toRecord(payload?.generationOptions)
  const resolution = readString(generationOptions.resolution) || readString(payload?.resolution)
  const quality = readString(generationOptions.quality) || readString(payload?.quality)
  const size = readString(generationOptions.size) || readString(payload?.size)
  const aspectRatio = readString(generationOptions.aspectRatio) || readString(payload?.aspectRatio)
  const metadata = {
    ...(resolution ? { resolution } : {}),
    ...(quality ? { quality } : {}),
    ...(size ? { size } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
  }
  const maxFrozenCost = calcImage(model, quantity, metadata)
  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'image',
    model,
    quantity,
    unit: 'image',
    maxFrozenCost,
    pricingVersion: BUILTIN_PRICING_VERSION,
    action: String(taskType),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    status: 'quoted',
  }
}

function buildVideoTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const firstLastFramePayload = toRecord(payload?.firstLastFrame)
  const generationMode = Object.keys(firstLastFramePayload).length > 0 ? 'firstlastframe' : 'normal'
  const model = pickFirstString([
    payload?.videoModel,
    payload?.modelId,
    payload?.model,
    firstLastFramePayload.flModel,
  ])
  if (!model) return null
  const generationOptions = toRecord(payload?.generationOptions)
  const resolution = readString(generationOptions.resolution) || readString(payload?.resolution)
  const duration = readNumber(generationOptions.duration) ?? readNumber(payload?.duration)
  const aspectRatio = readString(generationOptions.aspectRatio) || readString(payload?.aspectRatio)
  const generateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  const quantity = Math.max(1, Math.floor(toNumber(payload?.count, 1)))
  const metadata = {
    ...(resolution ? { resolution } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    generationMode,
    ...(typeof generateAudio === 'boolean' ? { generateAudio } : {}),
    containsVideoInput: false,
  }
  const maxFrozenCost = calcVideo(model, resolution || '720p', quantity, metadata)
  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'video',
    model,
    quantity,
    unit: 'video',
    maxFrozenCost,
    pricingVersion: BUILTIN_PRICING_VERSION,
    action: String(taskType),
    metadata,
    status: 'quoted',
  }
}

function buildMusicTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const model = pickFirstString([payload?.musicModel, payload?.modelId, payload?.model])
  if (!model) return null
  const durationSeconds = readNumber(payload?.durationSeconds)
  if (durationSeconds === null || durationSeconds <= 0) return null
  const outputFormat = readString(payload?.outputFormat)
  const vocalMode = readString(payload?.vocalMode)
  const genre = readString(payload?.genre)
  const mood = readString(payload?.mood)
  const bpm = readNumber(payload?.bpm)
  const metadata = {
    durationSeconds,
    ...(outputFormat ? { outputFormat } : {}),
    ...(vocalMode ? { vocalMode } : {}),
    ...(genre ? { genre } : {}),
    ...(mood ? { mood } : {}),
    ...(typeof bpm === 'number' ? { bpm } : {}),
  }
  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'music',
    model,
    quantity: 1,
    unit: 'call',
    maxFrozenCost: calcMusic(model, 1, metadata),
    pricingVersion: BUILTIN_PRICING_VERSION,
    action: String(taskType),
    metadata,
    status: 'quoted',
  }
}

export function isBillableTaskType(taskType: TaskType) {
  return BILLABLE_TASK_TYPES.has(taskType)
}

export function buildDefaultTaskBillingInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  if (!isBillableTaskType(taskType)) return null

  switch (taskType) {
    case TASK_TYPE.IMAGE_PANEL:
    case TASK_TYPE.EDIT_STYLE_PREVIEW_IMAGE:
    case TASK_TYPE.IMAGE_CHARACTER:
    case TASK_TYPE.IMAGE_LOCATION:
    case TASK_TYPE.MODIFY_ASSET_IMAGE:
    case TASK_TYPE.REGENERATE_GROUP:
    case TASK_TYPE.ASSET_HUB_IMAGE:
    case TASK_TYPE.ASSET_HUB_MODIFY:
      return buildImageTaskInfo(taskType, payload)
    case TASK_TYPE.VIDEO_PANEL:
    case TASK_TYPE.VIDEO_GROUP:
      return buildVideoTaskInfo(taskType, payload)
    case TASK_TYPE.MUSIC_GENERATE:
    case TASK_TYPE.BGM_SCORE_GENERATE:
      return buildMusicTaskInfo(taskType, payload)
    case TASK_TYPE.REGENERATE_STORYBOARD_TEXT:
    case TASK_TYPE.EDIT_SCRIPT_STORYBOARD_PREPARE:
    case TASK_TYPE.EDIT_SCRIPT_STORYBOARD_CAMERA_PLAN:
    case TASK_TYPE.INSERT_PANEL:
    case TASK_TYPE.ANALYZE_NOVEL:
    case TASK_TYPE.CLIPS_BUILD:
    case TASK_TYPE.SCREENPLAY_CONVERT:
    case TASK_TYPE.ANALYZE_GLOBAL:
    case TASK_TYPE.AI_MODIFY_APPEARANCE:
    case TASK_TYPE.AI_MODIFY_LOCATION:
    case TASK_TYPE.AI_MODIFY_PROP:
    case TASK_TYPE.AI_MODIFY_SHOT_PROMPT:
    case TASK_TYPE.ANALYZE_SHOT_VARIANTS:
    case TASK_TYPE.AI_CREATE_CHARACTER:
    case TASK_TYPE.AI_CREATE_LOCATION:
    case TASK_TYPE.REFERENCE_TO_CHARACTER:
    case TASK_TYPE.EPISODE_SPLIT_LLM:
    case TASK_TYPE.ASSET_HUB_AI_DESIGN_CHARACTER:
    case TASK_TYPE.ASSET_HUB_AI_DESIGN_LOCATION:
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_CHARACTER:
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_LOCATION:
    case TASK_TYPE.ASSET_HUB_AI_MODIFY_PROP:
    case TASK_TYPE.ASSET_HUB_REFERENCE_TO_CHARACTER:
      return buildTextTaskInfo(taskType, payload)
    case TASK_TYPE.PANEL_VARIANT:
      return buildImageTaskInfo(taskType, payload)
    default:
      return null
  }
}
ensureAiCatalogsRegistered()
