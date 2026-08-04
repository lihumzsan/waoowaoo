'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon, type AppIconName } from '@/components/ui/icons'
import { apiFetch } from '@/lib/api-fetch'
import { readClientApiError } from '@/lib/errors/client'
import { useToast } from '@/contexts/ToastContext'

type ModelOption = {
  value: string
  label: string
}

type ModelChoices = {
  llm: ModelOption[]
  image: ModelOption[]
  video: ModelOption[]
}

type ModelPreferences = {
  assistantModel: string
  imageModel: string
  videoModel: string
}

type ModelPreferenceKind = keyof ModelChoices

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readModelOptions(value: unknown, field: string): ModelOption[] {
  if (!isRecord(value) || !Array.isArray(value[field])) {
    throw new Error(`PLATFORM_MODEL_CHOICES_INVALID:${field}`)
  }
  return value[field].map((item, index) => {
    if (!isRecord(item)) throw new Error(`PLATFORM_MODEL_CHOICE_INVALID:${field}:${index}`)
    const optionValue = typeof item.value === 'string' ? item.value.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    if (!optionValue || !label) throw new Error(`PLATFORM_MODEL_CHOICE_INVALID:${field}:${index}`)
    return { value: optionValue, label }
  })
}

function readModelChoices(value: unknown): ModelChoices {
  return {
    llm: readModelOptions(value, 'llm'),
    image: readModelOptions(value, 'image'),
    video: readModelOptions(value, 'video'),
  }
}

function readPreferenceString(preference: Record<string, unknown>, field: string): string {
  const value = preference[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`PLATFORM_MODEL_PREFERENCE_INVALID:${field}`)
  }
  return value.trim()
}

function readModelPreferences(value: unknown): ModelPreferences {
  if (!isRecord(value) || !isRecord(value.preference)) {
    throw new Error('PLATFORM_MODEL_PREFERENCES_INVALID')
  }
  const preference = value.preference
  const characterModel = readPreferenceString(preference, 'characterModel')
  const locationModel = readPreferenceString(preference, 'locationModel')
  const editModel = readPreferenceString(preference, 'editModel')
  if (characterModel !== locationModel || characterModel !== editModel) {
    throw new Error('PLATFORM_IMAGE_MODEL_PREFERENCES_DIVERGED')
  }
  return {
    assistantModel: readPreferenceString(preference, 'assistantModel'),
    imageModel: characterModel,
    videoModel: readPreferenceString(preference, 'videoModel'),
  }
}

function assertSelectedOptionsExist(
  choices: ModelChoices,
  preferences: ModelPreferences,
): void {
  const selected = {
    llm: preferences.assistantModel,
    image: preferences.imageModel,
    video: preferences.videoModel,
  } satisfies Record<ModelPreferenceKind, string>
  for (const kind of Object.keys(selected) as ModelPreferenceKind[]) {
    if (!choices[kind].some((option) => option.value === selected[kind])) {
      throw new Error(`PLATFORM_MODEL_PREFERENCE_NOT_LISTED:${kind}`)
    }
  }
}

const MODEL_CARDS: ReadonlyArray<{
  kind: ModelPreferenceKind
  icon: AppIconName
  preferenceField: keyof ModelPreferences
}> = [
  { kind: 'llm', icon: 'brain', preferenceField: 'assistantModel' },
  { kind: 'image', icon: 'image', preferenceField: 'imageModel' },
  { kind: 'video', icon: 'video', preferenceField: 'videoModel' },
]

