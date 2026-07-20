import type { RecentOperationResult } from '@/lib/task/operation-result-types'
import type { EditFirstWorkflowView } from '@/lib/project-workflow/edit-first-view'

export interface ProjectPolicySnapshot {
  projectId: string
  episodeId?: string | null
  videoRatio: string | null
  analysisModel?: string | null
  overrides: Record<string, unknown>
}

export interface ProjectPolicyOverrideInput {
  videoRatio?: string | null
  analysisModel?: string | null
  overrides?: Record<string, unknown>
}

export interface ProjectContextEpisodeSnapshot {
  novelText: string | null
  videoSegmentCount: number
}

export interface ProjectContextEditBibleSnapshot {
  id: string
  status: string
  userPrompt: string
  textPreview: string
  updatedAt: string
}

export interface ProjectContextEditScriptSnapshot {
  id: string
  chapterId: string | null
  status: string
  assetReviewStatus: 'pending' | 'approved'
  durationSec: number
  shotCount: number
  generationSegmentCount: number
  requirementCount: number
  pendingRequirementCount: number
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
  status: string
  renderStatus: string | null
  outputMediaId: string | null
}

export interface ProjectContextVideoSegmentSnapshot {
  id: string
  editScriptId: string
  segmentId: string
  status: string
  durationSec: number
  videoMediaId: string | null
  errorCode: string | null
  errorMessage: string | null
  updatedAt: string
}

export interface ProjectContextEpisodeDetailSnapshot {
  episode: ProjectContextEpisodeSnapshot | null
  editBible: ProjectContextEditBibleSnapshot | null
  chapters: ProjectContextEditChapterSnapshot[]
  editScript: ProjectContextEditScriptSnapshot | null
  editScripts: ProjectContextEditScriptSnapshot[]
  videoSegments: ProjectContextVideoSegmentSnapshot[]
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
  editFirstWorkflow: EditFirstWorkflowView
  episodeDetail?: ProjectContextEpisodeDetailSnapshot
}
