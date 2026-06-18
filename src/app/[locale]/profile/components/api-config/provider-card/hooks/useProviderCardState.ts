'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  encodeModelKey,
  getProviderKey,
  getProviderTutorial,
  matchesModelKey,
} from '../../types'
import type {
  ModelFormState,
  ProviderCardGroupedModels,
  ProviderCardModelType,
  ProviderCardProps,
  ProviderCardTranslator,
} from '../types'
import { VERIFIABLE_PROVIDER_KEYS } from '../types'
import type { CustomModel } from '../../types'
import { apiFetch } from '@/lib/api-fetch'

type KeyTestStepStatus = 'pass' | 'fail' | 'skip'
interface KeyTestStep {
  name: string
  status: KeyTestStepStatus
  message: string
  model?: string
  detail?: string
}
type KeyTestStatus = 'idle' | 'testing' | 'passed' | 'failed'



interface UseProviderCardStateParams {
  provider: ProviderCardProps['provider']
  models: ProviderCardProps['models']
  allModels?: ProviderCardProps['allModels']
  defaultModels: ProviderCardProps['defaultModels']
  onUpdateApiKey: ProviderCardProps['onUpdateApiKey']
  onUpdateBaseUrl: ProviderCardProps['onUpdateBaseUrl']
  onUpdateModel: ProviderCardProps['onUpdateModel']
  onAddModel: ProviderCardProps['onAddModel']
  t: ProviderCardTranslator
}

const EMPTY_MODEL_FORM: ModelFormState = {
  name: '',
  modelId: '',
}

interface ProviderConnectionPayload {
  apiType: string
  apiKey: string
  llmModel?: string
}

function pickConfiguredLlmModel(params: {
  models: CustomModel[]
  defaultAnalysisModel?: string
}): string | undefined {
  const enabledLlmModels = params.models.filter((model) => model.type === 'llm' && model.enabled)
  if (enabledLlmModels.length === 0) return undefined
  const preferredModel = enabledLlmModels.find((model) => model.modelKey === params.defaultAnalysisModel)
  return (preferredModel ?? enabledLlmModels[0])?.modelId
}

export function buildProviderConnectionPayload(params: {
  providerKey: string
  apiKey: string
  llmModel?: string
}): ProviderConnectionPayload {
  const apiKey = params.apiKey.trim()
  const llmModel = params.llmModel?.trim()

  return {
    apiType: params.providerKey,
    apiKey,
    ...(llmModel ? { llmModel } : {}),
  }
}

function toProviderCardModelType(type: CustomModel['type']): ProviderCardModelType | null {
  if (type === 'llm' || type === 'image' || type === 'video' || type === 'music') return type
  return null
}

export function buildProviderCardGroupedModels(
  models: CustomModel[],
): ProviderCardGroupedModels {
  const groupedModels: ProviderCardGroupedModels = {}
  for (const model of models) {
    const groupedType = toProviderCardModelType(model.type)
    if (!groupedType) continue
    if (!groupedModels[groupedType]) {
      groupedModels[groupedType] = []
    }
    groupedModels[groupedType]!.push(model)
  }
  return groupedModels
}

export interface UseProviderCardStateResult {
  providerKey: string
  isPresetProvider: boolean
  showBaseUrlEdit: boolean
  tutorial: ReturnType<typeof getProviderTutorial>
  groupedModels: ProviderCardGroupedModels
  hasModels: boolean
  isEditing: boolean
  isEditingUrl: boolean
  showKey: boolean
  tempKey: string
  tempUrl: string
  showTutorial: boolean
  showAddForm: ProviderCardModelType | null
  newModel: ModelFormState
  batchMode: boolean
  editingModelId: string | null
  editModel: ModelFormState
  maskedKey: string
  isPresetModel: (modelKey: string) => boolean
  isDefaultModel: (model: CustomModel) => boolean
  setShowKey: (value: boolean) => void
  setShowTutorial: (value: boolean) => void
  setShowAddForm: (value: ProviderCardModelType | null) => void
  setBatchMode: (value: boolean) => void
  setNewModel: (value: ModelFormState) => void
  setEditModel: (value: ModelFormState) => void
  setTempKey: (value: string) => void
  setTempUrl: (value: string) => void
  startEditKey: () => void
  startEditUrl: () => void
  handleSaveKey: () => void
  handleCancelEdit: () => void
  handleSaveUrl: () => void
  handleCancelUrlEdit: () => void
  handleEditModel: (model: CustomModel) => void
  handleCancelEditModel: () => void
  handleSaveModel: (originalModelKey: string) => Promise<void>
  handleAddModel: (type: ProviderCardModelType) => Promise<void>
  handleCancelAdd: () => void
  keyTestStatus: KeyTestStatus
  keyTestSteps: KeyTestStep[]
  handleForceSaveKey: () => void
  handleTestOnly: () => void
  handleDismissTest: () => void
  isModelSavePending: boolean
}