export default function PlatformModelPreferencesTab() {
  const t = useTranslations('profile.modelPreferences')
  const tc = useTranslations('common')
  const { showError, showToast } = useToast()
  const [choices, setChoices] = useState<ModelChoices | null>(null)
  const [preferences, setPreferences] = useState<ModelPreferences | null>(null)
  const [savingKind, setSavingKind] = useState<ModelPreferenceKind | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    setLoadFailed(false)
    try {
      const [modelsResponse, preferencesResponse] = await Promise.all([
        apiFetch('/api/user/models', { cache: 'no-store' }),
        apiFetch('/api/user-preference', { cache: 'no-store' }),
      ])
      if (!modelsResponse.ok) throw await readClientApiError(modelsResponse)
      if (!preferencesResponse.ok) throw await readClientApiError(preferencesResponse)
      const nextChoices = readModelChoices(await modelsResponse.json())
      const nextPreferences = readModelPreferences(await preferencesResponse.json())
      assertSelectedOptionsExist(nextChoices, nextPreferences)
      setChoices(nextChoices)
      setPreferences(nextPreferences)
    } catch (error) {
      setLoadFailed(true)
      showError(error, t('loadFailed'), () => { void load() })
    }
  }, [showError, t])

  useEffect(() => {
    void load()
  }, [load])

  const updatePreference = useCallback(async (kind: ModelPreferenceKind, modelKey: string) => {
    if (!preferences || savingKind) return
    setSavingKind(kind)
    try {
      const body = kind === 'llm'
        ? { assistantModel: modelKey }
        : kind === 'image'
          ? {
              characterModel: modelKey,
              locationModel: modelKey,
              editModel: modelKey,
            }
          : { videoModel: modelKey }
      const response = await apiFetch('/api/user-preference', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw await readClientApiError(response)
      const nextPreferences = readModelPreferences(await response.json())
      if (choices) assertSelectedOptionsExist(choices, nextPreferences)
      setPreferences(nextPreferences)
      showToast(t('saved'), 'success', 2500)
    } catch (error) {
      showError(error, t('saveFailed'))
    } finally {
      setSavingKind(null)
    }
  }, [choices, preferences, savingKind, showError, showToast, t])

  if (!choices || !preferences) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        {loadFailed ? (
          <>
            <p className="text-sm text-[var(--glass-text-secondary)]">{t('loadFailed')}</p>
            <button type="button" className="glass-button-secondary px-4 py-2 text-sm" onClick={() => { void load() }}>
              {t('retry')}
            </button>
          </>
        ) : (
          <>
            <AppIcon name="loader" className="h-5 w-5 animate-spin text-[var(--glass-text-tertiary)]" />
            <p className="text-sm text-[var(--glass-text-secondary)]">{tc('loading')}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-7">
        <h2 className="text-xl font-semibold text-[var(--glass-text-primary)]">{t('title')}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--glass-text-secondary)]">
          {t('description')}
        </p>
      </header>

      <div className="grid gap-4">
        {MODEL_CARDS.map(({ kind, icon, preferenceField }) => (
          <section
            key={kind}
            className="rounded-2xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] p-5"
          >
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--glass-bg-hover)] text-[var(--glass-text-primary)]">
                  <AppIcon name={icon} className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--glass-text-primary)]">{t(`${kind}.title`)}</h3>
                  <p className="mt-1 text-xs leading-5 text-[var(--glass-text-tertiary)]">{t(`${kind}.description`)}</p>
                </div>
              </div>

              <div className="relative w-full shrink-0 xl:w-72">
                <select
                  aria-label={t(`${kind}.title`)}
                  value={preferences[preferenceField]}
                  disabled={savingKind !== null}
                  onChange={(event) => { void updatePreference(kind, event.target.value) }}
                  className="glass-input-base h-11 w-full cursor-pointer appearance-none rounded-xl px-3 pr-10 text-sm text-[var(--glass-text-primary)] outline-none disabled:cursor-wait disabled:opacity-60"
                >
                  {choices[kind].map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[var(--glass-text-tertiary)]">
                  {savingKind === kind
                    ? <AppIcon name="loader" className="h-4 w-4 animate-spin" />
                    : <AppIcon name="chevronDown" className="h-4 w-4" />}
                </span>
              </div>
            </div>
          </section>
        ))}
      </div>

      <p className="mt-5 text-xs leading-5 text-[var(--glass-text-tertiary)]">{t('providerManaged')}</p>
    </div>
  )
}
