export const STORYBOARD_PROMPT_FIELD_DEFINITIONS = [
  { id: 'style_bible', en: 'Style Bible', zh: '项目风格 Bible', scope: 'both' },
  { id: 'grid.mode', en: 'Grid mode', zh: '网格模式', scope: 'grid' },
  { id: 'grid.source_video_block_id', en: 'Source video block ID', zh: '视频 block ID', scope: 'grid' },
  { id: 'cell.cell_index', en: 'Cell index', zh: '格子序号', scope: 'grid' },
  { id: 'cell.cell_position', en: 'Cell position', zh: '格子位置', scope: 'grid' },
  { id: 'panel.panel_id', en: 'Panel ID', zh: '分镜 ID', scope: 'both' },
  { id: 'panel.shot_type', en: 'Shot type', zh: '镜头类型', scope: 'both' },
  { id: 'panel.camera_move', en: 'Camera move', zh: '镜头运动', scope: 'both' },
  { id: 'panel.description', en: 'Panel description', zh: '分镜描述', scope: 'both' },
  { id: 'panel.image_prompt', en: 'Image prompt', zh: '生图提示词', scope: 'both' },
  { id: 'panel.video_prompt', en: 'Video prompt', zh: '视频提示词', scope: 'single' },
  { id: 'panel.location', en: 'Location name', zh: '场景名称', scope: 'both' },
  { id: 'panel.characters', en: 'Panel characters', zh: '出场角色', scope: 'both' },
  { id: 'panel.source_text', en: 'Panel source text', zh: '分镜原文片段', scope: 'both' },
  { id: 'panel.photography_rules', en: 'Photography rules', zh: '摄影规则', scope: 'both' },
  { id: 'panel.photography_rules.shot_blocking', en: 'Shot blocking', zh: '文字 blocking / 站位构图', scope: 'both' },
  { id: 'panel.photography_rules.lighting', en: 'Lighting', zh: '光照', scope: 'both' },
  { id: 'panel.photography_rules.characters', en: 'Photography character rules', zh: '摄影角色规则', scope: 'both' },
  { id: 'panel.photography_rules.depth_of_field', en: 'Depth of field', zh: '景深', scope: 'both' },
  { id: 'panel.photography_rules.color_tone', en: 'Color tone', zh: '色调', scope: 'both' },
  { id: 'panel.acting_notes', en: 'Acting notes', zh: '表演指导', scope: 'both' },
  { id: 'context.character_appearances', en: 'Character appearance context', zh: '角色外观资料', scope: 'single' },
  { id: 'context.location_reference', en: 'Location reference', zh: '场景参考资料', scope: 'both' },
  { id: 'context.location_reference.spatial_profile', en: 'Spatial profile', zh: '空间档案', scope: 'both' },
  { id: 'context.reference_images', en: 'Reference image map', zh: '参考图编号映射', scope: 'both' },
  { id: 'context.additional_reference_images', en: 'Additional reference image notes', zh: '额外参考图说明', scope: 'both' },
] as const

export type StoryboardPromptFieldDefinition = (typeof STORYBOARD_PROMPT_FIELD_DEFINITIONS)[number]
export type StoryboardPromptFieldId = StoryboardPromptFieldDefinition['id']

export type StoryboardPromptFieldPreset = {
  readonly id: 'no_composition' | 'no_style'
  readonly en: string
  readonly zh: string
  readonly fieldIds: readonly StoryboardPromptFieldId[]
}

