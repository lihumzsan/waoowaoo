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
import { parseStructuredJsonByMode } from './structured-json'
import type { StructuredParseMode } from './structured-json'
import type {
  AiStepExecutionInput,
  AiStepExecutionResult,
  AiVisionStepExecutionInput,
  AiVisionStepExecutionResult,
} from '@/lib/ai-registry/types'

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

function issuePath(issue: ZodIssue): string {
  return issue.path.length > 0 ? issue.path.join('.') : '<root>'
}

function summarizeIssues(issues: readonly ZodIssue[]): string {
  return issues
    .slice(0, 20)
    .map((issue) => `${issuePath(issue)}: ${issue.message}`)
    .join('\n')
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
      const parsed = parseStructuredJsonByMode(result.text, input.parse)
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
      const parsed = parseStructuredJsonByMode(result.text, input.parse)
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
