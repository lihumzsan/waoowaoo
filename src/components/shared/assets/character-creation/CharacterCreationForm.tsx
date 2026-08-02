'use client'

import { useTranslations } from 'next-intl'

interface CharacterCreationFormProps {
  name: string
  setName: (value: string) => void
  description: string
  setDescription: (value: string) => void
}

export default function CharacterCreationForm({
  name,
  setName,
  description,
  setDescription,
}: CharacterCreationFormProps) {
  const t = useTranslations('assetModal')

  return (
    <div className="space-y-5">
      <div className="space-y-2">
          <label className="glass-field-label block">
            {t('character.name')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('character.namePlaceholder')}
            className="glass-input-base w-full px-3 py-2 text-sm"
          />
      </div>

      <div className="space-y-2">
        <label className="glass-field-label block">
          {t('character.description')}{' '}
          <span className="text-[var(--glass-tone-danger-fg)]">*</span>
        </label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={6}
          placeholder={t('character.descPlaceholder')}
          className="glass-textarea-base w-full px-3 py-2 text-sm resize-none"
        />
      </div>
    </div>
  )
}
