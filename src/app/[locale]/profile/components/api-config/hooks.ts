'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useLocale, useTranslations } from 'next-intl'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Provider,
    CustomModel,
    encodeModelKey,
    getProviderKey,
    isPresetComingSoonModelKey,
    resolvePresetProviderName,
} from './types'
import { CODEX_PROVIDER_KEY } from '@/lib/ai-providers/codex/constants'
import type { CapabilitySelections } from '@/lib/ai-registry/types'
import { normalizeWorkflowConcurrencyValue } from '@/lib/workflow-concurrency'
import { useApiConfigSaver } from './editor'
import { useUserApiConfigQuery } from './query'
import {
    applyCodexPresetDefaults,
    clearMissingDefaultModels,
    applyMissingCapabilityDefaults,
    type CapabilityFieldDefaults,
    createInitialModels,
    createInitialProviders,
    DEFAULT_WORKFLOW_CONCURRENCY,
    mergeModelsForDisplay,
    mergeProvidersForDisplay,
    parsePricingDisplayMap,
    parseWorkflowConcurrency,
    replaceDefaultModelKey,
    type DefaultModels,
    type WorkflowConcurrency,
} from './selectors'

export { mergeProvidersForDisplay } from './selectors'

interface UseProvidersReturn {
    providers: Provider[]
    models: CustomModel[]
    defaultModels: DefaultModels
    workflowConcurrency: WorkflowConcurrency
    capabilityDefaults: CapabilitySelections
    loading: boolean
    saveStatus: 'idle' | 'saving' | 'saved' | 'error'
    flushConfig: () => Promise<void>
    updateProviderHidden: (providerId: string, hidden: boolean) => void
    updateProviderApiKey: (providerId: string, apiKey: string) => void
    updateProviderBaseUrl: (providerId: string, baseUrl: string) => void
    reorderProviders: (activeProviderId: string, overProviderId: string) => void
    deleteProvider: (providerId: string) => void
    updateProviderInfo: (providerId: string, name: string, baseUrl?: string) => void
    toggleModel: (modelKey: string, providerId?: string) => void
    updateModel: (modelKey: string, updates: Partial<CustomModel>, providerId?: string) => void
    addModel: (model: Omit<CustomModel, 'enabled'>) => void
    deleteModel: (modelKey: string, providerId?: string) => void
    updateDefaultModel: (field: string, modelKey: string, capabilityFieldsToDefault?: CapabilityFieldDefaults[]) => void
    batchUpdateDefaultModels: (fields: string[], modelKey: string, capabilityFieldsToDefault?: CapabilityFieldDefaults[]) => void
    updateWorkflowConcurrency: (field: keyof WorkflowConcurrency, value: number) => void
    updateCapabilityDefault: (modelKey: string, field: string, value: string | number | boolean | null) => void
    getModelsByType: (type: CustomModel['type']) => CustomModel[]
}

