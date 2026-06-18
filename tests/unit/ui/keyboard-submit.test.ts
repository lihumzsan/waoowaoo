import { describe, expect, it, vi } from 'vitest'
import {
  shouldSubmitFromEnterKey,
  submitFromEnterKey,
  type EnterSubmitKeyboardEvent,
} from '@/lib/ui/keyboard-submit'

function keyboardEvent(input: {
  key: string
  shiftKey?: boolean
  isComposing?: boolean
  repeat?: boolean
}): EnterSubmitKeyboardEvent {
  const nativeEvent = input.isComposing === undefined
    ? {}
    : { isComposing: input.isComposing }
  const event: EnterSubmitKeyboardEvent = {
    key: input.key,
    shiftKey: input.shiftKey === true,
    nativeEvent,
    preventDefault: vi.fn(),
  }
  return input.repeat === undefined
    ? event
    : { ...event, repeat: input.repeat }
}

describe('keyboard enter submit helpers', () => {
  it('submits on Enter and prevents textarea newline insertion', () => {
    const event = keyboardEvent({ key: 'Enter' })
    const submit = vi.fn()

    expect(submitFromEnterKey(event, submit)).toBe(true)

    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('keeps Shift+Enter available for multiline input', () => {
    const event = keyboardEvent({ key: 'Enter', shiftKey: true })
    const submit = vi.fn()

    expect(submitFromEnterKey(event, submit)).toBe(false)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('does not submit while an IME composition is active', () => {
    const event = keyboardEvent({ key: 'Enter', isComposing: true })

    expect(shouldSubmitFromEnterKey(event)).toBe(false)
  })

  it('does not submit repeated Enter keydown events', () => {
    const event = keyboardEvent({ key: 'Enter', repeat: true })
    const submit = vi.fn()

    expect(submitFromEnterKey(event, submit)).toBe(false)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('ignores non-Enter keys', () => {
    const event = keyboardEvent({ key: 'a' })
    const submit = vi.fn()

    expect(submitFromEnterKey(event, submit)).toBe(false)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })
})
