'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useLocale, useTranslations } from 'next-intl'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Provider,
    CustomModel,
    encodeModelKey,
    isPresetComingSoonModelKey,
    resolvePresetProviderName,
} from './types'
import type { CapabilitySelections } from '@/lib/ai-registry/types'
import type { EffectiveDefaultModelsView } from '@/lib/user-api/api-config-types'
import {
    DEFAULT_VIDEO_WORKFLOW_CONCURRENCY,
    normalizeWorkflowConcurrencyValue,
} from '@/lib/workflow-concurrency'
import { useApiConfigSaver } from './editor'
import type { ApiConfigSaveError } from './editor'
import { useUserApiConfigQuery } from './query'
import { useToast } from '@/contexts/ToastContext'
import {
    clearMissingDefaultModels,
    applyMissingCapabilityDefaults,
    type CapabilityFieldDefaults,
    createInitialModels,
    createInitialProviders,
    DEFAULT_WORKFLOW_CONCURRENCY,
    mergeModelsForDisplay,
    mergeProvidersForDisplay,
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
    displayedDefaultModels: DefaultModels
    defaultModelSources: Partial<Record<keyof DefaultModels, 'user' | 'system' | 'unset'>>
    workflowConcurrency: WorkflowConcurrency
    capabilityDefaults: CapabilitySelections
    displayedCapabilityDefaults: CapabilitySelections
    runtimeManagedModelKeys: ReadonlySet<string>
    loading: boolean
    saveStatus: 'idle' | 'saving' | 'saved' | 'error'
    saveError: ApiConfigSaveError | null
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
    const { showToast } = useToast()
    const [providers, setProviders] = useState<Provider[]>(createInitialProviders([]))
    const [models, setModels] = useState<CustomModel[]>(createInitialModels([]))
    const [defaultModels, setDefaultModels] = useState<DefaultModels>({})
    const [workflowConcurrency, setWorkflowConcurrency] = useState<WorkflowConcurrency>(DEFAULT_WORKFLOW_CONCURRENCY)
    const [capabilityDefaults, setCapabilityDefaults] = useState<CapabilitySelections>({})
    const { data, loading: queryLoading, error: queryError, replaceData } = useUserApiConfigQuery()
    const [effectiveDefaults, setEffectiveDefaults] = useState<EffectiveDefaultModelsView | null>(null)
    const displayedDefaultModels = effectiveDefaults?.defaultModels ?? defaultModels
    const displayedCapabilityDefaults = effectiveDefaults?.capabilityDefaults ?? capabilityDefaults
    const defaultModelSources = effectiveDefaults?.sources ?? {}
    const runtimeManagedModelKeys = new Set(effectiveDefaults?.runtimeManagedModelKeys ?? [])
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

    const hydrateConfig = useCallback((nextConfig: NonNullable<typeof data>) => {
        if (!nextConfig.catalog) {
            throw new Error('API_CONFIG_CATALOG_MISSING')
        }
        const catalogProviders = nextConfig.catalog.providers
        const catalogModels = nextConfig.catalog.models
        catalogProviderIdsRef.current = new Set(catalogProviders.map((provider) => provider.id))
        catalogModelKeysRef.current = new Set(catalogModels.map((model) => encodeModelKey(model.provider, model.modelId)))

        const serverCatalogProviders = catalogProviders.map((provider) => ({
            ...provider,
            name: resolvePresetProviderName(provider.id, provider.name, locale),
        }))
        const nextProviders = mergeProvidersForDisplay(nextConfig.providers || [], serverCatalogProviders)
        const nextModels = mergeModelsForDisplay(nextConfig.models || [], catalogModels)
        const nextDefaultModels = nextConfig.defaultModels || {}
        const nextWorkflowConcurrency = parseWorkflowConcurrency(nextConfig.workflowConcurrency)
        const nextCapabilityDefaults = nextConfig.capabilityDefaults && typeof nextConfig.capabilityDefaults === 'object'
            ? nextConfig.capabilityDefaults as CapabilitySelections
            : {}

        latestProvidersRef.current = nextProviders
        latestModelsRef.current = nextModels
        latestDefaultModelsRef.current = nextDefaultModels
        latestWorkflowConcurrencyRef.current = nextWorkflowConcurrency
        latestCapabilityDefaultsRef.current = nextCapabilityDefaults
        setProviders(nextProviders)
        setModels(nextModels)
        setDefaultModels(nextDefaultModels)
        setWorkflowConcurrency(nextWorkflowConcurrency)
        setCapabilityDefaults(nextCapabilityDefaults)
        setEffectiveDefaults(nextConfig.effectiveDefaults ?? null)
    }, [locale])

    const acceptSavedConfig = useCallback((nextConfig: NonNullable<typeof data>) => {
        hydrateConfig(nextConfig)
        replaceData(nextConfig)
    }, [hydrateConfig, replaceData])

    const { saveStatus, saveError, performSave, flushConfig } = useApiConfigSaver({
        latestModelsRef,
        latestProvidersRef,
        latestDefaultModelsRef,
        latestWorkflowConcurrencyRef,
        latestCapabilityDefaultsRef,
        onSavedConfig: acceptSavedConfig,
    })

    useEffect(() => {
        if (queryError) {
            _ulogError('获取配置失败:', queryError)
            return
        }
        if (!data) return
        hydrateConfig(data)
    }, [data, queryError, hydrateConfig])

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
        const nextValue = field === 'video'
            ? DEFAULT_VIDEO_WORKFLOW_CONCURRENCY
            : normalizeWorkflowConcurrencyValue(value, DEFAULT_WORKFLOW_CONCURRENCY[field])
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
            const next = prev.map(p =>
                p.id === providerId ? { ...p, apiKey, hasApiKey: !!apiKey } : p
            )
            latestProvidersRef.current = next
            void performSave().then((saved) => {
                if (!saved) return
                const scrubbed = latestProvidersRef.current.map((provider) => provider.id === providerId
                    ? { ...provider, apiKey: undefined, hasApiKey: Boolean(apiKey) }
                    : provider)
                latestProvidersRef.current = scrubbed
                setProviders(scrubbed)
            })
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
            showToast(t('presetProviderCannotDelete'), 'warning')
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
    }, [t, performSave, showToast])

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
            const next = prev.map(p =>
                p.id === providerId ? { ...p, baseUrl } : p
            )
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
            showToast(t('presetModelCannotDelete'), 'warning')
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
    }, [t, performSave, showToast])

    // 过滤器
    const getModelsByType = useCallback((type: CustomModel['type']) => {
        return models.filter(m => m.type === type)
    }, [models])

    return {
        providers,
        models,
        defaultModels,
        displayedDefaultModels,
        defaultModelSources,
        workflowConcurrency,
        capabilityDefaults,
        displayedCapabilityDefaults,
        runtimeManagedModelKeys,
        loading: queryLoading,
        saveStatus,
        saveError,
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