export function useProviders(): UseProvidersReturn {
    const locale = useLocale()
    const t = useTranslations('apiConfig')
    const [providers, setProviders] = useState<Provider[]>(createInitialProviders([]))
    const [models, setModels] = useState<CustomModel[]>(createInitialModels([]))
    const [defaultModels, setDefaultModels] = useState<DefaultModels>({})
    const [workflowConcurrency, setWorkflowConcurrency] = useState<WorkflowConcurrency>(DEFAULT_WORKFLOW_CONCURRENCY)
    const [capabilityDefaults, setCapabilityDefaults] = useState<CapabilitySelections>({})
    const { data, loading: queryLoading, error: queryError } = useUserApiConfigQuery()
    const catalogProviderIdsRef = useRef<Set<string>>(new Set())
    const catalogModelKeysRef = useRef<Set<string>>(new Set())

    // 始终持有最新值的 refs，用于避免异步保存时读到旧的闭包值
    const latestModelsRef = useRef(models)
    const latestProvidersRef = useRef(providers)
    const latestDefaultModelsRef = useRef(defaultModels)
    const latestWorkflowConcurrencyRef = useRef(workflowConcurrency)
    const latestCapabilityDefaultsRef = useRef(capabilityDefaults)
    useEffect(() => { latestModelsRef.current = models }, [models])
    useEffect(() => { latestProvidersRef.current = providers }, [providers])
    useEffect(() => { latestDefaultModelsRef.current = defaultModels }, [defaultModels])
    useEffect(() => { latestWorkflowConcurrencyRef.current = workflowConcurrency }, [workflowConcurrency])
    useEffect(() => { latestCapabilityDefaultsRef.current = capabilityDefaults }, [capabilityDefaults])

    const { saveStatus, performSave, flushConfig } = useApiConfigSaver({
        latestModelsRef,
        latestProvidersRef,
        latestDefaultModelsRef,
        latestWorkflowConcurrencyRef,
        latestCapabilityDefaultsRef,
    })

    useEffect(() => {
        if (queryError) {
            _ulogError('获取配置失败:', queryError)
            return
        }
        if (!data) return
        if (!data.catalog) {
            throw new Error('API_CONFIG_CATALOG_MISSING')
        }
        const pricingDisplay = parsePricingDisplayMap(data.pricingDisplay)
        const catalogProviders = data.catalog.providers
        const catalogModels = data.catalog.models
        catalogProviderIdsRef.current = new Set(catalogProviders.map((provider) => provider.id))
        catalogModelKeysRef.current = new Set(catalogModels.map((model) => encodeModelKey(model.provider, model.modelId)))

        const serverCatalogProviders = catalogProviders.map((provider) => ({
            ...provider,
            name: resolvePresetProviderName(provider.id, provider.name, locale),
        }))

        const savedProviders: Provider[] = data.providers || []
        const savedModels: CustomModel[] = data.models || []
        const mergedProviders = mergeProvidersForDisplay(savedProviders, serverCatalogProviders)
        const mergedModels = mergeModelsForDisplay(savedModels, catalogModels, pricingDisplay)
        const normalizedDefaultModels = data.defaultModels || {}
        const parsedWorkflowConcurrency = parseWorkflowConcurrency(data.workflowConcurrency)
        const parsedCapabilityDefaults: CapabilitySelections =
            data.capabilityDefaults && typeof data.capabilityDefaults === 'object'
                ? data.capabilityDefaults as CapabilitySelections
                : {}
        const hasSavedCodexConfig =
            savedProviders.some((provider) => getProviderKey(provider.id) === CODEX_PROVIDER_KEY) ||
            savedModels.some((model) => getProviderKey(model.provider) === CODEX_PROVIDER_KEY) ||
            Object.values(normalizedDefaultModels).some((modelKey) =>
                typeof modelKey === 'string' && modelKey.startsWith(`${CODEX_PROVIDER_KEY}::`),
            )
        const codexResolved = applyCodexPresetDefaults({
            models: mergedModels,
            defaultModels: normalizedDefaultModels,
            shouldAutoSelectText: !hasSavedCodexConfig,
        })
        setProviders(mergedProviders)
        latestProvidersRef.current = mergedProviders
        setModels(codexResolved.models)
        latestModelsRef.current = codexResolved.models
        setDefaultModels(codexResolved.defaultModels)
        latestDefaultModelsRef.current = codexResolved.defaultModels
        setWorkflowConcurrency(parsedWorkflowConcurrency)
        latestWorkflowConcurrencyRef.current = parsedWorkflowConcurrency
        setCapabilityDefaults(parsedCapabilityDefaults)
        latestCapabilityDefaultsRef.current = parsedCapabilityDefaults
        if (codexResolved.changed) {
            void performSave({
                defaultModels: codexResolved.defaultModels,
                workflowConcurrency: parsedWorkflowConcurrency,
                capabilityDefaults: parsedCapabilityDefaults,
            })
        }
    }, [data, queryError, locale, performSave])

    // 默认模型操作：选中即立刻保存（与项目设置一致）
    const updateDefaultModel = useCallback((
        field: string,
        modelKey: string,
        capabilityFieldsToDefault?: CapabilityFieldDefaults[],
    ) => {
        setDefaultModels(prev => {
            const next = { ...prev, [field]: modelKey }
            latestDefaultModelsRef.current = next

            const capabilityResult = applyMissingCapabilityDefaults(
                latestCapabilityDefaultsRef.current,
                modelKey,
                capabilityFieldsToDefault,
            )
            if (capabilityResult.changed) {
                latestCapabilityDefaultsRef.current = capabilityResult.capabilityDefaults
                setCapabilityDefaults(capabilityResult.capabilityDefaults)
                void performSave({ defaultModels: next, capabilityDefaults: capabilityResult.capabilityDefaults })
            } else {
                void performSave({ defaultModels: next })
            }
            return next
        })
    }, [performSave])

    /** Batch-update multiple default model fields to the same model key, saving only once */
    const batchUpdateDefaultModels = useCallback((
        fields: string[],
        modelKey: string,
        capabilityFieldsToDefault?: CapabilityFieldDefaults[],
    ) => {
        setDefaultModels(prev => {
            const next = { ...prev }
            for (const field of fields) {
                (next as Record<string, string | undefined>)[field] = modelKey
            }
            latestDefaultModelsRef.current = next

            const capabilityResult = applyMissingCapabilityDefaults(
                latestCapabilityDefaultsRef.current,
                modelKey,
                capabilityFieldsToDefault,
            )
            if (capabilityResult.changed) {
                latestCapabilityDefaultsRef.current = capabilityResult.capabilityDefaults
                setCapabilityDefaults(capabilityResult.capabilityDefaults)
                void performSave({ defaultModels: next, capabilityDefaults: capabilityResult.capabilityDefaults })
            } else {
                void performSave({ defaultModels: next })
            }
            return next
        })
    }, [performSave])

    const updateCapabilityDefault = useCallback((modelKey: string, field: string, value: string | number | boolean | null) => {
        setCapabilityDefaults((previous) => {
            const next: CapabilitySelections = { ...previous }
            const current = { ...(next[modelKey] || {}) }
            if (value === null) {
                delete current[field]
            } else {
                current[field] = value
            }

            if (Object.keys(current).length === 0) {
                delete next[modelKey]
            } else {
                next[modelKey] = current
            }
            latestCapabilityDefaultsRef.current = next
            void performSave({ capabilityDefaults: next })
            return next
        })
    }, [performSave])

    const updateWorkflowConcurrency = useCallback((field: keyof WorkflowConcurrency, value: number) => {
        const nextValue = normalizeWorkflowConcurrencyValue(value, DEFAULT_WORKFLOW_CONCURRENCY[field])
        setWorkflowConcurrency((previous) => {
            const next = { ...previous, [field]: nextValue }
            latestWorkflowConcurrencyRef.current = next
            void performSave({ workflowConcurrency: next })
            return next
        })
    }, [performSave])

    // 提供商操作
    const updateProviderApiKey = useCallback((providerId: string, apiKey: string) => {
        setProviders(prev => {
            const next = prev.map((provider) => {
                if (provider.id !== providerId) return provider
                const isCodex = getProviderKey(providerId) === CODEX_PROVIDER_KEY
                return { ...provider, apiKey, hasApiKey: isCodex || !!apiKey }
            })
            latestProvidersRef.current = next
            void performSave()
            return next
        })
    }, [performSave])

    const updateProviderHidden = useCallback((providerId: string, hidden: boolean) => {
        setProviders((previous) => {
            const next = previous.map((provider) =>
                provider.id === providerId ? { ...provider, hidden } : provider,
            )
            latestProvidersRef.current = next
            void performSave()
            return next
        })
    }, [performSave])

    const reorderProviders = useCallback((activeProviderId: string, overProviderId: string) => {
        if (activeProviderId === overProviderId) return
        setProviders((previous) => {
            const oldIndex = previous.findIndex((provider) => provider.id === activeProviderId)
            const newIndex = previous.findIndex((provider) => provider.id === overProviderId)
            if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
                return previous
            }

            const next = [...previous]
            const moved = next[oldIndex]
            if (!moved) return previous
            next.splice(oldIndex, 1)
            next.splice(newIndex, 0, moved)
            latestProvidersRef.current = next
            void performSave()
            return next
        })
    }, [performSave])

    const deleteProvider = useCallback((providerId: string) => {
        if (catalogProviderIdsRef.current.has(providerId)) {
            alert(t('presetProviderCannotDelete'))
            return
        }
        if (confirm(t('confirmDeleteProvider'))) {
            setProviders(prev => {
                const next = prev.filter(p => p.id !== providerId)
                latestProvidersRef.current = next
                return next
            })
            setModels(prev => {
                const nextModels = prev.filter(m => m.provider !== providerId)
                setDefaultModels(prevDefaults => {
                    const remainingModelKeys = new Set(nextModels.map(m => m.modelKey))
                    const updates = clearMissingDefaultModels(prevDefaults, remainingModelKeys)
                    latestDefaultModelsRef.current = updates
                    return updates
                })
                latestModelsRef.current = nextModels
                void performSave()
                return nextModels
            })
        }
    }, [t, performSave])

    const updateProviderInfo = useCallback((providerId: string, name: string, baseUrl?: string) => {
        setProviders(prev => {
            const next = prev.map(p =>
                p.id === providerId ? { ...p, name, baseUrl } : p
            )
            latestProvidersRef.current = next
            void performSave()
            return next
        })
    }, [performSave])

    const updateProviderBaseUrl = useCallback((providerId: string, baseUrl: string) => {
        setProviders(prev => {
            const next = prev.map((provider) => {
                if (provider.id !== providerId) return provider
                const isCodex = getProviderKey(providerId) === CODEX_PROVIDER_KEY
                return { ...provider, baseUrl, hasApiKey: isCodex || !!provider.apiKey }
            })
            latestProvidersRef.current = next
            void performSave()
            return next
        })
    }, [performSave])

    // 模型操作
    const toggleModel = useCallback((modelKey: string, providerId?: string) => {
        if (isPresetComingSoonModelKey(modelKey)) {
            return
        }
        setModels(prev => {
            const next = prev.map(m =>
                m.modelKey === modelKey && (providerId ? m.provider === providerId : true)
                    ? { ...m, enabled: !m.enabled }
                    : m
            )
            latestModelsRef.current = next
            void performSave()
            return next
        })
    }, [performSave])

    const updateModel = useCallback((modelKey: string, updates: Partial<CustomModel>, providerId?: string) => {
        let nextModelKey = ''
        setModels(prev => {
            const next = prev.map(m => {
                if (m.modelKey !== modelKey || (providerId ? m.provider !== providerId : false)) return m
                const mergedProvider = updates.provider ?? m.provider
                const mergedModelId = updates.modelId ?? m.modelId
                nextModelKey = encodeModelKey(mergedProvider, mergedModelId)
                return {
                    ...m,
                    ...updates,
                    provider: mergedProvider,
                    modelId: mergedModelId,
                    modelKey: nextModelKey,
                    name: updates.name ?? m.name,
                    price: updates.price ?? m.price,
                }
            })
            latestModelsRef.current = next
            return next
        })
        if (nextModelKey && nextModelKey !== modelKey) {
            setDefaultModels(prev => {
                const next = replaceDefaultModelKey(prev, modelKey, nextModelKey)
                latestDefaultModelsRef.current = next
                return next
            })
        }
        void performSave()
    }, [performSave])

    const addModel = useCallback((model: Omit<CustomModel, 'enabled'>) => {
        setModels(prev => {
            const next = [
                ...prev,
                {
                    ...model,
                    modelKey: model.modelKey || encodeModelKey(model.provider, model.modelId),
                    price: 0,
                    priceLabel: '--',
                    enabled: true,
                },
            ]
            latestModelsRef.current = next
            void performSave()
            return next
        })
    }, [performSave])

    const deleteModel = useCallback((modelKey: string, providerId?: string) => {
        if (catalogModelKeysRef.current.has(modelKey)) {
            alert(t('presetModelCannotDelete'))
            return
        }
        if (confirm(t('confirmDeleteModel'))) {
            setModels(prev => {
                const nextModels = prev.filter(m =>
                    !(m.modelKey === modelKey && (providerId ? m.provider === providerId : true))
                )
                setDefaultModels(prevDefaults => {
                    const remainingModelKeys = new Set(nextModels.map(m => m.modelKey))
                    const nextDefaults = clearMissingDefaultModels(prevDefaults, remainingModelKeys)
                    latestDefaultModelsRef.current = nextDefaults
                    return nextDefaults
                })
                latestModelsRef.current = nextModels
                void performSave()
                return nextModels
            })
        }
    }, [t, performSave])

    // 过滤器
    const getModelsByType = useCallback((type: CustomModel['type']) => {
        return models.filter(m => m.type === type)
    }, [models])

    return {
        providers,
        models,
        defaultModels,
        workflowConcurrency,
        capabilityDefaults,
        loading: queryLoading,
        saveStatus,
        flushConfig,
        updateProviderHidden,
        updateProviderApiKey,
        updateProviderBaseUrl,
        reorderProviders,
        deleteProvider,
        updateProviderInfo,
        toggleModel,
        updateModel,
        addModel,
        deleteModel,
        updateDefaultModel,
        batchUpdateDefaultModels,
        updateWorkflowConcurrency,
        updateCapabilityDefault,
        getModelsByType
    }
}
