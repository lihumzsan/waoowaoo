import type { AgentInputItem } from '@openai/agents'
import type {
  ProjectAgentChoiceCardDefinition,
  ProjectAgentChoiceCommitment,
  ProjectAgentChoiceOffer,
} from './choice-offer'

type UnknownRecord = Record<string, unknown>

export type ProjectAgentChoiceSelection =
  | {
      groupKey: string
      kind: 'option'
      value: string
    }
  | {
      groupKey: string
      kind: 'text'
      text: string
    }

export type ProjectAgentChoiceDecision =
  | { kind: 'confirm' }
  | { kind: 'cancelled' }
  | { kind: 'select'; selections: ProjectAgentChoiceSelection[] }
  | { kind: 'text'; text: string }

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function parseSelection(value: unknown): ProjectAgentChoiceSelection | null {
  if (!isRecord(value)) return null
  const groupKey = readRequiredString(value.groupKey)
  if (!groupKey) return null
  if (value.kind === 'option') {
    const optionValue = readRequiredString(value.value)
    return optionValue ? { groupKey, kind: 'option', value: optionValue } : null
  }
  if (value.kind === 'text') {
    const text = readRequiredString(value.text)
    return text ? { groupKey, kind: 'text', text } : null
  }
  return null
}

function parseSelections(params: {
  card: ProjectAgentChoiceCardDefinition
  response: UnknownRecord
}): ProjectAgentChoiceSelection[] {
  if (!Array.isArray(params.response.selections)) {
    throw new Error('PROJECT_AGENT_CHOICE_SELECTIONS_INVALID')
  }
  const byGroup = new Map<string, ProjectAgentChoiceSelection>()
  for (const rawSelection of params.response.selections) {
    const selection = parseSelection(rawSelection)
    if (!selection) throw new Error('PROJECT_AGENT_CHOICE_SELECTION_INVALID')
    if (byGroup.has(selection.groupKey)) {
      throw new Error(`PROJECT_AGENT_CHOICE_SELECTION_DUPLICATE:${selection.groupKey}`)
    }
    const group = params.card.groups.find((candidate) => candidate.key === selection.groupKey)
    if (!group) {
      throw new Error(`PROJECT_AGENT_CHOICE_SELECTION_KEY_INVALID:${selection.groupKey}`)
    }
    if (selection.kind === 'option') {
      if (!group.options.some((option) => option.value === selection.value)) {
        throw new Error(
          `PROJECT_AGENT_CHOICE_SELECTION_NOT_OFFERED:${selection.groupKey}:${selection.value}`,
        )
      }
    } else if (params.card.replyMode !== 'per_group' || group.allowCustomText !== true) {
      throw new Error(`PROJECT_AGENT_CHOICE_CUSTOM_TEXT_NOT_ALLOWED:${selection.groupKey}`)
    }
    byGroup.set(selection.groupKey, selection)
  }
  for (const group of params.card.groups) {
    if (group.required && !byGroup.has(group.key)) {
      throw new Error(`PROJECT_AGENT_CHOICE_SELECTION_REQUIRED:${group.key}`)
    }
  }
  return params.card.groups.flatMap((group) => {
    const selection = byGroup.get(group.key)
    return selection ? [selection] : []
  })
}

export function parseProjectAgentChoiceDecision(params: {
  card: ProjectAgentChoiceCardDefinition
  response: unknown
}): ProjectAgentChoiceDecision {
  if (!isRecord(params.response)) throw new Error('PROJECT_AGENT_CHOICE_RESPONSE_INVALID')
  const kind = params.response.kind
  if (kind === 'cancelled') {
    return { kind: 'cancelled' }
  }
  if (kind === 'confirm') {
    if (params.card.mode !== 'confirm' && params.card.mode !== 'confirm_or_text') {
      throw new Error(`PROJECT_AGENT_CHOICE_DECISION_MODE_INVALID:${params.card.mode}:confirm`)
    }
    return { kind: 'confirm' }
  }
  if (kind === 'select') {
    if (params.card.mode === 'confirm' || params.card.mode === 'confirm_or_text') {
      throw new Error(`PROJECT_AGENT_CHOICE_DECISION_MODE_INVALID:${params.card.mode}:select`)
    }
    return {
      kind: 'select',
      selections: parseSelections({
        card: params.card,
        response: params.response,
      }),
    }
  }
  if (kind === 'text') {
    if (
      (params.card.mode !== 'select_or_text' && params.card.mode !== 'confirm_or_text') ||
      params.card.replyMode !== 'whole_card'
    ) {
      throw new Error(`PROJECT_AGENT_CHOICE_DECISION_MODE_INVALID:${params.card.mode}:text`)
    }
    const text = readRequiredString(params.response.text)
    if (!text) throw new Error('PROJECT_AGENT_CHOICE_TEXT_REQUIRED')
    return { kind: 'text', text }
  }
  throw new Error('PROJECT_AGENT_CHOICE_RESPONSE_INVALID')
}

