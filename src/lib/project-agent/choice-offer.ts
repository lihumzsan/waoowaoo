import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { parseProjectAgentChoiceDecision as parseChoiceDecision } from './choice-result'
import type { ProjectAgentChoiceDecision } from './choice-result'

const choiceCardOptionSchema = z.object({
  value: z.string().trim().min(1).max(160)
    .describe('Stable value returned for this exact option; use an exact domain identity when one exists.'),
  label: z.string().trim().min(1).max(300)
    .describe('User-visible option label in the current conversation language.'),
  description: z.string().trim().max(1200).nullable().optional(),
  imageUrl: z.string().trim().max(4096).nullable().optional(),
  meta: z.string().trim().max(500).nullable().optional(),
}).strict()

const choiceCardGroupFields = {
  key: z.string().trim().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  label: z.string().trim().min(1).max(300),
  required: z.boolean(),
  presentation: z.enum(['options', 'aspect_ratio', 'image'])
    .describe('Choose the renderer that best represents this group; image requires imageUrl on every option.'),
  options: z.array(choiceCardOptionSchema).min(1).max(12),
} as const

function buildChoiceCardGroupSchema(allowCustomText: z.ZodType<boolean | undefined>) {
  return z.object({
    ...choiceCardGroupFields,
    allowCustomText,
  }).strict().superRefine((group, context) => {
    const values = new Set<string>()
    for (const option of group.options) {
      if (values.has(option.value)) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: `duplicate option value: ${option.value}`,
        })
      }
      values.add(option.value)
      if (group.presentation === 'image' && !option.imageUrl) {
        context.addIssue({
          code: 'custom',
          path: ['options'],
          message: `image presentation requires imageUrl: ${option.value}`,
        })
      }
    }
  })
}

const choiceCardGroupSchema = buildChoiceCardGroupSchema(
  z.boolean().optional()
    .describe('Enable only with replyMode=per_group when the user may replace an offered option with text.'),
)

const choiceCardGroupWithoutCustomTextSchema = buildChoiceCardGroupSchema(
  z.literal(false).optional()
    .describe('Must be false because this reply mode does not collect text per group.'),
)

const choiceCardContentFields = {
  mode: z.enum(['confirm', 'confirm_or_text', 'select', 'select_or_text'])
    .describe('The exact interaction needed for this current decision; it never implies a later workflow.'),
  replyMode: z.enum(['none', 'whole_card', 'per_group'])
    .describe('How optional user-authored text is collected.'),
  title: z.string().trim().min(1).max(500)
    .describe('Model-authored title in the current conversation language.'),
  description: z.string().trim().max(4000).nullable().optional()
    .describe('Model-authored explanation scoped only to the current decision.'),
  groups: z.array(choiceCardGroupSchema).max(12),
  submitLabel: z.string().trim().min(1).max(200)
    .describe('Label only the current decision; never promise or name a downstream action.'),
  replyLabel: z.string().trim().min(1).max(300).nullable().optional(),
  replyPlaceholder: z.string().trim().min(1).max(1000).nullable().optional(),
  replySubmitLabel: z.string().trim().min(1).max(200).nullable().optional()
    .describe('Label only submission of the current free-text answer.'),
} as const

const choiceCardAuthoringBaseFields = {
  mode: choiceCardContentFields.mode,
  title: choiceCardContentFields.title,
  description: choiceCardContentFields.description,
  submitLabel: choiceCardContentFields.submitLabel,
} as const

const enabledReplyAuthoringFields = {
  replyLabel: z.string().trim().min(1).max(300)
    .describe('Required user-visible label whenever replyMode is whole_card or per_group.'),
  replyPlaceholder: z.string().trim().min(1).max(1000)
    .describe('Required user-visible placeholder whenever replyMode is whole_card or per_group.'),
  replySubmitLabel: z.string().trim().min(1).max(200)
    .describe('Required submission label whenever replyMode is whole_card or per_group.'),
} as const

const choiceCardDefinitionFields = {
  cardId: z.string().trim().min(1).max(191),
  toolCallId: z.string().trim().min(1).max(191),
  ...choiceCardContentFields,
} as const

