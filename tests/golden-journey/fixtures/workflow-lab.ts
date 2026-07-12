import type { Page } from '@playwright/test'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import type { GoldenWorkspaceScope } from '../browser/pages/home'

interface WorkflowLabCheckpoint {
  readonly id: string
  readonly kind: 'choice' | 'approval' | 'stage'
  readonly workflowStage: EditFirstWorkflowStage
}

export interface ForkedGoldenWorkflowCheckpoint extends GoldenWorkspaceScope {
  readonly checkpointKind: WorkflowLabCheckpoint['kind']
}

export async function listGoldenWorkflowCheckpointStages(input: {
  readonly page: Page
  readonly source: GoldenWorkspaceScope
}): Promise<EditFirstWorkflowStage[]> {
  return await input.page.evaluate(async ({ source }) => {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(source.projectId)}/workflow-lab?episodeId=${encodeURIComponent(source.episodeId)}`,
    )
    if (!response.ok) throw new Error(`GOLDEN_WORKFLOW_LAB_LIST_HTTP_${String(response.status)}`)
    const payload: unknown = await response.json()
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('GOLDEN_WORKFLOW_LAB_LIST_INVALID')
    }
    const checkpoints = (payload as Record<string, unknown>).checkpoints
    if (!Array.isArray(checkpoints)) throw new Error('GOLDEN_WORKFLOW_LAB_CHECKPOINTS_MISSING')
    return checkpoints.flatMap((checkpoint) => (
      checkpoint && typeof checkpoint === 'object' && !Array.isArray(checkpoint)
      && typeof (checkpoint as Record<string, unknown>).workflowStage === 'string'
        ? [(checkpoint as Record<string, unknown>).workflowStage as EditFirstWorkflowStage]
        : []
    ))
  }, { source: input.source })
}

export async function forkGoldenWorkflowCheckpoint(input: {
  readonly page: Page
  readonly source: GoldenWorkspaceScope
  readonly stage: EditFirstWorkflowStage
}): Promise<ForkedGoldenWorkflowCheckpoint> {
  return await input.page.evaluate(async ({ source, stage }) => {
    const listResponse = await fetch(
      `/api/projects/${encodeURIComponent(source.projectId)}/workflow-lab?episodeId=${encodeURIComponent(source.episodeId)}`,
    )
    if (!listResponse.ok) throw new Error(`GOLDEN_WORKFLOW_LAB_LIST_HTTP_${String(listResponse.status)}`)
    const listed: unknown = await listResponse.json()
    if (!listed || typeof listed !== 'object' || Array.isArray(listed)) {
      throw new Error('GOLDEN_WORKFLOW_LAB_LIST_INVALID')
    }
    const checkpoints = (listed as Record<string, unknown>).checkpoints
    if (!Array.isArray(checkpoints)) throw new Error('GOLDEN_WORKFLOW_LAB_CHECKPOINTS_MISSING')
    const checkpointKindPriority: Readonly<Record<WorkflowLabCheckpoint['kind'], number>> = {
      approval: 3,
      choice: 2,
      stage: 1,
    }
    const checkpoint = checkpoints
      .filter((candidate): candidate is WorkflowLabCheckpoint => (
        candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
        && (candidate as Record<string, unknown>).workflowStage === stage
        && ['choice', 'approval', 'stage'].includes(String((candidate as Record<string, unknown>).kind))
      ))
      .sort((left, right) => checkpointKindPriority[right.kind] - checkpointKindPriority[left.kind])[0]
    if (!checkpoint) throw new Error(`GOLDEN_STAGE_CHECKPOINT_MISSING:${stage}`)
    const forkResponse = await fetch(`/api/projects/${encodeURIComponent(source.projectId)}/workflow-lab`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'forkCheckpointProject',
        sourceEpisodeId: source.episodeId,
        checkpointId: checkpoint.id,
      }),
    })
    if (!forkResponse.ok) {
      const errorBody = await forkResponse.text()
      throw new Error(`GOLDEN_WORKFLOW_LAB_FORK_HTTP_${String(forkResponse.status)}:${errorBody}`)
    }
    const responsePayload: unknown = await forkResponse.json()
    if (!responsePayload || typeof responsePayload !== 'object' || Array.isArray(responsePayload)) {
      throw new Error('GOLDEN_WORKFLOW_LAB_FORK_INVALID')
    }
    const forked = (responsePayload as Record<string, unknown>).result
    if (!forked || typeof forked !== 'object' || Array.isArray(forked)) {
      throw new Error('GOLDEN_WORKFLOW_LAB_RESULT_MISSING')
    }
    const labProject = (forked as Record<string, unknown>).labProject
    const labEpisode = (forked as Record<string, unknown>).labEpisode
    if (!labProject || typeof labProject !== 'object' || Array.isArray(labProject)
      || !labEpisode || typeof labEpisode !== 'object' || Array.isArray(labEpisode)) {
      throw new Error('GOLDEN_WORKFLOW_LAB_SCOPE_MISSING')
    }
    const projectId = (labProject as Record<string, unknown>).id
    const episodeId = (labEpisode as Record<string, unknown>).id
    if (typeof projectId !== 'string' || typeof episodeId !== 'string') {
      throw new Error('GOLDEN_WORKFLOW_LAB_SCOPE_INVALID')
    }
    return { projectId, episodeId, checkpointKind: checkpoint.kind }
  }, { source: input.source, stage: input.stage })
}