export const STORYBOARD_PROMPT_FIELD_PRESETS: readonly StoryboardPromptFieldPreset[] = [
  {
    id: 'no_composition',
    en: 'No composition',
    zh: '无构图',
    fieldIds: [
      'panel.shot_type',
      'panel.image_prompt',
      'panel.photography_rules',
      'panel.photography_rules.shot_blocking',
      'context.location_reference',
      'context.location_reference.spatial_profile',
      'context.reference_images',
    ],
  },
  {
    id: 'no_style',
    en: 'No style',
    zh: '无风格',
    fieldIds: [
      'style_bible',
      'panel.image_prompt',
      'panel.photography_rules.color_tone',
      'context.location_reference',
      'context.reference_images',
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

function deletePhotographySubfields(panel: Record<string, unknown>, omitted: ReadonlySet<string>) {
  if (omitted.has('panel.photography_rules.shot_blocking')) {
    delete panel.shot_blocking
  }

  if (!isRecord(panel.photography_rules)) return
  const rules = panel.photography_rules

  if (omitted.has('panel.photography_rules.shot_blocking')) {
    delete rules.shot_blocking
    delete rules.shotBlocking
    const cameraPlan = cloneRecord(rules.cameraPlan)
    delete cameraPlan.shotBlocking
    delete cameraPlan.shot_blocking
    if (Object.keys(cameraPlan).length > 0) rules.cameraPlan = cameraPlan
    else delete rules.cameraPlan

    const consistencyMetadata = cloneRecord(rules.consistencyMetadata)
    const consistencyCameraPlan = cloneRecord(consistencyMetadata.cameraPlan)
    delete consistencyCameraPlan.shotBlocking
    delete consistencyCameraPlan.shot_blocking
    if (Object.keys(consistencyCameraPlan).length > 0) {
      consistencyMetadata.cameraPlan = consistencyCameraPlan
    } else {
      delete consistencyMetadata.cameraPlan
    }
    if (Object.keys(consistencyMetadata).length > 0) rules.consistencyMetadata = consistencyMetadata
    else delete rules.consistencyMetadata
  }

  const directFieldMap: ReadonlyArray<readonly [StoryboardPromptFieldId, string]> = [
    ['panel.photography_rules.lighting', 'lighting'],
    ['panel.photography_rules.characters', 'characters'],
    ['panel.photography_rules.depth_of_field', 'depth_of_field'],
    ['panel.photography_rules.color_tone', 'color_tone'],
  ]
  for (const [fieldId, key] of directFieldMap) {
    if (omitted.has(fieldId)) delete rules[key]
  }

  if (Object.keys(rules).length === 0) {
    delete panel.photography_rules
  }
}

function applyPanelFieldOmissions(panel: Record<string, unknown>, omitted: ReadonlySet<string>) {
  const directFieldMap: ReadonlyArray<readonly [StoryboardPromptFieldId, string]> = [
    ['panel.panel_id', 'panel_id'],
    ['panel.shot_type', 'shot_type'],
    ['panel.camera_move', 'camera_move'],
    ['panel.description', 'description'],
    ['panel.image_prompt', 'image_prompt'],
    ['panel.video_prompt', 'video_prompt'],
    ['panel.location', 'location'],
    ['panel.characters', 'characters'],
    ['panel.source_text', 'source_text'],
    ['panel.acting_notes', 'acting_notes'],
  ]
  for (const [fieldId, key] of directFieldMap) {
    if (omitted.has(fieldId)) delete panel[key]
  }
  if (omitted.has('panel.photography_rules')) {
    delete panel.photography_rules
    delete panel.shot_blocking
    return
  }
  deletePhotographySubfields(panel, omitted)
}

function applyContextFieldOmissions(context: Record<string, unknown>, omitted: ReadonlySet<string>) {
  if (omitted.has('context.character_appearances')) delete context.character_appearances
  if (omitted.has('context.reference_images')) delete context.reference_images
  if (omitted.has('context.additional_reference_images')) delete context.additional_reference_images
  if (omitted.has('context.location_reference')) {
    delete context.location_reference
    return
  }
  if (omitted.has('context.location_reference.spatial_profile') && isRecord(context.location_reference)) {
    const locationReference = cloneRecord(context.location_reference)
    delete locationReference.spatial_profile
    context.location_reference = locationReference
  }
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
  const omitted = new Set<string>(omittedFields)
  const output = cloneRecord(promptContext)
  const panel = cloneRecord(output.panel)
  const context = cloneRecord(output.context)
  applyPanelFieldOmissions(panel, omitted)
  applyContextFieldOmissions(context, omitted)
  output.panel = panel
  output.context = context
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
  if (omitted.has('grid.source_video_block_id')) delete grid.source_video_block_id

  const cells = Array.isArray(grid.cells) ? grid.cells : []
  grid.cells = cells.map((cell) => {
    const nextCell = cloneRecord(cell)
    if (omitted.has('cell.cell_index')) delete nextCell.cell_index
    if (omitted.has('cell.cell_position')) delete nextCell.cell_position
    const panel = cloneRecord(nextCell.panel)
    applyPanelFieldOmissions(panel, omitted)
    nextCell.panel = panel

    const panelContext = cloneRecord(nextCell.panel_context)
    applyContextFieldOmissions(panelContext, omitted)
    nextCell.panel_context = panelContext
    return nextCell
  })

  applyContextFieldOmissions(context, omitted)
  output.grid = grid
  output.context = context
  return output
}
