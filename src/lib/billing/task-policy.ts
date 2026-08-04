import {
  calcImage,
  calcMusic,
  calcText,
  calcVideo,
  calcVoice,
} from './cost'
import { BUILTIN_PRICING_VERSION } from '@/lib/ai-registry/pricing-resolution'
import { toChargeableCredits } from './credits'
import { ensureAiCatalogsRegistered } from '@/lib/ai-exec/catalog-bootstrap'
import { getTaskDefinition } from '@/lib/task/definition'
import type { TaskType } from '@/lib/task/types'
import type { TaskBillingInfo } from './types'
import { readImageRuntimeGenerationOptions } from '@/lib/image-generation/runtime-options'

type AnyPayload = Record<string, unknown> | null | undefined

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

  const maxFrozenCost = toChargeableCredits(calcText(model, inputTokens, 0))

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
  const generationOptions = readImageRuntimeGenerationOptions(payload?.generationOptions)
  const resolution = generationOptions.resolution
  const quality = generationOptions.quality
  const size = generationOptions.size
  const aspectRatio = generationOptions.aspectRatio
  const metadata = {
    ...(resolution ? { resolution } : {}),
    ...(quality ? { quality } : {}),
    ...(size ? { size } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
  }
  const maxFrozenCost = toChargeableCredits(calcImage(model, quantity, metadata))
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
  const model = pickFirstString([
    payload?.videoModel,
    payload?.modelId,
    payload?.model,
  ])
  if (!model) return null
  const generationOptions = toRecord(payload?.generationOptions)
  const resolution = readString(generationOptions.resolution) || readString(payload?.resolution)
  const duration = readNumber(payload?.durationSeconds)
  const aspectRatio = readString(generationOptions.aspectRatio) || readString(payload?.aspectRatio)
  const generateAudio = typeof generationOptions.generateAudio === 'boolean'
    ? generationOptions.generateAudio
    : undefined
  const quantity = Math.max(1, Math.floor(toNumber(payload?.count, 1)))
  const metadata = {
    ...(resolution ? { resolution } : {}),
    ...(typeof duration === 'number' ? { duration } : {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    generationMode: 'normal',
    ...(typeof generateAudio === 'boolean' ? { generateAudio } : {}),
    containsVideoInput: false,
  }
  const maxFrozenCost = toChargeableCredits(calcVideo(model, resolution || '720p', quantity, metadata))
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
  const quantity = Math.max(1, Math.floor(toNumber(payload?.count, 1)))
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
    quantity,
    unit: 'call',
    maxFrozenCost: toChargeableCredits(calcMusic(model, quantity, metadata)),
    pricingVersion: BUILTIN_PRICING_VERSION,
    action: String(taskType),
    metadata,
    status: 'quoted',
  }
}

function buildVoiceTaskInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const model = pickFirstString([payload?.voiceModel, payload?.modelId, payload?.model])
  const previewText = readString(payload?.previewText)
  if (!model || !previewText) return null
  const characters = Math.max(1, Array.from(previewText).length)
  const language = readString(payload?.language)
  return {
    billable: true,
    source: 'task',
    taskType,
    apiType: 'voice',
    model,
    quantity: characters,
    unit: 'character',
    maxFrozenCost: toChargeableCredits(calcVoice(model, characters)),
    pricingVersion: BUILTIN_PRICING_VERSION,
    action: String(taskType),
    metadata: {
      characters,
      ...(language ? { language } : {}),
    },
    status: 'quoted',
  }
}

export function isBillableTaskType(taskType: TaskType) {
  return getTaskDefinition(taskType).billingPolicy !== 'none'
}

export function buildDefaultTaskBillingInfo(taskType: TaskType, payload: AnyPayload): TaskBillingInfo | null {
  const billingPolicy = getTaskDefinition(taskType).billingPolicy
  switch (billingPolicy) {
    case 'none':
      return null
    case 'image':
      return buildImageTaskInfo(taskType, payload)
    case 'video':
      return buildVideoTaskInfo(taskType, payload)
    case 'music':
      return buildMusicTaskInfo(taskType, payload)
    case 'voice':
      return buildVoiceTaskInfo(taskType, payload)
    case 'text':
      return buildTextTaskInfo(taskType, payload)
  }
  const exhaustive: never = billingPolicy
  throw new Error(`TASK_BILLING_POLICY_UNSUPPORTED:${String(exhaustive)}`)
}
ensureAiCatalogsRegistered()
