export interface EnterSubmitKeyboardEvent {
  readonly key: string
  readonly shiftKey: boolean
  readonly repeat?: boolean
  readonly nativeEvent?: {
    readonly isComposing?: boolean
  }
  preventDefault: () => void
}

export function shouldSubmitFromEnterKey(event: EnterSubmitKeyboardEvent): boolean {
  return event.key === 'Enter'
    && !event.shiftKey
    && event.repeat !== true
    && event.nativeEvent?.isComposing !== true
}

export function submitFromEnterKey(
  event: EnterSubmitKeyboardEvent,
  submit: () => void,
): boolean {
  if (!shouldSubmitFromEnterKey(event)) return false
  event.preventDefault()
  submit()
  return true
}
