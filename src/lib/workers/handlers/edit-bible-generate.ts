import type { Job } from 'bullmq'
import type { Locale } from '@/i18n/routing'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenChatMessageContent } from '@/lib/ai-registry/message-content'
import { withTextBilling } from '@/lib/billing'
import {
  generateEditBibleArtifacts,
  markEditBibleScriptReadyForReview,
  normalizeExpandedSourceScriptOutput,
  persistGeneratedEditBibleBundle,
  type NormalizedSourceScriptSegments,
} from '@/lib/edit-bible'
import { expandedSourceScriptOutputSchema } from '@/lib/edit-bible/schemas'
import {
  EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE,
  estimateEditSourceDocumentInputTokens,
  materializePromptGeneratedSourceDocument,
  readEpisodeSourceDocumentById,
} from '@/lib/edit-source-document'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'
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
  readonly previousScript?: string | null
}): Promise<NormalizedSourceScriptSegments> {
  const userPrompt = input.previousScript
    ? [
        '当前完整剧本：',
        input.previousScript,
        '',
        '用户修改要求：',
        input.prompt,
        '',
        '请根据修改要求输出新版完整可拍摄剧本，并同步输出结构化剧本视图。',
      ].join('\n')
    : input.prompt
  const finalPromptContent = buildAiPromptContent({
    promptId: AI_PROMPT_IDS.EDIT_BIBLE_OUTLINE_SCRIPT,
    locale: input.locale,
    variables: {
      user_prompt: userPrompt,
    },
  })
  const finalPrompt = flattenChatMessageContent(finalPromptContent)
  const maxInputTokens = Math.max(
    1200,
    estimateEditSourceDocumentInputTokens(finalPrompt) + EDIT_SOURCE_DOCUMENT_OUTPUT_TOKEN_RESERVE,
  )
  const runCompletion = async () => executeAiStructuredTextStep({
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
    locale: input.locale,
    schema: expandedSourceScriptOutputSchema,
    parse: { kind: 'object' },
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
  const normalized = normalizeExpandedSourceScriptOutput(result.data)
  if (!normalized.normalizedText) throw new Error('EDIT_BIBLE_PROMPT_SOURCE_GENERATION_EMPTY')
  return normalized
}

export async function handleEditBibleGenerateTask(job: Job<TaskJobData>) {
  const payload = job.data.payload || {}
  const episodeId = readText(payload.episodeId) || readText(job.data.episodeId)
  const sourceDocumentId = readText(payload.sourceDocumentId)
  const previousSourceDocumentId = readText(payload.previousSourceDocumentId)
  const editBibleId = readText(payload.editBibleId) || readText(job.data.targetId)
  const model = readModel(payload)
  if (!episodeId) throw new Error('episodeId is required')
  if (!sourceDocumentId) throw new Error('sourceDocumentId is required')
  if (!editBibleId) throw new Error('editBibleId is required')
  const generatesSourceScript = job.data.type === TASK_TYPE.EDIT_SOURCE_SCRIPT_GENERATE

  await reportTaskProgress(job, 12, {
    stage: generatesSourceScript ? 'edit_source_script_prepare' : 'edit_bible_prepare',
    stageLabel: generatesSourceScript ? 'progress.stage.editSourceScriptPrepare' : 'progress.stage.editBiblePrepare',
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
      stage: generatesSourceScript ? 'edit_source_script_generate' : 'edit_bible_generate',
      stageLabel: generatesSourceScript ? 'progress.stage.editSourceScriptGenerate' : 'progress.stage.editBibleGenerate',
      displayMode: 'detail',
    })
    await assertTaskActive(job, 'edit_bible_generate')

    const bundle = await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => {
        if (sourceDocument.sourceKind === 'prompt_generated_outline') {
          const previousSourceDocument = previousSourceDocumentId
            ? await readEpisodeSourceDocumentById({
                projectId: job.data.projectId,
                episodeId,
                sourceDocumentId: previousSourceDocumentId,
              })
            : null
          const expandedSource = await expandPromptGeneratedSource({
            userId: job.data.userId,
            projectId: job.data.projectId,
            model,
            locale: job.data.locale,
            prompt: sourceDocument.normalizedText,
            previousScript: previousSourceDocument?.normalizedText ?? null,
          })
          const effectiveSourceDocument = await materializePromptGeneratedSourceDocument({
            projectId: job.data.projectId,
            episodeId,
            sourceDocumentId,
            text: expandedSource.normalizedText,
            scriptStructure: expandedSource.structure,
          })
          await markEditBibleScriptReadyForReview({
            editBibleId,
            sourceDocumentId: effectiveSourceDocument.id,
            taskId: job.data.taskId,
          })
          return null
        }
        return await generateEditBibleArtifacts({
          userId: job.data.userId,
          projectId: job.data.projectId,
          model,
          locale: job.data.locale,
          sourceDocument: sourceDocument.normalizedText,
        })
      },
    )

    if (!bundle) {
      return {
        editBibleId,
        episodeId,
        sourceDocumentId,
        status: 'script_ready_for_review',
        chapterCount: 0,
        version: null,
      }
    }

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
      taskId: job.data.taskId,
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
  } finally {
    await streamCallbacks.flush()
  }
}