function validateChoiceCard(
  card: {
    mode: 'confirm' | 'confirm_or_text' | 'select' | 'select_or_text'
    replyMode: 'none' | 'whole_card' | 'per_group'
    groups: Array<{ key: string; allowCustomText?: boolean }>
    replyLabel?: string | null
    replyPlaceholder?: string | null
    replySubmitLabel?: string | null
  },
  context: z.RefinementCtx,
): void {
  const groupKeys = new Set<string>()
  for (const group of card.groups) {
    if (groupKeys.has(group.key)) {
      context.addIssue({ code: 'custom', path: ['groups'], message: `duplicate group key: ${group.key}` })
    }
    groupKeys.add(group.key)
  }
  const isConfirmation = card.mode === 'confirm' || card.mode === 'confirm_or_text'
  const acceptsWholeCardText = card.mode === 'confirm_or_text' || card.mode === 'select_or_text'
  if (isConfirmation && card.groups.length > 0) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'confirmation cards cannot declare option groups' })
  }
  if (!isConfirmation && card.groups.length === 0) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'selection cards require at least one group' })
  }
  if (acceptsWholeCardText && card.replyMode === 'none') {
    context.addIssue({ code: 'custom', path: ['replyMode'], message: `${card.mode} requires a reply mode` })
  }
  if (card.mode === 'confirm' && card.replyMode !== 'none') {
    context.addIssue({ code: 'custom', path: ['replyMode'], message: 'confirm cards cannot accept text' })
  }
  if (isConfirmation && card.replyMode === 'per_group') {
    context.addIssue({ code: 'custom', path: ['replyMode'], message: 'confirmation cards require whole-card replies' })
  }
  const customTextGroups = card.groups.filter((group) => group.allowCustomText === true)
  if (customTextGroups.length > 0 && card.replyMode !== 'per_group') {
    context.addIssue({
      code: 'custom',
      path: ['groups'],
      message: 'custom group text requires per_group reply mode',
    })
  }
  if (card.replyMode === 'per_group' && customTextGroups.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['replyMode'],
      message: 'per_group reply mode requires at least one custom-text group',
    })
  }
  const hasReplyCopy = Boolean(card.replyLabel || card.replyPlaceholder || card.replySubmitLabel)
  if (card.replyMode === 'none' && hasReplyCopy) {
    context.addIssue({ code: 'custom', path: ['replyMode'], message: 'reply copy requires an enabled reply mode' })
  }
  if (card.replyMode !== 'none' && (!card.replyLabel || !card.replyPlaceholder || !card.replySubmitLabel)) {
    context.addIssue({ code: 'custom', path: ['replyMode'], message: 'enabled replies require all reply labels' })
  }
}

export const projectAgentChoiceCardDefinitionSchema = z.object(choiceCardDefinitionFields)
  .strict()
  .superRefine(validateChoiceCard)

export const projectAgentChoiceCardAuthoringSchema = z.discriminatedUnion('replyMode', [
  z.object({
    ...choiceCardAuthoringBaseFields,
    groups: z.array(choiceCardGroupWithoutCustomTextSchema).max(12),
    replyMode: z.literal('none')
      .describe('Use only when this card accepts no free-text answer.'),
    replyLabel: z.null().describe('Must be null when replyMode is none.'),
    replyPlaceholder: z.null().describe('Must be null when replyMode is none.'),
    replySubmitLabel: z.null().describe('Must be null when replyMode is none.'),
  }).strict(),
  z.object({
    ...choiceCardAuthoringBaseFields,
    groups: z.array(choiceCardGroupWithoutCustomTextSchema).max(12),
    replyMode: z.literal('whole_card')
      .describe('Collect one free-text answer for the whole card.'),
    ...enabledReplyAuthoringFields,
  }).strict(),
  z.object({
    ...choiceCardAuthoringBaseFields,
    groups: z.array(choiceCardGroupSchema).max(12),
    replyMode: z.literal('per_group')
      .describe('Collect free text only for groups with allowCustomText=true; at least one group must enable it.'),
    ...enabledReplyAuthoringFields,
  }).strict(),
])
  .superRefine(validateChoiceCard)

export const projectAgentChoiceCardSchema = z.object({
  ...choiceCardDefinitionFields,
  runId: z.string().trim().min(1).max(191),
  interruptionId: z.string().trim().min(1).max(191),
}).strict().superRefine(validateChoiceCard)

