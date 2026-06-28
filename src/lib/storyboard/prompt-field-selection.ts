export const STORYBOARD_PROMPT_FIELD_DEFINITIONS = [
  { id: 'style_bible', en: 'Style Bible', zh: '项目风格 Bible', scope: 'both' },
  { id: 'render_facts.SCENE_GRAPH', en: 'Scene graph', zh: '场景图谱', scope: 'both' },
  { id: 'render_facts.CHARACTER_GRAPH', en: 'Character graph', zh: '角色图谱', scope: 'both' },
  { id: 'render_facts.PROP_GRAPH', en: 'Prop graph', zh: '道具图谱', scope: 'both' },
  { id: 'render_facts.REFERENCE_IMAGES', en: 'Reference image facts', zh: '参考图事实', scope: 'single' },
  { id: 'render_facts.STILL_FRAME', en: 'Still frame facts', zh: '单帧事实', scope: 'both' },
  { id: 'render_facts.STILL_FRAME.camera', en: 'Camera execution', zh: '镜头执行', scope: 'both' },
  { id: 'render_facts.STILL_FRAME.blocking', en: 'Blocking execution', zh: '空间 blocking', scope: 'both' },
  { id: 'render_facts.STYLE', en: 'Style facts', zh: '风格事实', scope: 'both' },
  { id: 'render_facts.NEGATIVE', en: 'Negative constraints', zh: '负向约束', scope: 'both' },
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
      'render_facts.SCENE_GRAPH',
      'render_facts.STILL_FRAME.camera',
      'render_facts.STILL_FRAME.blocking',
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
      'render_facts.NEGATIVE',
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
  if (omitted.has('render_facts.SCENE_GRAPH')) delete renderFacts.SCENE_GRAPH
  if (omitted.has('render_facts.CHARACTER_GRAPH')) delete renderFacts.CHARACTER_GRAPH
  if (omitted.has('render_facts.PROP_GRAPH')) delete renderFacts.PROP_GRAPH
  if (omitted.has('render_facts.REFERENCE_IMAGES')) delete renderFacts.REFERENCE_IMAGES
  if (omitted.has('style_bible') || omitted.has('render_facts.STYLE')) delete renderFacts.STYLE
  if (omitted.has('render_facts.NEGATIVE')) delete renderFacts.NEGATIVE

  if (omitted.has('render_facts.STILL_FRAME')) {
    delete renderFacts.STILL_FRAME
    return
  }

  if (!isRecord(renderFacts.STILL_FRAME)) return
  const stillFrame = cloneRecord(renderFacts.STILL_FRAME)
  if (omitted.has('render_facts.STILL_FRAME.camera')) delete stillFrame.camera
  if (omitted.has('render_facts.STILL_FRAME.blocking')) delete stillFrame.blocking
  if (Object.keys(stillFrame).length > 0) renderFacts.STILL_FRAME = stillFrame
  else delete renderFacts.STILL_FRAME
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