export function useProviderCardState({
  provider,
  models,
  allModels,
  defaultModels,
  onUpdateApiKey,
  onUpdateBaseUrl,
  onUpdateModel,
  onAddModel,
  t,
}: UseProviderCardStateParams): UseProviderCardStateResult {
  const [isEditing, setIsEditing] = useState(false)
  const [isEditingUrl, setIsEditingUrl] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [tempKey, setTempKey] = useState(provider.apiKey || '')
  const [tempUrl, setTempUrl] = useState(provider.baseUrl || '')
  const [showTutorial, setShowTutorial] = useState(false)
  const [showAddForm, setShowAddForm] = useState<ProviderCardModelType | null>(null)
  const [newModel, setNewModel] = useState<ModelFormState>(EMPTY_MODEL_FORM)
  const [batchMode, setBatchMode] = useState(false)
  const [editingModelId, setEditingModelId] = useState<string | null>(null)
  const [editModel, setEditModel] = useState<ModelFormState>(EMPTY_MODEL_FORM)
  const [keyTestStatus, setKeyTestStatus] = useState<KeyTestStatus>('idle')
  const [keyTestSteps, setKeyTestSteps] = useState<KeyTestStep[]>([])
  const [isModelSavePending, setIsModelSavePending] = useState(false)

  const providerKey = getProviderKey(provider.id)
  const isPresetProvider = !provider.id.includes(':')
  const showBaseUrlEdit = Boolean(onUpdateBaseUrl)
  const tutorial = getProviderTutorial(provider.id)

  const groupedModels = useMemo(
    () => buildProviderCardGroupedModels(models),
    [models],
  )

  const hasModels = Object.keys(groupedModels).length > 0
  const isPresetModel = () => false

  const isDefaultModel = (model: CustomModel) => {
    if (model.type === 'llm' && matchesModelKey(defaultModels.analysisModel, model.provider, model.modelId)) {
      return true
    }

    if (model.type === 'image') {
      if (matchesModelKey(defaultModels.characterModel, model.provider, model.modelId)) return true
      if (matchesModelKey(defaultModels.locationModel, model.provider, model.modelId)) return true
      if (matchesModelKey(defaultModels.storyboardModel, model.provider, model.modelId)) return true
      if (matchesModelKey(defaultModels.editModel, model.provider, model.modelId)) return true
    }

    if (model.type === 'video' && matchesModelKey(defaultModels.videoModel, model.provider, model.modelId)) {
      return true
    }

    if (model.type === 'music' && matchesModelKey(defaultModels.musicModel, model.provider, model.modelId)) {
      return true
    }

    return false
  }

  const startEditKey = () => {
    setTempKey(provider.apiKey || '')
    setIsEditing(true)
  }

  const startEditUrl = () => {
    setTempUrl(provider.baseUrl || '')
    setIsEditingUrl(true)
  }

  const doSaveKey = useCallback(() => {
    onUpdateApiKey(provider.id, tempKey)
    setIsEditing(false)
    setKeyTestStatus('idle')
    setKeyTestSteps([])
  }, [onUpdateApiKey, provider.id, tempKey])

  const handleSaveKey = useCallback(async () => {
    if (!VERIFIABLE_PROVIDER_KEYS.has(providerKey)) {
      doSaveKey()
      return
    }

    setKeyTestStatus('testing')
    setKeyTestSteps([])

    try {
      const fallbackLlmModel = pickConfiguredLlmModel({
        models,
        defaultAnalysisModel: defaultModels.analysisModel,
      })
      const payload = buildProviderConnectionPayload({
        providerKey,
        apiKey: tempKey,
        llmModel: fallbackLlmModel,
      })
      const res = await apiFetch('/api/user/api-config/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      const steps: KeyTestStep[] = data.steps || []
      setKeyTestSteps(steps)

      if (data.success) {
        setKeyTestStatus('passed')
        // Show success for 1.5s before saving
        setTimeout(() => doSaveKey(), 1500)
      } else {
        setKeyTestStatus('failed')
      }
    } catch {
      setKeyTestSteps([{ name: 'models', status: 'fail', message: 'Network error' }])
      setKeyTestStatus('failed')
    }
  }, [defaultModels.analysisModel, doSaveKey, models, providerKey, tempKey])

  const handleForceSaveKey = useCallback(() => {
    doSaveKey()
  }, [doSaveKey])

  // 纯测试：不保存，结果持久展示直到用户手动关闭
  const handleTestOnly = useCallback(async () => {
    setKeyTestStatus('testing')
    setKeyTestSteps([])
    try {
      const fallbackLlmModel = pickConfiguredLlmModel({
        models,
        defaultAnalysisModel: defaultModels.analysisModel,
      })
      const payload = buildProviderConnectionPayload({
        providerKey,
        apiKey: provider.apiKey || '',
        llmModel: fallbackLlmModel,
      })
      const res = await apiFetch('/api/user/api-config/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      setKeyTestSteps(data.steps || [])
      setKeyTestStatus(data.success ? 'passed' : 'failed')
    } catch {
      setKeyTestSteps([{ name: 'models', status: 'fail', message: 'Network error' }])
      setKeyTestStatus('failed')
    }
  }, [defaultModels.analysisModel, models, provider.apiKey, providerKey])

  const handleDismissTest = useCallback(() => {
    setKeyTestStatus('idle')
    setKeyTestSteps([])
  }, [])

  const handleCancelEdit = () => {
    setTempKey(provider.apiKey || '')
    setIsEditing(false)
    setKeyTestStatus('idle')
    setKeyTestSteps([])
  }

  const handleSaveUrl = () => {
    onUpdateBaseUrl?.(provider.id, tempUrl)
    setIsEditingUrl(false)
  }

  const handleCancelUrlEdit = () => {
    setTempUrl(provider.baseUrl || '')
    setIsEditingUrl(false)
  }

  const handleEditModel = (model: CustomModel) => {
    setEditingModelId(model.modelKey)
    setEditModel({
      name: model.name,
      modelId: model.modelId,
    })
  }

  const handleCancelEditModel = () => {
    setEditingModelId(null)
    setEditModel(EMPTY_MODEL_FORM)
  }

  const handleSaveModel = async (originalModelKey: string): Promise<void> => {
    if (isModelSavePending) return
    if (!editModel.name || !editModel.modelId) {
      alert(t('fillComplete'))
      return
    }

    const nextModelKey = encodeModelKey(provider.id, editModel.modelId)
    const all = allModels || models
    const duplicate = all.some(
      (model) =>
        model.modelKey === nextModelKey &&
        model.modelKey !== originalModelKey,
    )

    if (duplicate) {
      alert(t('modelIdExists'))
      return
    }

    setIsModelSavePending(true)
    try {
      onUpdateModel?.(originalModelKey, {
        name: editModel.name,
        modelId: editModel.modelId,
      })

      handleCancelEditModel()
    } finally {
      setIsModelSavePending(false)
    }
  }

  const handleAddModel = async (type: ProviderCardModelType): Promise<void> => {
    if (isModelSavePending) return
    if (!newModel.name || !newModel.modelId) {
      alert(t('fillComplete'))
      return
    }

    const finalModelId =
      type === 'video' && batchMode && provider.id === 'ark'
        ? `${newModel.modelId}-batch`
        : newModel.modelId
    const finalModelKey = encodeModelKey(provider.id, finalModelId)

    const all = allModels || models
    if (all.some((model) => model.modelKey === finalModelKey)) {
      alert(t('modelIdExists'))
      return
    }

    const finalName =
      type === 'video' && batchMode && provider.id === 'ark'
        ? `${newModel.name} (Batch)`
        : newModel.name

    setIsModelSavePending(true)
    try {
      onAddModel({
        modelId: finalModelId,
        modelKey: finalModelKey,
        name: finalName,
        type,
        provider: provider.id,
        price: 0,
      })

      setNewModel(EMPTY_MODEL_FORM)
      setBatchMode(false)
      setShowAddForm(null)
    } finally {
      setIsModelSavePending(false)
    }
  }

  const handleCancelAdd = () => {
    setShowAddForm(null)
    setNewModel(EMPTY_MODEL_FORM)
    setBatchMode(false)
  }

  const maskedKey = (() => {
    const key = provider.apiKey || ''
    if (key.length <= 8) return '•'.repeat(key.length)
    return `${key.slice(0, 4)}${'•'.repeat(50)}`
  })()

  return {
    providerKey,
    isPresetProvider,
    showBaseUrlEdit,
    tutorial,
    groupedModels,
    hasModels,
    isEditing,
    isEditingUrl,
    showKey,
    tempKey,
    tempUrl,
    showTutorial,
    showAddForm,
    newModel,
    batchMode,
    editingModelId,
    editModel,
    maskedKey,
    isPresetModel,
    isDefaultModel,
    setShowKey,
    setShowTutorial,
    setShowAddForm,
    setBatchMode,
    setNewModel,
    setEditModel,
    setTempKey,
    setTempUrl,
    startEditKey,
    startEditUrl,
    handleSaveKey,
    handleCancelEdit,
    handleSaveUrl,
    handleCancelUrlEdit,
    handleEditModel,
    handleCancelEditModel,
    handleSaveModel,
    handleAddModel,
    handleCancelAdd,
    keyTestStatus,
    keyTestSteps,
    handleForceSaveKey,
    handleTestOnly,
    handleDismissTest,
    isModelSavePending,
  }
}
