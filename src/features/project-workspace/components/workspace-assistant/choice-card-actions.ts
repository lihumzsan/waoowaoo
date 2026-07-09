import type {
  ProjectAgentChoiceCardGroup,
  ProjectAgentChoiceCardOption,
  ProjectAgentChoiceCardPartData,
} from '@/lib/project-agent/types'

export type ChoiceCardSelections = Record<string, string>
export type ChoiceCardCustomOptions = Record<string, ProjectAgentChoiceCardOption>

const CHOICE_CARD_CUSTOM_OPTION_VALUE_PREFIX = 'custom_choice:'

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

export function resolveChoiceCardSelectionLabels(
  groups: readonly ProjectAgentChoiceCardGroup[],
  selections: ChoiceCardSelections,
): ChoiceCardSelections {
  const labels: ChoiceCardSelections = {}
  groups.forEach((group) => {
    const selectedValue = selections[group.key]
    if (!selectedValue) return
    const selectedOption = group.options.find((option) => option.value === selectedValue)
    if (!selectedOption) return
    labels[`${group.key}Label`] = selectedOption.label
  })
  return labels
}

export function shouldShowChoiceCardManualSubmit(
  card: Pick<ProjectAgentChoiceCardPartData, 'autoSubmitOnReady' | 'variant'>,
): boolean {
  return card.autoSubmitOnReady !== true
    && card.variant !== 'confirm'
    && card.variant !== 'confirm_or_reply'
}
