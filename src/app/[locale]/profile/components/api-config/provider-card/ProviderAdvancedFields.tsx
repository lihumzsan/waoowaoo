'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { getProviderKey, isPresetComingSoonModel, type CustomModel } from '../types'
import type { UseProviderCardStateResult } from './hooks/useProviderCardState'
import type {
  ProviderCardModelType,
  ProviderCardProps,
  ProviderCardTranslator,
} from './types'

interface ProviderAdvancedFieldsProps {
  provider: ProviderCardProps['provider']
  onToggleModel: ProviderCardProps['onToggleModel']
  onDeleteModel: ProviderCardProps['onDeleteModel']
  onUpdateModel: ProviderCardProps['onUpdateModel']
  t: ProviderCardTranslator
  state: UseProviderCardStateResult
}

function providerHasCredentials(provider: ProviderCardProps['provider']): boolean {
  const key = getProviderKey(provider.id)
  if (key === 'comfyui') return !!(provider.hasApiKey || provider.baseUrl?.trim())
  return !!provider.hasApiKey
}

const TypeIcon = ({
  type,
  className = 'w-4 h-4',
}: {
  type: ProviderCardModelType
  className?: string
}) => {
  switch (type) {
    case 'llm':
      return (
        <AppIcon name="menu" className={className} />
      )
    case 'image':
      return (
        <AppIcon name="image" className={className} />
      )
    case 'video':
      return (
        <AppIcon name="video" className={className} />
      )
    case 'audio':
      return (
        <AppIcon name="audioWave" className={className} />
      )
  }
}

const typeLabel = (type: ProviderCardModelType, t: ProviderCardTranslator) => {
  switch (type) {
    case 'llm':
      return t('typeText')
    case 'image':
      return t('typeImage')
    case 'video':
      return t('typeVideo')
    case 'audio':
      return t('typeAudio')
  }
}

const MODEL_TYPES: readonly ProviderCardModelType[] = ['llm', 'image', 'video', 'audio']

type ComfyUiWorkflowParts = {
  root: string
  category: string
  workflow: string
}

type ComfyUiCategoryGroup = {
  key: string
  root: string
  category: string
  models: CustomModel[]
}

export function parseComfyUiWorkflowParts(modelId: string): ComfyUiWorkflowParts | null {
  const segments = modelId
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length < 3) return null

  const [root, category, ...workflowParts] = segments
  const workflow = workflowParts.join('/').trim()
  if (!root || !category || !workflow) return null

  return {
    root,
    category,
    workflow,
  }
}

export function groupComfyUiModelsByCategory(models: CustomModel[]): ComfyUiCategoryGroup[] {
  const groups = new Map<string, ComfyUiCategoryGroup>()

  for (const model of models) {
    const parts = parseComfyUiWorkflowParts(model.modelId)
    if (!parts) continue

    const groupKey = `${parts.root}/${parts.category}`
    const existingGroup = groups.get(groupKey)
    if (existingGroup) {
      existingGroup.models.push(model)
      continue
    }

    groups.set(groupKey, {
      key: groupKey,
      root: parts.root,
      category: parts.category,
      models: [model],
    })
  }

  return Array.from(groups.values())
}

function getAllowedModelTypesForProvider(
  providerId: string,
  options?: { isBailianCodingPlan?: boolean },
): ProviderCardModelType[] {
  const providerKey = getProviderKey(providerId)
  if (providerKey === 'bailian' && options?.isBailianCodingPlan) return ['llm']
  if (providerKey === 'openai-compatible') return ['llm', 'image', 'video']
  return ['llm', 'image', 'video', 'audio']
}

export function getAddableModelTypesForProvider(
  providerId: string,
  options?: { isBailianCodingPlan?: boolean; allowManualAdd?: boolean },
): ProviderCardModelType[] {
  if (options?.allowManualAdd === false) return []
  return getAllowedModelTypesForProvider(providerId, options)
}

export function shouldShowOpenAICompatVideoHint(
  providerId: string,
  type: ProviderCardModelType | null,
): boolean {
  return getProviderKey(providerId) === 'openai-compatible' && type === 'video'
}

