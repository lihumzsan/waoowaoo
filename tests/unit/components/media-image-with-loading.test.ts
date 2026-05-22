import { describe, expect, it } from 'vitest'
import { isCurrentImageElement, readCompletedImageState } from '@/components/media/MediaImageWithLoading'

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
})
