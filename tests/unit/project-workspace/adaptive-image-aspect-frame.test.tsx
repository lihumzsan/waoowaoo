import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import type { AbstractIntlMessages } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import {
  AdaptiveImageAspectFrame,
  imageThumbnailAspectRatio,
  resolveImageFrameAspectRatio,
} from '@/features/project-workspace/canvas/nodes/AdaptiveImageAspectFrame'
import type { WorkspaceCanvasNodeData } from '@/features/project-workspace/canvas/node-canvas-types'

vi.mock('@xyflow/react', () => ({
  Handle: (props: { type?: string }) => createElement('span', { 'data-handle': props.type }),
  Position: {
    Left: 'left',
    Right: 'right',
  },
}))

vi.mock('@/components/ui/ImagePreviewModal', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/components/task/EstimatedTaskProgressOverlay', () => ({
  EstimatedTaskProgressInline: () => null,
}))

vi.mock('@/components/media/MediaGenerationLoading', () => ({
  __esModule: true,
  default: () => null,
}))

vi.mock('@/components/media/MediaImageWithLoading', () => ({
  MediaImageWithLoading: (props: {
    src: string
    alt: string
    className?: string
    containerClassName?: string
    onLoad?: React.ReactEventHandler<HTMLImageElement>
  }) => createElement('img', {
    src: props.src,
    alt: props.alt,
    className: [props.containerClassName, props.className].filter(Boolean).join(' '),
    onLoad: props.onLoad,
  }),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: (props: { name?: string; className?: string }) =>
    createElement('span', { 'data-icon': props.name, className: props.className }),
}))

const messages = {
  projectWorkflow: {
    canvas: {
      workspace: {
        nodeFields: {
          expandDetails: '展开',
          itemCount: '{count} 项',
          styleSummary: '风格总结',
          rawUserStyle: '用户风格',
          visualPolicy: '画面策略',
          colorPrompt: '色彩',
          lightingPrompt: '光线',
          texturePrompt: '质感',
          compositionPrompt: '构图',
          imageFilterPrompt: '画面滤镜',
          cameraPolicy: '镜头策略',
          movementPrompt: '运镜',
          lensAndDepthPrompt: '镜头与景深',
          videoRhythmPrompt: '视频节奏',
          soundPolicy: '声音策略',
          soundFilterPrompt: '声音滤镜',
        },
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

describe('adaptive image aspect frame', () => {
  it('computes source image ratios and rejects invalid image dimensions', () => {
    expect(imageThumbnailAspectRatio({ naturalWidth: 2400, naturalHeight: 1000 })).toBe('2400 / 1000')
    expect(imageThumbnailAspectRatio({ naturalWidth: 0, naturalHeight: 1000 })).toBeNull()
    expect(imageThumbnailAspectRatio({ naturalWidth: 2400, naturalHeight: 0 })).toBeNull()
    expect(resolveImageFrameAspectRatio(2.4)).toBe('2.4')
    expect(resolveImageFrameAspectRatio(null)).toBe('16 / 9')
  })

  it('renders children inside an aspect-ratio frame with full-image containment', () => {
    const html = renderToStaticMarkup(
      <AdaptiveImageAspectFrame
        sourceKey="style-reference.png"
        initialAspectRatio={2.4}
        className="relative w-full overflow-hidden"
      >
        {({ onImageLoad }) => createElement('img', {
          src: 'https://example.com/style-reference.png',
          alt: 'Style reference',
          className: 'h-full w-full object-contain',
          onLoad: onImageLoad,
        })}
      </AdaptiveImageAspectFrame>,
    )

    expect(html).toContain('style="aspect-ratio:2.4"')
    expect(html).toContain('object-contain')
  })

  it('renders Style Bible previews through an adaptive frame instead of the fixed media preview height', async () => {
    Reflect.set(globalThis, 'React', React)
    const { default: WorkspaceNode } = await import('@/features/project-workspace/canvas/nodes/WorkspaceNode')
    const data: WorkspaceCanvasNodeData = {
      nodeId: 'edit-style-bible:bible-1',
      projectId: 'project-1',
      kind: 'editStyleBible',
      mediaLoadingContext: { styleImageUrl: 'https://example.com/style.png' },
      layoutNodeType: 'editStyleBible',
      targetType: 'editStyleBible',
      targetId: 'bible-1',
      title: 'Style Bible',
      eyebrow: '风格圣经',
      body: '非真人的高质感暗黑3D动画方案。',
      meta: 'ready',
      statusLabel: '已就绪',
      width: 420,
      height: 420,
      previewImageUrl: 'https://example.com/style-reference.png',
      previewAspectRatio: null,
      styleBibleDetails: {
        rawUserStyle: null,
        styleSummary: '非真人的高质感暗黑3D动画方案。',
        visual: {},
        camera: {},
        sound: {},
      },
    }

    const html = renderToStaticMarkup(
      createElement(
        TestIntlProvider,
        {
          locale: 'zh',
          messages: messages as unknown as AbstractIntlMessages,
          timeZone: 'Asia/Shanghai',
        },
        createElement(WorkspaceNode as React.ComponentType<{ readonly data: WorkspaceCanvasNodeData }>, { data }),
      ),
    )

    expect(html).toContain('src="https://example.com/style-reference.png"')
    expect(html).toContain('style="aspect-ratio:16 / 9"')
    expect(html).toContain('object-contain')
    expect(html).not.toContain('height:118px')
  })
})
