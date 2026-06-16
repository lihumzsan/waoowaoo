const GRID_CELL_COUNT = 4

export type StoryboardPanelImageGenerationMode = 'single' | 'grid'

export type StoryboardGridGroupingPanel = {
  readonly id: string
  readonly storyboardId: string
  readonly panelIndex: number
  readonly photographyRules: string | null
}

export type StoryboardPanelImageSubmissionGroup =
  | {
    readonly kind: 'single'
    readonly panels: readonly [StoryboardGridGroupingPanel]
  }
  | {
    readonly kind: 'grid2x2'
    readonly sourceVideoBlockId: string
    readonly panels: readonly StoryboardGridGroupingPanel[]
  }

export function normalizeStoryboardPanelImageGenerationMode(value: unknown): StoryboardPanelImageGenerationMode {
  return value === 'single' ? 'single' : 'grid'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readPanelSourceVideoBlockId(panel: StoryboardGridGroupingPanel): string {
  if (!panel.photographyRules) return ''
  let parsed: unknown
  try {
    parsed = JSON.parse(panel.photographyRules)
  } catch {
    return ''
  }
  if (!isRecord(parsed)) return ''
  const sourceVideoBlockKind = normalizeString(parsed.sourceVideoBlockKind)
  const sourceVideoBlockId = normalizeString(parsed.sourceVideoBlockId)
  if (sourceVideoBlockKind !== 'group' || !sourceVideoBlockId) return ''
  return sourceVideoBlockId
}

function pushChunkedGridGroups(
  output: StoryboardPanelImageSubmissionGroup[],
  sourceVideoBlockId: string,
  panels: readonly StoryboardGridGroupingPanel[],
) {
  for (let index = 0; index < panels.length; index += GRID_CELL_COUNT) {
    const chunk = panels.slice(index, index + GRID_CELL_COUNT)
    if (chunk.length === 1) {
      output.push({ kind: 'single', panels: [chunk[0]] })
      continue
    }
    output.push({
      kind: 'grid2x2',
      sourceVideoBlockId,
      panels: chunk,
    })
  }
}

export function planStoryboardPanelImageSubmissionGroups(
  panels: readonly StoryboardGridGroupingPanel[],
  generationMode: StoryboardPanelImageGenerationMode = 'grid',
): StoryboardPanelImageSubmissionGroup[] {
  const sortedPanels = [...panels].sort((left, right) => {
    if (left.storyboardId !== right.storyboardId) return left.storyboardId.localeCompare(right.storyboardId)
    return left.panelIndex - right.panelIndex
  })
  if (generationMode === 'single') {
    return sortedPanels.map((panel) => ({ kind: 'single', panels: [panel] }))
  }
  const groupedPanels = new Map<string, {
    readonly sourceVideoBlockId: string
    readonly panels: StoryboardGridGroupingPanel[]
  }>()
  const output: StoryboardPanelImageSubmissionGroup[] = []

  for (const panel of sortedPanels) {
    const sourceVideoBlockId = readPanelSourceVideoBlockId(panel)
    if (!sourceVideoBlockId) {
      output.push({ kind: 'single', panels: [panel] })
      continue
    }
    const key = `${panel.storyboardId}:${sourceVideoBlockId}`
    const existing = groupedPanels.get(key)
    if (existing) {
      existing.panels.push(panel)
      continue
    }
    groupedPanels.set(key, {
      sourceVideoBlockId,
      panels: [panel],
    })
  }

  for (const group of groupedPanels.values()) {
    pushChunkedGridGroups(output, group.sourceVideoBlockId, group.panels)
  }

  return output.sort((left, right) => left.panels[0].panelIndex - right.panels[0].panelIndex)
}