function shouldShowDefaultTabs(providerId: string): boolean {
  const providerKey = getProviderKey(providerId)
  return providerKey === 'openai-compatible' || providerKey === 'gemini-compatible'
}

export function getVisibleModelTypesForProvider(
  providerId: string,
  groupedModels: Partial<Record<ProviderCardModelType, CustomModel[]>>,
  options?: { isBailianCodingPlan?: boolean },
): ProviderCardModelType[] {
  const shouldShowAllTabs = shouldShowDefaultTabs(providerId)
  const allowedTypes = getAllowedModelTypesForProvider(providerId, options)
  if (shouldShowAllTabs) {
    return allowedTypes
  }

  return MODEL_TYPES.filter((type) => {
    if (!allowedTypes.includes(type)) return false
    const modelsOfType = groupedModels[type]
    return Array.isArray(modelsOfType) && modelsOfType.length > 0
  })
}

function formatPriceAmount(amount: number): string {
  const fixed = amount.toFixed(4)
  const normalized = fixed.replace(/\.?0+$/, '')
  return normalized || '0'
}

function getModelPriceTexts(model: CustomModel, t: ProviderCardTranslator): string[] {
  if (
    model.type === 'llm'
    && typeof model.priceInput === 'number'
    && Number.isFinite(model.priceInput)
    && typeof model.priceOutput === 'number'
    && Number.isFinite(model.priceOutput)
  ) {
    return [
      t('priceInput', { amount: `¥${formatPriceAmount(model.priceInput)}` }),
      t('priceOutput', { amount: `¥${formatPriceAmount(model.priceOutput)}` }),
    ]
  }

  const label = typeof model.priceLabel === 'string' ? model.priceLabel.trim() : ''
  if (label) {
    return label === '--' ? [] : [`¥${label}`]
  }
  if (typeof model.price === 'number' && Number.isFinite(model.price) && model.price > 0) {
    return [`¥${formatPriceAmount(model.price)}`]
  }
  return []
}

