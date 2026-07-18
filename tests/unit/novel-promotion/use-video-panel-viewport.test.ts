import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVideoPanelViewport } from '@/lib/novel-promotion/stages/video-stage-runtime/useVideoPanelViewport'

vi.mock('react', () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  useRef: <T,>(initialValue: T) => ({ current: initialValue }),
  useState: <T,>(initialValue: T) => [initialValue, vi.fn()] as const,
}))

describe('useVideoPanelViewport', () => {
  const frameQueue: Array<FrameRequestCallback> = []
  const order: string[] = []
  const scrollTo = vi.fn(() => order.push('scroll'))
  let nextFrameNumber = 1

  beforeEach(() => {
    frameQueue.length = 0
    order.length = 0
    nextFrameNumber = 1
    scrollTo.mockClear()
    vi.useFakeTimers()

    vi.stubGlobal('window', {
      scrollY: 100,
      scrollTo,
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const frameNumber = nextFrameNumber
        nextFrameNumber += 1
        frameQueue.push((timestamp) => {
          order.push(`raf-${frameNumber}`)
          callback(timestamp)
        })
        return frameNumber
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reveals before two animation frames and then scrolls using the mounted ref', () => {
    const revealPanel = vi.fn(() => order.push('reveal'))
    const viewport = useVideoPanelViewport({ revealPanel })

    viewport.locateVoiceLinePanel('story', 24)

    expect(revealPanel).toHaveBeenCalledWith('story-24')
    expect(order).toEqual(['reveal'])
    expect(frameQueue).toHaveLength(1)
    expect(scrollTo).not.toHaveBeenCalled()

    viewport.panelRefs.current.set('story-24', {
      getBoundingClientRect: () => ({ top: 300 }),
    } as HTMLDivElement)

    frameQueue.shift()?.(0)
    expect(order).toEqual(['reveal', 'raf-1'])
    expect(frameQueue).toHaveLength(1)
    expect(scrollTo).not.toHaveBeenCalled()

    frameQueue.shift()?.(16)
    expect(order).toEqual(['reveal', 'raf-1', 'raf-2', 'scroll'])
    expect(scrollTo).toHaveBeenCalledWith({ top: 260, behavior: 'smooth' })
  })

  it('does not scroll when the panel ref is still missing after two frames', () => {
    const revealPanel = vi.fn()
    const viewport = useVideoPanelViewport({ revealPanel })

    viewport.locateVoiceLinePanel('missing-story', 50)
    frameQueue.shift()?.(0)
    frameQueue.shift()?.(16)

    expect(revealPanel).toHaveBeenCalledWith('missing-story-50')
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
