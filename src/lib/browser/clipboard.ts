/**
 * Copies text through the single browser clipboard boundary.
 *
 * The async Clipboard API is unavailable in insecure LAN HTTP contexts, so
 * the legacy document command remains the explicit local-browser fallback.
 */
export async function writeClipboardText(text: string): Promise<void> {
  let clipboardApiError: unknown = null

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch (error) {
      clipboardApiError = error
    }
  }

  try {
    copyTextThroughDocument(text)
  } catch (fallbackError) {
    throw new AggregateError(
      clipboardApiError === null
        ? [fallbackError]
        : [clipboardApiError, fallbackError],
      'CLIPBOARD_WRITE_FAILED',
    )
  }
}

function copyTextThroughDocument(text: string): void {
  if (
    typeof document === 'undefined'
    || !document.body
    || typeof document.execCommand !== 'function'
  ) {
    throw new Error('CLIPBOARD_DOCUMENT_FALLBACK_UNAVAILABLE')
  }

  const textarea = document.createElement('textarea')
  const activeElement = document.activeElement
  const selection = document.getSelection()
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
    : []

  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.inset = '0 auto auto 0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'

  let copied = false
  document.body.appendChild(textarea)
  try {
    textarea.focus()
    textarea.select()
    copied = document.execCommand('copy')
  } finally {
    textarea.remove()
    if (selection) {
      selection.removeAllRanges()
      for (const range of selectedRanges) selection.addRange(range)
    }
    if (typeof HTMLElement !== 'undefined' && activeElement instanceof HTMLElement) {
      activeElement.focus({ preventScroll: true })
    }
  }

  if (!copied) throw new Error('CLIPBOARD_DOCUMENT_COPY_REJECTED')
}
