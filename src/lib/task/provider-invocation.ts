import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { AppError } from '@/lib/errors/app-error'
import { getLogContext } from '@/lib/logging/context'
import { prisma } from '@/lib/prisma'
import { FetchStatusError } from '@/lib/retry'
import { loadTaskExecutionFingerprint } from './execution-checkpoint'

const CONTRACT_VERSION = 1
const STEP_PREFIX = 'provider:'

export type TaskProviderInvocation = {
  readonly key: string
}

type MediaProviderInvocationResult = {
  readonly success: boolean
  readonly error?: string
}

type TaskDurableInvocationResultPolicy<TResult> = {
  readonly parse: (value: unknown) => TResult
  readonly rejectionMessage?: (result: TResult) => string | null
  readonly isKnownRejectionError?: (error: unknown) => boolean
}

type ProviderInvocationDescriptor = {
  readonly taskId: string
  readonly invocationKey: string
  readonly invocationHash: string
  readonly modality: string
  readonly provider: string
  readonly modelKey: string
}

type ProviderInvocationOutput = ProviderInvocationDescriptor & {
  readonly contractVersion: typeof CONTRACT_VERSION
  readonly taskAttempt?: number
  readonly result?: unknown
  readonly error?: {
    readonly name: string
    readonly message: string
  }
}

type ProviderCheckpoint = {
  readonly id: string
  readonly inputFingerprint: string
  readonly state: string
  readonly output: unknown
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]))
}

function hashJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

function buildStepKey(invocationKey: string): string {
  return `${STEP_PREFIX}${createHash('sha256').update(invocationKey).digest('hex')}`
}

function parseOutput(value: unknown): ProviderInvocationOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PROVIDER_INVOCATION_CHECKPOINT_OUTPUT_INVALID')
  }
  const output = value as Record<string, unknown>
  if (
    output.contractVersion !== CONTRACT_VERSION
    || typeof output.taskId !== 'string'
    || typeof output.invocationKey !== 'string'
    || typeof output.invocationHash !== 'string'
    || typeof output.modality !== 'string'
    || typeof output.provider !== 'string'
    || typeof output.modelKey !== 'string'
  ) throw new Error('PROVIDER_INVOCATION_CHECKPOINT_OUTPUT_INVALID')
  return output as ProviderInvocationOutput
}

function assertDescriptor(output: ProviderInvocationOutput, descriptor: ProviderInvocationDescriptor): void {
  if (
    output.taskId !== descriptor.taskId
    || output.invocationKey !== descriptor.invocationKey
    || output.invocationHash !== descriptor.invocationHash
    || output.modality !== descriptor.modality
    || output.provider !== descriptor.provider
    || output.modelKey !== descriptor.modelKey
  ) throw new Error(`PROVIDER_INVOCATION_CHECKPOINT_CONFLICT:${descriptor.taskId}:${descriptor.invocationKey}`)
}

function parseMediaProviderResult<TResult extends MediaProviderInvocationResult>(value: unknown): TResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('PROVIDER_INVOCATION_RESULT_INVALID')
  }
  const result = value as Record<string, unknown>
  if (typeof result.success !== 'boolean') throw new Error('PROVIDER_INVOCATION_RESULT_INVALID')
  return result as TResult
}

function outcomeUnknown(descriptor: ProviderInvocationDescriptor, cause?: unknown): AppError {
  return new AppError(
    'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
    'Provider submission outcome is unknown; this invocation will not be submitted again',
    {
      provider: descriptor.provider,
      details: {
        taskId: descriptor.taskId,
        invocationKey: descriptor.invocationKey,
        modality: descriptor.modality,
        modelKey: descriptor.modelKey,
      },
      cause,
    },
  )
}

function rejected(
  descriptor: ProviderInvocationDescriptor,
  message: string,
  cause?: unknown,
): AppError {
  return new AppError(
    'PROVIDER_SUBMISSION_REJECTED',
    message || 'Provider rejected the generation request',
    {
      provider: descriptor.provider,
      details: {
        taskId: descriptor.taskId,
        invocationKey: descriptor.invocationKey,
        modality: descriptor.modality,
        modelKey: descriptor.modelKey,
      },
      cause,
    },
  )
}

function retryableSubmissionFailure(
  descriptor: ProviderInvocationDescriptor,
  message: string,
  cause?: unknown,
): AppError {
  return new AppError(
    'PROVIDER_SUBMIT_FAILED',
    message || 'Provider temporarily declined the generation request',
    {
      provider: descriptor.provider,
      details: {
        taskId: descriptor.taskId,
        invocationKey: descriptor.invocationKey,
        modality: descriptor.modality,
        modelKey: descriptor.modelKey,
      },
      cause,
    },
  )
}

function isRetryableSubmissionStatus(status: number): boolean {
  return status === 408
    || status === 425
    || status === 429
    || status === 500
    || status === 502
    || status === 503
    || status === 504
}

