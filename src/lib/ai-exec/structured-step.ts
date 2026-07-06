import type { ZodIssue, ZodType } from 'zod'
import type { Locale } from '@/i18n/routing'
import { safeParseJson } from '@/lib/json-repair'
import { AppError } from '@/lib/errors/app-error'
import {
  executeAiTextStep,
  executeAiVisionStep,
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
  readonly maxRepairRounds?: number
  readonly validate?: (parsed: TParsed) => TData
}

export type AiStructuredTextStepResult<TData> = AiStepExecutionResult & {
  readonly data: TData
  readonly repairRounds: number
}

export type AiStructuredVisionStepResult<TData> = AiVisionStepExecutionResult & {
  readonly data: TData
  readonly repairRounds: number
}

type ParsedJsonResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: AppError }

type ValidationResult<TData> =
  | { readonly ok: true; readonly data: TData }
  | { readonly ok: false; readonly error: AppError }

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
  try {
    const parsed = safeParseJson(text)
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

function buildRepairInstruction(error: AppError, locale: Locale | undefined): string {
  const details = error.details || {}
  const summary = typeof details.summary === 'string'
    ? details.summary
    : typeof details.validationError === 'string'
      ? details.validationError
      : error.message
  if (locale === 'en') {
    return [
      'Your previous response failed validation.',
      'Return the full corrected JSON only. Do not return a patch, markdown, comments, or explanation.',
      `Validation error code: ${error.code}`,
      `Validation details:\n${summary}`,
    ].join('\n\n')
  }
  return [
    '你上一次回复没有通过校验。',
    '只返回完整修正后的 JSON。不要返回补丁、Markdown、注释或解释。',
    `校验错误代码：${error.code}`,
    `校验详情：\n${summary}`,
  ].join('\n\n')
}

function appendRepairMessages(messages: AiStepExecutionInput['messages'], text: string, error: AppError, locale: Locale | undefined): AiStepExecutionInput['messages'] {
  return [
    ...messages,
    {
      role: 'assistant',
      content: truncate(text, 8000),
    },
    {
      role: 'user',
      content: buildRepairInstruction(error, locale),
    },
  ]
}

function appendRepairToVisionPrompt(prompt: string, text: string, error: AppError, locale: Locale | undefined): string {
  const previousOutputLabel = locale === 'en' ? 'Previous model output:' : '上一次模型输出：'
  return [
    prompt,
    '',
    previousOutputLabel,
    truncate(text, 8000),
    '',
    buildRepairInstruction(error, locale),
  ].join('\n')
}

function resolveRepairRounds(value: number | undefined): number {
  if (value === undefined) return 1
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new Error(`STRUCTURED_STEP_REPAIR_ROUNDS_INVALID:${String(value)}`)
  }
  return value
}

export async function executeAiStructuredTextStep<TParsed, TData = TParsed>(
  input: AiStepExecutionInput & AiStructuredOptions<TParsed, TData>,
): Promise<AiStructuredTextStepResult<TData>> {
  const maxRepairRounds = resolveRepairRounds(input.maxRepairRounds)
  let messages = input.messages
  let lastError: AppError | null = null

  for (let repairRound = 0; repairRound <= maxRepairRounds; repairRound += 1) {
    const result = await executeAiTextStep({
      ...input,
      messages,
    })
    const parsed = parseJsonByMode(result.text, input.parse)
    if (!parsed.ok) {
      lastError = parsed.error
      if (repairRound >= maxRepairRounds) break
      messages = appendRepairMessages(messages, result.text, parsed.error, input.locale)
      continue
    }
    const validated = validateParsed(parsed.value, input)
    if (!validated.ok) {
      lastError = validated.error
      if (repairRound >= maxRepairRounds) break
      messages = appendRepairMessages(messages, result.text, validated.error, input.locale)
      continue
    }
    return {
      ...result,
      data: validated.data,
      repairRounds: repairRound,
    }
  }

  throw lastError || new AppError('PARSE_ERROR', 'Structured model output failed')
}

export async function executeAiStructuredVisionStep<TParsed, TData = TParsed>(
  input: AiVisionStepExecutionInput & AiStructuredOptions<TParsed, TData>,
): Promise<AiStructuredVisionStepResult<TData>> {
  const maxRepairRounds = resolveRepairRounds(input.maxRepairRounds)
  let prompt = input.prompt
  let lastError: AppError | null = null

  for (let repairRound = 0; repairRound <= maxRepairRounds; repairRound += 1) {
    const result = await executeAiVisionStep({
      ...input,
      prompt,
    })
    const parsed = parseJsonByMode(result.text, input.parse)
    if (!parsed.ok) {
      lastError = parsed.error
      if (repairRound >= maxRepairRounds) break
      prompt = appendRepairToVisionPrompt(prompt, result.text, parsed.error, input.locale)
      continue
    }
    const validated = validateParsed(parsed.value, input)
    if (!validated.ok) {
      lastError = validated.error
      if (repairRound >= maxRepairRounds) break
      prompt = appendRepairToVisionPrompt(prompt, result.text, validated.error, input.locale)
      continue
    }
    return {
      ...result,
      data: validated.data,
      repairRounds: repairRound,
    }
  }

  throw lastError || new AppError('PARSE_ERROR', 'Structured model output failed')
}
