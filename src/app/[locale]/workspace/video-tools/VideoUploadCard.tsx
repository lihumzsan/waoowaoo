'use client'

import { useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES } from '@/lib/video-tools/trim-frames'
import type { UploadedVideo } from './video-tools-state'

type VideoUploadCardProps = {
  label: string
  description: string
  value: UploadedVideo | null
  uploading: boolean
  error: string | null
  disabled?: boolean
  onUpload: (file: File) => void
  onRemove: () => void
  selectLabel: string
  replaceLabel: string
  removeLabel: string
  uploadingLabel: string
  trimLabel: string
  trimHelp: string
  trimFrames: number | ''
  onTrimFramesChange: (value: number | '') => void
}

const ACCEPTED_VIDEO_TYPES = '.mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska'

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function VideoUploadCard(props: VideoUploadCardProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const openPicker = () => {
    if (!props.disabled && !props.uploading) inputRef.current?.click()
  }

  const acceptFile = (file: File | undefined) => {
    if (!file || props.disabled || props.uploading) return
    props.onUpload(file)
  }

  return (
    <section className="glass-surface overflow-hidden rounded-3xl border border-[var(--glass-stroke-base)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--glass-stroke-base)] px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-[var(--glass-text-primary)]">{props.label}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--glass-text-tertiary)]">{props.description}</p>
        </div>
        {props.value ? (
          <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600">
            {formatBytes(props.value.size)}
          </span>
        ) : null}
      </div>

      {props.value ? (
        <div className="p-4">
          <div className="overflow-hidden rounded-2xl border border-[var(--glass-stroke-base)] bg-black">
            <video
              key={props.value.url}
              src={props.value.url}
              controls
              preload="metadata"
              className="aspect-video w-full object-contain"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--glass-text-primary)]">{props.value.name}</p>
              <p className="mt-0.5 text-xs text-[var(--glass-text-tertiary)]">{props.value.mimeType}</p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={openPicker}
                disabled={props.disabled || props.uploading}
                className="glass-btn-base px-3 py-2 text-xs disabled:opacity-50"
              >
                <AppIcon name="refresh" className="h-3.5 w-3.5" />
                {props.replaceLabel}
              </button>
              <button
                type="button"
                onClick={props.onRemove}
                disabled={props.disabled || props.uploading}
                className="glass-btn-base px-3 py-2 text-xs text-red-600 disabled:opacity-50"
              >
                <AppIcon name="trash" className="h-3.5 w-3.5" />
                {props.removeLabel}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={openPicker}
          onDragEnter={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            event.preventDefault()
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            acceptFile(event.dataTransfer.files[0])
          }}
          disabled={props.disabled || props.uploading}
          className={`m-4 flex min-h-64 w-[calc(100%-2rem)] flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-10 text-center transition-all disabled:cursor-not-allowed disabled:opacity-60 ${dragging
            ? 'border-[var(--glass-tone-info-fg)] bg-[var(--glass-tone-info-bg)]'
            : 'border-[var(--glass-stroke-strong)] bg-[var(--glass-bg-muted)] hover:border-[var(--glass-tone-info-fg)]/60'
          }`}
        >
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500/15 to-violet-500/15 text-[var(--glass-tone-info-fg)]">
            <AppIcon name={props.uploading ? 'loader' : 'cloudUpload'} className={`h-7 w-7 ${props.uploading ? 'animate-spin' : ''}`} />
          </span>
          <span className="text-sm font-semibold text-[var(--glass-text-primary)]">
            {props.uploading ? props.uploadingLabel : props.selectLabel}
          </span>
          <span className="mt-2 text-xs text-[var(--glass-text-tertiary)]">MP4 / MOV / WEBM / MKV · 256 MB</span>
        </button>
      )}

      <div className="mx-4 mb-4 rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-4">
        <label className="block text-xs font-semibold text-[var(--glass-text-secondary)]">
          {props.trimLabel}
          <input
            type="number"
            min={0}
            max={VIDEO_SEAM_CONCAT_MAX_TRIM_FRAMES}
            step={1}
            value={props.trimFrames}
            disabled={props.disabled || props.uploading}
            onChange={(event) => {
              const value = event.currentTarget.value
              props.onTrimFramesChange(value === '' ? '' : Number(value))
            }}
            className="mt-2 w-full rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)] px-3 py-2 text-sm text-[var(--glass-text-primary)] outline-none transition-colors focus:border-[var(--glass-tone-info-fg)] disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        <p className="mt-2 text-xs leading-5 text-[var(--glass-text-tertiary)]">{props.trimHelp}</p>
      </div>

      {props.error ? (
        <p className="mx-4 mb-4 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-600">
          {props.error}
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_VIDEO_TYPES}
        className="hidden"
        onChange={(event) => {
          acceptFile(event.target.files?.[0])
          event.target.value = ''
        }}
      />
    </section>
  )
}
