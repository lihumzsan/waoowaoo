'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import { useAttachmentFilePicker } from '@/components/project-assistant/useAttachmentFilePicker'
import {
  isAssistantRuntimeApprovalRequest,
  isAssistantRuntimeInputRequest,
  readAssistantRuntimeMcpElicitation,
  readAssistantRuntimeUserInputQuestions,
  type AssistantRuntimePendingInteractionView,
} from '@/lib/assistant-runtime/view-contract'
import {
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES,
  type ProjectAssistantTextAttachment,
} from '@/lib/project-agent/text-attachments'
import {
  uploadProjectAssistantTextAttachment,
  validateProjectAssistantTextAttachmentFile,
} from '@/lib/project-agent/text-attachments/client'
import {
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT,
  PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES,
  type ProjectAssistantMediaAttachment,
} from '@/lib/project-agent/media-attachments'
import {
  isProjectAssistantMediaFile,
  mintProjectAssistantResourceAttachment,
  uploadProjectAssistantMediaAttachment,
  validateProjectAssistantMediaAttachmentFile,
} from '@/lib/project-agent/media-attachments/client'
import type {
  WorkspaceAssistantDraftRequest,
  WorkspaceCanvasSelection,
} from '../canvas/contracts/workspace-canvas-interactions'
import type { WorkspaceAssistantActiveFocusRequest } from '../workspace-assistant-focus'
import {
  ConfirmationActionCard,
  useWorkspaceAssistantMessagePartComponents,
  WorkspaceAssistantPendingTurnPlaceholder,
  WorkspaceAssistantThreadMessage,
} from './workspace-assistant/WorkspaceAssistantRenderers'
import { WorkspaceAssistantActiveRunCard } from './workspace-assistant/WorkspaceAssistantActiveRunCard'
import { WorkspaceAssistantPlanCard } from './workspace-assistant/WorkspaceAssistantPlanCard'
import { WorkspaceAssistantSettings } from './workspace-assistant/WorkspaceAssistantSettings'
import { WorkspaceAssistantComposer } from './workspace-assistant/WorkspaceAssistantComposer'
import { WorkspaceAssistantRepeatedToolCallGroupProvider } from './workspace-assistant/WorkspaceAssistantToolCall'
import { WorkspaceAssistantRunningSurfaceProvider } from './workspace-assistant/WorkspaceAssistantReasoning'
import {
  buildWorkspaceAssistantPanelLayout,
  WORKSPACE_ASSISTANT_PANEL_WIDTH_CSS_VAR,
} from './workspace-assistant/panel-layout'
import { useWorkspaceAssistantCanvasFocus } from './workspace-assistant/useWorkspaceAssistantCanvasFocus'
import { useWorkspaceAssistantComposer } from './workspace-assistant/useWorkspaceAssistantComposer'
import { useWorkspaceAssistantPanelResize } from './workspace-assistant/useWorkspaceAssistantPanelResize'
import { useWorkspaceAssistantRuntime } from './workspace-assistant/useWorkspaceAssistantRuntime'
import {
  parseWorkspaceAssistantFailureText,
  resolveWorkspaceAssistantFailureView,
  resolveWorkspaceAssistantResendDraft,
  resolveWorkspaceAssistantUndeliveredUserMessage,
  shouldShowWorkspaceAssistantReplyLoading,
  shouldShowWorkspaceAssistantRunFailureNotice,
  type WorkspaceAssistantFailureView,
} from './workspace-assistant/workspace-assistant-panel-state'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'

interface WorkspaceAssistantPanelProps {
  projectId: string
  selection: WorkspaceCanvasSelection | null
  draftRequest: WorkspaceAssistantDraftRequest | null
  onDraftRequestConsumed: (requestId: string) => void
  onClearSelection: () => void
  autoStartDraft?: {
    readonly message: string
    readonly attachments: readonly ProjectAssistantTextAttachment[]
    readonly mediaAttachments: readonly ProjectAssistantMediaAttachment[]
  } | null
  autoStartKey?: string | null
  onAutoStartConsumed?: () => void
  onActiveOperationChange?: (focusRequest: WorkspaceAssistantActiveFocusRequest | null) => void
}

export const WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE = {
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
} satisfies CSSProperties

