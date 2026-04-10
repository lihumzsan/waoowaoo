'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'

interface AudioWorkflowOption {
  value: string
  label: string
  provider?: string
  providerName?: string
}

interface VoiceWorkflowSelectorProps {
  models: AudioWorkflowOption[]
  value?: string | null
  disabled?: boolean
  onChange: (modelKey: string) => void
}

export default function VoiceWorkflowSelector({
  models,
  value,
  disabled = false,
  onChange,
}: VoiceWorkflowSelectorProps) {
  const tConfig = useTranslations('configModal')
  const selectedLabel = useMemo(
    () => models.find((model) => model.value === value)?.label ?? '',
    [models, value],
  )

  return (
    <div className="min-w-[220px] max-w-[320px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[var(--glass-text-tertiary)]">
          {tConfig('audioModel')}
        </span>
        {selectedLabel ? (
          <span className="max-w-[140px] truncate text-[11px] text-[var(--glass-text-tertiary)]" title={selectedLabel}>
            {selectedLabel}
          </span>
        ) : null}
      </div>
      <div className={disabled ? 'pointer-events-none opacity-60' : ''}>
        <ModelCapabilityDropdown
          compact
          models={models}
          value={value || undefined}
          onModelChange={onChange}
          capabilityFields={[]}
          capabilityOverrides={{}}
          onCapabilityChange={() => {}}
          placeholder={tConfig('selectModel')}
          placementMode="downward"
        />
      </div>
    </div>
  )
}
