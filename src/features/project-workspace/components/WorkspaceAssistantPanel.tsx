'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useTranslations } from 'next-intl'
import { AssistantRuntimeProvider, ThreadPrimitive } from '@assistant-ui/react'
import { AppIcon } from '@/components/ui/icons'
import { UserErrorActionLink } from '@/components/errors/UserErrorActionLink'
import { useAttachmentFilePicker } from '@/components/project-assistant/useAttachmentFilePicker'
import {
  isAssistantRuntimeApprovalRequest,
  isAssistantRuntimeInputRequest,
  readAssistantRuntimeMcpElicitation,
  type AssistantRuntimePendingInteractionView,
} from '@/lib/assistant-runtime/view-contract'
import {
  readWaoMcpUserDecisionPresentation,
  type WaoMcpUserDecisionPresentation,
  WAO_MCP_USER_DECISION_OPTION_FIELD,
  WAO_MCP_USER_DECISION_OTHER_FIELD,
  WAO_MCP_USER_DECISION_OTHER_OPTION_ID,
} from '@/lib/wao-mcp/user-decision'
import { isWaoMcpApprovalRequestMeta } from '@/lib/wao-mcp/approval-contract'
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
  shouldShowWorkspaceAssistantDeliveryFailure,
  shouldShowWorkspaceAssistantReplyLoading,
  shouldShowWorkspaceAssistantRunFailureNotice,
  type WorkspaceAssistantFailureView,
} from './workspace-assistant/workspace-assistant-panel-state'
import { useClientErrorMessage } from '@/hooks/useClientErrorMessage'
import { WorkspaceAssistantWorkspaceLinkProvider } from './workspace-assistant/workspace-assistant-workspace-link'

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
  onOpenWorkspacePath: (workspacePath: string) => void
}

export const WORKSPACE_ASSISTANT_VIEWPORT_FADE_STYLE = {
  WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
  maskImage: 'linear-gradient(to bottom, transparent 0, black 28px, black 100%)',
} satisfies CSSProperties

