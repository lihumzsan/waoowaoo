import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { AppError } from '@/lib/errors/app-error'
import { getLogContext } from '@/lib/logging/context'
import { prisma } from '@/lib/prisma'
import { FetchStatusError } from '@/lib/retry'
import { ProviderPreAcceptRejectedError } from '@/lib/ai-exec/submission-error'
import { loadTaskExecutionFingerprint } from './execution-checkpoint'

const STEP_PREFIX = 'provider:'

export type TaskProviderInvocation = {
  readonly key: string
}

export type TaskProviderInvocationRouteSelection = {
  readonly provider: string
  readonly modelKey: string
  readonly logicalCapabilityId: string | null
}

type MediaProviderInvocationResult = {
  readonly success: boolean
  readonly error?: string
}

type TaskDurableInvocationResultPolicy<TResult> = {
  readonly parse: (value: unknown) => TResult
  readonly rejectionMessage?: (result: TResult) => string | null
  readonly outcomeUnknownMessage?: (result: TResult) => string | null
  readonly isKnownRejectionError?: (error: unknown) => boolean
  readonly isKnownRetryableFailureError?: (error: unknown) => boolean
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
  readonly taskAttempt?: number
  readonly result?: unknown
  readonly error?: {
    readonly name: string
    readonly message: string
  }
}

type MediaProviderRouteDescriptor = {
  readonly provider: string
  readonly modelKey: string
  readonly requestHash: string
}

type MediaProviderRouteAttempt = {
  readonly routeIndex: number
  readonly taskAttempt: number
  readonly provider: string
  readonly modelKey: string
  readonly state:
    | 'submitting'
    | 'pre_accept_rejected'
    | 'submitted'
    | 'retryable_rejected'
    | 'rejected'
    | 'outcome_unknown'
  readonly externalId?: string
  readonly error?: {
    readonly name: string
    readonly message: string
  }
}

type MediaProviderRouteInvocationOutput = ProviderInvocationOutput & {
  readonly protocol: 'media_routes_v1'
  readonly logicalCapabilityId: string
  readonly primaryModelKey: string
  readonly failoverPolicy: 'pre_accept_only'
  readonly routes: readonly MediaProviderRouteDescriptor[]
  readonly routeAttempts: readonly MediaProviderRouteAttempt[]
  readonly nextRouteIndex: number
}

type ProviderCheckpoint = {
  readonly id: string
  readonly stepKey: string
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
    typeof output.taskId !== 'string'
    || typeof output.invocationKey !== 'string'
    || typeof output.invocationHash !== 'string'
    || typeof output.modality !== 'string'
    || typeof output.provider !== 'string'
    || typeof output.modelKey !== 'string'
  ) throw new Error('PROVIDER_INVOCATION_CHECKPOINT_OUTPUT_INVALID')
  return output as ProviderInvocationOutput
}

function parseRouteOutput(value: unknown): MediaProviderRouteInvocationOutput {
  const output = parseOutput(value)
  const record = output as ProviderInvocationOutput & Record<string, unknown>
  if (
    record.protocol !== 'media_routes_v1'
    || typeof record.logicalCapabilityId !== 'string'
    || typeof record.primaryModelKey !== 'string'
    || record.failoverPolicy !== 'pre_accept_only'
    || !Array.isArray(record.routes)
    || !Array.isArray(record.routeAttempts)
    || typeof record.nextRouteIndex !== 'number'
    || !Number.isSafeInteger(record.nextRouteIndex)
    || record.nextRouteIndex < 0
  ) throw new Error('PROVIDER_ROUTE_CHECKPOINT_OUTPUT_INVALID')

  for (const route of record.routes) {
    if (!route || typeof route !== 'object' || Array.isArray(route)) {
      throw new Error('PROVIDER_ROUTE_CHECKPOINT_OUTPUT_INVALID')
    }
    const candidate = route as Record<string, unknown>
    if (
      typeof candidate.provider !== 'string'
      || typeof candidate.modelKey !== 'string'
      || typeof candidate.requestHash !== 'string'
    ) throw new Error('PROVIDER_ROUTE_CHECKPOINT_OUTPUT_INVALID')
  }
  for (const attempt of record.routeAttempts) {
    if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
      throw new Error('PROVIDER_ROUTE_ATTEMPT_OUTPUT_INVALID')
    }
    const candidate = attempt as Record<string, unknown>
    if (
      typeof candidate.routeIndex !== 'number'
      || !Number.isSafeInteger(candidate.routeIndex)
      || candidate.routeIndex < 0
      || typeof candidate.taskAttempt !== 'number'
      || !Number.isSafeInteger(candidate.taskAttempt)
      || candidate.taskAttempt < 1
      || typeof candidate.provider !== 'string'
      || typeof candidate.modelKey !== 'string'
      || ![
        'submitting',
        'pre_accept_rejected',
        'submitted',
        'retryable_rejected',
        'rejected',
        'outcome_unknown',
      ].includes(String(candidate.state))
    ) throw new Error('PROVIDER_ROUTE_ATTEMPT_OUTPUT_INVALID')
  }
  return record as unknown as MediaProviderRouteInvocationOutput
}

