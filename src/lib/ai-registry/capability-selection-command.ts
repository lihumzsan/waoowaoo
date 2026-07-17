import { z } from 'zod'
import type { CapabilitySelections } from './types'

export const capabilitySelectionCommandSchema = z.array(z.object({
  modelKey: z.string().trim().min(1)
    .describe('Exact provider::modelId whose capability option is being configured.'),
  field: z.string().trim().min(1)
    .describe('Exact capability field returned for this model by list_user_models.'),
  value: z.union([z.string(), z.number(), z.boolean()])
    .describe('Exact allowed value returned for this model and capability field.'),
}).strict()).max(200).superRefine((entries, context) => {
  const seen = new Set<string>()
  entries.forEach((entry, index) => {
    const identity = `${entry.modelKey}\u0000${entry.field}`
    if (seen.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'CAPABILITY_SELECTION_DUPLICATE',
        path: [index, 'field'],
      })
      return
    }
    seen.add(identity)
  })
})
  .describe('Complete capability selection entries. Pass an empty array to clear all selections.')

export type CapabilitySelectionCommand = z.infer<typeof capabilitySelectionCommandSchema>

export function capabilitySelectionCommandToSelections(
  entries: CapabilitySelectionCommand,
): CapabilitySelections {
  const selections: CapabilitySelections = {}
  for (const entry of entries) {
    const current = selections[entry.modelKey] ?? {}
    current[entry.field] = entry.value
    selections[entry.modelKey] = current
  }
  return selections
}

export function capabilitySelectionsToCommand(
  selections: CapabilitySelections | null | undefined,
): CapabilitySelectionCommand {
  if (!selections) return []
  const entries: CapabilitySelectionCommand = []
  for (const [modelKey, fields] of Object.entries(selections)) {
    for (const [field, value] of Object.entries(fields)) {
      if (
        typeof value !== 'string'
        && typeof value !== 'number'
        && typeof value !== 'boolean'
      ) continue
      entries.push({ modelKey, field, value })
    }
  }
  return entries
}