export type ProjectAgentChoiceCardDefinition = z.infer<typeof projectAgentChoiceCardDefinitionSchema>
export type ProjectAgentChoiceCardPartData = z.infer<typeof projectAgentChoiceCardSchema>
export type ProjectAgentChoiceCardAuthoring = z.infer<typeof projectAgentChoiceCardAuthoringSchema>

const resourceRevisionRequestSchema = z.object({
  revisionId: z.string().trim().min(1),
}).strict()

export const projectAgentChoiceSubjectRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict()
    .describe('No mutable domain fact is being reviewed.'),
  z.object({
    kind: z.literal('task_result'),
    taskId: z.string().trim().min(1)
      .describe('Exact completed Task whose current persisted result is being reviewed.'),
  }).strict().describe('Bind the Choice to one exact completed Task result.'),
  z.object({
    kind: z.literal('resource_revisions'),
    revisions: z.array(resourceRevisionRequestSchema).min(1).max(24),
  }).strict().describe('Bind the Choice to exact immutable Resource revisions.'),
])

export type ProjectAgentChoiceSubjectRequest = z.infer<typeof projectAgentChoiceSubjectRequestSchema>

const fingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/)

const projectAgentChoiceSubjectSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('none'),
    fingerprint: fingerprintSchema,
  }).strict(),
  z.object({
    kind: z.literal('task_result'),
    taskId: z.string().trim().min(1),
    fingerprint: fingerprintSchema,
  }).strict(),
  z.object({
    kind: z.literal('resource_revisions'),
    revisions: z.array(z.object({
      revisionId: z.string().trim().min(1),
    }).strict()).min(1).max(24),
    fingerprint: fingerprintSchema,
  }).strict(),
])

export type ProjectAgentChoiceSubject = z.infer<typeof projectAgentChoiceSubjectSchema>

const commitmentWhenSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('confirm') }).strict(),
  z.object({
    kind: z.literal('option'),
    groupKey: z.string().trim().min(1),
    optionValue: z.string().trim().min(1),
  }).strict(),
])

export const projectAgentChoiceCommitmentRequestSchema = z.object({
  when: commitmentWhenSchema,
  operationId: z.string().trim().min(1).max(128)
    .describe('Exact Choice-eligible operation to invoke for this one answer.'),
  inputJson: z.string().trim().min(2).max(100_000)
    .describe('Complete frozen operation input as one JSON object string; the server validates it against the target schema.'),
}).strict()

const projectAgentChoiceCommitmentSchema = z.object({
  when: commitmentWhenSchema,
  operationId: z.string().trim().min(1).max(128),
  input: z.record(z.string(), z.unknown()),
}).strict()

export type ProjectAgentChoiceCommitmentRequest = z.infer<typeof projectAgentChoiceCommitmentRequestSchema>
export type ProjectAgentChoiceCommitment = z.infer<typeof projectAgentChoiceCommitmentSchema>

const projectAgentChoiceOfferSchema = z.object({
  card: projectAgentChoiceCardSchema,
  subject: projectAgentChoiceSubjectSchema,
  commitments: z.array(projectAgentChoiceCommitmentSchema).max(12),
}).strict()

export interface ProjectAgentChoiceOffer {
  card: ProjectAgentChoiceCardPartData
  subject: ProjectAgentChoiceSubject
  commitments: ProjectAgentChoiceCommitment[]
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson }

function canonicalize(value: unknown): CanonicalJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('PROJECT_AGENT_CHOICE_FINGERPRINT_VALUE_INVALID')
    return value
  }
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
    )
  }
  throw new Error('PROJECT_AGENT_CHOICE_FINGERPRINT_VALUE_INVALID')
}

export function fingerprintProjectAgentChoiceSubject(kind: ProjectAgentChoiceSubject['kind'], snapshot: unknown): string {
  return createHash('sha256')
    .update(kind)
    .update('\n')
    .update(JSON.stringify(canonicalize(snapshot)))
    .digest('hex')
}

