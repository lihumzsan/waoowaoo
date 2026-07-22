import type { RecentOperationResult } from '@/lib/task/operation-result-types'

export interface ProjectPolicySnapshot {
  projectId: string
  episodeId?: string | null
  videoRatio: string | null
  analysisModel?: string | null
  overrides: Record<string, unknown>
}

export interface ProjectPolicyOverrideInput {
  analysisModel?: string | null
  overrides?: Record<string, unknown>
}

export interface ProjectContextEditBibleSnapshot {
  id: string
  sourceResourceId: string
  sourceRevisionId: string
  bibleResourceId: string
  bibleRevisionId: string
  version: number
  updatedAt: string
}

export interface ProjectContextEditChapterSnapshot {
  id: string
  chapterIndex: number
  title: string
  summary: string
  sourceStart: number
  sourceEnd: number
  targetDurationSec: number
  beatIds: readonly string[]
  eventIds: readonly string[]
}

export interface ProjectContextEpisodeDetailSnapshot {
  editBible: ProjectContextEditBibleSnapshot | null
  chapters: ProjectContextEditChapterSnapshot[]
}

export interface ProjectContextSnapshot {
  projectId: string
  projectName: string
  episodeId?: string | null
  episodeName?: string | null
  selectedScopeRef?: string | null
  selectedAssetId?: string | null
  activeOperationTasks: RecentOperationResult[]
  recentOperationResults: RecentOperationResult[]
  policy: ProjectPolicySnapshot
  episodeDetail?: ProjectContextEpisodeDetailSnapshot
}
