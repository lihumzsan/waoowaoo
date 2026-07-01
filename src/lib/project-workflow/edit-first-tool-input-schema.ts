import type { JsonValue, ProjectAgentToolInputSchema } from '@/lib/operations/types'
import { EDIT_FIRST_DURATION_TIERS } from '@/lib/edit-script/duration-tier'
import { EDIT_SCRIPT_VIDEO_RATIOS } from '@/lib/edit-script/types'

type ToolInputProperties = ProjectAgentToolInputSchema['properties']

function createToolInputSchema(properties: ToolInputProperties): ProjectAgentToolInputSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }
}

function stringProperty(description: string): JsonValue {
  return {
    type: 'string',
    minLength: 1,
    description,
  }
}

function nullableStringProperty(description: string): JsonValue {
  return {
    anyOf: [
      {
        type: 'string',
        minLength: 1,
      },
      {
        type: 'null',
      },
    ],
    description,
  }
}

function nullableEnumProperty(values: readonly string[], description: string): JsonValue {
  return {
    anyOf: [
      {
        type: 'string',
        enum: [...values],
      },
      {
        type: 'null',
      },
    ],
    description,
  }
}

export const EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({})

export const EDIT_FIRST_GENERATE_SCREENPLAY_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  prompt: stringProperty('The user creative request/story premise. Summarize the user intent; do not include system ids.'),
  durationTier: {
    type: 'string',
    enum: [...EDIT_FIRST_DURATION_TIERS],
    description: 'Short-film duration tier selected by the user.',
  },
  aspectRatio: {
    type: 'string',
    enum: [...EDIT_SCRIPT_VIDEO_RATIOS],
    description: 'Final film aspect ratio selected by the user.',
  },
})

export const EDIT_FIRST_REVISE_SCREENPLAY_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  revisionInstruction: stringProperty('Concrete user-requested screenplay changes. Do not include system ids.'),
  durationTier: nullableEnumProperty(
    EDIT_FIRST_DURATION_TIERS,
    'Pass only when the user explicitly changes the duration tier in this revision; otherwise pass null.',
  ),
  aspectRatio: nullableEnumProperty(
    EDIT_SCRIPT_VIDEO_RATIOS,
    'Pass only when the user explicitly changes the final aspect ratio in this revision; otherwise pass null.',
  ),
})

export const EDIT_FIRST_STYLE_PREVIEWS_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  styleDirection: nullableStringProperty('Pass only when the user explicitly asks to regenerate or adjust visual style candidates; otherwise pass null.'),
})

export const EDIT_FIRST_REVISE_ASSETS_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  revisionNotes: stringProperty('Concrete user asset review notes to apply to the current required assets. Do not include system ids.'),
})
