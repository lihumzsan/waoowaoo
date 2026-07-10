import { z } from 'zod'
import type { Locale } from '@/i18n/routing'
import { executeAiStructuredTextStep } from '@/lib/ai-exec/structured-step'
import { AI_PROMPT_IDS, buildAiPromptContent } from '@/lib/ai-prompts'
import { flattenChatMessageContent } from '@/lib/ai-registry/message-content'
import { withTextBilling } from '@/lib/billing'
import { AppError, toAppError } from '@/lib/errors/app-error'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import {
  buildEditSourceBlocks,
  formatEditSourceBlocksForPrompt,
} from '@/lib/edit-source-document'
import { EDIT_BIBLE_PROMPT_CACHE_MIN_CHARS } from './constraints'
import { validateEditBibleBundle } from './cross-check'
import {
  type EditBibleBeatSheet,
  type EditBibleBundle,
  type EditBibleDiagnostics,
  type EditBibleEmotionalCurve,
  type EditBible,
} from './schemas'
import type { Ledger } from '@/lib/edit-ledger'
import {
  normalizeRawBeatSheet,
  normalizeRawEditBible,
  normalizeRawEmotionalCurve,
  normalizeRawLedger,
} from './source-anchor-normalization'

type EditBiblePromptStepId =
  | typeof AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL
  | typeof AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET
  | typeof AI_PROMPT_IDS.EDIT_BIBLE_LEDGER
  | typeof AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE

class EditBibleExtractionError extends AppError {
  readonly diagnostics: EditBibleDiagnostics

  constructor(diagnostics: EditBibleDiagnostics, code: UnifiedErrorCode) {
    super(code, 'EDIT_BIBLE_EXTRACTION_FAILED', { details: diagnostics })
    this.name = 'EditBibleExtractionError'
    this.diagnostics = diagnostics
  }
}

function serializeExtractionError(error: unknown): Record<string, string> {
  return {
    error: error instanceof Error ? error.message : String(error),
  }
}

export function readEditBibleExtractionDiagnostics(error: unknown): EditBibleDiagnostics | null {
  return error instanceof EditBibleExtractionError ? error.diagnostics : null
}

async function runEditBibleStructuredStep<TData>(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly promptId: EditBiblePromptStepId
  readonly sourceDocument: string
  readonly stepTitle: string
  readonly stepIndex: number
  readonly stepTotal: number
  readonly validate: (raw: unknown) => TData
}): Promise<TData> {
  const finalPromptContent = buildAiPromptContent({
    promptId: input.promptId,
    locale: input.locale,
    variables: {
      source_document: input.sourceDocument,
      source_length: String(input.sourceDocument.length),
    },
    cacheVariableKeys: ['source_document'],
    minCacheChars: EDIT_BIBLE_PROMPT_CACHE_MIN_CHARS,
  })
  const finalPrompt = flattenChatMessageContent(finalPromptContent)
  const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
  const action = input.promptId
  const runCompletion = async () => executeAiStructuredTextStep({
    userId: input.userId,
    model: input.model,
    messages: [{ role: 'user', content: finalPromptContent }],
    temperature: 0.3,
    projectId: input.projectId,
    action,
    locale: input.locale,
    meta: {
      stepId: action,
      stepTitle: input.stepTitle,
      stepIndex: input.stepIndex,
      stepTotal: input.stepTotal,
    },
    schema: z.unknown(),
    parse: { kind: 'object' },
    validate: input.validate,
  })

  const result = await withTextBilling(
    input.userId,
    input.model,
    maxInputTokens,
    { projectId: input.projectId, action, metadata: { promptId: input.promptId } },
    runCompletion,
  )
  if (!result.text.trim()) {
    throw new Error(`EDIT_BIBLE_PROMPT_EMPTY:${input.promptId}`)
  }
  return result.data
}

