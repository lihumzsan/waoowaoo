import { type Job } from 'bullmq'
import { type TaskJobData } from '@/lib/task/types'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import {
  resolveImageSourceFromGeneration,
  uploadImageSourceToCos,
} from '../utils'
import {
  readImageRuntimeGenerationOptions,
  requireImageRuntimeAspectRatio,
} from '@/lib/image-generation/runtime-options'

export type AnyObj = Record<string, unknown>

export interface ImageProviderRuntimeOptions {
  readonly referenceImages?: string[]
  readonly aspectRatio: string
  readonly resolution?: string
  readonly quality?: string
  readonly size?: string
}

export function parseJsonStringArray(value: unknown): string[] {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string')
  if (typeof value !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

export function parseImageUrls(value: string | null | undefined, fieldName: string): string[] {
  return decodeImageUrlsFromDb(value, fieldName)
}

export function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

export function buildImageProviderRuntimeOptions(input: {
  readonly generationOptions: unknown
  readonly context: string
  readonly referenceImages?: readonly string[]
}): ImageProviderRuntimeOptions {
  const options = readImageRuntimeGenerationOptions(input.generationOptions)
  const aspectRatio = requireImageRuntimeAspectRatio(input.generationOptions, input.context)
  return {
    ...(input.referenceImages?.length ? { referenceImages: [...input.referenceImages] } : {}),
    aspectRatio,
    ...(options.resolution ? { resolution: options.resolution } : {}),
    ...(options.quality ? { quality: options.quality } : {}),
    ...(options.size ? { size: options.size } : {}),
  }
}

export async function generateCleanImageToStorage(params: {
  job: Job<TaskJobData>
  userId: string
  modelId: string
  prompt: string
  targetId: string
  keyPrefix: string
  allowTaskExternalIdResume?: boolean
  options?: {
    referenceImages?: string[]
    aspectRatio?: string
    resolution?: string
    quality?: string
    size?: string
  }
}) {
  const source = await resolveImageSourceFromGeneration(params.job, {
    userId: params.userId,
    modelId: params.modelId,
    prompt: params.prompt,
    options: params.options,
    allowTaskExternalIdResume: params.allowTaskExternalIdResume,
  })
  return await uploadImageSourceToCos(source, params.keyPrefix, params.targetId, {
    taskId: params.job.data.taskId,
    artifact: `${params.keyPrefix}:${params.targetId}`,
  })
}
