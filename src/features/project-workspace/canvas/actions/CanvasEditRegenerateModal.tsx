'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useTranslations } from 'next-intl'
import GlassModalShell from '@/components/ui/primitives/GlassModalShell'
import type {
  CreativeResourceJsonObject,
  CreativeResourceJsonValue,
} from '@/lib/creative-resource/contracts'
import type { WorkspaceCanvasResourceOperationView } from '../contracts/workspace-canvas-interactions'

function isRecord(value: unknown): value is CreativeResourceJsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readPath(root: CreativeResourceJsonObject, path: readonly string[]): CreativeResourceJsonValue | undefined {
  let current: CreativeResourceJsonValue | undefined = root
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function replacePath(
  root: CreativeResourceJsonObject,
  path: readonly string[],
  value: CreativeResourceJsonValue,
): CreativeResourceJsonObject {
  const [head, ...tail] = path
  if (!head) return root
  if (tail.length === 0) return { ...root, [head]: value }
  const child = root[head]
  if (!isRecord(child)) throw new Error('CANVAS_EDITABLE_INPUT_PATH_INVALID')
  return { ...root, [head]: replacePath(child, tail, value) }
}

function applyEdit(params: {
  readonly input: CreativeResourceJsonObject
  readonly path: readonly string[]
  readonly text: string
  readonly count: number
}): CreativeResourceJsonObject {
  const withText = replacePath(params.input, params.path, params.text)
  const request = withText.request
  if (!isRecord(request)) throw new Error('CANVAS_EDIT_REQUEST_INVALID')
  return { ...withText, request: { ...request, count: params.count } }
}

export function CanvasEditRegenerateModal({
  operation,
  countRange,
  onSubmit,
  onClose,
}: {
  readonly operation: WorkspaceCanvasResourceOperationView
  readonly countRange: { readonly min: number; readonly max: number }
  readonly onSubmit: (operation: WorkspaceCanvasResourceOperationView) => void
  readonly onClose: () => void
}) {
  const t = useTranslations('projectWorkflow.canvas.workspace.actions.editModal')
  const path = useMemo(
    () => operation.editableInputPath ?? [],
    [operation.editableInputPath],
  )
  const initialText = useMemo(() => {
    const value = readPath(operation.input, path)
    return typeof value === 'string' ? value : ''
  }, [operation.input, path])
  const request = isRecord(operation.input.request) ? operation.input.request : null
  const initialCount = typeof request?.count === 'number' ? request.count : countRange.min
  const [text, setText] = useState(initialText)
  const [count, setCount] = useState(initialCount)
  const valid = path.length > 0
    && text.trim().length > 0
    && Number.isInteger(count)
    && count >= countRange.min
    && count <= countRange.max

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!valid) return
    onSubmit({
      ...operation,
      input: applyEdit({
        input: operation.input,
        path,
        text: text.trim(),
        count,
      }),
    })
  }

  return (
    <GlassModalShell
      open
      onClose={onClose}
      title={t('title')}
      description={t('description')}
      size="sm"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form="canvas-edit-regenerate-form" disabled={!valid} className="glass-btn-base glass-btn-primary px-4 py-2 text-sm disabled:opacity-50">
            {t('continue')}
          </button>
        </div>
      )}
    >
      <form id="canvas-edit-regenerate-form" className="space-y-4" onSubmit={submit}>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('instruction')}</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            className="glass-input-base w-full resize-y px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-[var(--glass-text-secondary)]">{t('count')}</span>
          <input
            type="number"
            min={countRange.min}
            max={countRange.max}
            step={1}
            value={count}
            onChange={(event) => setCount(
              Number.isFinite(event.target.valueAsNumber)
                ? event.target.valueAsNumber
                : countRange.min,
            )}
            className="glass-input-base w-full px-3 py-2 text-sm"
          />
        </label>
      </form>
    </GlassModalShell>
  )
}
