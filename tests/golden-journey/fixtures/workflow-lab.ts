import type { Page } from '@playwright/test'
import type { EditFirstWorkflowStage } from '@/lib/project-workflow/edit-first'
import type { GoldenWorkspaceScope } from '../browser/pages/home'

interface WorkflowLabCheckpoint {
  readonly id: string
  readonly workflowStage: EditFirstWorkflowStage
}

export async function forkGoldenWorkflowCheckpoint(input: {
  readonly page: Page
  readonly source: GoldenWorkspaceScope
  readonly stage: EditFirstWorkflowStage
}): Promise<GoldenWorkspaceScope> {
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
    const checkpoint = checkpoints.find((candidate) => (
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
      && (candidate as Record<string, unknown>).workflowStage === stage
    )) as WorkflowLabCheckpoint | undefined
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
    if (!forkResponse.ok) throw new Error(`GOLDEN_WORKFLOW_LAB_FORK_HTTP_${String(forkResponse.status)}`)
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
    return { projectId, episodeId }
  }, { source: input.source, stage: input.stage })
}
