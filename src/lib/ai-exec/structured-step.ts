import type { ZodIssue, ZodType } from 'zod'
import type { Locale } from '@/i18n/routing'
import { AppError } from '@/lib/errors/app-error'
import { toAppError } from '@/lib/errors/app-error'
import { ERROR_FAILURE_CLASS } from '@/lib/errors/codes'
import { getLogContext } from '@/lib/logging/context'
import {
  executeAiTextStep,
  executeAiVisionStep,
  markTaskAiInvocationRetryable,
} from './engine'
import type {
  AiStepExecutionInput,
  AiStepExecutionResult,
  AiVisionStepExecutionInput,
  AiVisionStepExecutionResult,
} from '@/lib/ai-registry/types'

export type StructuredParseMode =
  | { readonly kind: 'object' }
  | { readonly kind: 'array'; readonly fallbackKey?: string }

export type AiStructuredOptions<TParsed, TData> = {
  readonly schema: ZodType<TParsed>
  readonly parse: StructuredParseMode
  readonly locale?: Locale
  readonly validate?: (parsed: TParsed) => TData
}

export type AiStructuredTextStepResult<TData> = AiStepExecutionResult & {
  readonly data: TData
}

export type AiStructuredVisionStepResult<TData> = AiVisionStepExecutionResult & {
  readonly data: TData
}

type ParsedJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: AppError }

type ValidationResult<TData> =
  | { readonly ok: true; readonly data: TData }
  | { readonly ok: false; readonly error: AppError }

async function markTaskStructuredOutputRetryable(
  modality: 'llm' | 'vision',
  input: {
    readonly action?: string
    readonly meta?: { readonly stepId: string; readonly stepAttempt?: number; readonly stepIndex: number }
  },
  error: AppError,
): Promise<void> {
  if (!getLogContext().taskId || error.failureClass !== ERROR_FAILURE_CLASS.OUTPUT_VALIDATION) return
  await markTaskAiInvocationRetryable({
    modality,
    action: input.action,
    meta: input.meta,
    error,
  })
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}\n...[truncated]`
}

function issuePath(issue: ZodIssue): string {
  return issue.path.length > 0 ? issue.path.join('.') : '<root>'
}

function summarizeIssues(issues: readonly ZodIssue[]): string {
  return issues
    .slice(0, 20)
    .map((issue) => `${issuePath(issue)}: ${issue.message}`)
    .join('\n')
}

function parseJsonByMode(text: string, mode: StructuredParseMode): ParsedJsonResult {
  if (!text.trim()) {
    return {
      ok: false,
      error: new AppError('EMPTY_RESPONSE', 'Model returned no structured response body'),
    }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (mode.kind === 'object') {
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ok: true, value: parsed }
      }
      return {
        ok: false,
        error: new AppError('PARSE_ERROR', 'Expected JSON object from model output', {
          details: { parseMode: mode.kind, rawTextHead: truncate(text, 1000) },
        }),
      }
    }

    if (Array.isArray(parsed)) {
      return { ok: true, value: parsed }
    }
    if (parsed && typeof parsed === 'object' && mode.fallbackKey) {
      const wrapped = (parsed as Record<string, unknown>)[mode.fallbackKey]
      if (Array.isArray(wrapped)) {
        return { ok: true, value: wrapped }
      }
    }
    return {
      ok: false,
      error: new AppError('PARSE_ERROR', 'Expected JSON array from model output', {
        details: { parseMode: mode.kind, fallbackKey: mode.fallbackKey || null, rawTextHead: truncate(text, 1000) },
      }),
    }
  } catch (error: unknown) {
    return {
      ok: false,
      error: new AppError('PARSE_ERROR', error instanceof Error ? error.message : 'Model output could not be parsed', {
        details: {
          parseMode: mode.kind,
          fallbackKey: mode.kind === 'array' ? mode.fallbackKey || null : null,
          rawTextHead: truncate(text, 1000),
        },
        cause: error,
      }),
    }
  }
}

function validateParsed<TParsed, TData>(
  value: unknown,
  options: AiStructuredOptions<TParsed, TData>,
): ValidationResult<TData> {
  const parsed = options.schema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      error: new AppError('MODEL_OUTPUT_SCHEMA_INVALID', 'Model output did not match the required schema', {
        details: {
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
            code: issue.code,
          })),
          summary: summarizeIssues(parsed.error.issues),
        },
      }),
    }
  }

  if (!options.validate) {
    return { ok: true, data: parsed.data as unknown as TData }
  }

  try {
    return { ok: true, data: options.validate(parsed.data) }
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return {
        ok: false,
        error,
      }
    }
    return {
      ok: false,
      error: new AppError('MODEL_OUTPUT_SCHEMA_INVALID', error instanceof Error ? error.message : 'Model output failed validation', {
        details: {
          validationError: error instanceof Error ? error.message : String(error),
        },
        cause: error,
      }),
    }
  }
}

export async function executeAiStructuredTextStep<TParsed, TData = TParsed>(
  input: AiStepExecutionInput & AiStructuredOptions<TParsed, TData>,
): Promise<AiStructuredTextStepResult<TData>> {
  const maxAttempts = getLogContext().taskId ? 1 : 3
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await executeAiTextStep(input)
      const parsed = parseJsonByMode(result.text, input.parse)
      if (!parsed.ok) {
        await markTaskStructuredOutputRetryable('llm', input, parsed.error)
        throw parsed.error
      }
      const validated = validateParsed(parsed.value, input)
      if (!validated.ok) {
        await markTaskStructuredOutputRetryable('llm', input, validated.error)
        throw validated.error
      }
      return { ...result, data: validated.data }
    } catch (error: unknown) {
      const appError = toAppError(error)
      if (!appError.retryable || attempt >= maxAttempts) throw appError
    }
  }
  throw new Error('STRUCTURED_TEXT_RETRY_INVARIANT_EXHAUSTED')
}

export async function executeAiStructuredVisionStep<TParsed, TData = TParsed>(
  input: AiVisionStepExecutionInput & AiStructuredOptions<TParsed, TData>,
): Promise<AiStructuredVisionStepResult<TData>> {
  const maxAttempts = getLogContext().taskId ? 1 : 3
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await executeAiVisionStep(input)
      const parsed = parseJsonByMode(result.text, input.parse)
      if (!parsed.ok) {
        await markTaskStructuredOutputRetryable('vision', input, parsed.error)
        throw parsed.error
      }
      const validated = validateParsed(parsed.value, input)
      if (!validated.ok) {
        await markTaskStructuredOutputRetryable('vision', input, validated.error)
        throw validated.error
      }
      return { ...result, data: validated.data }
    } catch (error: unknown) {
      const appError = toAppError(error)
      if (!appError.retryable || attempt >= maxAttempts) throw appError
    }
  }
  throw new Error('STRUCTURED_VISION_RETRY_INVARIANT_EXHAUSTED')
}
