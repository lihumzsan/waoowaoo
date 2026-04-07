import { describe, expect, it } from 'vitest'
import { lockModalPageScroll } from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/storyboard/modal-scroll-lock'

describe('modal scroll lock', () => {
  it('locks page scroll while modal is open and restores previous styles on cleanup', () => {
    const doc = {
      body: {
        style: {
          overflow: 'auto',
        },
      },
      documentElement: {
        style: {
          overflow: 'scroll',
        },
      },
    }

    const restore = lockModalPageScroll(doc)

    expect(doc.body.style.overflow).toBe('hidden')
    expect(doc.documentElement.style.overflow).toBe('hidden')

    restore()

    expect(doc.body.style.overflow).toBe('auto')
    expect(doc.documentElement.style.overflow).toBe('scroll')
  })
})
