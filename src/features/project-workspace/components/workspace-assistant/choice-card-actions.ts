import type { ProjectAgentChoiceCardGroup } from '@/lib/project-agent/types'

export type ChoiceCardSelections = Record<string, string>

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
