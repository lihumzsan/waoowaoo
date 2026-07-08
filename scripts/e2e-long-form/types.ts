import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'

export const E2E_RESULT_STATUSES = ['PASS', 'SYSTEM_FAIL', 'PROVIDER_FAIL', 'QUALITY_WARN'] as const
export type E2eResultStatus = (typeof E2E_RESULT_STATUSES)[number]

export const E2E_MODES = ['mock', 'live'] as const
export type E2eMode = (typeof E2E_MODES)[number]

export const E2E_GENERATION_MODES = ['plan-only', 'real'] as const
export type E2eGenerationMode = (typeof E2E_GENERATION_MODES)[number]

export const E2E_TARGET_STAGE_IDS = [
  'source_ingested',
  'bible_ready',
  'bible_confirmed',
  'style_previews_ready',
  'style_selected',
  'core_edit_ready',
  'assets_ready',
  'assets_approved',
  'shot_plan_ready',
  'storyboard_ready',
  'storyboard_images_ready',
  'video_plan_ready',
  'videos_ready',
  'chapters_rendered',
  'music_ready',
  'final_video_ready',
] as const

export type E2eTargetStageId = (typeof E2E_TARGET_STAGE_IDS)[number]

export interface E2eTargetStageDefinition {
  readonly id: E2eTargetStageId
  readonly label: string
  readonly minimumWorkflowStage: EditFirstWorkflowStage
  readonly requiresRealGeneration?: boolean
}

export interface E2eRunnerConfig {
  readonly mode: E2eMode
  readonly target: E2eTargetStageId
  readonly generation: E2eGenerationMode
  readonly baseUrl: string
  readonly locale: 'zh' | 'en'
  readonly username: string | null
  readonly password: string | null
  readonly sessionCookie: string | null
  readonly prompt: string
  readonly projectName: string
  readonly episodeName: string
  readonly projectId: string | null
  readonly episodeId: string | null
  readonly aspectRatio: '9:16' | '16:9' | '21:9'
  readonly assistantPermissionMode: 'ask' | 'auto'
  readonly pollIntervalMs: number
  readonly stageTimeoutMs: number
  readonly overallTimeoutMs: number
  readonly reportDir: string
}

export interface E2eProjectScope {
  readonly projectId: string
  readonly episodeId: string
  readonly userId: string
}

export interface E2eChoiceAction {
  readonly runId: string
  readonly interruptionId: string | null
  readonly choiceType: 'bible_review' | 'style' | 'asset_review' | 'budget_confirmation'
  readonly toolCallId: string | null
  readonly output: Record<string, unknown>
}

export interface E2eApprovalAction {
  readonly runId: string
  readonly interruptionId: string
  readonly approved: boolean
  readonly reason: string | null
}

export interface E2eTaskFollowUpAction {
  readonly runId: string
  readonly waitId: string
  readonly claimId: string
}

export type E2eNextAction =
  | { readonly kind: 'choice'; readonly action: E2eChoiceAction }
  | { readonly kind: 'approval'; readonly action: E2eApprovalAction }
  | { readonly kind: 'task_follow_up'; readonly action: E2eTaskFollowUpAction }
  | { readonly kind: 'wait' }

export interface E2eFailure {
  readonly status: Exclude<E2eResultStatus, 'PASS'>
  readonly code: string
  readonly message: string
}

export interface E2eRunResult {
  readonly status: E2eResultStatus
  readonly projectId: string | null
  readonly episodeId: string | null
  readonly workspaceUrl: string | null
  readonly target: E2eTargetStageId
  readonly elapsedMs: number
  readonly reportPath: string | null
  readonly failure: E2eFailure | null
}
