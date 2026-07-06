import type { Job } from 'bullmq'
import {
  generateEditBibleArtifacts,
  markEditBibleGenerationFailed,
  persistGeneratedEditBibleBundle,
  readEditBibleExtractionDiagnostics,
} from '@/lib/edit-bible'
import { readEpisodeSourceDocumentById } from '@/lib/edit-source-document'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import type { TaskJobData } from '@/lib/task/types'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'

function readText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readModel(payload: Record<string, unknown>): string {
  const model = readText(payload.analysisModel) || readText(payload.model)
  if (!model) throw new Error('EDIT_BIBLE_ANALYSIS_MODEL_REQUIRED')
  return model
}

export async function handleEditBibleGenerateTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const sourceDocumentId = readText(payload.sourceDocumentId)
  const editBibleId = readText(payload.editBibleId) || readText(job.data.targetId)
  const model = readModel(payload)
  if (!episodeId) throw new Error('episodeId is required')
  if (!sourceDocumentId) throw new Error('sourceDocumentId is required')
  if (!editBibleId) throw new Error('editBibleId is required')

  await reportTaskProgress(job, 12, {
    stage: 'edit_bible_prepare',
    stageLabel: 'progress.stage.editBiblePrepare',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'edit_bible_prepare')

  const sourceDocument = await readEpisodeSourceDocumentById({
    projectId: job.data.projectId,
    episodeId,
    sourceDocumentId,
  })

  const streamContext = createWorkerLLMStreamContext(job, 'edit_bible_generate')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  try {
    await reportTaskProgress(job, 20, {
      stage: 'edit_bible_generate',
      stageLabel: 'progress.stage.editBibleGenerate',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_bible_generate')

    const bundle = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => await generateEditBibleArtifacts({
        userId: job.data.userId,
        projectId: job.data.projectId,
        model,
        locale: job.data.locale,
        sourceDocument: sourceDocument.normalizedText,
        sourceChecksum: sourceDocument.checksum,
      }),
    )

    await reportTaskProgress(job, 90, {
      stage: 'edit_bible_persist',
      stageLabel: 'progress.stage.editBiblePersist',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_bible_persist')

    const persisted = await persistGeneratedEditBibleBundle({
      projectId: job.data.projectId,
      episodeId,
      editBibleId,
      sourceDocumentId,
      bundle,
    })

    await reportTaskProgress(job, 96, {
      stage: 'edit_bible_persist',
      stageLabel: 'progress.stage.editBiblePersist',
      displayMode: 'detail',
    })

    return {
      editBibleId: persisted.editBible.id,
      episodeId,
      sourceDocumentId,
      status: persisted.editBible.status,
      chapterCount: persisted.chapters.length,
      version: persisted.editBible.version,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markEditBibleGenerationFailed({
      editBibleId,
      diagnostics: readEditBibleExtractionDiagnostics(error) ?? { error: message },
    })
    throw error
  } finally {
    await streamCallbacks.flush()
  }
}
