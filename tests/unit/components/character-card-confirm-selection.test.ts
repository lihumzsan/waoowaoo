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

const characterCardActionsMock = vi.hoisted(() => vi.fn((props: unknown) => {
  void props
  return null
}))

vi.mock('@/lib/query/mutations', () => ({
  useUploadProjectCharacterImage: () => idleMutation,
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/character-card/CharacterCardActions', () => ({
  __esModule: true,
  default: (props: unknown) => {
    characterCardActionsMock(props)
    return null
  },
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/character-card/CharacterCardGallery', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/character-card/CharacterCardHeader', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/VoiceSettings', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/components/image-generation/ImageGenerationInlineCountButton', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/components/task/TaskStatusInline', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: (props: { name?: string; className?: string }) =>
    createElement('span', { 'data-icon': props.name, className: props.className }),
}))

vi.mock('@/components/ui/icons/AISparklesIcon', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/lib/task/presentation', () => ({
  resolveTaskPresentationState: () => null,
}))

vi.mock('@/lib/image-generation/use-image-generation-count', () => ({
  useImageGenerationCount: () => ({
    count: 2,
    setCount: vi.fn(),
  }),
}))

vi.mock('@/lib/image-generation/count', () => ({
  getImageGenerationCountOptions: () => [{ value: 2, label: '2' }],
}))

const messages = {
  assets: {
    image: {
      regenCountPrefix: 'regenerate',
      undo: 'undo',
    },
    character: {
      delete: 'delete',
    },
  },
} as const

const TestIntlProvider = NextIntlClientProvider as React.ComponentType<{
  locale: string
  messages: AbstractIntlMessages
  timeZone: string
  children?: React.ReactNode
}>

describe('CharacterCard confirm selection', () => {
  it('passes the currently selected image index to the confirm callback', async () => {
    Reflect.set(globalThis, 'React', React)
    characterCardActionsMock.mockClear()
    const onConfirmSelection = vi.fn()
    const { default: CharacterCard } = await import('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/CharacterCard')

    renderToStaticMarkup(
      createElement(
        TestIntlProvider,
        {
          locale: 'zh',
          messages: messages as unknown as AbstractIntlMessages,
          timeZone: 'Asia/Shanghai',
        },
        createElement(CharacterCard, {
          character: {
            id: 'character-1',
            name: 'Doctor',
            customVoiceUrl: null,
            appearances: [],
          },
          appearance: {
            id: 'appearance-1',
            appearanceIndex: 0,
            changeReason: 'default',
            description: 'middle-aged doctor',
            descriptions: null,
            imageUrl: null,
            imageUrls: ['img-0', 'img-1'],
            previousImageUrl: null,
            previousImageUrls: [],
            previousDescription: null,
            previousDescriptions: null,
            selectedIndex: 1,
          },
          onEdit: () => undefined,
          onDelete: () => undefined,
          onRegenerate: () => undefined,
          onGenerate: () => undefined,
          onImageClick: () => undefined,
          showDeleteButton: false,
          projectId: 'project-1',
          onConfirmSelection,
        }),
      ),
    )

    const actionsProps = characterCardActionsMock.mock.calls[0]?.[0] as { onConfirmSelection?: () => void } | undefined
    actionsProps?.onConfirmSelection?.()

    expect(onConfirmSelection).toHaveBeenCalledWith('character-1', 'appearance-1', 1)
  })
})
