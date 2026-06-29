export const STORYBOARD_PROMPT_FIELD_DEFINITIONS = [
  { id: 'style_bible', en: 'Style Bible', zh: '项目风格 Bible', scope: 'both' },
  { id: 'render_facts.SCENE', en: 'Scene facts', zh: '场景事实', scope: 'both' },
  { id: 'render_facts.CHARACTERS', en: 'Character facts', zh: '角色事实', scope: 'both' },
  { id: 'render_facts.PROPS', en: 'Prop facts', zh: '道具事实', scope: 'both' },
  { id: 'render_facts.CAMERA', en: 'Camera facts', zh: '镜头事实', scope: 'both' },
  { id: 'render_facts.AXIS', en: 'Axis facts', zh: '轴线事实', scope: 'both' },
  { id: 'render_facts.STYLE', en: 'Style facts', zh: '风格事实', scope: 'both' },
  { id: 'grid.mode', en: 'Grid mode', zh: '网格模式', scope: 'grid' },
  { id: 'grid.source_generation_segment_id', en: 'Source generation segment ID', zh: '生成片段 ID', scope: 'grid' },
  { id: 'cell.cell_index', en: 'Cell index', zh: '格子序号', scope: 'grid' },
  { id: 'cell.cell_position', en: 'Cell position', zh: '格子位置', scope: 'grid' },
  { id: 'cell.panel_id', en: 'Panel ID', zh: '分镜 ID', scope: 'grid' },
  { id: 'context.reference_images', en: 'Uploaded reference image map', zh: '上传参考图映射', scope: 'both' },
  { id: 'context.additional_reference_images', en: 'Additional reference image notes', zh: '额外参考图说明', scope: 'both' },
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
      'context.reference_images',
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

function applyContextFieldOmissions(context: Record<string, unknown>, omitted: ReadonlySet<string>): void {
  if (omitted.has('context.reference_images')) delete context.reference_images
  if (omitted.has('context.additional_reference_images')) delete context.additional_reference_images
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

export function applyGridPromptFieldOmissions(
  promptContext: unknown,
  omittedFields: readonly StoryboardPromptFieldId[],
): unknown {
  if (omittedFields.length === 0 || !isRecord(promptContext)) return promptContext
  const omitted = new Set<string>(omittedFields)
  const output = cloneRecord(promptContext)
  const grid = cloneRecord(output.grid)
  const context = cloneRecord(output.context)

  if (omitted.has('grid.mode')) delete grid.mode
  if (omitted.has('grid.source_generation_segment_id')) delete grid.source_generation_segment_id

  const cells = Array.isArray(grid.cells) ? grid.cells : []
  grid.cells = cells.map((cell) => {
    const nextCell = cloneRecord(cell)
    if (omitted.has('cell.cell_index')) delete nextCell.cell_index
    if (omitted.has('cell.cell_position')) delete nextCell.cell_position

    const panelFacts = cloneRecord(nextCell.panel_facts)
    if (omitted.has('cell.panel_id')) delete panelFacts.panel_id
    const renderFacts = cloneRecord(panelFacts.render_facts)
    applyRenderFactsOmissions(renderFacts, omitted)
    panelFacts.render_facts = renderFacts
    nextCell.panel_facts = panelFacts
    return nextCell
  })

  applyContextFieldOmissions(context, omitted)
  output.grid = grid
  output.context = context
  return output
}
