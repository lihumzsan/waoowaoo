import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  MediaImageWithLoading,
  isCurrentImageElement,
  readCompletedImageState,
  shouldAnimateImagePlaceholder,
} from '@/components/media/MediaImageWithLoading'
import { MediaImage } from '@/components/media/MediaImage'

vi.stubGlobal('React', React)

vi.mock('next/image', async () => {
  const ReactModule = await import('react')
  return {
    default: ReactModule.forwardRef<HTMLImageElement, {
      src: string
      alt: string
      unoptimized?: boolean
      sizes?: string
    }>(function MockNextImage({ src, alt, unoptimized, sizes }, ref) {
      return ReactModule.createElement('img', {
        ref,
        src,
        alt,
        'data-unoptimized': String(Boolean(unoptimized)),
        'data-sizes': sizes,
      })
    }),
  }
})

describe('MediaImageWithLoading', () => {
  it('marks a cached completed image as loaded', () => {
    expect(readCompletedImageState({ complete: true, naturalWidth: 1024 })).toEqual({
      isLoaded: true,
      isError: false,
    })
  })

  it('marks a completed broken image as loaded with error', () => {
    expect(readCompletedImageState({ complete: true, naturalWidth: 0 })).toEqual({
      isLoaded: true,
      isError: true,
    })
  })

  it('leaves a pending image unresolved', () => {
    expect(readCompletedImageState({ complete: false, naturalWidth: 0 })).toBeNull()
  })

  it('ignores load events from a previous image element after src switches', () => {
    const previousImage = {} as HTMLImageElement
    const currentImage = {} as HTMLImageElement

    expect(isCurrentImageElement(previousImage, currentImage)).toBe(false)
    expect(isCurrentImageElement(currentImage, currentImage)).toBe(true)
  })

  it('animates a loading placeholder only near the viewport', () => {
    expect(shouldAnimateImagePlaceholder(true, false)).toBe(false)
    expect(shouldAnimateImagePlaceholder(true, true)).toBe(true)
    expect(shouldAnimateImagePlaceholder(false, true)).toBe(false)
  })

  it('renders an offscreen loading placeholder without animation work', () => {
    const markup = renderToStaticMarkup(React.createElement(MediaImageWithLoading, {
      src: '/m/project/frame.png',
      alt: 'frame',
    }))

    expect(markup).not.toContain('animate-pulse')
    expect(markup).not.toContain('animate-spin')
  })

  it('allows Next.js to optimize stable media routes', () => {
    const markup = renderToStaticMarkup(React.createElement(MediaImage, {
      src: '/m/project/frame.png',
      alt: 'frame',
      sizes: '(max-width: 767px) 100vw, 33vw',
    }))

    expect(markup).toContain('data-unoptimized="false"')
    expect(markup).toContain('data-sizes="(max-width: 767px) 100vw, 33vw"')
  })
})
