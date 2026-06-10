import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'

const uploadMutationMock = vi.hoisted(() => ({
  isPending: false,
  mutate: vi.fn(),
}))
const locationCardActionsMock = vi.hoisted(() => vi.fn((props: unknown) => {
  void props
  return null
}))

vi.mock('@/lib/query/mutations', () => ({
  useUploadProjectLocationImage: () => uploadMutationMock,
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/location-card/LocationCardHeader', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/location-card/LocationCardActions', () => ({
  __esModule: true,
  default: (props: unknown) => {
    locationCardActionsMock(props)
    return null
  },
}))

vi.mock('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/location-card/LocationImageList', () => ({
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
      optionSelected: 'selected {number}',
      selectFirst: 'select first',
      generatedProgress: '{generated}/{total}',
      regenCountPrefix: 'regenerate',
      undo: 'undo',
    },
    location: {
      delete: 'delete location',
    },
    prop: {
      delete: 'delete prop',
    },
  },
} as const

const TestIntlProvider = NextIntlClientProvider as React.ComponentType<{
  locale: string
  messages: AbstractIntlMessages
  timeZone: string
  children?: React.ReactNode
}>

describe('LocationCard confirm selection', () => {
  it('passes the currently selected image index to the confirm callback', async () => {
    Reflect.set(globalThis, 'React', React)
    locationCardActionsMock.mockClear()
    const onConfirmSelection = vi.fn()
    const { default: LocationCard } = await import('@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/LocationCard')

    renderToStaticMarkup(
      createElement(
        TestIntlProvider,
        {
          locale: 'zh',
          messages: messages as unknown as AbstractIntlMessages,
          timeZone: 'Asia/Shanghai',
        },
        createElement(LocationCard, {
          location: {
            id: 'location-1',
            name: 'Clinic',
            summary: 'hospital interior',
            selectedImageId: 'location-image-2',
            images: [
              {
                id: 'location-image-1',
                imageIndex: 0,
                description: 'option 1',
                imageUrl: 'https://example.com/location-1.png',
                previousImageUrl: null,
                previousDescription: null,
                isSelected: false,
              },
              {
                id: 'location-image-2',
                imageIndex: 1,
                description: 'option 2',
                imageUrl: 'https://example.com/location-2.png',
                previousImageUrl: null,
                previousDescription: null,
                isSelected: true,
              },
            ],
          },
          assetType: 'location',
          onEdit: () => undefined,
          onDelete: () => undefined,
          onRegenerate: () => undefined,
          onGenerate: () => undefined,
          onImageClick: () => undefined,
          projectId: 'project-1',
          onConfirmSelection,
        }),
      ),
    )

    const actionsProps = locationCardActionsMock.mock.calls[0]?.[0] as { onConfirmSelection?: () => void } | undefined
    actionsProps?.onConfirmSelection?.()

    expect(onConfirmSelection).toHaveBeenCalledWith('location-1', 1)
  })
})
