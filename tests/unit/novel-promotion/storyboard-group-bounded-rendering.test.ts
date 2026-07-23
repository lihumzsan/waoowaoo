import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import StoryboardGroup from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup'
import type { StoryboardGroupProps } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroup.types'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name }: { name: string }) => createElement('span', { 'data-icon': name }),
}))
vi.mock('@/components/task/TaskStatusOverlay', () => ({ default: () => null }))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/ScreenplayDisplay', () => ({ default: () => null }))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupHeader', () => ({
  default: () => createElement('header', null, 'group-header'),
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupActions', () => ({
  default: () => createElement('nav', null, 'group-actions'),
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardPanelList', () => ({
  default: () => createElement('div', { 'data-testid': 'storyboard-panel-list' }),
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupFailedAlert', () => ({ default: () => null }))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/StoryboardGroupDialogs', () => ({ default: () => null }))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardGroupTaskErrors', () => ({
  useStoryboardGroupTaskErrors: () => ({ panelTaskErrorMap: new Map(), clearPanelTaskError: vi.fn() }),
}))
vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/hooks/useStoryboardInsertVariantRuntime', () => ({
  useStoryboardInsertVariantRuntime: () => ({
    insertModalOpen: false,
    insertAfterPanel: null,
    nextPanelForInsert: null,
    variantModalPanel: null,
    handleOpenInsertModal: vi.fn(),
    handleCloseInsertModal: vi.fn(),
    handleInsert: vi.fn(),
    handleOpenVariantModal: vi.fn(),
    handleCloseVariantModal: vi.fn(),
    handleVariant: vi.fn(),
  }),
}))

vi.stubGlobal('React', React)

const noop = vi.fn()
const baseProps = {
  storyboard: {
    id: 'storyboard-1',
    episodeId: 'episode-1',
    clipId: 'clip-1',
    storyboardTextJson: null,
    panelCount: 1,
    storyboardImageUrl: null,
  },
  clip: undefined,
  sbIndex: 0,
  totalStoryboards: 2,
  textPanels: [{
    id: 'panel-1',
    panelIndex: 0,
    panel_number: 1,
    shot_type: 'medium',
    camera_move: null,
    description: 'panel',
    characters: [],
    imageUrl: null,
  }],
  storyboardStartIndex: 0,
  videoRatio: '16:9',
  isSourceExpanded: false,
  isPanelListExpanded: false,
  isSubmittingStoryboardTask: false,
  isSelectingCandidate: false,
  isSubmittingStoryboardTextTask: false,
  hasAnyImage: false,
  failedError: null,
  savingPanels: new Set<string>(),
  deletingPanelIds: new Set<string>(),
  saveStateByPanel: {},
  hasUnsavedByPanel: new Set<string>(),
  modifyingPanels: new Set<string>(),
  submittingPanelImageIds: new Set<string>(),
  onToggleSource: noop,
  onTogglePanelList: noop,
  onMoveUp: noop,
  onMoveDown: noop,
  onRegenerateText: noop,
  onAddPanel: noop,
  onDeleteStoryboard: noop,
  onGenerateAllIndividually: noop,
  onPreviewImage: noop,
  onCloseError: noop,
  getPanelEditData: (panel) => ({
    id: panel.id,
    panelIndex: panel.panelIndex,
    panelNumber: panel.panel_number,
    shotType: panel.shot_type,
    cameraMove: panel.camera_move,
    description: panel.description,
    location: null,
    characters: [],
    srtStart: null,
    srtEnd: null,
    duration: null,
    imageModel: null,
    videoPrompt: null,
  }),
  storyboardWorkflowOptions: [],
  defaultStoryboardWorkflow: '',
  onPanelUpdate: noop,
  onPanelDelete: noop,
  onOpenCharacterPicker: noop,
  onOpenLocationPicker: noop,
  onRemoveCharacter: noop,
  onRemoveLocation: noop,
  onRetryPanelSave: noop,
  onRegeneratePanelImage: noop,
  onOpenEditModal: noop,
  onOpenAIDataModal: noop,
  getPanelCandidates: () => null,
  onSelectPanelCandidateIndex: noop,
  onConfirmPanelCandidate: async () => undefined,
  onCancelPanelCandidate: noop,
  formatClipTitle: () => 'Segment 1',
  movingClipId: null,
  onInsertPanel: async () => undefined,
  insertingAfterPanelId: null,
  projectId: 'project-1',
  episodeId: 'episode-1',
  onPanelVariant: async () => undefined,
  submittingVariantPanelId: null,
} satisfies StoryboardGroupProps

function renderGroup(overrides: Partial<StoryboardGroupProps>) {
  return renderToStaticMarkup(createElement(StoryboardGroup, { ...baseProps, ...overrides }))
}

describe('StoryboardGroup bounded rendering', () => {
  it('summarizes a collapsed group without mounting its panel list', () => {
    const html = renderGroup({ isPanelListExpanded: false })
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('group.panelSummary')
    expect(html).not.toContain('data-testid="storyboard-panel-list"')
  })

  it('mounts the panel list only when the group is expanded', () => {
    const html = renderGroup({ isPanelListExpanded: true })
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain('data-testid="storyboard-panel-list"')
    expect(html).toContain('id="storyboard-panel-list-storyboard-1"')
  })
})
