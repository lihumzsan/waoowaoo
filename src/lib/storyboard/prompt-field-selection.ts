export const STORYBOARD_PROMPT_FIELD_DEFINITIONS = [
  { id: 'style_bible', en: 'Style Bible', zh: '项目风格 Bible', scope: 'both' },
  { id: 'render_facts.SCENE', en: 'Scene facts', zh: '场景事实', scope: 'both' },
  { id: 'render_facts.CHARACTERS', en: 'Character facts', zh: '角色事实', scope: 'both' },
  { id: 'render_facts.PROPS', en: 'Prop facts', zh: '道具事实', scope: 'both' },
  { id: 'render_facts.CAMERA', en: 'Camera facts', zh: '镜头事实', scope: 'both' },
  { id: 'render_facts.AXIS', en: 'Axis facts', zh: '轴线事实', scope: 'both' },
  { id: 'render_facts.STYLE', en: 'Style facts', zh: '风格事实', scope: 'both' },
] as const

export type StoryboardPromptFieldDefinition = (typeof STORYBOARD_PROMPT_FIELD_DEFINITIONS)[number]
export type StoryboardPromptFieldId = StoryboardPromptFieldDefinition['id']

export type StoryboardPromptFieldPreset = {
  readonly id: 'no_scene_graph' | 'no_style'
  readonly en: string
  readonly zh: string
  readonly fieldIds: readonly StoryboardPromptFieldId[]
}

export const STORYBOARD_PROMPT_FIELD_PRESETS: readonly StoryboardPromptFieldPreset[] = [
  {
    id: 'no_scene_graph',
    en: 'No scene graph',
    zh: '无场景图谱',
    fieldIds: [
      'render_facts.SCENE',
      'render_facts.CAMERA',
      'render_facts.AXIS',
    ],
  },
  {
    id: 'no_style',
    en: 'No style',
    zh: '无风格',
    fieldIds: [
      'style_bible',
      'render_facts.STYLE',
    ],
  },
]

const STORYBOARD_PROMPT_FIELD_ID_SET = new Set<string>(
  STORYBOARD_PROMPT_FIELD_DEFINITIONS.map((field) => field.id),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneJson(item))
  if (!isRecord(value)) return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    output[key] = cloneJson(item)
  }
  return output
}

function cloneRecord(value: unknown): Record<string, unknown> {
  const cloned = cloneJson(value)
  return isRecord(cloned) ? cloned : {}
}

function applyRenderFactsOmissions(renderFacts: Record<string, unknown>, omitted: ReadonlySet<string>): void {
  if (omitted.has('render_facts.SCENE')) delete renderFacts.SCENE
  if (omitted.has('render_facts.CHARACTERS')) delete renderFacts.CHARACTERS
  if (omitted.has('render_facts.PROPS')) delete renderFacts.PROPS
  if (omitted.has('render_facts.CAMERA')) delete renderFacts.CAMERA
  if (omitted.has('render_facts.AXIS')) delete renderFacts.AXIS
  if (omitted.has('style_bible') || omitted.has('render_facts.STYLE')) delete renderFacts.STYLE
}

export function parseStoryboardPromptFieldOmissions(value: unknown): StoryboardPromptFieldId[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value
    .filter((item): item is StoryboardPromptFieldId =>
      typeof item === 'string' && STORYBOARD_PROMPT_FIELD_ID_SET.has(item),
    )))
}

export function applyPanelPromptFieldOmissions(
  promptContext: unknown,
  omittedFields: readonly StoryboardPromptFieldId[],
): unknown {
  if (omittedFields.length === 0 || !isRecord(promptContext)) return promptContext
  const output = cloneRecord(promptContext)
  applyRenderFactsOmissions(output, new Set<string>(omittedFields))
  return output
}