function cardDefinitionFromPersistedCard(
  card: ProjectAgentChoiceCardPartData,
): ProjectAgentChoiceCardDefinition {
  const definition: Record<string, unknown> = { ...card }
  delete definition.runId
  delete definition.interruptionId
  return projectAgentChoiceCardDefinitionSchema.parse(definition)
}

function assertUniqueResourceRevisionRequests(
  revisions: readonly { revisionId: string }[],
): void {
  const identities = new Set<string>()
  for (const revision of revisions) {
    const identity = revision.revisionId
    if (identities.has(identity)) {
      throw new Error(`PROJECT_AGENT_CHOICE_RESOURCE_REVISION_DUPLICATE:${identity}`)
    }
    identities.add(identity)
  }
}

async function resolveTaskResultSubject(params: {
  tx: Prisma.TransactionClient
  projectId: string
  userId: string
  taskId: string
}): Promise<Extract<ProjectAgentChoiceSubject, { kind: 'task_result' }>> {
  const task = await params.tx.task.findFirst({
    where: {
      id: params.taskId,
      projectId: params.projectId,
      userId: params.userId,
      status: 'completed',
    },
    select: {
      id: true,
      episodeId: true,
      type: true,
      status: true,
      targetType: true,
      targetId: true,
      result: true,
    },
  })
  if (!task || task.result === null) throw new Error('PROJECT_AGENT_CHOICE_TASK_RESULT_MISSING')
  return {
    kind: 'task_result',
    taskId: task.id,
    fingerprint: fingerprintProjectAgentChoiceSubject('task_result', task),
  }
}

async function resolveResourceRevisionsSubject(params: {
  tx: Prisma.TransactionClient
  projectId: string
  userId: string
  revisions: readonly { revisionId: string }[]
}): Promise<Extract<ProjectAgentChoiceSubject, { kind: 'resource_revisions' }>> {
  assertUniqueResourceRevisionRequests(params.revisions)
  const revisionIds = params.revisions.map((revision) => revision.revisionId)
  const records = await params.tx.creativeResourceRevision.findMany({
    where: {
      id: { in: revisionIds },
      resource: {
        userId: params.userId,
        status: 'ready',
        OR: [{ projectId: params.projectId }, { projectId: null }],
      },
    },
    select: {
      id: true,
      resourceId: true,
      resource: {
        select: {
          projectId: true,
          episodeId: true,
          mediaType: true,
          schemaId: true,
          status: true,
        },
      },
    },
  })
  const byId = new Map(records.map((record) => [record.id, record]))
  const ordered = params.revisions.map((requested) => {
    const record = byId.get(requested.revisionId)
    if (!record) {
      throw new Error(`PROJECT_AGENT_CHOICE_RESOURCE_REVISION_MISSING:${requested.revisionId}`)
    }
    return record
  })
  return {
    kind: 'resource_revisions',
    revisions: ordered.map((record) => ({
      revisionId: record.id,
    })),
    fingerprint: fingerprintProjectAgentChoiceSubject('resource_revisions', ordered),
  }
}

export async function resolveProjectAgentChoiceSubject(params: {
  tx: Prisma.TransactionClient
  projectId: string
  userId: string
  request: ProjectAgentChoiceSubjectRequest
  card: ProjectAgentChoiceCardDefinition
  commitments: readonly ProjectAgentChoiceCommitment[]
}): Promise<ProjectAgentChoiceSubject> {
  if (params.request.kind === 'none') {
    return {
      kind: 'none',
      fingerprint: fingerprintProjectAgentChoiceSubject('none', {
        card: params.card,
        commitments: params.commitments,
      }),
    }
  }
  if (params.request.kind === 'task_result') {
    return await resolveTaskResultSubject({
      tx: params.tx,
      projectId: params.projectId,
      userId: params.userId,
      taskId: params.request.taskId,
    })
  }
  return await resolveResourceRevisionsSubject({
    tx: params.tx,
    projectId: params.projectId,
    userId: params.userId,
    revisions: params.request.revisions,
  })
}

export function parseProjectAgentChoiceCommitmentInputJson(inputJson: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(inputJson)
  } catch {
    throw new Error('PROJECT_AGENT_CHOICE_COMMITMENT_INPUT_JSON_INVALID')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('PROJECT_AGENT_CHOICE_COMMITMENT_INPUT_OBJECT_REQUIRED')
  }
  canonicalize(parsed)
  return parsed as Record<string, unknown>
}

