import { describe, expect, it } from 'vitest'
import { readCompletedImageState } from '@/components/media/MediaImageWithLoading'

function imageState(input: { complete: boolean; naturalWidth: number }): Pick<HTMLImageElement, 'complete' | 'naturalWidth'> {
  return input
}

describe('MediaImageWithLoading', () => {
  it('treats an already cached successful image as loaded', () => {
    expect(readCompletedImageState(imageState({
      complete: true,
      naturalWidth: 1200,
    }))).toBe('loaded')
  })

  it('treats an already completed broken image as error', () => {
    expect(readCompletedImageState(imageState({
      complete: true,
      naturalWidth: 0,
    }))).toBe('error')
  })

  it('keeps an incomplete image pending', () => {
    expect(readCompletedImageState(imageState({
      complete: false,
      naturalWidth: 0,
    }))).toBe('pending')
  })
})