function WorkspaceAssistantRunFailureNotice({
  failure,
  title,
  resend,
}: {
  failure: WorkspaceAssistantFailureView
  title?: string
  resend: { readonly pending: boolean; readonly onResend: () => void } | null
}) {
  const t = useTranslations('assistantAgent')
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-sm leading-5 text-[var(--glass-tone-warn-fg)]"
    >
      <AppIcon name="alert" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="min-w-0">
        <div className="font-semibold">{title ?? t('panel.runFailedTitle')}</div>
        <div className="break-words text-xs leading-4 opacity-80">{failure.headline}</div>
        {failure.technical ? (
          <div className="mt-0.5 break-all text-[11px] leading-4 opacity-60">
            {failure.technical}
          </div>
        ) : null}
        {resend ? (
          <button
            type="button"
            disabled={resend.pending}
            onClick={resend.onResend}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[var(--glass-tone-warn-fg)]/30 bg-white/70 px-2 py-1 text-xs font-medium text-[var(--glass-tone-warn-fg)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="refresh" className="h-3 w-3 shrink-0" />
            {resend.pending ? t('panel.sending') : t('panel.resend')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function runtimeApprovalTitle(
  interaction: AssistantRuntimePendingInteractionView,
  fallback: string,
): string {
  if (!isRecord(interaction.params)) return fallback
  const network = interaction.params.networkApprovalContext
  if (isRecord(network) && typeof network.host === 'string' && network.host.trim()) {
    const protocol = typeof network.protocol === 'string' ? network.protocol.trim() : ''
    return protocol ? `${protocol}://${network.host.trim()}` : network.host.trim()
  }
  const command = interaction.params.command
  if (typeof command === 'string' && command.trim()) return command
  if (Array.isArray(command) && command.every((value) => typeof value === 'string')) {
    const joined = command.join(' ').trim()
    if (joined) return joined
  }
  const reason = interaction.params.reason
  if (typeof reason === 'string' && reason.trim()) return reason
  const path = interaction.params.path
  if (typeof path === 'string' && path.trim()) return path
  return fallback
}

function runtimePermissionApprovalFacts(
  interaction: AssistantRuntimePendingInteractionView,
): readonly { readonly kind: 'cwd' | 'network' | 'fileSystem'; readonly value: string }[] {
  if (interaction.method !== 'item/permissions/requestApproval' || !isRecord(interaction.params)) return []
  const facts: { kind: 'cwd' | 'network' | 'fileSystem'; value: string }[] = []
  if (typeof interaction.params.cwd === 'string' && interaction.params.cwd.trim()) {
    facts.push({ kind: 'cwd', value: interaction.params.cwd })
  }
  if (!isRecord(interaction.params.permissions)) return facts
  const permissions = interaction.params.permissions
  if (permissions.network !== null && permissions.network !== undefined) {
    facts.push({ kind: 'network', value: JSON.stringify(permissions.network) })
  }
  if (permissions.fileSystem !== null && permissions.fileSystem !== undefined) {
    facts.push({ kind: 'fileSystem', value: JSON.stringify(permissions.fileSystem) })
  }
  return facts
}

type RuntimeRequestContent =
  | {
      readonly kind: 'questions'
      readonly questions: ReturnType<typeof readAssistantRuntimeUserInputQuestions>
    }
  | {
      readonly kind: 'elicitation'
      readonly elicitation: ReturnType<typeof readAssistantRuntimeMcpElicitation>
    }
  | { readonly kind: 'invalid' }

function parseRuntimeRequestContent(
  interaction: AssistantRuntimePendingInteractionView,
): RuntimeRequestContent {
  try {
    if (interaction.method === 'item/tool/requestUserInput') {
      return {
        kind: 'questions',
        questions: readAssistantRuntimeUserInputQuestions(interaction),
      }
    }
    if (interaction.method === 'mcpServer/elicitation/request') {
      return {
        kind: 'elicitation',
        elicitation: readAssistantRuntimeMcpElicitation(interaction),
      }
    }
  } catch {
    return { kind: 'invalid' }
  }
  return { kind: 'invalid' }
}

function runtimeEnumOptions(schema: Record<string, unknown>): readonly {
  readonly value: string
  readonly label: string
}[] {
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter((entry): entry is string => typeof entry === 'string')
    const labels = Array.isArray(schema.enumNames)
      ? schema.enumNames.filter((entry): entry is string => typeof entry === 'string')
      : []
    return values.map((value, index) => ({ value, label: labels[index] ?? value }))
  }
  if (!Array.isArray(schema.oneOf)) return []
  return schema.oneOf.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.const !== 'string') return []
    return [{
      value: entry.const,
      label: typeof entry.title === 'string' && entry.title.trim() ? entry.title : entry.const,
    }]
  })
}

function initialRuntimeRequestValues(content: RuntimeRequestContent): Record<string, unknown> {
  if (content.kind !== 'elicitation' || content.elicitation.mode !== 'form') return {}
  const schema = content.elicitation.requestedSchema
  if (!schema || !isRecord(schema.properties)) return {}
  return Object.fromEntries(
    Object.entries(schema.properties).flatMap(([key, property]) => {
      if (!isRecord(property) || property.default === undefined) return []
      const value = property.type === 'number' || property.type === 'integer'
        ? String(property.default)
        : property.default
      return [[key, value]]
    }),
  )
}

function WorkspaceAssistantRuntimeRequestCard(props: {
  interaction: AssistantRuntimePendingInteractionView
  onSubmit: (params: { response: Record<string, unknown> }) => Promise<void>
}) {
  const t = useTranslations('assistantAgent')
  const content = useMemo(
    () => parseRuntimeRequestContent(props.interaction),
    [props.interaction],
  )
  const [values, setValues] = useState<Record<string, unknown>>(
    () => initialRuntimeRequestValues(content),
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  const submit = (response: Record<string, unknown>): void => {
    if (submitting) return
    setSubmitting(true)
    setError(false)
    void props.onSubmit({ response })
      .catch(() => {
        setError(true)
        setSubmitting(false)
      })
  }

  if (content.kind === 'invalid') {
    return (
      <div
        role="alert"
        className="rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-sm text-[var(--glass-tone-warn-fg)]"
      >
        {t('panel.sessionStateError')}
      </div>
    )
  }

  if (content.kind === 'questions') {
    const ready = content.questions.every((question) => {
      const value = values[question.id]
      return typeof value === 'string' && value.trim().length > 0
    })
    return (
      <div className="space-y-3 rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-sm text-[var(--glass-text-primary)]">
        {content.questions.map((question) => (
          <fieldset key={question.id} className="space-y-2">
            <legend className="font-semibold">{question.header}</legend>
            <p className="text-xs leading-5 text-[var(--glass-text-secondary)]">
              {question.question}
            </p>
            {question.options ? (
              <div className="grid gap-2">
                {question.options.map((option) => {
                  const selected = values[question.id] === option.label
                  return (
                    <button
                      key={option.label}
                      type="button"
                      disabled={submitting}
                      className={`rounded-xl border px-3 py-2 text-left transition-colors ${selected ? 'border-neutral-900 bg-neutral-50' : 'border-[var(--glass-stroke-base)] bg-white hover:bg-neutral-100'}`}
                      onClick={() => {
                        setValues((current) => ({ ...current, [question.id]: option.label }))
                        setError(false)
                      }}
                    >
                      <span className="block font-medium">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block text-xs text-[var(--glass-text-secondary)]">
                          {option.description}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
            {question.isOther || !question.options ? (
              <input
                type={question.isSecret ? 'password' : 'text'}
                value={typeof values[question.id] === 'string' ? String(values[question.id]) : ''}
                disabled={submitting}
                className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2 outline-none focus:border-neutral-700"
                onChange={(event) => {
                  setValues((current) => ({ ...current, [question.id]: event.target.value }))
                  setError(false)
                }}
              />
            ) : null}
          </fieldset>
        ))}
        {error ? (
          <div role="alert" className="text-xs text-[var(--glass-tone-warn-fg)]">
            {t('cards.interactionSubmitErrorFallback')}
          </div>
        ) : null}
        <button
          type="button"
          disabled={!ready || submitting}
          className="w-full rounded-xl bg-neutral-900 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => {
            submit({
              answers: Object.fromEntries(
                content.questions.map((question) => [
                  question.id,
                  { answers: [String(values[question.id]).trim()] },
                ]),
              ),
            })
          }}
        >
          {submitting ? t('cards.interactionSubmitting') : t('cards.confirmContinue')}
        </button>
      </div>
    )
  }

  const elicitation = content.elicitation
  const schema = elicitation.requestedSchema
  const properties = schema && isRecord(schema.properties)
    ? Object.entries(schema.properties)
    : []
  const required = new Set(
    schema && Array.isArray(schema.required)
      ? schema.required.filter((key): key is string => typeof key === 'string')
      : [],
  )
  const schemaSupported = elicitation.mode === 'url' || (
    schema?.type === 'object'
    && properties.every(([, property]) => {
      if (!isRecord(property)) return false
      if (property.type === 'boolean' || property.type === 'string') return true
      if (property.type === 'number' || property.type === 'integer') return true
      return property.type === 'array'
        && isRecord(property.items)
        && runtimeEnumOptions(property.items).length > 0
    })
  )
  const formReady = schemaSupported && properties.every(([key, property]) => {
    if (!required.has(key)) return true
    if (!isRecord(property)) return false
    const value = values[key]
    if (property.type === 'boolean') return typeof value === 'boolean'
    if (property.type === 'array') return Array.isArray(value) && value.length > 0
    if (property.type === 'number' || property.type === 'integer') {
      if (typeof value !== 'string' || !value.trim()) return false
      const parsed = Number(value)
      return Number.isFinite(parsed)
        && (property.type !== 'integer' || Number.isInteger(parsed))
    }
    return typeof value === 'string' && value.trim().length > 0
  })
  const formContent = (): Record<string, unknown> => {
    const result: Record<string, unknown> = {}
    for (const [key, property] of properties) {
      if (!isRecord(property)) continue
      const value = values[key]
      if (property.type === 'boolean') {
        result[key] = value === true
        continue
      }
      if (property.type === 'number' || property.type === 'integer') {
        if (typeof value === 'string' && value.trim()) result[key] = Number(value)
        continue
      }
      if (property.type === 'array') {
        if (Array.isArray(value)) result[key] = value
        continue
      }
      if (typeof value === 'string' && value.trim()) result[key] = value.trim()
    }
    return result
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-sm text-[var(--glass-text-primary)]">
      <p className="leading-5">{elicitation.message}</p>
      {elicitation.mode === 'url' && elicitation.url ? (
        <a
          href={elicitation.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block break-all rounded-xl border border-[var(--glass-stroke-base)] px-3 py-2 text-xs underline"
        >
          {elicitation.url}
        </a>
      ) : null}
      {elicitation.mode === 'form' && schemaSupported ? (
        <div className="space-y-3">
          {properties.map(([key, property]) => {
            if (!isRecord(property)) return null
            const label = typeof property.title === 'string' && property.title.trim()
              ? property.title
              : key
            const description = typeof property.description === 'string'
              ? property.description
              : null
            const enumOptions = runtimeEnumOptions(property)
            if (property.type === 'boolean') {
              return (
                <label key={key} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={values[key] === true}
                    disabled={submitting}
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [key]: event.target.checked }))
                      setError(false)
                    }}
                  />
                  <span>
                    <span className="block font-medium">{label}</span>
                    {description ? (
                      <span className="block text-xs text-[var(--glass-text-secondary)]">
                        {description}
                      </span>
                    ) : null}
                  </span>
                </label>
              )
            }
            if (property.type === 'array' && isRecord(property.items)) {
              const options = runtimeEnumOptions(property.items)
              const selected = Array.isArray(values[key])
                ? values[key].filter((entry): entry is string => typeof entry === 'string')
                : []
              return (
                <fieldset key={key} className="space-y-1">
                  <legend className="font-medium">{label}</legend>
                  {options.map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selected.includes(option.value)}
                        disabled={submitting}
                        onChange={(event) => {
                          setValues((current) => ({
                            ...current,
                            [key]: event.target.checked
                              ? [...selected, option.value]
                              : selected.filter((value) => value !== option.value),
                          }))
                          setError(false)
                        }}
                      />
                      {option.label}
                    </label>
                  ))}
                </fieldset>
              )
            }
            return (
              <label key={key} className="block space-y-1">
                <span className="block font-medium">{label}</span>
                {description ? (
                  <span className="block text-xs text-[var(--glass-text-secondary)]">
                    {description}
                  </span>
                ) : null}
                {enumOptions.length > 0 ? (
                  <select
                    value={typeof values[key] === 'string' ? values[key] : ''}
                    disabled={submitting}
                    className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2"
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [key]: event.target.value }))
                      setError(false)
                    }}
                  >
                    <option value="" />
                    {enumOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={property.type === 'number' || property.type === 'integer' ? 'number' : 'text'}
                    step={property.type === 'integer' ? 1 : 'any'}
                    min={typeof property.minimum === 'number' ? property.minimum : undefined}
                    max={typeof property.maximum === 'number' ? property.maximum : undefined}
                    minLength={typeof property.minLength === 'number' ? property.minLength : undefined}
                    maxLength={typeof property.maxLength === 'number' ? property.maxLength : undefined}
                    value={typeof values[key] === 'string' ? values[key] : ''}
                    disabled={submitting}
                    className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2 outline-none focus:border-neutral-700"
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [key]: event.target.value }))
                      setError(false)
                    }}
                  />
                )}
              </label>
            )
          })}
        </div>
      ) : null}
      {!schemaSupported ? (
        <div role="alert" className="text-xs text-[var(--glass-tone-warn-fg)]">
          {t('panel.sessionStateError')}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="text-xs text-[var(--glass-tone-warn-fg)]">
          {t('cards.interactionSubmitErrorFallback')}
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={submitting || (elicitation.mode === 'form' && !formReady)}
          className="flex-1 rounded-xl bg-neutral-900 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => submit({
            action: 'accept',
            content: elicitation.mode === 'form' ? formContent() : null,
            _meta: null,
          })}
        >
          {submitting ? t('cards.interactionSubmitting') : t('cards.confirmContinue')}
        </button>
        <button
          type="button"
          disabled={submitting}
          className="rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2 font-medium hover:bg-neutral-100 disabled:opacity-50"
          onClick={() => submit({ action: 'decline', content: null, _meta: null })}
        >
          {t('cards.cancelAction')}
        </button>
      </div>
    </div>
  )
}

