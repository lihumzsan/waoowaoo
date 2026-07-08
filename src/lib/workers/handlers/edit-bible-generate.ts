import type { Job } from 'bullmq'
import type { Locale } from '@/i18n/routing'
import { executeAiTextStep } from '@/lib/ai-exec/engine'
import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenChatMessageContent } from '@/lib/ai-registry/message-content'
import { withTextBilling } from '@/lib/billing'
import {
  generateEditBibleArtifacts,
  markEditBibleGenerationFailed,
  persistGeneratedEditBibleBundle,
  readEditBibleExtractionDiagnostics,
} from '@/lib/edit-bible'
import {
  EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE,
  estimateEditSourceDocumentInputTokens,
  materializePromptGeneratedSourceDocument,
  readEpisodeSourceDocumentById,
} from '@/lib/edit-source-document'
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

async function expandPromptGeneratedSource(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly prompt: string
}): Promise<string> {
  const finalPromptContent = buildAiPromptContent({
    promptId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
    locale: input.locale,
    variables: {
      user_prompt: input.prompt,
    },
  })
  const finalPrompt = flattenChatMessageContent(finalPromptContent)
  const maxInputTokens = Math.max(
    1200,
    estimateEditSourceDocumentInputTokens(finalPrompt) + EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE,
  )
  const runCompletion = async () => executeAiTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPromptContent }],
    temperature: 0.4,
    projectId: input.projectId,
    action: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
    meta: {
      stepId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
      stepTitle: 'Expand prompt into source script',
      stepIndex: 1,
      stepTotal: 5,
    },
  })
  const result = await withTextBilling(
    input.userId,
    input.model,
    maxInputTokens,
    {
      projectId: input.projectId,
      action: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
      metadata: { promptId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT },
    },
    runCompletion,
  )
  const text = result.text.trim()
  if (!text) throw new Error('EDIT_BIBLE_PROMPT_SOURCE_GENERATION_EMPTY')
  return text
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
      async () => {
        const effectiveSourceDocument = sourceDocument.sourceKind === 'prompt_generated_outline'
          ? await materializePromptGeneratedSourceDocument({
              projectId: job.data.projectId,
              episodeId,
              sourceDocumentId,
              text: await expandPromptGeneratedSource({
                userId: job.data.userId,
                projectId: job.data.projectId,
                model,
                locale: job.data.locale,
                prompt: sourceDocument.normalizedText,
              }),
            })
          : sourceDocument
        return await generateEditBibleArtifacts({
          userId: job.data.userId,
          projectId: job.data.projectId,
          model,
          locale: job.data.locale,
          sourceDocument: effectiveSourceDocument.normalizedText,
        })
      },
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