function WorkspaceAssistantRunFailureNotice({
  failure,
  title,
  action,
}: {
  failure: WorkspaceAssistantFailureView
  title?: string
  action: {
    readonly label: string
    readonly pendingLabel: string
    readonly pending: boolean
    readonly onClick: () => void
  } | null
}) {
  const t = useTranslations('assistantAgent')
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md bg-[var(--glass-tone-surface)] shadow-[var(--glass-tone-shadow)] px-3 py-2 text-sm leading-5 text-[var(--glass-tone-warning-fg)]"
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
        {failure.action === 'recharge' ? (
          <UserErrorActionLink
            action={failure.action}
            className="mt-1.5 inline-flex rounded-md border border-[var(--glass-tone-warning-fg)]/30 bg-white/70 px-2 py-1 text-xs font-medium text-[var(--glass-tone-warning-fg)] transition-colors hover:bg-white"
          />
        ) : action ? (
          <button
            type="button"
            disabled={action.pending}
            onClick={action.onClick}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-[var(--glass-tone-warning-fg)]/30 bg-white/70 px-2 py-1 text-xs font-medium text-[var(--glass-tone-warning-fg)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AppIcon name="refresh" className="h-3 w-3 shrink-0" />
            {action.pending ? action.pendingLabel : action.label}
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
      readonly kind: 'elicitation'
      readonly elicitation: ReturnType<typeof readAssistantRuntimeMcpElicitation>
      readonly userDecisionPresentation: WaoMcpUserDecisionPresentation | null
    }
  | { readonly kind: 'invalid' }

function parseRuntimeRequestContent(
  interaction: AssistantRuntimePendingInteractionView,
): RuntimeRequestContent {
  try {
    if (interaction.method === 'mcpServer/elicitation/request') {
      const elicitation = readAssistantRuntimeMcpElicitation(interaction)
      return {
        kind: 'elicitation',
        elicitation,
        userDecisionPresentation: readWaoMcpUserDecisionPresentation({
          requestedSchema: elicitation.requestedSchema,
          meta: elicitation.meta,
        }),
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

  if (props.interaction.status === 'decided') {
    return (
      <div className="rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-sm">
        <button
          type="button"
          disabled={submitting}
          className="w-full rounded-xl bg-neutral-900 px-3 py-2 font-medium text-white disabled:opacity-50"
          onClick={() => submit({})}
        >
          {submitting ? t('cards.interactionSubmitting') : t('cards.confirmContinue')}
        </button>
      </div>
    )
  }

  if (content.kind === 'invalid') {
    return (
      <div
        role="alert"
        className="rounded-md bg-[var(--glass-tone-surface)] shadow-[var(--glass-tone-shadow)] px-3 py-2 text-sm text-[var(--glass-tone-warning-fg)]"
      >
        {t('panel.sessionStateError')}
      </div>
    )
  }

  const elicitation = content.elicitation
  const schema = elicitation.requestedSchema
  const userDecisionPresentation = content.userDecisionPresentation
  const isWaoUserDecision = userDecisionPresentation !== null
  const isWaoApproval = isWaoMcpApprovalRequestMeta(elicitation.meta)
  const properties = schema && isRecord(schema.properties)
    ? Object.entries(schema.properties)
    : []
  const otherDecisionProperty = isWaoUserDecision
    ? properties.find(([key]) => key === WAO_MCP_USER_DECISION_OTHER_FIELD)?.[1]
    : null
  const otherDecisionLabel = isRecord(otherDecisionProperty)
    && typeof otherDecisionProperty.title === 'string'
    && otherDecisionProperty.title.trim()
    ? otherDecisionProperty.title
    : null
  const otherDecisionValue = typeof values[WAO_MCP_USER_DECISION_OTHER_FIELD] === 'string'
    ? values[WAO_MCP_USER_DECISION_OTHER_FIELD]
    : ''
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
  const formReady = schemaSupported && (isWaoApproval || properties.every(([key, property]) => {
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
  }))
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
  const submitCustomDecision = (): void => {
    const answer = otherDecisionValue.trim()
    if (!answer || submitting) return
    submit({
      action: 'accept',
      content: {
        [WAO_MCP_USER_DECISION_OPTION_FIELD]: WAO_MCP_USER_DECISION_OTHER_OPTION_ID,
        [WAO_MCP_USER_DECISION_OTHER_FIELD]: answer,
      },
      _meta: null,
    })
  }

  return (
    <div className="relative space-y-3 rounded-2xl border border-[var(--glass-stroke-base)] bg-white p-3 text-sm text-[var(--glass-text-primary)]">
      {isWaoUserDecision ? (
        <button
          type="button"
          aria-label={t('cards.cancelDecision')}
          title={t('cards.cancelDecision')}
          disabled={submitting}
          className="absolute right-2.5 top-2.5 rounded-full p-1.5 text-[var(--glass-text-secondary)] transition-colors hover:bg-neutral-100 hover:text-[var(--glass-text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={() => submit({ action: 'decline', content: null, _meta: null })}
        >
          <AppIcon name="close" className="h-4 w-4" />
        </button>
      ) : null}
      <p className={`leading-5 ${isWaoUserDecision ? 'pr-8' : ''}`}>{elicitation.message}</p>
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
            if (isWaoApproval && key === 'confirmed') return null
            const label = typeof property.title === 'string' && property.title.trim()
              ? property.title
              : key
            const description = typeof property.description === 'string'
              ? property.description
              : null
            const enumOptions = runtimeEnumOptions(property)
            if (isWaoUserDecision && key === WAO_MCP_USER_DECISION_OTHER_FIELD) return null
            if (
              isWaoUserDecision
              && key === WAO_MCP_USER_DECISION_OPTION_FIELD
              && enumOptions.length > 0
            ) {
              const decisionOptions = enumOptions.filter(
                (option) => option.value !== WAO_MCP_USER_DECISION_OTHER_OPTION_ID,
              )
              return (
                <fieldset key={key} className="space-y-2">
                  <legend className="font-semibold">{label}</legend>
                  {description && !isWaoUserDecision ? (
                    <p className="whitespace-pre-line text-xs leading-5 text-[var(--glass-text-secondary)]">
                      {description}
                    </p>
                  ) : null}
                  <div className="grid gap-2">
                    {decisionOptions.map((option) => {
                      const presentationOption = userDecisionPresentation.options.find(
                        (candidate) => candidate.id === option.value,
                      )
                      if (!presentationOption) {
                        throw new Error('WAO_MCP_USER_DECISION_PRESENTATION_INVALID')
                      }
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={submitting}
                          className="rounded-xl border border-[var(--glass-stroke-base)] bg-white px-3 py-2 text-left font-medium transition-colors hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
                          onClick={() => submit({
                            action: 'accept',
                            content: { [WAO_MCP_USER_DECISION_OPTION_FIELD]: option.value },
                            _meta: null,
                          })}
                        >
                          <span className="block font-semibold">{option.label}</span>
                          <span className="mt-1 block text-xs font-normal leading-5 text-[var(--glass-text-secondary)]">
                            {presentationOption.description}
                          </span>
                        </button>
                      )
                    })}
                    {otherDecisionLabel ? (
                      <div className="relative">
                        <input
                          type="text"
                          minLength={isRecord(otherDecisionProperty) && typeof otherDecisionProperty.minLength === 'number'
                            ? otherDecisionProperty.minLength
                            : undefined}
                          maxLength={isRecord(otherDecisionProperty) && typeof otherDecisionProperty.maxLength === 'number'
                            ? otherDecisionProperty.maxLength
                            : undefined}
                          value={otherDecisionValue}
                          placeholder={otherDecisionLabel}
                          disabled={submitting}
                          className="w-full rounded-xl border border-[var(--glass-stroke-base)] bg-white py-2 pl-3 pr-11 outline-none focus:border-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
                          onChange={(event) => {
                            setValues((current) => ({
                              ...current,
                              [WAO_MCP_USER_DECISION_OTHER_FIELD]: event.target.value,
                            }))
                            setError(false)
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                            event.preventDefault()
                            submitCustomDecision()
                          }}
                        />
                        <button
                          type="button"
                          aria-label={t('cards.sendDecision')}
                          title={t('cards.sendDecision')}
                          disabled={submitting || !otherDecisionValue.trim()}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-neutral-900 p-1.5 text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
                          onClick={submitCustomDecision}
                        >
                          <AppIcon name="arrowRight" className="h-4 w-4" />
                        </button>
                      </div>
                    ) : null}
                  </div>
                </fieldset>
              )
            }
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
                  <span className="block whitespace-pre-line text-xs text-[var(--glass-text-secondary)]">
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
        <div role="alert" className="text-xs text-[var(--glass-tone-warning-fg)]">
          {t('panel.sessionStateError')}
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="text-xs text-[var(--glass-tone-warning-fg)]">
          {t('cards.interactionSubmitErrorFallback')}
        </div>
      ) : null}
      {!isWaoUserDecision ? (
        <div className="flex gap-2">
          <button
            type="button"
            disabled={submitting || (elicitation.mode === 'form' && !formReady)}
            className="flex-1 rounded-xl bg-neutral-900 px-3 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => submit({
              action: 'accept',
              content: isWaoApproval
                ? { confirmed: true }
                : elicitation.mode === 'form' ? formContent() : null,
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
      ) : null}
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
  onOpenWorkspacePath,
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
  const currentTurn = assistantRuntime.view?.currentTurn ?? null
  const showInterruptedNotice =
    !assistantRuntime.viewLoading &&
    !assistantRuntime.replyInFlight &&
    currentTurn?.status === 'interrupted' &&
    currentTurn.cancelReason !== 'user_cancelled'
  const showDeliveryFailureNotice = shouldShowWorkspaceAssistantDeliveryFailure({
    storageLoading: assistantRuntime.viewLoading,
    replyInFlight: assistantRuntime.replyInFlight,
    currentTurnStatus: currentTurn?.status ?? null,
    currentTurnStartedAt: currentTurn?.startedAt ?? null,
  })
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
  const formatFailureDiagnostic = useCallback(
    (message: string) => tErrors('providerDiagnostic', { message }),
    [tErrors],
  )
  const runFailureView = resolveWorkspaceAssistantFailureView({
    facts: {
      code: currentTurn?.errorCode?.trim() || null,
      requestId: currentTurn?.requestId?.trim() || null,
      diagnostic: currentTurn?.errorDiagnostic?.trim() || null,
    },
    localizeCode: localizeErrorCode,
    formatReference: formatFailureReference,
    formatDiagnostic: formatFailureDiagnostic,
    unknownFallback: unknownFailureFallback,
  })
  const composerFailureView =
    showRunFailureNotice || !assistantRuntime.error
      ? null
      : resolveWorkspaceAssistantFailureView({
          facts: parseWorkspaceAssistantFailureText(assistantRuntime.error.message),
          localizeCode: localizeErrorCode,
          formatReference: formatFailureReference,
          formatDiagnostic: formatFailureDiagnostic,
          unknownFallback: unknownFailureFallback,
        })
  // Undelivered marker + resend draft are derived from persisted facts only:
  // exact source message identity plus the absence of runtime start. A Turn
  // interrupted after it started is resumable work, never an undelivered send.
  const undeliveredUserMessage = useMemo(
    () =>
      resolveWorkspaceAssistantUndeliveredUserMessage({
        messages: assistantRuntime.messages,
        showDeliveryFailureNotice,
        currentTurnSourceKind: currentTurn?.sourceKind ?? null,
        currentTurnSourceId: currentTurn?.sourceId ?? null,
      }),
    [
      assistantRuntime.messages,
      currentTurn?.sourceId,
      currentTurn?.sourceKind,
      showDeliveryFailureNotice,
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
  const continueInterruptedTurn = useCallback(() => {
    // This is a new Product Turn with a new message-command identity. It asks
    // the Agent to reconcile durable facts and never replays the failed source
    // message or reopens its terminal Turn.
    void sendMessage({
      text: t('panel.continueInterruptedInstruction'),
      attachments: [],
      mediaAttachments: [],
    }).catch(() => undefined)
  }, [sendMessage, t])
  const canContinueInterruptedTurn = Boolean(
    currentTurn?.startedAt
      && (
        currentTurn.status === 'failed'
        || (currentTurn.status === 'interrupted' && currentTurn.cancelReason !== 'user_cancelled')
      ),
  )
  const failureActionPending = assistantRuntime.pending || assistantRuntime.viewLoading
  const continueAction = canContinueInterruptedTurn
    ? {
        label: t('panel.continueInterrupted'),
        pendingLabel: t('panel.continuing'),
        pending: failureActionPending,
        onClick: continueInterruptedTurn,
      }
    : null
  const resendAction = resendDraft
    ? {
        label: t('panel.resend'),
        pendingLabel: t('panel.sending'),
        pending: failureActionPending,
        onClick: resendUndeliveredMessage,
      }
    : null
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
          <WorkspaceAssistantRepeatedToolCallGroupProvider
            messages={assistantRuntime.messages}
          >
            <WorkspaceAssistantWorkspaceLinkProvider
              openWorkspacePath={onOpenWorkspacePath}
            >
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
                              className="rounded-md bg-[var(--glass-tone-surface)] shadow-[var(--glass-tone-shadow)] px-3 py-2 text-sm leading-5 text-[var(--glass-tone-warning-fg)]"
                            >
                              {t('panel.sessionStateError')}
                            </div>
                          ) : null}
                          {showRunFailureNotice ? (
                            <WorkspaceAssistantRunFailureNotice
                              failure={runFailureView}
                              action={continueAction ?? resendAction}
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
                                action: null,
                              }}
                              action={continueAction ?? resendAction}
                            />
                          ) : null}
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
                              retryOnly={serverPendingApproval.status === 'decided'}
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
                    {assistantRuntime.view?.currentTurn?.plan ? (
                      <WorkspaceAssistantPlanCard
                        plan={assistantRuntime.view.currentTurn.plan}
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
            </WorkspaceAssistantWorkspaceLinkProvider>
          </WorkspaceAssistantRepeatedToolCallGroupProvider>
        </div>
      </div>
      {attachmentPicker.input}
    </aside>
  )
}