/**
 * Derive the one user-visible transcript fact from the frozen card and the
 * already validated decision. Callers may supply only the localized copy for
 * the semantic `cancelled` decision; every option/text label comes from the
 * authoritative frozen offer or parsed decision.
 */
export function buildProjectAgentChoiceVisibleUserText(params: {
  card: ProjectAgentChoiceCardDefinition
  decision: ProjectAgentChoiceDecision
  cancelledText: string
}): string {
  let visibleUserText: string
  if (params.decision.kind === 'confirm') {
    visibleUserText = params.card.submitLabel
  } else if (params.decision.kind === 'cancelled') {
    visibleUserText = params.cancelledText
  } else if (params.decision.kind === 'text') {
    visibleUserText = params.decision.text
  } else {
    const selectionByGroup = new Map(
      params.decision.selections.map((selection) => [selection.groupKey, selection]),
    )
    const lines = params.card.groups.flatMap((group) => {
      const selection = selectionByGroup.get(group.key)
      if (!selection) return []
      if (selection.kind === 'text') {
        return [`${group.label}: ${selection.text}`]
      }
      const option = group.options.find((candidate) => candidate.value === selection.value)
      if (!option) {
        throw new Error(
          `PROJECT_AGENT_CHOICE_SELECTION_NOT_OFFERED:${group.key}:${selection.value}`,
        )
      }
      return [`${group.label}: ${option.label}`]
    })
    visibleUserText = lines.length > 0 ? lines.join('\n') : params.card.submitLabel
  }
  const normalized = visibleUserText.trim()
  if (!normalized || normalized.length > 4_000) {
    throw new Error('PROJECT_AGENT_CHOICE_VISIBLE_USER_TEXT_INVALID')
  }
  return normalized
}

export function resolveProjectAgentChoiceCommitment(params: {
  offer: ProjectAgentChoiceOffer
  decision: ProjectAgentChoiceDecision
}): ProjectAgentChoiceCommitment | null {
  if (params.decision.kind === 'cancelled') return null
  const matching = params.offer.commitments.filter((commitment) => {
    if (commitment.when.kind === 'confirm') return params.decision.kind === 'confirm'
    const when = commitment.when
    return (
      params.decision.kind === 'select' &&
      params.decision.selections.some(
        (selection) =>
          selection.kind === 'option' &&
          selection.groupKey === when.groupKey &&
          selection.value === when.optionValue,
      )
    )
  })
  if (matching.length > 1) throw new Error('PROJECT_AGENT_CHOICE_COMMITMENT_AMBIGUOUS')
  return matching[0] ?? null
}

/**
 * A Choice answer is a new user fact. The original request_choice call and its
 * complete model-authored arguments already live in SDK Session history, so
 * fabricating a second empty function call would destroy that causality.
 */
export function buildProjectAgentChoiceResponseInputItem(params: {
  decision: ProjectAgentChoiceDecision
  toolCallId: string
  cardId: string
  visibleUserText: string
}): AgentInputItem {
  const toolCallId = params.toolCallId.trim()
  const cardId = params.cardId.trim()
  if (!toolCallId) throw new Error('PROJECT_AGENT_CHOICE_TOOL_CALL_ID_REQUIRED')
  if (!cardId) throw new Error('PROJECT_AGENT_CHOICE_CARD_ID_REQUIRED')
  const visibleUserText = params.visibleUserText.trim()
  if (!visibleUserText) {
    throw new Error('PROJECT_AGENT_CHOICE_VISIBLE_USER_TEXT_REQUIRED')
  }
  return {
    role: 'user',
    content: [
      '[choice_response]',
      `toolCallId=${toolCallId}`,
      `cardId=${cardId}`,
      `decision=${JSON.stringify(params.decision)}`,
      `visibleUserText=${JSON.stringify(visibleUserText)}`,
      '[/choice_response]',
    ].join('\n'),
  } satisfies AgentInputItem
}