export default function WorkspaceAssistantPanel({
  projectId,
  selection,
  draftRequest,
  onDraftRequestConsumed,
  onClearSelection,
  autoStartDraft,
  autoStartKey,
  onAutoStartConsumed,
  onActiveOperationChange,
}: WorkspaceAssistantPanelProps) {
  const t = useTranslations('assistantAgent')
  const tErrors = useTranslations('errors')
  const resolveClientError = useClientErrorMessage()
  const assistantRuntime = useWorkspaceAssistantRuntime({
    projectId,
    selectedScopeRef: selection?.selectedScopeRef ?? null,
    selectedAssetId: selection?.selectedAssetId ?? null,
  })
  const panelScopeKey = projectId
  const panelScopeKeyRef = useRef(panelScopeKey)
  panelScopeKeyRef.current = panelScopeKey
  const panelResize = useWorkspaceAssistantPanelResize()
  const panelLayout = buildWorkspaceAssistantPanelLayout(panelResize.width)
  // 把面板实际宽度发布到 root CSS 变量,画布页 dock 依赖它贴靠面板左缘。
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty(WORKSPACE_ASSISTANT_PANEL_WIDTH_CSS_VAR, `${panelLayout.panelWidthPx}px`)
    return () => {
      root.style.removeProperty(WORKSPACE_ASSISTANT_PANEL_WIDTH_CSS_VAR)
    }
  }, [panelLayout.panelWidthPx])
  const composer = useWorkspaceAssistantComposer(assistantRuntime.sendMessage, panelScopeKey)
  const { applyDraftRequest } = composer
  useEffect(() => {
    if (!draftRequest) return
    applyDraftRequest(draftRequest)
    onDraftRequestConsumed(draftRequest.requestId)
  }, [applyDraftRequest, draftRequest, onDraftRequestConsumed])
  const [mediaUploadPending, setMediaUploadPending] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const uploadAttachmentFiles = async (files: readonly File[]): Promise<void> => {
    if (mediaUploadPending) return
    const uploadScopeKey = panelScopeKey
    setAttachmentError(null)
    const mediaFiles = files.filter(isProjectAssistantMediaFile)
    const textFiles = files.filter((file) => !isProjectAssistantMediaFile(file))
    const validationCode = mediaFiles
      .map(validateProjectAssistantMediaAttachmentFile)
      .find((code) => code !== null)
      ?? textFiles.map(validateProjectAssistantTextAttachmentFile).find((code) => code !== null)
    if (validationCode) {
      setAttachmentError(resolveClientError(new Error(validationCode), t('attachments.mediaUploadFailed')))
      return
    }
    if (mediaFiles.length + composer.mediaAttachments.length > PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES) {
      setAttachmentError(resolveClientError(new Error('PROJECT_ASSISTANT_MEDIA_ATTACHMENTS_TOO_MANY'), t('attachments.mediaUploadFailed')))
      return
    }
    if (textFiles.length + composer.attachments.length > PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES) {
      setAttachmentError(resolveClientError(new Error('PROJECT_ASSISTANT_TEXT_ATTACHMENTS_TOO_MANY'), t('attachments.mediaUploadFailed')))
      return
    }
    setMediaUploadPending(true)
    try {
      const mediaRoom =
        PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES - composer.mediaAttachments.length
      for (const file of mediaFiles.slice(0, Math.max(mediaRoom, 0))) {
        const attachment = await uploadProjectAssistantMediaAttachment({
          projectId,
          file,
        })
        if (panelScopeKeyRef.current !== uploadScopeKey) return
        composer.addMediaAttachment(attachment)
      }
      const textRoom = PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES - composer.attachments.length
      for (const file of textFiles.slice(0, Math.max(textRoom, 0))) {
        const attachment = await uploadProjectAssistantTextAttachment({ file })
        if (panelScopeKeyRef.current !== uploadScopeKey) return
        composer.addAttachment(attachment)
      }
    } catch (error) {
      if (panelScopeKeyRef.current === uploadScopeKey) {
        setAttachmentError(resolveClientError(error, t('attachments.mediaUploadFailed')))
      }
    } finally {
      if (panelScopeKeyRef.current === uploadScopeKey) {
        setMediaUploadPending(false)
      }
    }
  }
  const attachmentPicker = useAttachmentFilePicker({
    accept: `${PROJECT_ASSISTANT_TEXT_ATTACHMENT_ACCEPT},${PROJECT_ASSISTANT_MEDIA_ATTACHMENT_ACCEPT}`,
    disabled: assistantRuntime.pending || assistantRuntime.viewLoading,
    onFiles: (files) => {
      void uploadAttachmentFiles(files)
    },
  })
  useEffect(() => {
    panelScopeKeyRef.current = panelScopeKey
    setMediaUploadPending(false)
    setAttachmentError(null)
  }, [panelScopeKey])
  const sendAutoStartMessage = assistantRuntime.sendMessage
  const autoStartBlocked = assistantRuntime.viewLoading || assistantRuntime.pending
  const attemptedAutoStartKeysRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (
      !autoStartDraft
      || !autoStartKey
      || autoStartBlocked
      || attemptedAutoStartKeysRef.current.has(autoStartKey)
    ) {
      return
    }
    attemptedAutoStartKeysRef.current.add(autoStartKey)
    void sendAutoStartMessage({
      text: autoStartDraft.message,
      attachments: autoStartDraft.attachments,
      mediaAttachments: autoStartDraft.mediaAttachments,
      sourceKey: autoStartKey,
    }).then(() => {
      onAutoStartConsumed?.()
    }).catch(() => {
      // sendMessage owns the visible failure state. Keep the Home draft in
      // sessionStorage so a refresh can retry the same idempotent source key.
    })
  }, [
    autoStartBlocked,
    autoStartDraft,
    autoStartKey,
    onAutoStartConsumed,
    sendAutoStartMessage,
  ])

  useWorkspaceAssistantCanvasFocus({
    view: assistantRuntime.view,
    storageLoading: assistantRuntime.viewLoading,
    onActiveOperationChange,
  })
  const taskBatches = useMemo(
    () => assistantRuntime.view?.followUpBatches ?? [],
    [assistantRuntime.view?.followUpBatches],
  )
  const pendingInteraction = assistantRuntime.pendingInteraction
  const serverPendingApproval = isAssistantRuntimeApprovalRequest(pendingInteraction)
    ? pendingInteraction
    : null
  const activeRuntimeRequest = isAssistantRuntimeInputRequest(pendingInteraction)
    ? pendingInteraction
    : null
  const displayedRuntimeRequest = serverPendingApproval ? null : activeRuntimeRequest
  const partComponents = useWorkspaceAssistantMessagePartComponents()
  const showAssistantReplyLoading = shouldShowWorkspaceAssistantReplyLoading({
    storageLoading: assistantRuntime.viewLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    hasPendingInteraction: Boolean(pendingInteraction),
  })
  const showRunFailureNotice = shouldShowWorkspaceAssistantRunFailureNotice({
    storageLoading: assistantRuntime.viewLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    currentTurnStatus: assistantRuntime.view?.currentTurn?.status ?? null,
  })
  const showInterruptedNotice =
    !assistantRuntime.viewLoading &&
    !assistantRuntime.replyInFlight &&
    assistantRuntime.view?.currentTurn?.status === 'interrupted'
  // Run, send, and Task failures all resolve through the same view resolver,
  // so every failure surface uses the canonical error catalogue instead of
  // panel-local sentences or model-written guesses.
  const localizeErrorCode = useCallback(
    (code: string) => (tErrors.has(code) ? tErrors(code) : null),
    [tErrors],
  )
  const unknownFailureFallback = tErrors('INTERNAL_ERROR')
  const formatFailureReference = useCallback(
    (id: string) => tErrors('referenceId', { id }),
    [tErrors],
  )
  const currentTurn = assistantRuntime.view?.currentTurn ?? null
  const runFailureView = resolveWorkspaceAssistantFailureView({
    facts: {
      code: currentTurn?.errorCode?.trim() || null,
      requestId: currentTurn?.requestId?.trim() || null,
    },
    localizeCode: localizeErrorCode,
    formatReference: formatFailureReference,
    unknownFallback: unknownFailureFallback,
  })
  const composerFailureView =
    showRunFailureNotice || !assistantRuntime.error
      ? null
      : resolveWorkspaceAssistantFailureView({
          facts: parseWorkspaceAssistantFailureText(assistantRuntime.error.message),
          localizeCode: localizeErrorCode,
          formatReference: formatFailureReference,
          unknownFallback: unknownFailureFallback,
        })
  // Undelivered marker + resend draft are derived from persisted facts only
  // (failed `user_turn` current run + rendered message order); see the
  // resolver's doc comment for the attribution boundary. No second copy of
  // the message or its attachments is stored anywhere.
  const undeliveredUserMessage = useMemo(
    () =>
      resolveWorkspaceAssistantUndeliveredUserMessage({
        messages: assistantRuntime.messages,
        showDeliveryFailureNotice: showRunFailureNotice || showInterruptedNotice,
        currentTurnSourceKind: currentTurn?.sourceKind ?? null,
        currentTurnSourceId: currentTurn?.sourceId ?? null,
      }),
    [
      assistantRuntime.messages,
      currentTurn?.sourceId,
      currentTurn?.sourceKind,
      showInterruptedNotice,
      showRunFailureNotice,
    ],
  )
  const resendDraft = useMemo(
    () => resolveWorkspaceAssistantResendDraft(undeliveredUserMessage),
    [undeliveredUserMessage],
  )
  const sendMessage = assistantRuntime.sendMessage
  const resendUndeliveredMessage = useCallback(() => {
    if (!resendDraft) return
    // A resend is a brand-new user_turn through the single send authority.
    // Its failures surface through chat.error/controlError exactly like
    // composer sends; nothing may escape to the React overlay.
    void sendMessage({
      text: resendDraft.text,
      attachments: resendDraft.attachments,
      mediaAttachments: resendDraft.mediaAttachments,
    }).catch(() => undefined)
  }, [resendDraft, sendMessage])
  const taskBatchViews = useMemo(
    () =>
      taskBatches.map((batch) => {
        const operationIds = Array.from(
          new Set(batch.tasks.flatMap((task) => (task.operationId ? [task.operationId] : []))),
        ).sort()
        const failures = Array.from(
          new Map(
            batch.tasks.flatMap((task) => {
              if (!task.errorCode) return []
              const failure = resolveWorkspaceAssistantFailureView({
                facts: {
                  code: task.errorCode?.trim() || null,
                  requestId: task.taskId,
                },
                localizeCode: localizeErrorCode,
                formatReference: formatFailureReference,
                unknownFallback: unknownFailureFallback,
              })
              return [[`${failure.headline}\u0000${failure.technical ?? ''}`, failure] as const]
            }),
          ).values(),
        )
        return { batch, operationIds, failures }
      }),
    [formatFailureReference, localizeErrorCode, taskBatches, unknownFailureFallback],
  )

  return (
    <aside
      className="pointer-events-none fixed inset-y-0 right-0 z-20 w-0"
      style={{ width: `${panelLayout.occupiedWidthPx}px` }}
      data-state={panelLayout.state}
    >
      <div
        className={`glass-tower pointer-events-auto fixed inset-y-0 right-0 z-20 overflow-hidden ${panelResize.isResizing ? '' : 'transition-[width] duration-200 ease-out'}`}
        style={{
          width: `${panelLayout.panelWidthPx}px`,
        }}
        data-state={panelLayout.state}
      >
        <button
          type="button"
          aria-label={t('panel.resize')}
          title={t('panel.resize')}
          className="absolute inset-y-0 left-0 z-30 w-2 cursor-ew-resize bg-transparent"
          onPointerDown={panelResize.onResizePointerDown}
        />
        <div className="h-full opacity-100 transition-opacity duration-200">
          <WorkspaceAssistantRepeatedToolCallGroupProvider messages={assistantRuntime.messages}>
            <AssistantRuntimeProvider runtime={assistantRuntime.runtime}>
              <ThreadPrimitive.Root
                key={projectId}
                className="relative flex h-full min-h-0 flex-col"
              >
                <WorkspaceAssistantSettings />
                <ThreadPrimitive.Viewport
                  autoScroll
                  className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-4 pt-12"
                  style={WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE}
                >
                  <WorkspaceAssistantRunningSurfaceProvider
                    activeTurn={assistantRuntime.replyInFlight}
                  >
                    <div className="min-w-0">
                      <div className="space-y-3">
                          <ThreadPrimitive.Messages>
                            {() => (
                              <WorkspaceAssistantThreadMessage
                                messagePartComponents={partComponents}
                                undeliveredUserMessageId={undeliveredUserMessage?.id ?? null}
                              />
                            )}
                          </ThreadPrimitive.Messages>
                          {showAssistantReplyLoading ? (
                            <WorkspaceAssistantPendingTurnPlaceholder
                              label={
                                assistantRuntime.backgroundFollowUpActive
                                  ? t('panel.backgroundFollowUpRunning')
                                  : undefined
                              }
                            />
                          ) : null}
                          {assistantRuntime.viewError ? (
                            <div
                              role="alert"
                              className="rounded-md border border-[var(--glass-tone-warn-fg)]/25 bg-[var(--glass-tone-warn-bg)]/70 px-3 py-2 text-sm leading-5 text-[var(--glass-tone-warn-fg)]"
                            >
                              {t('panel.sessionStateError')}
                            </div>
                          ) : null}
                          {showRunFailureNotice ? (
                            <WorkspaceAssistantRunFailureNotice
                              failure={runFailureView}
                              resend={
                                resendDraft
                                  ? {
                                      pending:
                                        assistantRuntime.pending || assistantRuntime.viewLoading,
                                      onResend: resendUndeliveredMessage,
                                    }
                                  : null
                              }
                            />
                          ) : null}
                          {showInterruptedNotice ? (
                            <WorkspaceAssistantRunFailureNotice
                              title={t('panel.turnInterruptedTitle')}
                              failure={{
                                tone: 'info',
                                headline: t('panel.turnInterruptedDescription'),
                                technical: currentTurn?.requestId
                                  ? formatFailureReference(currentTurn.requestId)
                                  : null,
                              }}
                              resend={
                                resendDraft
                                  ? {
                                      pending:
                                        assistantRuntime.pending || assistantRuntime.viewLoading,
                                      onResend: resendUndeliveredMessage,
                                    }
                                  : null
                              }
                            />
                          ) : null}
                          {!assistantRuntime.viewLoading
                            ? taskBatchViews.map((view) => (
                                <WorkspaceAssistantActiveRunCard
                                  key={view.batch.batchId}
                                  operationIds={view.operationIds}
                                  progress={view.batch.progress}
                                  failures={view.failures}
                                />
                              ))
                            : null}
                          {serverPendingApproval ? (
                            <ConfirmationActionCard
                              members={[{
                                operationId: serverPendingApproval.method,
                                title: runtimeApprovalTitle(
                                  serverPendingApproval,
                                  t('cards.confirmationRequired'),
                                ),
                                operationPlan: null,
                                details: runtimePermissionApprovalFacts(serverPendingApproval).map((fact) => {
                                  switch (fact.kind) {
                                    case 'cwd': return t('runtime.permission.cwd', { value: fact.value })
                                    case 'network': return t('runtime.permission.network', { value: fact.value })
                                    case 'fileSystem': return t('runtime.permission.fileSystem', { value: fact.value })
                                  }
                                }),
                              }]}
                              subtitle={t('cards.confirmationRequired')}
                              onConfirm={() =>
                                assistantRuntime.resolveApproval({
                                  decision: 'approve',
                                })
                              }
                              onCancel={() =>
                                assistantRuntime.resolveApproval({
                                  decision: 'reject',
                                })
                              }
                            />
                          ) : null}
                      </div>
                    </div>
                  </WorkspaceAssistantRunningSurfaceProvider>
                </ThreadPrimitive.Viewport>

                <div className="mx-4 mb-2 shrink-0">
                  {displayedRuntimeRequest ? (
                    <div className="mb-2">
                      <WorkspaceAssistantRuntimeRequestCard
                        key={displayedRuntimeRequest.interactionId}
                        interaction={displayedRuntimeRequest}
                        onSubmit={assistantRuntime.submitInteractionResponse}
                      />
                    </div>
                  ) : null}
                  <div className="relative">
                    {assistantRuntime.view?.thread?.plan ? (
                      <WorkspaceAssistantPlanCard
                        plan={assistantRuntime.view.thread.plan}
                        isRunActive={assistantRuntime.view.currentTurn?.status === 'running'}
                      />
                    ) : null}
                    <WorkspaceAssistantComposer
                        value={composer.text}
                        textareaRef={composer.textareaRef}
                        selection={selection}
                        error={composerFailureView}
                        pending={assistantRuntime.pending || assistantRuntime.viewLoading}
                        canStopReply={assistantRuntime.canStopReply}
                        attachments={composer.attachments}
                        mediaAttachments={composer.mediaAttachments}
                        attachDisabled={
                          composer.attachments.length >=
                            PROJECT_ASSISTANT_TEXT_ATTACHMENT_MAX_FILES &&
                          composer.mediaAttachments.length >=
                            PROJECT_ASSISTANT_MEDIA_ATTACHMENT_MAX_FILES
                        }
                        mediaUploadPending={mediaUploadPending}
                        attachmentError={attachmentError}
                        onChange={composer.setText}
                        onSubmit={async () => {
                          setAttachmentError(null)
                          // The selected canvas image is delivered as a real
                          // media attachment (signed receipt from the single
                          // token authority), so the model actually sees it.
                          // A mint failure blocks the send with a visible
                          // error instead of silently sending a blind message.
                          let extraMediaAttachments: readonly ProjectAssistantMediaAttachment[] = []
                          if (selection?.mediaType === 'image') {
                            try {
                              extraMediaAttachments = [await mintProjectAssistantResourceAttachment({
                                projectId,
                                resourceId: selection.targetId,
                                previewUrl: selection.previewUrl,
                              })]
                            } catch (error) {
                              setAttachmentError(resolveClientError(error, t('attachments.mediaUploadFailed')))
                              return
                            }
                          }
                          // Send failures surface through chat.error/controlError
                          // (rendered under the composer); never as an unhandled
                          // rejection reaching the React overlay.
                          try {
                            await composer.submit({ extraMediaAttachments })
                          } catch {
                            return
                          }
                          // The selection is consumed by the delivered message;
                          // a lingering chip after send reads as "still pending".
                          if (selection) onClearSelection()
                        }}
                        onStopReply={assistantRuntime.stopReply}
                        onAttachClick={attachmentPicker.open}
                        onRemoveAttachment={composer.removeAttachment}
                        onRemoveMediaAttachment={composer.removeMediaAttachment}
                        onPasteMediaFiles={(files) => {
                          void uploadAttachmentFiles(files)
                        }}
                        onClearSelection={onClearSelection}
                    />
                  </div>
                </div>
              </ThreadPrimitive.Root>
            </AssistantRuntimeProvider>
          </WorkspaceAssistantRepeatedToolCallGroupProvider>
        </div>
      </div>
      {attachmentPicker.input}
    </aside>
  )
}
