import type { FollowUpResponse } from './api-client'
import type { E2eChoiceAction, E2eNextAction, E2eRunnerConfig, E2eTaskFollowUpAction } from './types'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readRecord(value: unknown, field: string): UnknownRecord {
  if (!isRecord(value)) throw new Error(`E2E_SESSION_FIELD_RECORD_REQUIRED:${field}`)
  return value
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`E2E_SESSION_FIELD_STRING_REQUIRED:${field}`)
  }
  return value.trim()
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`E2E_SESSION_FIELD_ARRAY_REQUIRED:${field}`)
  return value
}

function readSessionState(payload: unknown): UnknownRecord {
  const root = readRecord(payload, 'root')
  return readRecord(root.sessionState, 'sessionState')
}

function readChoiceOptionValue(choiceCard: UnknownRecord, groupKey: string): string {
  const groups = readArray(choiceCard.groups, 'choiceCard.groups')
  const group = groups
    .map((item) => (isRecord(item) ? item : null))
    .find((item) => item?.key === groupKey)
  if (!group) throw new Error(`E2E_CHOICE_GROUP_MISSING:${groupKey}`)
  const options = readArray(group.options, `choiceCard.groups.${groupKey}.options`)
  const first = options.map((item) => (isRecord(item) ? item : null)).find(Boolean)
  if (!first) throw new Error(`E2E_CHOICE_OPTION_MISSING:${groupKey}`)
  return readString(first.value, `choiceCard.groups.${groupKey}.options.0.value`)
}

function readStyleAspectRatio(choiceCard: UnknownRecord, config: E2eRunnerConfig): E2eRunnerConfig['aspectRatio'] {
  const submit = isRecord(choiceCard.submit) ? choiceCard.submit : null
  const value = submit?.aspectRatio
  if (value === '9:16' || value === '16:9' || value === '21:9') return value
  return config.aspectRatio
}

function buildChoiceAction(config: E2eRunnerConfig, interaction: UnknownRecord): E2eChoiceAction {
  const choiceType = readString(interaction.choiceType, 'pendingInteraction.choiceType')
  if (
    choiceType !== 'bible_review'
    && choiceType !== 'style'
    && choiceType !== 'asset_review'
    && choiceType !== 'budget_confirmation'
  ) {
    throw new Error(`E2E_CHOICE_TYPE_UNSUPPORTED:${choiceType}`)
  }
  const choiceCard = readRecord(interaction.choiceCard, 'pendingInteraction.choiceCard')
  const base = {
    runId: readString(interaction.runId, 'pendingInteraction.runId'),
    interruptionId: readOptionalString(interaction.interruptionId),
    choiceType,
    toolCallId: readOptionalString(interaction.toolCallId),
  } as const

  if (choiceType === 'bible_review') {
    return {
      ...base,
      output: {
        ok: true,
        decision: 'approve',
        selections: {
          aspectRatio: config.aspectRatio,
        },
      },
    }
  }
  if (choiceType === 'style') {
    return {
      ...base,
      output: {
        ok: true,
        stylePreviewId: readChoiceOptionValue(choiceCard, 'stylePreviewId'),
        aspectRatio: readStyleAspectRatio(choiceCard, config),
      },
    }
  }
  if (choiceType === 'asset_review') {
    return {
      ...base,
      output: {
        ok: true,
        decision: 'approve',
      },
    }
  }
  return {
    ...base,
    output: {
      ok: true,
      decision: 'approve',
    },
  }
}

export function readNextActionFromSessionState(config: E2eRunnerConfig, payload: unknown): E2eNextAction | null {
  const sessionState = readSessionState(payload)
  const pendingInteraction = sessionState.pendingInteraction
  if (!pendingInteraction) return null
  const interaction = readRecord(pendingInteraction, 'pendingInteraction')
  const kind = readString(interaction.kind, 'pendingInteraction.kind')
  if (kind === 'choice') {
    return {
      kind: 'choice',
      action: buildChoiceAction(config, interaction),
    }
  }
  if (kind === 'approval') {
    return {
      kind: 'approval',
      action: {
        runId: readString(interaction.runId, 'pendingInteraction.runId'),
        interruptionId: readString(interaction.interruptionId, 'pendingInteraction.interruptionId'),
        approved: true,
        reason: null,
      },
    }
  }
  throw new Error(`E2E_PENDING_INTERACTION_UNSUPPORTED:${kind}`)
}

export function readFollowUpAction(response: FollowUpResponse): E2eTaskFollowUpAction | null {
  const first = response.followUps?.[0]
  if (!first) return null
  const runId = readOptionalString(first.runId)
  const waitId = readOptionalString(first.waitId)
  const claimId = readOptionalString(first.claimId)
  if (!runId || !waitId || !claimId) {
    throw new Error('E2E_FOLLOW_UP_INVALID')
  }
  return { runId, waitId, claimId }
}