function requireTaskAttempt(taskId: string): number {
  const context = getLogContext()
  if (context.taskId !== taskId) {
    throw new Error(`TASK_PROVIDER_INVOCATION_CONTEXT_CONFLICT:${taskId}:${context.taskId || 'missing'}`)
  }
  if (!Number.isInteger(context.taskAttempt) || (context.taskAttempt ?? 0) < 1) {
    throw new Error(`TASK_PROVIDER_INVOCATION_ATTEMPT_REQUIRED:${taskId}`)
  }
  return context.taskAttempt!
}

async function loadCheckpoint(taskId: string, stepKey: string): Promise<ProviderCheckpoint | null> {
  return await prisma.taskExecutionCheckpoint.findUnique({
    where: { taskId_stepKey: { taskId, stepKey } },
    select: { id: true, inputFingerprint: true, state: true, output: true },
  })
}

async function claimCheckpoint(params: {
  readonly descriptor: ProviderInvocationDescriptor
  readonly inputFingerprint: string
  readonly stepKey: string
  readonly taskAttempt: number
}): Promise<{ readonly checkpoint: ProviderCheckpoint; readonly claimed: boolean }> {
  const output: ProviderInvocationOutput = {
    contractVersion: CONTRACT_VERSION,
    ...params.descriptor,
    taskAttempt: params.taskAttempt,
  }
  try {
    const checkpoint = await prisma.taskExecutionCheckpoint.create({
      data: {
        id: randomUUID(),
        taskId: params.descriptor.taskId,
        stepKey: params.stepKey,
        inputFingerprint: params.inputFingerprint,
        state: 'submitting',
        output: toJson(output),
      },
      select: { id: true, inputFingerprint: true, state: true, output: true },
    })
    return { checkpoint, claimed: true }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const existing = await loadCheckpoint(params.descriptor.taskId, params.stepKey)
    if (!existing) throw error
    return { checkpoint: existing, claimed: false }
  }
}

async function reclaimRetryableCheckpoint(params: {
  readonly checkpoint: ProviderCheckpoint
  readonly descriptor: ProviderInvocationDescriptor
  readonly taskAttempt: number
}): Promise<{ readonly checkpoint: ProviderCheckpoint; readonly claimed: boolean }> {
  const output = parseOutput(params.checkpoint.output)
  const previousAttempt = output.taskAttempt
  if (!Number.isInteger(previousAttempt) || (previousAttempt ?? 0) < 1) {
    throw new Error(`PROVIDER_INVOCATION_RETRY_ATTEMPT_INVALID:${params.descriptor.taskId}:${params.descriptor.invocationKey}`)
  }
  if (params.taskAttempt <= previousAttempt!) {
    throw retryableSubmissionFailure(params.descriptor, readStoredError(output))
  }

  const nextOutput: ProviderInvocationOutput = {
    contractVersion: CONTRACT_VERSION,
    ...params.descriptor,
    taskAttempt: params.taskAttempt,
  }
  const updated = await prisma.taskExecutionCheckpoint.updateMany({
    where: { id: params.checkpoint.id, state: 'retryable_rejected' },
    data: {
      state: 'submitting',
      output: toJson(nextOutput),
      completedAt: null,
    },
  })
  const checkpoint = await loadCheckpoint(params.descriptor.taskId, buildStepKey(params.descriptor.invocationKey))
  if (!checkpoint) {
    throw new Error(`PROVIDER_INVOCATION_CHECKPOINT_MISSING:${params.descriptor.taskId}:${params.descriptor.invocationKey}`)
  }
  return { checkpoint, claimed: updated.count === 1 }
}

async function transitionCheckpoint(params: {
  readonly checkpointId: string
  readonly descriptor: ProviderInvocationDescriptor
  readonly state: 'submitted' | 'rejected' | 'retryable_rejected' | 'outcome_unknown'
  readonly taskAttempt: number
  readonly result?: unknown
  readonly error?: unknown
}): Promise<void> {
  const error = params.error instanceof Error
    ? { name: params.error.name || 'Error', message: params.error.message.slice(0, 2_000) }
    : params.error === undefined
      ? undefined
      : { name: typeof params.error, message: String(params.error).slice(0, 2_000) }
  const output: ProviderInvocationOutput = {
    contractVersion: CONTRACT_VERSION,
    ...params.descriptor,
    taskAttempt: params.taskAttempt,
    ...(params.result !== undefined ? { result: params.result } : {}),
    ...(error ? { error } : {}),
  }
  const updated = await prisma.taskExecutionCheckpoint.updateMany({
    where: { id: params.checkpointId, state: 'submitting' },
    data: {
      state: params.state,
      output: toJson(output),
      completedAt: new Date(),
    },
  })
  if (updated.count !== 1) {
    throw new Error(`PROVIDER_INVOCATION_CHECKPOINT_TRANSITION_FAILED:${params.descriptor.taskId}:${params.descriptor.invocationKey}`)
  }
}

