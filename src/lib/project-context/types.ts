import type { RecentOperationResult } from '@/lib/task/operation-result-types'
import type { EditFirstWorkflowState } from '@/lib/project-workflow/edit-first'

export interface ProjectPolicySnapshot {
  projectId: string
  episodeId?: string | null
  videoRatio: string
  analysisModel?: string | null
  overrides: Record<string, unknown>
}

export interface ProjectPolicyOverrideInput {
  videoRatio?: string
  analysisModel?: string | null
  overrides?: Record<string, unknown>
}

export interface ProjectContextArtifactSummary {
  type: string
  refId: string
  createdAt?: string | null
}

export interface ProjectContextRunSummary {
  id: string
  runType: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface ProjectContextEpisodeSnapshot {
  novelText: string | null
  storyboardCount: number
  panelCount: number
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

export interface ProjectContextPanelSnapshot {
  panelId: string
  editScriptId: string | null
  storyboardId: string
  panelIndex: number
  description: string | null
  imagePrompt: string | null
  imageUrl: string | null
  imageMediaId: string | null
  candidateImages: string | null
  videoPrompt: string | null
  videoUrl: string | null
  videoMediaId: string | null
  updatedAt: string
}

export interface ProjectContextEpisodeDetailSnapshot {
  episode: ProjectContextEpisodeSnapshot | null
  editBible: ProjectContextEditBibleSnapshot | null
  chapters: ProjectContextEditChapterSnapshot[]
  editScript: ProjectContextEditScriptSnapshot | null
  editScripts: ProjectContextEditScriptSnapshot[]
  panels: ProjectContextPanelSnapshot[]
}

export interface ProjectContextSnapshot {
  projectId: string
  projectName: string
  episodeId?: string | null
  episodeName?: string | null
  selectedScopeRef?: string | null
  selectedPanelId?: string | null
  selectedAssetId?: string | null
  latestArtifacts: ProjectContextArtifactSummary[]
  activePlanRuns: ProjectContextRunSummary[]
  activeOperationTasks: RecentOperationResult[]
  recentOperationResults: RecentOperationResult[]
  policy: ProjectPolicySnapshot
  editFirstWorkflow: EditFirstWorkflowState
  episodeDetail?: ProjectContextEpisodeDetailSnapshot
}
