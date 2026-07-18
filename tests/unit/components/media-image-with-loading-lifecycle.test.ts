import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'

const hookHarness = vi.hoisted(() => ({
  refValues: [] as unknown[],
  stateSetters: [] as Array<ReturnType<typeof vi.fn>>,
  effectCleanups: [] as Array<void | (() => void)>,
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      hookHarness.effectCleanups.push(effect())
    },
    useRef: () => ({ current: hookHarness.refValues.shift() }),
    useState: <T,>(initialValue: T) => {
      const setter = vi.fn()
      hookHarness.stateSetters.push(setter)
      return [initialValue, setter] as const
    },
  }
})

vi.mock('@/components/media/MediaImage', () => ({
  MediaImage: () => null,
}))

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []

  readonly observe = vi.fn()
  readonly disconnect = vi.fn()

  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this)
  }
}

describe('MediaImageWithLoading intersection lifecycle', () => {
  const container = {} as HTMLDivElement

  beforeEach(() => {
    hookHarness.refValues = [container, null]
    hookHarness.stateSetters = []
    hookHarness.effectCleanups = []
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('React', React)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('observes with a 300px margin, activates near the viewport, and disconnects', () => {
    vi.stubGlobal(
      'IntersectionObserver',
      FakeIntersectionObserver as unknown as typeof IntersectionObserver,
    )

    MediaImageWithLoading({ src: '/m/project/frame.png', alt: 'frame' })

    const observer = FakeIntersectionObserver.instances[0]
    expect(observer?.options).toEqual({ rootMargin: '300px' })
    expect(observer?.observe).toHaveBeenCalledWith(container)

    observer?.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    )
    expect(hookHarness.stateSetters[2]).toHaveBeenCalledWith(true)

    hookHarness.effectCleanups[1]?.()
    expect(observer?.disconnect).toHaveBeenCalledOnce()
  })

  it('activates the placeholder when IntersectionObserver is unsupported', () => {
    vi.stubGlobal('IntersectionObserver', undefined)

    MediaImageWithLoading({ src: '/m/project/frame.png', alt: 'frame' })

    expect(FakeIntersectionObserver.instances).toHaveLength(0)
    expect(hookHarness.stateSetters[2]).toHaveBeenCalledWith(true)
  })
})