function isRouteOutput(value: ProviderInvocationOutput): value is MediaProviderRouteInvocationOutput {
  return (value as ProviderInvocationOutput & { protocol?: unknown }).protocol === 'media_routes_v1'
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

function assertRouteDescriptor(
  output: MediaProviderRouteInvocationOutput,
  input: {
    readonly descriptor: ProviderInvocationDescriptor
    readonly logicalCapabilityId: string
    readonly primaryModelKey: string
    readonly routes: readonly MediaProviderRouteDescriptor[]
  },
): void {
  assertDescriptor(output, input.descriptor)
  if (
    output.logicalCapabilityId !== input.logicalCapabilityId
    || output.primaryModelKey !== input.primaryModelKey
    || hashJson(output.routes) !== hashJson(input.routes)
  ) {
    throw new Error(`PROVIDER_ROUTE_CHECKPOINT_CONFLICT:${input.descriptor.taskId}:${input.descriptor.invocationKey}`)
  }
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

function readExplicitHttpStatus(error: unknown): number | null {
  if (error instanceof FetchStatusError) return error.status
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null
  const record = error as {
    readonly status?: unknown
    readonly statusCode?: unknown
    readonly code?: unknown
  }
  for (const candidate of [record.status, record.statusCode, record.code]) {
    const status = typeof candidate === 'number'
      ? candidate
      : typeof candidate === 'string' && /^\d{3}$/.test(candidate.trim())
        ? Number.parseInt(candidate.trim(), 10)
        : NaN
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status
  }
  return null
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
    select: { id: true, stepKey: true, inputFingerprint: true, state: true, output: true },
  })
}

/**
 * Returns the provider route durably accepted for one logical Task invocation.
 * Consumers never inspect checkpoint JSON and receive no route while submission
 * is unaccepted, ambiguous, retryable, or rejected.
 */
export async function readTaskProviderInvocationRouteSelection(params: {
  readonly taskId: string
  readonly invocation: TaskProviderInvocation
}): Promise<TaskProviderInvocationRouteSelection | null> {
  const invocationKey = params.invocation.key.trim()
  if (!invocationKey) throw new Error('PROVIDER_INVOCATION_KEY_REQUIRED')
  const checkpoint = await loadCheckpoint(params.taskId, buildStepKey(invocationKey))
  if (!checkpoint || checkpoint.state !== 'submitted') return null
  const output = parseOutput(checkpoint.output)
  if (output.taskId !== params.taskId || output.invocationKey !== invocationKey) {
    throw new Error(`PROVIDER_INVOCATION_CHECKPOINT_CONFLICT:${params.taskId}:${invocationKey}`)
  }
  if (!isRouteOutput(output)) {
    return {
      provider: output.provider,
      modelKey: output.modelKey,
      logicalCapabilityId: null,
    }
  }

  const routeOutput = parseRouteOutput(checkpoint.output)
  const accepted = routeOutput.routeAttempts[routeOutput.routeAttempts.length - 1]
  if (!accepted || accepted.state !== 'submitted') {
    throw new Error(`PROVIDER_ROUTE_ACCEPTED_ATTEMPT_MISSING:${params.taskId}:${invocationKey}`)
  }
  const declared = routeOutput.routes[accepted.routeIndex]
  if (
    !declared
    || declared.provider !== accepted.provider
    || declared.modelKey !== accepted.modelKey
  ) {
    throw new Error(`PROVIDER_ROUTE_ACCEPTED_ATTEMPT_CONFLICT:${params.taskId}:${invocationKey}`)
  }
  return {
    provider: accepted.provider,
    modelKey: accepted.modelKey,
    logicalCapabilityId: routeOutput.logicalCapabilityId,
  }
}

