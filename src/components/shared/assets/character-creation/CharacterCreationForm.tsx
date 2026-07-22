'use client'

import { useTranslations } from 'next-intl'

type Mode = 'asset-hub' | 'project'

interface AvailableCharacter {
  id: string
  name: string
  appearances: unknown[]
}

interface CharacterCreationFormProps {
  mode: Mode
  name: string
  setName: (value: string) => void
  description: string
  setDescription: (value: string) => void
  isSubAppearance: boolean
  setIsSubAppearance: (value: boolean) => void
  selectedCharacterId: string
  setSelectedCharacterId: (value: string) => void
  changeReason: string
  setChangeReason: (value: string) => void
  availableCharacters: AvailableCharacter[]
}

export default function CharacterCreationForm({
  mode,
  name,
  setName,
  description,
  setDescription,
  isSubAppearance,
  setIsSubAppearance,
  selectedCharacterId,
  setSelectedCharacterId,
  changeReason,
  setChangeReason,
  availableCharacters,
}: CharacterCreationFormProps) {
  const t = useTranslations('assetModal')

  return (
    <div className="space-y-5">
      {mode === 'project' && availableCharacters.length > 0 && (
        <div className="flex items-start gap-3 p-3 glass-surface-soft rounded-lg border border-[var(--glass-stroke-base)]">
          <input
            type="checkbox"
            id="isSubAppearance"
            checked={isSubAppearance}
            onChange={(event) => setIsSubAppearance(event.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-[var(--glass-stroke-base)] text-[var(--glass-tone-info-fg)]"
          />
          <label htmlFor="isSubAppearance" className="flex-1 text-sm cursor-pointer">
            <span className="font-medium text-[var(--glass-text-primary)]">{t('character.isSubAppearance')}</span>
            <p className="text-xs text-[var(--glass-text-secondary)] mt-0.5">{t('character.isSubAppearanceHint')}</p>
          </label>
        </div>
      )}

      {isSubAppearance && (
        <div className="space-y-2">
          <label className="glass-field-label block">
            {t('character.selectMainCharacter')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
          </label>
          <select
            value={selectedCharacterId}
            onChange={(event) => setSelectedCharacterId(event.target.value)}
            className="glass-select-base w-full px-3 py-2 text-sm"
          >
            <option value="">{t('character.selectCharacterPlaceholder')}</option>
            {availableCharacters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} ({t('character.appearancesCount', { count: character.appearances.length })})
              </option>
            ))}
          </select>
        </div>
      )}

      {isSubAppearance && (
        <div className="space-y-2">
          <label className="glass-field-label block">
            {t('character.changeReason')} <span className="text-[var(--glass-tone-danger-fg)]">*</span>
          </label>
          <input
            type="text"
            value={changeReason}
            onChange={(event) => setChangeReason(event.target.value)}
            placeholder={t('character.changeReasonPlaceholder')}
            className="glass-input-base w-full px-3 py-2 text-sm"
          />
        </div>
      )}

      {!isSubAppearance && (
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
      )}

      <div className="space-y-2">
        <label className="glass-field-label block">
          {isSubAppearance ? t('character.modifyDescription') : t('character.description')}{' '}
          <span className="text-[var(--glass-tone-danger-fg)]">*</span>
        </label>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={6}
          placeholder={isSubAppearance
            ? t('character.modifyDescriptionPlaceholder')
            : t('character.descPlaceholder')}
          className="glass-textarea-base w-full px-3 py-2 text-sm resize-none"
        />
      </div>
    </div>
  )
}