export function ProviderAdvancedFields({
  provider,
  onToggleModel,
  onDeleteModel,
  onUpdateModel,
  t,
  state,
}: ProviderAdvancedFieldsProps) {
  const providerKey = getProviderKey(provider.id)
  const allowManualAdd = !(providerKey === 'bailian' && state.isBailianCodingPlan)
  const addableModelTypes = new Set<ProviderCardModelType>(getAddableModelTypesForProvider(provider.id, {
    isBailianCodingPlan: state.isBailianCodingPlan,
    allowManualAdd,
  }))
  const visibleTypes = useMemo(
    () => getVisibleModelTypesForProvider(provider.id, state.groupedModels, {
      isBailianCodingPlan: state.isBailianCodingPlan,
    }),
    [provider.id, state.groupedModels, state.isBailianCodingPlan],
  )
  const [activeType, setActiveType] = useState<ProviderCardModelType | null>(
    visibleTypes[0] ?? null,
  )
  const activeTypeSignature = visibleTypes.join('|')

  useEffect(() => {
    if (visibleTypes.length === 0) {
      setActiveType(null)
      return
    }
    if (!activeType || !visibleTypes.includes(activeType)) {
      setActiveType(visibleTypes[0])
    }
  }, [activeType, activeTypeSignature, visibleTypes])

  const currentType = activeType ?? visibleTypes[0] ?? null
  const currentModels = currentType ? (state.groupedModels[currentType] ?? []) : []
  const providerReadyForToggle = providerHasCredentials(provider)
  const shouldShowAddButton =
    !!currentType
    && addableModelTypes.has(currentType)
    && state.showAddForm !== currentType
  const defaultAddType: ProviderCardModelType = visibleTypes[0]
    ?? Array.from(addableModelTypes)[0]
    ?? (providerKey === 'openrouter' ? 'llm' : 'image')
  const useTabbedLayout = state.hasModels || shouldShowDefaultTabs(provider.id)
  const shouldShowVideoHint = shouldShowOpenAICompatVideoHint(provider.id, currentType)
  const comfyUiCategoryGroups = useMemo(
    () => (providerKey === 'comfyui' ? groupComfyUiModelsByCategory(currentModels) : []),
    [currentModels, providerKey],
  )
  const shouldShowComfyUiCategorySections =
    providerKey === 'comfyui'
    && (currentType === 'image' || currentType === 'video' || currentType === 'audio')
    && comfyUiCategoryGroups.length > 0

  return useTabbedLayout ? (
    <div className="space-y-2.5 p-3">
      <SegmentedControl
        options={visibleTypes.map((type) => ({
          value: type,
          label: <><TypeIcon type={type} className="h-3 w-3" /><span>{typeLabel(type, t)}</span></>,
        }))}
        value={currentType ?? visibleTypes[0]}
        onChange={(val) => setActiveType(val as ProviderCardModelType)}
      />

      {currentType && (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--glass-text-primary)]">
            <TypeIcon type={currentType} className="h-3 w-3" />
            <span>{typeLabel(currentType, t)}</span>
            <span className="rounded-full bg-[var(--glass-tone-neutral-bg)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--glass-tone-neutral-fg)]">
              {currentModels.length}
            </span>
          </div>
          {shouldShowAddButton && (
            <button
              onClick={() => state.setShowAddForm(currentType)}
              className="glass-btn-base glass-btn-soft px-2 py-1 text-[12px] font-medium"
            >
              <AppIcon name="plus" className="h-3.5 w-3.5" />
              {t('add')}
            </button>
          )}
        </div>
      )}

      {currentType && state.showAddForm === currentType && addableModelTypes.has(currentType) && (
        <div className="glass-surface-soft rounded-xl p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <input
              type="text"
              value={state.newModel.name}
              onChange={(event) =>
                state.setNewModel({ ...state.newModel, name: event.target.value })
              }
              placeholder={t('modelDisplayName')}
              className="glass-input-base px-3 py-1.5 text-[12px]"
              autoFocus
            />
            <button onClick={state.handleCancelAdd} className="glass-icon-btn-sm">
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={state.newModel.modelId}
              onChange={(event) =>
                state.setNewModel({ ...state.newModel, modelId: event.target.value })
              }
              placeholder={t('modelActualId')}
              className={`glass-input-base flex-1 px-3 py-1.5 text-[12px] font-mono ${currentType === 'video' && state.batchMode && provider.id === 'ark' ? 'rounded-r-none' : ''}`}
            />
            {currentType === 'video' && state.batchMode && provider.id === 'ark' && (
              <span className="rounded-r-lg bg-[var(--glass-bg-muted)] px-2 py-1.5 font-mono text-[12px] text-[var(--glass-text-secondary)]">
                -batch
              </span>
            )}
            <button
              onClick={() => state.handleAddModel(currentType)}
              disabled={state.isModelSavePending}
              className="glass-btn-base glass-btn-primary px-3 py-1.5 text-[12px] font-medium"
            >
              {state.isModelSavePending ? t('saving') : t('save')}
            </button>
          </div>
          {shouldShowVideoHint && (
            <p className="mt-2 text-xs text-[var(--glass-text-tertiary)]">
              {t('openaiCompatVideoOnlyHint')}
            </p>
          )}
          {currentType === 'video' && provider.id === 'ark' && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-[var(--glass-bg-muted)] px-2 py-2">
              <button
                onClick={() => state.setBatchMode(!state.batchMode)}
                className="glass-check-mini"
                data-active={state.batchMode}
              >
                {state.batchMode && (
                  <AppIcon name="checkSm" className="h-2.5 w-2.5 text-white" />
                )}
              </button>
              <span className="text-xs font-medium text-[var(--glass-text-secondary)]">
                {t('batchModeHalfPrice')}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="glass-surface-soft rounded-xl p-2">
        <div
          className="app-scrollbar h-[280px] overflow-y-auto pr-1"
        >
          {shouldShowComfyUiCategorySections ? (
            <div className="space-y-3">
              {comfyUiCategoryGroups.map((group) => (
                <div
                  key={group.key}
                  className="rounded-xl border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface)]/80 p-2.5"
                >
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[12px] font-semibold text-[var(--glass-text-primary)]">
                          {group.category}
                        </span>
                        <span className="rounded-full bg-[var(--glass-tone-neutral-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--glass-tone-neutral-fg)]">
                          {group.models.length}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-[var(--glass-text-tertiary)]">
                        {group.root}
                      </div>
                    </div>
                    <div className="shrink-0 rounded-full border border-[var(--glass-stroke-base)] bg-[var(--glass-bg-muted)] px-2 py-0.5 text-[10px] text-[var(--glass-text-secondary)]">
                      {typeLabel(currentType, t)}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {group.models.map((model, index) => (
                      <ModelRow
                        key={`${group.key}-${model.modelKey}-${index}`}
                        model={model}
                        t={t}
                        state={state}
                        onToggleModel={onToggleModel}
                        onDeleteModel={onDeleteModel}
                        onUpdateModel={onUpdateModel}
                        hasApiKey={providerReadyForToggle}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {currentModels.map((model, index) => (
                <ModelRow
                  key={`${model.modelKey}-${index}`}
                  model={model}
                  t={t}
                  state={state}
                  onToggleModel={onToggleModel}
                  onDeleteModel={onDeleteModel}
                  onUpdateModel={onUpdateModel}
                  hasApiKey={providerReadyForToggle}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  ) : (
    <div className="p-3">
      {state.showAddForm === null ? (
        <div className="text-center">
          <p className="mb-3 text-[12px] text-[var(--glass-text-tertiary)]">{t('noModelsForProvider')}</p>
          {addableModelTypes.size > 0 && (
            <div className="flex items-center justify-center">
              <button
                onClick={() => state.setShowAddForm(defaultAddType)}
                className="glass-btn-base glass-btn-soft px-3 py-1.5 text-[12px]"
              >
                <AppIcon name="plus" className="h-3.5 w-3.5" />
                {t('addModel')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="glass-surface-soft rounded-xl p-3">
          <div className="mb-2.5 flex items-center gap-2">
            <input
              type="text"
              value={state.newModel.name}
              onChange={(event) =>
                state.setNewModel({ ...state.newModel, name: event.target.value })
              }
              placeholder={t('modelDisplayName')}
              className="glass-input-base px-3 py-1.5 text-[12px]"
              autoFocus
            />
            <button onClick={state.handleCancelAdd} className="glass-icon-btn-sm">
              <AppIcon name="close" className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={state.newModel.modelId}
              onChange={(event) =>
                state.setNewModel({ ...state.newModel, modelId: event.target.value })
              }
              placeholder={t('modelActualId')}
              className="glass-input-base flex-1 px-3 py-1.5 text-[12px] font-mono"
            />
            <button
              onClick={() => state.showAddForm && state.handleAddModel(state.showAddForm)}
              disabled={state.isModelSavePending}
              className="glass-btn-base glass-btn-primary px-3 py-1.5 text-[12px] font-medium"
            >
              {state.isModelSavePending ? t('saving') : t('save')}
            </button>
          </div>
          {shouldShowOpenAICompatVideoHint(provider.id, state.showAddForm) && (
            <p className="mt-2 text-xs text-[var(--glass-text-tertiary)]">
              {t('openaiCompatVideoOnlyHint')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface ModelRowProps {
  model: CustomModel
  t: ProviderCardTranslator
  state: UseProviderCardStateResult
  onToggleModel: ProviderCardProps['onToggleModel']
  onDeleteModel: ProviderCardProps['onDeleteModel']
  onUpdateModel: ProviderCardProps['onUpdateModel']
  hasApiKey: boolean
}

function ModelRow({
  model,
  t,
  state,
  onToggleModel,
  onDeleteModel,
  onUpdateModel,
  hasApiKey,
}: ModelRowProps) {
  const priceTexts = getModelPriceTexts(model, t)
  const priceText = priceTexts.join(' / ')
  const hasPriceText = priceText.length > 0
  const isComingSoonModel = isPresetComingSoonModel(model.provider, model.modelId)
  const toggleDisabled = isComingSoonModel || !hasApiKey
  const rowDisabledClass = model.enabled ? '' : 'opacity-50'
  const comfyUiParts = getProviderKey(model.provider) === 'comfyui'
    ? parseComfyUiWorkflowParts(model.modelId)
    : null
  const displayName = comfyUiParts?.workflow || model.name
  const displayMeta = comfyUiParts
    ? `${comfyUiParts.root}/${comfyUiParts.category}/${comfyUiParts.workflow}`
    : model.modelId

  return (
    <div className={`group flex items-center justify-between gap-2 rounded-xl bg-[var(--glass-bg-surface)] px-3 py-2 transition-colors hover:bg-[var(--glass-bg-surface-strong)] ${rowDisabledClass}`}>
      {state.editingModelId === model.modelKey ? (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <input
              type="text"
              value={state.editModel.name}
              onChange={(event) =>
                state.setEditModel({ ...state.editModel, name: event.target.value })
              }
              className="glass-input-base w-full px-3 py-1.5 text-[12px]"
              placeholder={t('modelDisplayName')}
            />
            <input
              type="text"
              value={state.editModel.modelId}
              onChange={(event) =>
                state.setEditModel({ ...state.editModel, modelId: event.target.value })
              }
              className="glass-input-base w-full px-3 py-1.5 text-[12px] font-mono"
              placeholder={t('modelActualId')}
            />
            {hasPriceText && (
              <div className="text-xs text-[var(--glass-text-tertiary)]">{priceText}</div>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => state.handleSaveModel(model.modelKey)}
              disabled={state.isModelSavePending}
              className="glass-icon-btn-sm"
              title={t('save')}
            >
              {state.isModelSavePending
                ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--glass-text-secondary)] border-t-transparent" />
                : <AppIcon name="check" className="h-4 w-4" />}
            </button>
            <button
              onClick={state.handleCancelEditModel}
              className="glass-icon-btn-sm"
              title={t('cancel')}
            >
              <AppIcon name="close" className="w-3.5 h-3.5" />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-[12px] font-semibold ${model.enabled ? 'text-[var(--glass-text-primary)]' : 'text-[var(--glass-text-secondary)]'}`}>
                {displayName}
              </span>
              {state.isDefaultModel(model) && model.enabled && (
                <span className="shrink-0 rounded-md bg-[var(--glass-text-primary)] px-1.5 py-0.5 text-[10px] leading-none text-white">
                  {t('default')}
                </span>
              )}
              {hasPriceText && (
                <span className="shrink-0 text-[11px] text-[var(--glass-text-tertiary)]">{priceText}</span>
              )}
            </div>
            <span className="break-all text-[11px] text-[var(--glass-text-tertiary)]">{displayMeta}</span>
          </div>

          <div className="flex items-center gap-1.5">
            {!state.isPresetModel(model.modelKey) && onUpdateModel && (
              <button
                onClick={() => state.handleEditModel(model)}
                className="glass-icon-btn-sm opacity-0 transition-opacity group-hover:opacity-100"
                title={t('configure')}
              >
                <AppIcon name="edit" className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              onClick={() => onDeleteModel(model.modelKey)}
              className="glass-icon-btn-sm opacity-0 transition-opacity hover:text-[var(--glass-tone-danger-fg)] group-hover:opacity-100"
            >
              <AppIcon name="trash" className="h-3.5 w-3.5" />
            </button>

            <button
              onClick={() => {
                if (toggleDisabled) return
                onToggleModel(model.modelKey)
              }}
              className={`glass-toggle ${toggleDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
              data-active={model.enabled}
              disabled={toggleDisabled}
              title={isComingSoonModel ? t('comingSoon') : !hasApiKey ? t('configureApiKey') : undefined}
            >
              <div className="glass-toggle-thumb"></div>
            </button>
          </div>
        </>
      )}
    </div>
  )
}