async function claimCheckpoint(params: {
  readonly descriptor: ProviderInvocationDescriptor
  readonly inputFingerprint: string
  readonly stepKey: string
  readonly taskAttempt: number
}): Promise<{ readonly checkpoint: ProviderCheckpoint; readonly claimed: boolean }> {
  const output: ProviderInvocationOutput = {
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
      select: { id: true, stepKey: true, inputFingerprint: true, state: true, output: true },
    })
    return { checkpoint, claimed: true }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
    const existing = await loadCheckpoint(params.descriptor.taskId, params.stepKey)
    if (!existing) throw error
    return { checkpoint: existing, claimed: false }
  }
}

async function claimRouteCheckpoint(params: {
  readonly descriptor: ProviderInvocationDescriptor
  readonly inputFingerprint: string
  readonly stepKey: string
  readonly taskAttempt: number
  readonly logicalCapabilityId: string
  readonly primaryModelKey: string
  readonly routes: readonly MediaProviderRouteDescriptor[]
}): Promise<{ readonly checkpoint: ProviderCheckpoint; readonly claimed: boolean }> {
  const output: MediaProviderRouteInvocationOutput = {
    ...params.descriptor,
    protocol: 'media_routes_v1',
    taskAttempt: params.taskAttempt,
    logicalCapabilityId: params.logicalCapabilityId,
    primaryModelKey: params.primaryModelKey,
    failoverPolicy: 'pre_accept_only',
    routes: params.routes,
    routeAttempts: [],
    nextRouteIndex: 0,
  }
  try {
    const checkpoint = await prisma.taskExecutionCheckpoint.create({
      data: {
        id: randomUUID(),
        taskId: params.descriptor.taskId,
        stepKey: params.stepKey,
        inputFingerprint: params.inputFingerprint,
        state: 'route_ready',
        output: toJson(output),
      },
      select: { id: true, stepKey: true, inputFingerprint: true, state: true, output: true },
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

async function transitionRouteCheckpoint(params: {
  readonly checkpointId: string
  readonly expectedState: string
  readonly state: 'route_ready' | 'submitting' | 'submitted' | 'rejected' | 'retryable_rejected' | 'outcome_unknown'
  readonly output: MediaProviderRouteInvocationOutput
}): Promise<boolean> {
  const updated = await prisma.taskExecutionCheckpoint.updateMany({
    where: { id: params.checkpointId, state: params.expectedState },
    data: {
      state: params.state,
      output: toJson(params.output),
      completedAt: ['submitted', 'rejected', 'retryable_rejected', 'outcome_unknown'].includes(params.state)
        ? new Date()
        : null,
    },
  })
  return updated.count === 1
}

function replaceLastRouteAttempt(
  output: MediaProviderRouteInvocationOutput,
  next: MediaProviderRouteAttempt,
): readonly MediaProviderRouteAttempt[] {
  const attempts = [...output.routeAttempts]
  const current = attempts[attempts.length - 1]
  if (
    !current
    || current.state !== 'submitting'
    || current.routeIndex !== next.routeIndex
    || current.taskAttempt !== next.taskAttempt
    || current.provider !== next.provider
    || current.modelKey !== next.modelKey
  ) throw new Error(`PROVIDER_ROUTE_ATTEMPT_CONFLICT:${output.taskId}:${output.invocationKey}`)
  attempts[attempts.length - 1] = next
  return attempts
}

async function claimNextProviderRoute(params: {
  readonly checkpoint: ProviderCheckpoint
  readonly output: MediaProviderRouteInvocationOutput
  readonly taskAttempt: number
}): Promise<MediaProviderRouteInvocationOutput | null> {
  const storedAttempt = params.output.taskAttempt
  if (Number.isInteger(storedAttempt) && params.taskAttempt < storedAttempt!) {
    throw new Error(`PROVIDER_INVOCATION_RETRY_ATTEMPT_STALE:${params.output.taskId}:${params.output.invocationKey}`)
  }
  const route = params.output.routes[params.output.nextRouteIndex]
  if (!route) throw new Error(`PROVIDER_ROUTE_EXHAUSTED:${params.output.logicalCapabilityId}`)
  const nextOutput: MediaProviderRouteInvocationOutput = {
    ...params.output,
    taskAttempt: params.taskAttempt,
    routeAttempts: [
      ...params.output.routeAttempts,
      {
        routeIndex: params.output.nextRouteIndex,
        taskAttempt: params.taskAttempt,
        provider: route.provider,
        modelKey: route.modelKey,
        state: 'submitting',
      },
    ],
  }
  const claimed = await transitionRouteCheckpoint({
    checkpointId: params.checkpoint.id,
    expectedState: 'route_ready',
    state: 'submitting',
    output: nextOutput,
  })
  return claimed ? nextOutput : null
}

function readStoredError(output: ProviderInvocationOutput): string {
  return output.error?.message || 'Provider rejected the generation request'
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function toStoredError(error: unknown): NonNullable<ProviderInvocationOutput['error']> {
  return error instanceof Error
    ? { name: error.name || 'Error', message: error.message.slice(0, 2_000) }
    : { name: typeof error, message: String(error).slice(0, 2_000) }
}

async function markCheckpointRetryable(params: {
  readonly checkpoint: ProviderCheckpoint
  readonly taskAttempt: number
  readonly error: unknown
}): Promise<void> {
  const output = parseOutput(params.checkpoint.output)
  const storedAttempt = output.taskAttempt
  if (!Number.isInteger(storedAttempt) || (storedAttempt ?? 0) < 1) {
    throw new Error(`PROVIDER_INVOCATION_RETRY_ATTEMPT_INVALID:${output.taskId}:${output.invocationKey}`)
  }
  if (params.taskAttempt < storedAttempt!) {
    throw new Error(`PROVIDER_INVOCATION_RETRY_ATTEMPT_STALE:${output.taskId}:${output.invocationKey}`)
  }
  if (params.checkpoint.state === 'retryable_rejected' && storedAttempt === params.taskAttempt) return
  if (params.checkpoint.state !== 'submitted') {
    throw new Error(`PROVIDER_INVOCATION_RETRY_STATE_INVALID:${output.taskId}:${output.invocationKey}:${params.checkpoint.state}`)
  }

  if (isRouteOutput(output)) {
    const attempts = [...output.routeAttempts]
    const last = attempts[attempts.length - 1]
    if (!last || last.state !== 'submitted') {
      throw new Error(`PROVIDER_ROUTE_RETRY_ATTEMPT_INVALID:${output.taskId}:${output.invocationKey}`)
    }
    attempts[attempts.length - 1] = {
      ...last,
      state: 'retryable_rejected',
      error: toStoredError(params.error),
    }
    const nextOutput: MediaProviderRouteInvocationOutput = {
      ...output,
      taskAttempt: params.taskAttempt,
      routeAttempts: attempts,
      nextRouteIndex: last.routeIndex,
      error: toStoredError(params.error),
      result: undefined,
    }
    const updated = await prisma.taskExecutionCheckpoint.updateMany({
      where: { id: params.checkpoint.id, state: 'submitted' },
      data: {
        state: 'retryable_rejected',
        output: toJson(nextOutput),
        completedAt: new Date(),
      },
    })
    if (updated.count === 1) return

    const current = await loadCheckpoint(output.taskId, params.checkpoint.stepKey)
    if (!current) {
      throw new Error(`PROVIDER_INVOCATION_CHECKPOINT_MISSING:${output.taskId}:${output.invocationKey}`)
    }
    const currentOutput = parseRouteOutput(current.output)
    if (current.state === 'retryable_rejected' && currentOutput.taskAttempt === params.taskAttempt) return
    throw new Error(`PROVIDER_INVOCATION_RETRY_TRANSITION_FAILED:${output.taskId}:${output.invocationKey}`)
  }

  const nextOutput: ProviderInvocationOutput = {
    ...output,
    taskAttempt: params.taskAttempt,
    error: toStoredError(params.error),
  }
  const updated = await prisma.taskExecutionCheckpoint.updateMany({
    where: {
      id: params.checkpoint.id,
      state: 'submitted',
    },
    data: {
      state: 'retryable_rejected',
      output: toJson(nextOutput),
      completedAt: new Date(),
    },
  })
  if (updated.count === 1) return

  const current = await loadCheckpoint(output.taskId, params.checkpoint.stepKey)
  if (!current) {
    throw new Error(`PROVIDER_INVOCATION_CHECKPOINT_MISSING:${output.taskId}:${output.invocationKey}`)
  }
  const currentOutput = parseOutput(current.output)
  if (current.state === 'retryable_rejected' && currentOutput.taskAttempt === params.taskAttempt) return
  throw new Error(`PROVIDER_INVOCATION_RETRY_TRANSITION_FAILED:${output.taskId}:${output.invocationKey}`)
}

export async function markTaskProviderInvocationRetryable(params: {
  readonly taskId: string
  readonly invocation: TaskProviderInvocation
  readonly error: unknown
}): Promise<void> {
  const invocationKey = params.invocation.key.trim()
  if (!invocationKey) throw new Error('PROVIDER_INVOCATION_KEY_REQUIRED')
  const taskAttempt = requireTaskAttempt(params.taskId)
  const checkpoint = await loadCheckpoint(params.taskId, buildStepKey(invocationKey))
  if (!checkpoint) {
    throw new Error(`PROVIDER_INVOCATION_CHECKPOINT_MISSING:${params.taskId}:${invocationKey}`)
  }
  const output = parseOutput(checkpoint.output)
  if (output.taskId !== params.taskId || output.invocationKey !== invocationKey) {
    throw new Error(`PROVIDER_INVOCATION_CHECKPOINT_CONFLICT:${params.taskId}:${invocationKey}`)
  }
  await markCheckpointRetryable({ checkpoint, taskAttempt, error: params.error })
}

function readExternalId(result: unknown): string | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null
  const externalId = (result as Record<string, unknown>).externalId
  return typeof externalId === 'string' && externalId.trim() ? externalId.trim() : null
}

export async function markTaskProviderInvocationRetryableByExternalId(params: {
  readonly taskId: string
  readonly externalId: string
  readonly error: unknown
}): Promise<void> {
  const externalId = params.externalId.trim()
  if (!externalId) throw new Error('PROVIDER_EXTERNAL_ID_REQUIRED')
  const taskAttempt = requireTaskAttempt(params.taskId)
  const candidates = await prisma.taskExecutionCheckpoint.findMany({
    where: {
      taskId: params.taskId,
      state: { in: ['submitted', 'retryable_rejected'] },
      stepKey: { startsWith: STEP_PREFIX },
    },
    select: { id: true, stepKey: true, inputFingerprint: true, state: true, output: true },
  })
  const matches = candidates.filter((checkpoint) => {
    const output = parseOutput(checkpoint.output)
    return readExternalId(output.result) === externalId
  })
  if (matches.length !== 1) {
    throw new Error(`PROVIDER_EXTERNAL_ID_CHECKPOINT_${matches.length === 0 ? 'MISSING' : 'CONFLICT'}:${params.taskId}:${externalId}`)
  }
  await markCheckpointRetryable({ checkpoint: matches[0]!, taskAttempt, error: params.error })
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
    const explicitHttpStatus = readExplicitHttpStatus(error)
    if (
      (explicitHttpStatus !== null && isRetryableSubmissionStatus(explicitHttpStatus))
      || params.resultPolicy.isKnownRetryableFailureError?.(error) === true
    ) {
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
      explicitHttpStatus !== null
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

  const unknownOutcomeMessage = params.resultPolicy.outcomeUnknownMessage?.(result) ?? null
  if (unknownOutcomeMessage) {
    const error = new Error(unknownOutcomeMessage)
    try {
      await transitionCheckpoint({ checkpointId: checkpoint.id, descriptor, state: 'outcome_unknown', taskAttempt, result })
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

export type TaskProviderInvocationRoute<TResult> = {
  readonly provider: string
  readonly modelKey: string
  readonly request: unknown
  readonly execute: () => Promise<TResult>
}

function withProviderRouteMetadata<TResult extends MediaProviderInvocationResult>(params: {
  readonly result: TResult
  readonly logicalCapabilityId: string
  readonly routeIndex: number
  readonly provider: string
  readonly modelKey: string
}): TResult {
  const record = params.result as TResult & { metadata?: unknown }
  const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
    ? record.metadata as Record<string, unknown>
    : {}
  return {
    ...params.result,
    metadata: {
      ...metadata,
      providerRoute: {
        logicalCapabilityId: params.logicalCapabilityId,
        routeIndex: params.routeIndex,
        provider: params.provider,
        modelKey: params.modelKey,
      },
    },
  } as TResult
}

export async function executeTaskProviderInvocation<TResult extends MediaProviderInvocationResult>(params: {
  readonly taskId: string
  readonly invocation: TaskProviderInvocation
  readonly modality: string
  readonly logicalCapabilityId: string
  readonly primaryModelKey: string
  readonly routes: readonly TaskProviderInvocationRoute<TResult>[]
}): Promise<TResult> {
  const invocationKey = params.invocation.key.trim()
  if (!invocationKey) throw new Error('PROVIDER_INVOCATION_KEY_REQUIRED')
  if (!params.logicalCapabilityId.trim()) throw new Error('PROVIDER_LOGICAL_CAPABILITY_ID_REQUIRED')
  if (params.routes.length === 0) throw new Error('PROVIDER_ROUTE_REQUIRED')
  if (params.routes[0]?.modelKey !== params.primaryModelKey) {
    throw new Error(`PROVIDER_ROUTE_PRIMARY_CONFLICT:${params.logicalCapabilityId}:${params.primaryModelKey}`)
  }
  const onlyRoute = params.routes.length === 1 ? params.routes[0] : undefined
  if (onlyRoute) {
    return await executeTaskDurableInvocation({
      taskId: params.taskId,
      invocation: params.invocation,
      modality: params.modality,
      provider: onlyRoute.provider,
      modelKey: onlyRoute.modelKey,
      request: onlyRoute.request,
      execute: onlyRoute.execute,
      resultPolicy: {
        parse: parseMediaProviderResult<TResult>,
        outcomeUnknownMessage: (result) => result.success
          ? null
          : result.error || 'Provider returned success:false without a typed acceptance outcome',
        isKnownRejectionError: (error) => error instanceof AppError && !error.retryable,
      },
    })
  }
  const routeIdentities = new Set<string>()
  const routes: MediaProviderRouteDescriptor[] = params.routes.map((route) => {
    const provider = route.provider.trim()
    const modelKey = route.modelKey.trim()
    if (!provider || !modelKey) throw new Error('PROVIDER_ROUTE_IDENTITY_REQUIRED')
    const identity = `${provider}\u0000${modelKey}`
    if (routeIdentities.has(identity)) {
      throw new Error(`PROVIDER_ROUTE_DUPLICATE:${params.logicalCapabilityId}:${modelKey}`)
    }
    routeIdentities.add(identity)
    return { provider, modelKey, requestHash: hashJson(route.request) }
  })
  const descriptor: ProviderInvocationDescriptor = {
    taskId: params.taskId,
    invocationKey,
    invocationHash: hashJson({
      modality: params.modality,
      logicalCapabilityId: params.logicalCapabilityId,
      primaryModelKey: params.primaryModelKey,
      routes,
    }),
    modality: params.modality,
    provider: `logical:${params.logicalCapabilityId}`,
    modelKey: params.primaryModelKey,
  }
  const inputFingerprint = await loadTaskExecutionFingerprint(params.taskId)
  const stepKey = buildStepKey(invocationKey)
  const taskAttempt = requireTaskAttempt(params.taskId)
  const claim = await claimRouteCheckpoint({
    descriptor,
    inputFingerprint,
    stepKey,
    taskAttempt,
    logicalCapabilityId: params.logicalCapabilityId,
    primaryModelKey: params.primaryModelKey,
    routes,
  })
  let checkpoint = claim.checkpoint
  let output = parseRouteOutput(checkpoint.output)
  assertRouteDescriptor(output, {
    descriptor,
    logicalCapabilityId: params.logicalCapabilityId,
    primaryModelKey: params.primaryModelKey,
    routes,
  })
  if (checkpoint.inputFingerprint !== inputFingerprint) {
    throw new Error(`PROVIDER_INVOCATION_INPUT_FINGERPRINT_CONFLICT:${params.taskId}:${invocationKey}`)
  }

  if (checkpoint.state === 'submitted') return parseMediaProviderResult<TResult>(output.result)
  if (checkpoint.state === 'rejected') throw rejected(descriptor, readStoredError(output))
  if (checkpoint.state === 'outcome_unknown') throw outcomeUnknown(descriptor)
  if (checkpoint.state === 'retryable_rejected') {
    const previousAttempt = output.taskAttempt
    if (!Number.isInteger(previousAttempt) || taskAttempt <= previousAttempt!) {
      throw retryableSubmissionFailure(descriptor, readStoredError(output))
    }
    const routeReadyOutput: MediaProviderRouteInvocationOutput = {
      ...output,
      taskAttempt,
      result: undefined,
      error: undefined,
    }
    const reclaimed = await transitionRouteCheckpoint({
      checkpointId: checkpoint.id,
      expectedState: 'retryable_rejected',
      state: 'route_ready',
      output: routeReadyOutput,
    })
    if (!reclaimed) throw outcomeUnknown(descriptor)
    checkpoint = { ...checkpoint, state: 'route_ready', output: routeReadyOutput }
    output = routeReadyOutput
  }
  if (checkpoint.state === 'submitting') throw outcomeUnknown(descriptor)
  if (checkpoint.state !== 'route_ready') throw outcomeUnknown(descriptor)

  while (output.nextRouteIndex < params.routes.length) {
    const routeIndex = output.nextRouteIndex
    const route = params.routes[routeIndex]
    const routeDescriptor = routes[routeIndex]
    if (!route || !routeDescriptor) throw new Error(`PROVIDER_ROUTE_MISSING:${params.logicalCapabilityId}:${routeIndex}`)
    const claimedOutput = await claimNextProviderRoute({ checkpoint, output, taskAttempt })
    if (!claimedOutput) throw outcomeUnknown(descriptor)
    output = claimedOutput
    checkpoint = { ...checkpoint, state: 'submitting', output }

    let result: TResult
    try {
      result = await route.execute()
    } catch (error) {
      if (error instanceof ProviderPreAcceptRejectedError) {
        if (error.externalId !== null) throw outcomeUnknown(descriptor, error)
        const nextRouteIndex = routeIndex + 1
        const nextState = nextRouteIndex < params.routes.length ? 'route_ready' : 'rejected'
        const nextOutput: MediaProviderRouteInvocationOutput = {
          ...output,
          routeAttempts: replaceLastRouteAttempt(output, {
            routeIndex,
            taskAttempt,
            provider: routeDescriptor.provider,
            modelKey: routeDescriptor.modelKey,
            state: 'pre_accept_rejected',
            error: toStoredError(error),
          }),
          nextRouteIndex,
          error: toStoredError(error),
        }
        const transitioned = await transitionRouteCheckpoint({
          checkpointId: checkpoint.id,
          expectedState: 'submitting',
          state: nextState,
          output: nextOutput,
        })
        if (!transitioned) throw outcomeUnknown(descriptor)
        if (nextState === 'rejected') throw rejected(descriptor, error.message, error)
        checkpoint = { ...checkpoint, state: 'route_ready', output: nextOutput }
        output = nextOutput
        continue
      }

      const explicitHttpStatus = readExplicitHttpStatus(error)
      const retryableFailure = explicitHttpStatus !== null && isRetryableSubmissionStatus(explicitHttpStatus)
      const permanentRejection = explicitHttpStatus !== null || (error instanceof AppError && !error.retryable)
      const nextOutput: MediaProviderRouteInvocationOutput = {
        ...output,
        routeAttempts: replaceLastRouteAttempt(output, {
          routeIndex,
          taskAttempt,
          provider: routeDescriptor.provider,
          modelKey: routeDescriptor.modelKey,
          state: retryableFailure
            ? 'retryable_rejected'
            : permanentRejection
              ? 'rejected'
              : 'outcome_unknown',
          error: toStoredError(error),
        }),
        nextRouteIndex: routeIndex,
        error: toStoredError(error),
      }
      const nextState = retryableFailure
        ? 'retryable_rejected'
        : permanentRejection
          ? 'rejected'
          : 'outcome_unknown'
      const transitioned = await transitionRouteCheckpoint({
        checkpointId: checkpoint.id,
        expectedState: 'submitting',
        state: nextState,
        output: nextOutput,
      })
      if (!transitioned) throw outcomeUnknown(descriptor)
      if (retryableFailure) throw retryableSubmissionFailure(descriptor, readErrorMessage(error), error)
      if (permanentRejection) throw rejected(descriptor, readErrorMessage(error), error)
      throw outcomeUnknown(descriptor, error)
    }

    if (!result.success) {
      const nextOutput: MediaProviderRouteInvocationOutput = {
        ...output,
        routeAttempts: replaceLastRouteAttempt(output, {
          routeIndex,
          taskAttempt,
          provider: routeDescriptor.provider,
          modelKey: routeDescriptor.modelKey,
          state: 'outcome_unknown',
          error: {
            name: 'ProviderResultRejected',
            message: result.error || 'Provider returned success:false without a typed acceptance outcome',
          },
        }),
        error: {
          name: 'ProviderResultRejected',
          message: result.error || 'Provider returned success:false without a typed acceptance outcome',
        },
      }
      const transitioned = await transitionRouteCheckpoint({
        checkpointId: checkpoint.id,
        expectedState: 'submitting',
        state: 'outcome_unknown',
        output: nextOutput,
      })
      if (!transitioned) throw outcomeUnknown(descriptor)
      throw outcomeUnknown(descriptor, new Error(nextOutput.error?.message))
    }

    const routedResult = withProviderRouteMetadata({
      result,
      logicalCapabilityId: params.logicalCapabilityId,
      routeIndex,
      provider: routeDescriptor.provider,
      modelKey: routeDescriptor.modelKey,
    })
    const externalId = readExternalId(routedResult)
    const nextOutput: MediaProviderRouteInvocationOutput = {
      ...output,
      routeAttempts: replaceLastRouteAttempt(output, {
        routeIndex,
        taskAttempt,
        provider: routeDescriptor.provider,
        modelKey: routeDescriptor.modelKey,
        state: 'submitted',
        ...(externalId ? { externalId } : {}),
      }),
      result: routedResult,
      error: undefined,
    }
    const transitioned = await transitionRouteCheckpoint({
      checkpointId: checkpoint.id,
      expectedState: 'submitting',
      state: 'submitted',
      output: nextOutput,
    })
    if (!transitioned) throw outcomeUnknown(descriptor)
    return routedResult
  }

  throw rejected(descriptor, readStoredError(output))
}
