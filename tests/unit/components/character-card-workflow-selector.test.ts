import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'

const idleMutation = {
  isPending: false,
  mutate: vi.fn(),
}

vi.mock('@/lib/query/mutations', () => ({
  useGenerateCharacterImage: () => idleMutation,
  useSelectCharacterImage: () => idleMutation,
  useUndoCharacterImage: () => idleMutation,
  useUploadCharacterImage: () => idleMutation,
  useDeleteCharacter: () => idleMutation,
  useDeleteCharacterAppearance: () => idleMutation,
  useUploadCharacterVoice: () => idleMutation,
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: (props: { className?: string; name?: string }) =>
    createElement('span', { className: props.className, 'data-icon': props.name }),
}))

vi.mock('@/components/task/TaskStatusOverlay', () => ({
  default: () => createElement('div', null, 'overlay'),
}))

vi.mock('@/components/task/TaskStatusInline', () => ({
  default: () => createElement('span', null, 'inline'),
}))

vi.mock('@/components/media/MediaImageWithLoading', () => ({
  MediaImageWithLoading: (props: { containerClassName?: string; className?: string }) =>
    createElement('div', {
      className: [props.containerClassName, props.className].filter(Boolean).join(' '),
    }),
}))

vi.mock('@/components/image-generation/ImageGenerationInlineCountButton', () => ({
  default: () => createElement('button', null, 'count'),
}))

vi.mock('@/lib/task/presentation', () => ({
  resolveTaskPresentationState: () => null,
}))

vi.mock('@/lib/image-generation/use-image-generation-count', () => ({
  useImageGenerationCount: () => ({
    count: 1,
    setCount: vi.fn(),
  }),
}))

vi.mock('@/lib/image-generation/count', () => ({
  getImageGenerationCountOptions: () => [{ value: 1, label: '1' }],
}))

vi.mock('@/app/[locale]/workspace/asset-hub/components/VoiceSettings', () => ({
  default: () => createElement('div', null, 'voice-settings'),
}))

vi.mock('@/components/ui/config-modals/ModelCapabilityDropdown', () => ({
  ModelCapabilityDropdown: (props: { value?: string; placeholder?: string }) =>
    createElement('div', {
      'data-testid': 'character-workflow-dropdown',
      'data-value': props.value || '',
      'data-placeholder': props.placeholder || '',
    }),
}))

const messages = {
  assetHub: {
    generateFailed: '生成失败',
    selectFailed: '选择失败',
    uploadFailed: '上传失败',
    confirmDeleteCharacter: '确认删除角色',
    cancel: '取消',
    delete: '删除',
    characterWorkflowLabel: '生图工作流',
    characterWorkflowPlaceholder: '选择当前角色使用的文生图工作流',
    characterWorkflowSaving: '切换中...',
  },
  assets: {
    image: {
      generateCountPrefix: '生成',
      generateCountSuffix: '张',
      generating: '生成中',
      generatingPlaceholder: '正在生成',
      regenerateStuck: '重新生成',
      regenCountPrefix: '重生成',
      undo: '撤回',
      upload: '上传',
      uploadReplace: '替换',
      edit: '编辑',
      selectCount: '选择数量',
      confirmOption: '确认选择',
      optionNumber: '方案 {number}',
      deleteThis: '删除当前',
    },
    common: {
      generateFailed: '生成失败',
    },
    character: {
      deleteWhole: '删除整个角色',
      primary: '主形象',
      secondary: '子形象',
    },
    video: {
      panelCard: {
        editPrompt: '编辑',
      },
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

describe('CharacterCard workflow selector', () => {
  it('renders the image workflow selector when workflow options are available', async () => {
    Reflect.set(globalThis, 'React', React)
    const { CharacterCard } = await import('@/app/[locale]/workspace/asset-hub/components/CharacterCard')

    const html = renderWithIntl(
      createElement(CharacterCard, {
        character: {
          id: 'character-1',
          name: '陈迹',
          folderId: null,
          customVoiceUrl: null,
          appearances: [
            {
              id: 'appearance-1',
              appearanceIndex: 0,
              changeReason: '默认形象',
              description: '中年医生',
              imageUrl: null,
              imageUrls: [],
              selectedIndex: null,
              previousImageUrl: null,
              previousImageUrls: [],
              imageTaskRunning: false,
            },
          ],
        },
        characterWorkflowOptions: [
          {
            value: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
            label: 'Flux2Klein 文生图',
            provider: 'comfyui',
            providerName: 'ComfyUI (Local)',
          },
        ],
        selectedCharacterWorkflow: 'comfyui::baseimage/图片生成/Flux2Klein文生图',
      }),
    )

    expect(html).toContain('生图工作流')
    expect(html).toContain('data-testid="character-workflow-dropdown"')
    expect(html).toContain('data-value="comfyui::baseimage/图片生成/Flux2Klein文生图"')
  })
})