export function assertProjectAgentChoiceCommitmentsMatchCard(params: {
  card: ProjectAgentChoiceCardDefinition
  commitments: readonly ProjectAgentChoiceCommitment[]
}): void {
  const identities = new Set<string>()
  for (const commitment of params.commitments) {
    const identity = commitment.when.kind === 'confirm'
      ? 'confirm'
      : `option:${commitment.when.groupKey}:${commitment.when.optionValue}`
    if (identities.has(identity)) {
      throw new Error(`PROJECT_AGENT_CHOICE_COMMITMENT_DUPLICATE:${identity}`)
    }
    identities.add(identity)
    if (commitment.when.kind === 'confirm') {
      if (params.card.mode !== 'confirm' && params.card.mode !== 'confirm_or_text') {
        throw new Error('PROJECT_AGENT_CHOICE_CONFIRM_COMMITMENT_MODE_INVALID')
      }
      continue
    }
    if (
      params.card.mode === 'confirm'
      || params.card.mode === 'confirm_or_text'
      || params.card.groups.length !== 1
    ) {
      throw new Error('PROJECT_AGENT_CHOICE_OPTION_COMMITMENT_CARD_INVALID')
    }
    const when = commitment.when
    const group = params.card.groups[0]
    if (
      !group
      || group.key !== when.groupKey
      || !group.options.some((option) => option.value === when.optionValue)
    ) {
      throw new Error(
        `PROJECT_AGENT_CHOICE_COMMITMENT_OPTION_NOT_OFFERED:${when.groupKey}:${when.optionValue}`,
      )
    }
  }
}

export function buildProjectAgentChoiceOffer(params: {
  runId: string
  interruptionId: string
  card: ProjectAgentChoiceCardDefinition
  subject: ProjectAgentChoiceSubject
  commitments: readonly ProjectAgentChoiceCommitment[]
}): ProjectAgentChoiceOffer {
  assertProjectAgentChoiceCommitmentsMatchCard({ card: params.card, commitments: params.commitments })
  return parseProjectAgentChoiceOffer({
    card: {
      ...params.card,
      runId: params.runId,
      interruptionId: params.interruptionId,
    },
    subject: params.subject,
    commitments: [...params.commitments],
  })
}

export function parseProjectAgentChoiceOffer(value: Prisma.JsonValue | unknown): ProjectAgentChoiceOffer {
  const parsed = projectAgentChoiceOfferSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(
      `PROJECT_AGENT_CHOICE_OFFER_INVALID:${parsed.error.issues.map((issue) => issue.path.join('.')).join(',')}`,
    )
  }
  assertProjectAgentChoiceCommitmentsMatchCard({ card: parsed.data.card, commitments: parsed.data.commitments })
  return parsed.data
}

export function parseProjectAgentChoiceDecision(params: {
  offer: ProjectAgentChoiceOffer
  response: Prisma.InputJsonValue | unknown
}): ProjectAgentChoiceDecision {
  return parseChoiceDecision({ card: params.offer.card, response: params.response })
}

export async function assertProjectAgentChoiceOfferCurrent(params: {
  tx: Prisma.TransactionClient
  projectId: string
  userId: string
  episodeId?: string | null
  offer: ProjectAgentChoiceOffer
}): Promise<void> {
  const request: ProjectAgentChoiceSubjectRequest = params.offer.subject.kind === 'none'
    ? { kind: 'none' }
    : params.offer.subject.kind === 'task_result'
      ? { kind: 'task_result', taskId: params.offer.subject.taskId }
      : {
          kind: 'resource_revisions',
          revisions: params.offer.subject.revisions.map((revision) => ({
            revisionId: revision.revisionId,
          })),
        }
  const current = await resolveProjectAgentChoiceSubject({
    tx: params.tx,
    projectId: params.projectId,
    userId: params.userId,
    request,
    card: cardDefinitionFromPersistedCard(params.offer.card),
    commitments: params.offer.commitments,
  })
  if (current.fingerprint !== params.offer.subject.fingerprint) {
    throw new Error('PROJECT_AGENT_CHOICE_OFFER_STALE')
  }
}
