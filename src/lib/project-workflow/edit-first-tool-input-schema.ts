import type { JsonValue, ProjectAgentToolInputSchema } from '@/lib/operations/types'

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

function nullableStringArrayProperty(description: string): JsonValue {
  return {
    anyOf: [
      {
        type: 'array',
        items: {
          type: 'string',
          minLength: 1,
        },
        minItems: 1,
      },
      {
        type: 'null',
      },
    ],
    description,
  }
}

export const EDIT_FIRST_EMPTY_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({})

export const EDIT_FIRST_SCRIPT_INTAKE_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  seedText: stringProperty('The exact user creative request that lacks the basic conditions for a complete script or directly expandable detailed brief and needs one structured intake choice before script expansion. Do not include projectId, episodeId, or system-derived parameters.'),
})

export const EDIT_FIRST_CHAPTER_SCOPE_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  chapterId: nullableStringProperty('Pass an exact chapterId only when the user explicitly targets a specific chapter or the current selection resolves to a chapter. Otherwise pass null so the system resolves the current/default scope.'),
})

export const EDIT_FIRST_REQUIRED_CHAPTER_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  chapterId: stringProperty('Exact chapterId to replan. This operation cannot infer a default chapter and must not receive null.'),
})

export const EDIT_FIRST_PLAN_CHAPTERS_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  chapterIds: nullableStringArrayProperty('Pass exact chapterIds only when the user explicitly targets a subset. Pass null to plan every missing or failed chapter automatically.'),
})

export const EDIT_FIRST_INGEST_SCRIPT_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  sourceKind: {
    type: 'string',
    enum: ['paste', 'prompt_generated_outline'],
    description: 'Classify the user input. Use paste only for a complete filmable script provided by the user. Use prompt_generated_outline only for a post-intake normalizedBrief, or for original user input already detailed enough to need no follow-up before expansion. Titles, theme directions, one-line ideas, short loglines, and briefs missing basic script conditions must use request_script_intake_choice first.',
  },
  text: stringProperty('The complete source script text, pasted script, or sufficiently detailed creative brief to expand after the intake rule has been satisfied. Do not include projectId or episodeId.'),
})

export const EDIT_FIRST_STYLE_PREVIEWS_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  styleDirection: nullableStringProperty('Pass only when the user explicitly asks to regenerate or adjust visual style candidates; otherwise pass null.'),
})

export const EDIT_FIRST_REVISE_ASSETS_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  revisionNotes: stringProperty('Concrete user asset review notes to apply to the current required assets. Do not include system ids.'),
})

export const EDIT_FIRST_REVISE_ASSETS_CHAPTER_TOOL_INPUT_SCHEMA: ProjectAgentToolInputSchema = createToolInputSchema({
  revisionNotes: stringProperty('Concrete user asset review notes to apply to the current required assets. Do not include system ids.'),
  chapterId: nullableStringProperty('Pass an exact chapterId only when the user explicitly targets a specific chapter or the current selection resolves to a chapter. Otherwise pass null so the system resolves the current/default scope.'),
})
