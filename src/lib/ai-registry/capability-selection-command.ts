import { z } from 'zod'
import { parseModelKeyStrict } from './selection'
import type { CapabilitySelections, CapabilityValue } from './types'

const UNSAFE_DYNAMIC_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const capabilityModelKeySchema = z.string().trim().min(1)
  .refine((value) => parseModelKeyStrict(value)?.modelKey === value, {
    message: 'CAPABILITY_SELECTION_MODEL_KEY_INVALID',
  })

const capabilityFieldSchema = z.string().trim().min(1)
  .refine((value) => !UNSAFE_DYNAMIC_KEYS.has(value), {
    message: 'CAPABILITY_SELECTION_FIELD_UNSAFE',
  })

export const capabilitySelectionCommandSchema = z.array(z.object({
  modelKey: capabilityModelKeySchema
    .describe('Exact provider::modelId whose capability option is being configured.'),
  field: capabilityFieldSchema
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
  const selections = Object.create(null) as CapabilitySelections
  for (const entry of entries) {
    const current = selections[entry.modelKey]
      ?? Object.create(null) as Record<string, CapabilityValue>
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
