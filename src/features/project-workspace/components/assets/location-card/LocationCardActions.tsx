'use client'

import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import type { TaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'

interface LocationCardActionsProps {
  selectedIndex: number | null
  isConfirmingSelection: boolean
  confirmingSelectionState: TaskPresentationState | null
  onConfirmSelection?: () => void
}

export default function LocationCardActions(props: LocationCardActionsProps) {
  const t = useTranslations('assets')
  return (
    <>
      <div className="mt-3 text-xs text-[var(--glass-text-tertiary)] text-center">{t('image.selectTip')}</div>
      {props.selectedIndex !== null && props.onConfirmSelection && (
        <div className="mt-4 flex justify-end">
          <button onClick={props.onConfirmSelection} disabled={props.isConfirmingSelection} className="px-4 py-2 text-sm bg-[var(--glass-tone-success-fg)] text-white rounded-lg disabled:opacity-50 flex items-center gap-2">
            {props.isConfirmingSelection
              ? <TaskStatusInline state={props.confirmingSelectionState} className="text-white [&>span]:text-white [&_svg]:text-white" />
              : <><AppIcon name="check" className="w-4 h-4" />{t('image.confirmOption', { number: props.selectedIndex + 1 })}<span className="text-xs opacity-75">{t('image.deleteOthersHint')}</span></>}
          </button>
        </div>
      )}
    </>
  )
}