export async function generateEditBibleArtifacts(input: {
  readonly userId: string
  readonly projectId: string
  readonly model: string
  readonly locale: Locale
  readonly sourceDocument: string
}): Promise<EditBibleBundle> {
  const sourceBlocks = buildEditSourceBlocks(input.sourceDocument)
  const sourceDocumentForPrompt = formatEditSourceBlocksForPrompt(sourceBlocks)
  const entries = [
    ['bible', runEditBibleStructuredStep<EditBible>({
      ...input,
      sourceDocument: sourceDocumentForPrompt,
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_GLOBAL,
      stepTitle: 'Edit bible global facts',
      stepIndex: 1,
      stepTotal: 4,
      validate: (raw) => normalizeRawEditBible({ raw }),
    })],
    ['beatSheet', runEditBibleStructuredStep<EditBibleBeatSheet>({
      ...input,
      sourceDocument: sourceDocumentForPrompt,
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_BEAT_SHEET,
      stepTitle: 'Edit bible beat sheet',
      stepIndex: 2,
      stepTotal: 4,
      validate: (raw) => normalizeRawBeatSheet({
        raw,
        sourceText: input.sourceDocument,
        blocks: sourceBlocks,
      }),
    })],
    ['ledger', runEditBibleStructuredStep<Ledger>({
      ...input,
      sourceDocument: sourceDocumentForPrompt,
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_LEDGER,
      stepTitle: 'Edit bible ledger',
      stepIndex: 3,
      stepTotal: 4,
      validate: (raw) => normalizeRawLedger({
        raw,
        sourceText: input.sourceDocument,
        blocks: sourceBlocks,
      }),
    })],
    ['emotionalCurve', runEditBibleStructuredStep<EditBibleEmotionalCurve>({
      ...input,
      sourceDocument: sourceDocumentForPrompt,
      promptId: AI_PROMPT_IDS.EDIT_BIBLE_EMOTIONAL_CURVE,
      stepTitle: 'Edit bible emotional curve',
      stepIndex: 4,
      stepTotal: 4,
      validate: (raw) => normalizeRawEmotionalCurve({
        raw,
        sourceText: input.sourceDocument,
        blocks: sourceBlocks,
      }),
    })],
  ] as const
  const settled = await Promise.allSettled(entries.map((entry) => entry[1]))
  const diagnostics: EditBibleDiagnostics = {}
  const extractionErrors: AppError[] = []
  let bible: EditBible | null = null
  let beatSheet: EditBibleBeatSheet | null = null
  let ledger: Ledger | null = null
  let emotionalCurve: EditBibleEmotionalCurve | null = null
  settled.forEach((result, index) => {
    const key = entries[index]?.[0]
    if (!key) return
    if (result.status === 'fulfilled') {
      switch (key) {
        case 'bible':
          bible = result.value as EditBible
          return
        case 'beatSheet':
          beatSheet = result.value as EditBibleBeatSheet
          return
        case 'ledger':
          ledger = result.value as Ledger
          return
        case 'emotionalCurve':
          emotionalCurve = result.value as EditBibleEmotionalCurve
          return
      }
      return
    }
    const normalizedError = toAppError(result.reason, {
      fallbackCode: 'PLAN_VALIDATION_FAILED',
    })
    extractionErrors.push(normalizedError)
    diagnostics[key] = serializeExtractionError(result.reason)
  })
  if (Object.keys(diagnostics).length > 0) {
    const primaryError = extractionErrors.find((error) => !error.retryable) ?? extractionErrors[0]
    throw new EditBibleExtractionError(diagnostics, primaryError?.code ?? 'PLAN_VALIDATION_FAILED')
  }
  if (!bible || !beatSheet || !ledger || !emotionalCurve) {
    throw new EditBibleExtractionError(
      { error: 'EDIT_BIBLE_EXTRACTION_RESULT_INCOMPLETE' },
      'PLAN_VALIDATION_FAILED',
    )
  }

  try {
    return validateEditBibleBundle({
      bundle: {
        bible,
        beatSheet,
        ledger,
        emotionalCurve,
      },
      sourceText: input.sourceDocument,
    })
  } catch (error: unknown) {
    throw new EditBibleExtractionError(
      { bundle: serializeExtractionError(error) },
      'PLAN_VALIDATION_FAILED',
    )
  }
}
