'use client'

import { useCallback, useRef, type ReactNode } from 'react'

/**
 * Headless native file picker: `open()` triggers the OS file dialog directly
 * (filtered by `accept`), and every selection lands in `onFiles`. There is no
 * intermediate confirmation surface — the attach affordance IS the picker.
 */
export function useAttachmentFilePicker({
  accept,
  multiple = true,
  disabled = false,
  onFiles,
}: {
  readonly accept: string
  readonly multiple?: boolean
  readonly disabled?: boolean
  readonly onFiles: (files: readonly File[]) => void
}): { readonly input: ReactNode; readonly open: () => void } {
  const inputRef = useRef<HTMLInputElement>(null)
  const open = useCallback(() => {
    if (!disabled) inputRef.current?.click()
  }, [disabled])
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      disabled={disabled}
      className="hidden"
      onChange={(event) => {
        const files = Array.from(event.target.files ?? [])
        // Reset so picking the same file again still fires onChange.
        event.target.value = ''
        if (files.length > 0) onFiles(files)
      }}
    />
  )
  return { input, open }
}
