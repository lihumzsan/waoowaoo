import { afterEach, describe, expect, it } from 'vitest'
import { writeClipboardText } from '@/lib/browser/clipboard'

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')

afterEach(() => {
  if (originalNavigatorDescriptor) {
    Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'navigator')
  }
  if (originalDocumentDescriptor) {
    Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'document')
  }
})

describe('writeClipboardText', () => {
  it('copies through the document fallback when the Clipboard API is unavailable', async () => {
    let copiedText: string | null = null
    let textareaValue = ''
    const textarea = {
      get value() {
        return textareaValue
      },
      set value(value: string) {
        textareaValue = value
      },
      style: {},
      setAttribute: () => undefined,
      focus: () => undefined,
      select: () => undefined,
      remove: () => undefined,
    }
    const documentFallback = {
      activeElement: null,
      body: {
        appendChild: () => textarea,
      },
      createElement: (tagName: string) => {
        if (tagName !== 'textarea') throw new Error(`unexpected element: ${tagName}`)
        return textarea
      },
      execCommand: (command: string) => {
        if (command !== 'copy') return false
        copiedText = textarea.value
        return true
      },
      getSelection: () => null,
    }

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {},
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: documentFallback,
    })

    await writeClipboardText('局域网复制内容')

    expect(copiedText).toBe('局域网复制内容')
  })

  it('falls back when the Clipboard API rejects the write', async () => {
    let copiedText: string | null = null
    const textarea = {
      value: '',
      style: {},
      setAttribute: () => undefined,
      focus: () => undefined,
      select: () => undefined,
      remove: () => undefined,
    }
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error('insecure context')
          },
        },
      },
    })
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        activeElement: null,
        body: { appendChild: () => textarea },
        createElement: () => textarea,
        execCommand: () => {
          copiedText = textarea.value
          return true
        },
        getSelection: () => null,
      },
    })

    await writeClipboardText('fallback after rejection')

    expect(copiedText).toBe('fallback after rejection')
  })
})
