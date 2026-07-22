import type { TaskType } from '@/lib/task/types'

export interface StructuredStreamTaskEventMeta {
  readonly taskType: string | null
  readonly stepId: string | null
}

export interface StructuredStreamAdapter {
  readonly key: string
  readonly taskTypes: readonly TaskType[]
  readonly stepIds: readonly string[]
}

export interface TextStreamAdapter {
  readonly key: string
  readonly taskTypes: readonly TaskType[]
  readonly stepIds: readonly string[]
}

export const STRUCTURED_STREAM_ADAPTERS: readonly StructuredStreamAdapter[] = []
export const TEXT_STREAM_ADAPTERS: readonly TextStreamAdapter[] = []

export function findStructuredStreamAdapters(
  _meta: StructuredStreamTaskEventMeta,
): readonly StructuredStreamAdapter[] {
  return STRUCTURED_STREAM_ADAPTERS
}

export function findTextStreamAdapters(
  _meta: StructuredStreamTaskEventMeta,
): readonly TextStreamAdapter[] {
  return TEXT_STREAM_ADAPTERS
}