function readStoredError(output: ProviderInvocationOutput): string {
  return output.error?.message || 'Provider rejected the generation request'
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function executeTaskDurableInvocation<TResult>(params: {
  readonly taskId: string
  readonly invocation: TaskProviderInvocation
  readonly modality: string
  readonly provider: string
  readonly modelKey: string
  readonly request: unknown
  readonly execute: () => Promise<TResult>
  readonly resultPolicy: TaskDurableInvocationResultPolicy<TResult>
}): Promise<TResult> {
  const invocationKey = params.invocation.key.trim()
  if (!invocationKey) throw new Error('PROVIDER_INVOCATION_KEY_REQUIRED')
  const descriptor: ProviderInvocationDescriptor = {
    taskId: params.taskId,
    invocationKey,
    invocationHash: hashJson({
      modality: params.modality,
      provider: params.provider,
      modelKey: params.modelKey,
      request: params.request,
    }),
    modality: params.modality,
    provider: params.provider,
    modelKey: params.modelKey,
  }
  const inputFingerprint = await loadTaskExecutionFingerprint(params.taskId)
  const stepKey = buildStepKey(invocationKey)
  const taskAttempt = requireTaskAttempt(params.taskId)
  let claim = await claimCheckpoint({ descriptor, inputFingerprint, stepKey, taskAttempt })
  let checkpoint = claim.checkpoint
  let output = parseOutput(checkpoint.output)
  assertDescriptor(output, descriptor)
  if (checkpoint.inputFingerprint !== inputFingerprint) {
    throw new Error(`PROVIDER_INVOCATION_INPUT_FINGERPRINT_CONFLICT:${params.taskId}:${invocationKey}`)
  }

  if (checkpoint.state === 'submitted') return params.resultPolicy.parse(output.result)
  if (checkpoint.state === 'rejected') throw rejected(descriptor, readStoredError(output))
  if (checkpoint.state === 'retryable_rejected') {
    claim = await reclaimRetryableCheckpoint({ checkpoint, descriptor, taskAttempt })
    checkpoint = claim.checkpoint
    output = parseOutput(checkpoint.output)
    assertDescriptor(output, descriptor)
    if (checkpoint.inputFingerprint !== inputFingerprint) {
      throw new Error(`PROVIDER_INVOCATION_INPUT_FINGERPRINT_CONFLICT:${params.taskId}:${invocationKey}`)
    }
    if (checkpoint.state === 'submitted') return params.resultPolicy.parse(output.result)
    if (checkpoint.state === 'rejected') throw rejected(descriptor, readStoredError(output))
    if (checkpoint.state === 'retryable_rejected') {
      throw retryableSubmissionFailure(descriptor, readStoredError(output))
    }
  }
  if (!claim.claimed) throw outcomeUnknown(descriptor)
  if (checkpoint.state !== 'submitting') throw outcomeUnknown(descriptor)

  let result: TResult
  try {
    result = await params.execute()
  } catch (error) {
    if (error instanceof FetchStatusError && isRetryableSubmissionStatus(error.status)) {
      try {
        await transitionCheckpoint({
          checkpointId: checkpoint.id,
          descriptor,
          state: 'retryable_rejected',
          taskAttempt,
          error,
        })
      } catch (transitionError) {
        throw outcomeUnknown(descriptor, transitionError)
      }
      throw retryableSubmissionFailure(descriptor, readErrorMessage(error), error)
    }
    if (
      error instanceof FetchStatusError
      || params.resultPolicy.isKnownRejectionError?.(error) === true
    ) {
      try {
        await transitionCheckpoint({
          checkpointId: checkpoint.id,
          descriptor,
          state: 'rejected',
          taskAttempt,
          error,
        })
      } catch (transitionError) {
        throw outcomeUnknown(descriptor, transitionError)
      }
      throw rejected(descriptor, readErrorMessage(error), error)
    }
    try {
      await transitionCheckpoint({
        checkpointId: checkpoint.id,
        descriptor,
        state: 'outcome_unknown',
        taskAttempt,
        error,
      })
    } catch (transitionError) {
      throw outcomeUnknown(descriptor, transitionError)
    }
    throw outcomeUnknown(descriptor, error)
  }

  const rejectionMessage = params.resultPolicy.rejectionMessage?.(result) ?? null
  if (rejectionMessage) {
    try {
      await transitionCheckpoint({ checkpointId: checkpoint.id, descriptor, state: 'rejected', taskAttempt, result })
    } catch (error) {
      throw outcomeUnknown(descriptor, error)
    }
    throw rejected(descriptor, rejectionMessage)
  }

  try {
    await transitionCheckpoint({ checkpointId: checkpoint.id, descriptor, state: 'submitted', taskAttempt, result })
  } catch (error) {
    throw outcomeUnknown(descriptor, error)
  }
  return result
}

export async function executeTaskProviderInvocation<TResult extends MediaProviderInvocationResult>(params: {
  readonly taskId: string
  readonly invocation: TaskProviderInvocation
  readonly modality: string
  readonly provider: string
  readonly modelKey: string
  readonly request: unknown
  readonly execute: () => Promise<TResult>
}): Promise<TResult> {
  return await executeTaskDurableInvocation({
    ...params,
    resultPolicy: {
      parse: parseMediaProviderResult<TResult>,
      rejectionMessage: (result) => result.success
        ? null
        : result.error || 'Provider rejected the generation request',
    },
  })
}
