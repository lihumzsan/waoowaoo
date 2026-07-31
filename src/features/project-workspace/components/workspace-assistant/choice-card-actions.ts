import type {
  ProjectAgentChoiceCardGroup,
  ProjectAgentChoiceCardOption,
  ProjectAgentChoiceCardDefinition,
} from '@/lib/project-agent/types'

export type ChoiceCardSelections = Record<string, string>
export type ChoiceCardCustomOptions = Record<string, ProjectAgentChoiceCardOption>

export const CHOICE_CARD_CUSTOM_OPTION_VALUE_PREFIX = 'custom_choice:'

export function buildChoiceCardCustomOptionValue(groupKey: string): string {
  return `${CHOICE_CARD_CUSTOM_OPTION_VALUE_PREFIX}${groupKey}`
}

export function mergeChoiceCardCustomOptions(
  groups: readonly ProjectAgentChoiceCardGroup[],
  customOptions: ChoiceCardCustomOptions,
): ProjectAgentChoiceCardGroup[] {
  return groups.map((group) => {
    const customOption = customOptions[group.key]
    if (!customOption) return group
    const options = group.options.some((option) => option.value === customOption.value)
      ? group.options
      : [...group.options, customOption]
    return {
      ...group,
      options,
    }
  })
}

export function isChoiceCardSubmitReady(
  groups: readonly ProjectAgentChoiceCardGroup[],
  selections: ChoiceCardSelections,
): boolean {
  return groups.every((group) => {
    if (!group.required) return true
    const selected = selections[group.key]
    return typeof selected === 'string' && selected.trim().length > 0
  })
}

export function buildSingleOptionChoiceCardSelections(
  card: Pick<ProjectAgentChoiceCardDefinition, 'groups'>,
  optionValue: string,
): ChoiceCardSelections {
  const matchingGroups = card.groups.filter((group) => (
    group.options.some((option) => option.value === optionValue)
  ))
  if (matchingGroups.length !== 1) {
    throw new Error(`ASSISTANT_CHOICE_OPTION_IDENTITY_INVALID:${optionValue}:${String(matchingGroups.length)}`)
  }
  const selections = { [matchingGroups[0].key]: optionValue }
  if (!isChoiceCardSubmitReady(card.groups, selections)) {
    throw new Error(`ASSISTANT_CHOICE_OPTION_INCOMPLETE:${optionValue}`)
  }
  return selections
}

export function shouldShowChoiceCardManualSubmit(
  card: Pick<ProjectAgentChoiceCardDefinition, 'mode'>,
): boolean {
  return card.mode !== 'confirm' && card.mode !== 'confirm_or_text'
}
