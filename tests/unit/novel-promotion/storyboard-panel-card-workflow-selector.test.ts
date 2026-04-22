import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'

vi.mock('@/components/ui/icons', () => ({
  AppIcon: (props: { className?: string; name?: string }) =>
    createElement('span', { className: props.className, 'data-icon': props.name }),
}))

vi.mock('@/components/ui/primitives', () => ({
  GlassSurface: (props: { children?: React.ReactNode; className?: string }) =>
    createElement('div', { className: props.className }, props.children),
}))

vi.mock('@/components/ui/config-modals/ModelCapabilityDropdown', () => ({
  ModelCapabilityDropdown: (props: { value?: string; placeholder?: string }) =>
    createElement('div', {
      'data-testid': 'storyboard-workflow-dropdown',
      'data-value': props.value || '',
      'data-placeholder': props.placeholder || '',
    }),
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/ImageSection', () => ({
  default: () => createElement('div', null, 'image-section'),
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/PanelActionButtons', () => ({
  default: () => createElement('div', null, 'panel-actions'),
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/PanelEditForm', () => ({
  __esModule: true,
  default: () => createElement('div', null, 'panel-form'),
}))

const messages = {
  storyboard: {
    panelActions: {
      deleteShot: '删除镜头',
    },
  },
} as const

const TestIntlProvider = NextIntlClientProvider as React.ComponentType<{
  locale: string
  messages: AbstractIntlMessages
  timeZone: string
  children?: React.ReactNode
}>

function renderWithIntl(node: React.ReactElement) {
  return renderToStaticMarkup(
    createElement(
      TestIntlProvider,
      {
        locale: 'zh',
        messages: messages as unknown as AbstractIntlMessages,
        timeZone: 'Asia/Shanghai',
      },
      node,
    ),
  )
}

describe('Storyboard panel workflow selector', () => {
  it('renders the panel image workflow selector with default project workflow', async () => {
    Reflect.set(globalThis, 'React', React)
    const PanelCard = (await import('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/PanelCard')).default

    const html = renderWithIntl(
      createElement(PanelCard, {
        panel: {
          id: 'panel-1',
          panelIndex: 0,
          panel_number: 1,
          shot_type: '近景',
          camera_move: '缓推',
          description: 'test',
          characters: [],
        },
        panelData: {
          id: 'panel-1',
          panelIndex: 0,
          panelNumber: 1,
          shotType: '近景',
          cameraMove: '缓推',
          description: 'test',
          location: null,
          characters: [],
          srtStart: null,
          srtEnd: null,
          duration: null,
          imageModel: null,
          videoPrompt: null,
        },
        imageUrl: null,
        globalPanelNumber: 1,
        storyboardId: 'storyboard-1',
        videoRatio: '9:16',
        isSaving: false,
        isDeleting: false,
        isModifying: false,
        isSubmittingPanelImageTask: false,
        failedError: null,
        candidateData: null,
        storyboardWorkflowOptions: [
          {
            value: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
            label: 'Flux2Klein 文生图',
            provider: 'comfyui',
            providerName: 'ComfyUI (Local)',
          },
        ],
        defaultImageWorkflow: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
        onUpdate: vi.fn(),
        onDelete: vi.fn(),
        onOpenCharacterPicker: vi.fn(),
        onOpenLocationPicker: vi.fn(),
        onRemoveCharacter: vi.fn(),
        onRemoveLocation: vi.fn(),
        onRegeneratePanelImage: vi.fn(),
        onOpenEditModal: vi.fn(),
        onOpenAIDataModal: vi.fn(),
        onSelectCandidateIndex: vi.fn(),
        onConfirmCandidate: vi.fn(async () => undefined),
        onCancelCandidate: vi.fn(),
        onClearError: vi.fn(),
      }),
    )

    expect(html).toContain('生图工作流')
    expect(html).toContain('data-testid="storyboard-workflow-dropdown"')
    expect(html).toContain('data-value="comfyui::baseimage/图片生成/Flux2Klein文生图"')
  })
})
