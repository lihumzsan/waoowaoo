'use client'

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import { AppIcon } from '@/components/ui/icons'

interface ImageGenerationInlineCountButtonProps {
  prefix: ReactNode
  suffix?: ReactNode
  value: number
  options: number[]
  onValueChange: (value: number) => void
  onClick: () => void
  disabled?: boolean
  actionDisabled?: boolean
  selectDisabled?: boolean
  showCountControl?: boolean
  splitInteractiveZones?: boolean
  className?: string
  actionClassName?: string
  countClassName?: string
  selectClassName?: string
  labelClassName?: string
  ariaLabel: string
}

export default function ImageGenerationInlineCountButton({
  prefix,
  suffix,
  value,
  options,
  onValueChange,
  onClick,
  disabled = false,
  actionDisabled,
  selectDisabled,
  showCountControl = true,
  splitInteractiveZones = false,
  className = '',
  actionClassName = '',
  countClassName = '',
  selectClassName = '',
  labelClassName = '',
  ariaLabel,
}: ImageGenerationInlineCountButtonProps) {
  const isActionDisabled = disabled || actionDisabled === true
  const isSelectDisabled = disabled || selectDisabled === true
  const rootStateClassName = isActionDisabled
    ? 'opacity-60 cursor-not-allowed'
    : 'cursor-pointer'
  const selectStateClassName = isSelectDisabled
    ? 'pointer-events-none opacity-70'
    : 'cursor-pointer'
  const resolvedActionClassName = (actionClassName || className).trim()

  if (!showCountControl) {
    return (
      <button
        type="button"
        onClick={() => {
          if (isActionDisabled) return
          onClick()
        }}
        disabled={isActionDisabled}
        aria-label={ariaLabel}
        className={`${resolvedActionClassName} ${rootStateClassName}`.trim()}
      >
        <span className={`${labelClassName} inline-flex items-center gap-1 whitespace-nowrap`.trim()}>{prefix}</span>
      </button>
    )
  }

  if (splitInteractiveZones) {
    return (
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            if (isActionDisabled) return
            onClick()
          }}
          disabled={isActionDisabled}
          aria-label={ariaLabel}
          className={`${resolvedActionClassName} ${rootStateClassName}`.trim()}
        >
          <span className={`${labelClassName} inline-flex items-center gap-1 whitespace-nowrap`.trim()}>{prefix}</span>
        </button>
        <span
          className={`group relative inline-flex h-6 items-center gap-1 rounded-md px-1.5 transition-colors ${
            isSelectDisabled ? '' : 'hover:bg-white/12 focus-within:bg-white/14'
          } ${countClassName}`.trim()}
        >
          <select
            value={String(value)}
            onChange={(event) => onValueChange(Number(event.target.value))}
            aria-label={ariaLabel}
            disabled={isSelectDisabled}
            className={`${selectClassName} ${selectStateClassName}`.trim()}
          >
            {options.map((option) => (
              <option key={option} value={option} className="text-black">
                {option}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-1 flex items-center text-current opacity-85 transition-colors group-hover:opacity-100 group-focus-within:opacity-100">
            <AppIcon name="chevronDown" className="h-3 w-3" />
          </span>
          {suffix ? (
            <span className={`${labelClassName} whitespace-nowrap pr-4`.trim()}>{suffix}</span>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <div
      role="button"
      tabIndex={isActionDisabled ? -1 : 0}
      onClick={() => {
        if (isActionDisabled) return
        onClick()
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (isActionDisabled) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      aria-disabled={isActionDisabled}
      className={`${className} ${rootStateClassName}`.trim()}
    >
      <span className={`${labelClassName} inline-flex shrink-0 items-center whitespace-nowrap leading-none`.trim()}>{prefix}</span>
      <span
        className={`group relative inline-flex h-8 shrink-0 items-center rounded-full bg-white/12 px-2 transition-colors ${
          isSelectDisabled ? '' : 'hover:bg-white/16 focus-within:bg-white/18'
        }`}
        onClick={(event: MouseEvent<HTMLSpanElement>) => event.stopPropagation()}
      >
        <select
          value={String(value)}
          onChange={(event) => onValueChange(Number(event.target.value))}
          aria-label={ariaLabel}
          disabled={isSelectDisabled}
          className={`${selectClassName} ${selectStateClassName}`.trim()}
        >
          {options.map((option) => (
            <option key={option} value={option} className="text-black">
              {option}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-current opacity-85 transition-colors group-hover:opacity-100 group-focus-within:opacity-100">
          <AppIcon name="chevronDown" className="h-3 w-3" />
        </span>
      </span>
      <span className={`${labelClassName} inline-flex shrink-0 items-center whitespace-nowrap leading-none`.trim()}>{suffix}</span>
    </div>
  )
}
