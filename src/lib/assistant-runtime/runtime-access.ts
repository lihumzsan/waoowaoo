import type { RuntimeJsonObject } from '@/lib/codex-runtime/runtime-adapter'
import { HUMAN_VISUAL_SAFETY_POLICY } from '@/lib/ai-prompts'
import type {
  RuntimeSessionScope,
  RuntimeSessionThreadConfiguration,
} from '@/lib/codex-runtime/runtime-session-manager'
import {
  issueWaoRuntimeToken,
  WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS,
} from '@/lib/wao-mcp/runtime-token'
import {
  CODEX_RUNTIME_BEARER_ENV_KEY,
  resolveCodexModelGatewayRuntimeConfig,
} from '@/lib/codex-model-gateway'
import { ASSISTANT_RUNTIME_REVISION } from './runtime-revision'

const MCP_PATH = '/api/internal/codex-runtime/mcp'
// Codex defaults MCP tool calls to 60 seconds. Wao production calls can spend
// most of that time planning before they suspend on a user-owned billing
// decision, so the default races the approval UI. Keep the call alive for the
// same bounded lifetime as its project capability token; Wao still owns plan
// validity, idempotency, cancellation, and execution state.
const WAO_MCP_TOOL_TIMEOUT_SECONDS = WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS

export type AssistantRuntimeAccess = {
  readonly environment: Readonly<Record<string, string>>
  readonly bearerToken: string
  readonly ownerToken: string
  readonly expiresAtMs: number
}

export type AssistantRuntimeModelConfiguration = {
  readonly modelKey: string
  readonly runtimeModel: string
  readonly runtimeRevision: string
  readonly thread: RuntimeSessionThreadConfiguration
}

function requireAbsoluteHttpUrl(value: string | undefined, code: string): string {
  if (!value || value !== value.trim()) throw new Error(code)
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(code)
  if (url.username || url.password || url.hash || url.search) throw new Error(code)
  return url.toString().replace(/\/$/u, '')
}

function runtimeInstructions(): string {
  return [
    'You are the Wao creative production agent for the current project workspace.',
    'Treat system/project.json as a read-only projection of product facts.',
    'Creative methods are installed as native Codex Skills. Read the relevant Skill completely before using it.',
    'Project files outside system/ are the creative workspace. Organize them freely with normal file and shell tools.',
    'Never create, edit, move, or delete system/**. Never edit a .resource pointer; move or delete it as one file.',
    'Use the wao MCP server for real image, video, audio, billing, approval, Task, and Resource operations.',
    'The current native Web Search provider supports search_query only. Do not call image_query, open, click, find, screenshot, finance, weather, sports, or time through that tool; unsupported commands fail explicitly.',
    'The wao MCP server exposes tools, not MCP resources or resource templates. Explore project state through workspace files and use Wao tools directly; do not call list_mcp_resources or list_mcp_resource_templates for wao.',
    'Before a Wao operation creates a Resource, create every outputPath parent directory in the workspace; the MCP boundary flushes those directories before planning.',
    'Never claim an external production operation completed unless the wao MCP result says it completed.',
    'Do not retry a billed or failed production operation unless the user explicitly authorizes it.',
    'If a native Plan exists, keep it synchronized with the currently authorized scope. Before ending a Turn, update it so finished work is completed and superseded steps are removed; never leave an obsolete pending step after reporting the scoped task complete.',
    'For a complete video longer than 15 seconds, establish one matching Creative Direction and only the reusable reference assets the final video will actually consume before submitting video generation.',
    'For a complete video longer than 60 seconds, explicitly evaluate music direction; an intentional empty cue list is a valid no-music decision.',
    'When a speaking character must keep the same voice across shots, create and bind one stable character voice before the dependent video prompts; do not turn a single isolated line into a mandatory voice workflow.',
    HUMAN_VISUAL_SAFETY_POLICY,
  ].join('\n')
}

function runtimeSandboxMode(): 'workspace-write' {
  const driver = process.env.CODEX_RUNTIME_DRIVER
  if (driver === 'local' || driver === 'docker') return 'workspace-write'
  throw new Error('ASSISTANT_RUNTIME_DRIVER_REQUIRED')
}

function runtimeConfig(input: {
  readonly mcpUrl: string
  readonly modelGatewayUrl: string
  readonly modelProviderId: string
  readonly bearerTokenEnvironmentKey: string
  readonly requestMaxRetries: number
  readonly streamMaxRetries: number
}): RuntimeJsonObject {
  return {
    web_search: 'live',
    features: {
      // Custom-provider standalone search remains an explicit Codex feature
      // gate. Provider capability plus live mode do not expose the tool
      // without this third switch.
      standalone_web_search: true,
      // Keep compaction local: Wao proxies Responses and standalone search,
      // not OpenAI's private remote-compaction endpoint.
      remote_compaction_v2: false,
      // GPT-5.6 Sol/Terra select Codex's code-mode-only tool contract in their
      // official model metadata. The bundled process host must therefore be
      // available or those models fail closed without shell or Web Search.
      // Wao stays direct-model-only so business approval never crosses the
      // nested executor and still has one visible, product-owned protocol.
      code_mode: {
        enabled: true,
        direct_only_tool_namespaces: ['wao'],
      },
      code_mode_host: {
        enabled: true,
        disable_in_process_fallback: true,
      },
    },
    mcp_servers: {
      wao: {
        url: input.mcpUrl,
        bearer_token_env_var: input.bearerTokenEnvironmentKey,
        required: true,
        // Wao owns approval for its immutable production plan and quoted
        // budget. Codex approval remains enabled for shell/file permissions,
        // but must not add a second prompt in front of Wao MCP tools.
        default_tools_approval_mode: 'approve',
        tool_timeout_sec: WAO_MCP_TOOL_TIMEOUT_SECONDS,
      },
    },
    model_providers: {
      [input.modelProviderId]: {
        name: 'Wao Responses Gateway',
        base_url: input.modelGatewayUrl,
        env_key: input.bearerTokenEnvironmentKey,
        wire_api: 'responses',
        requires_openai_auth: false,
        supports_standalone_web_search: true,
        request_max_retries: input.requestMaxRetries,
        stream_max_retries: input.streamMaxRetries,
      },
    },
  }
}

export function issueAssistantRuntimeAccess(scope: RuntimeSessionScope): AssistantRuntimeAccess {
  const issued = issueWaoRuntimeToken({
    scope: {
      userId: scope.userId,
      projectId: scope.projectId,
      assistantId: 'workspace-command',
    },
    ttlSeconds: WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS,
  })
  return {
    environment: Object.freeze({
      [CODEX_RUNTIME_BEARER_ENV_KEY]: issued.token,
    }),
    bearerToken: issued.token,
    ownerToken: issued.payload.nonce,
    expiresAtMs: issued.payload.expiry * 1_000,
  }
}

export async function resolveAssistantRuntimeModelConfiguration(
  input: {
    readonly scope: RuntimeSessionScope
    readonly access: AssistantRuntimeAccess
  },
): Promise<AssistantRuntimeModelConfiguration> {
  const waoBaseUrl = requireAbsoluteHttpUrl(
    process.env.CODEX_RUNTIME_WAO_BASE_URL,
    'ASSISTANT_RUNTIME_WAO_BASE_URL_REQUIRED',
  )
  const gateway = await resolveCodexModelGatewayRuntimeConfig({
    scope: {
      ...input.scope,
      assistantId: 'workspace-command',
    },
    runtimeReachableWaoBaseUrl: waoBaseUrl,
    runtimeBearerToken: input.access.bearerToken,
  })
  const config = runtimeConfig({
    mcpUrl: `${waoBaseUrl}${MCP_PATH}`,
    modelGatewayUrl: gateway.baseUrl,
    modelProviderId: gateway.modelProviderId,
    bearerTokenEnvironmentKey: gateway.bearerTokenEnvironmentKey,
    requestMaxRetries: gateway.requestMaxRetries,
    streamMaxRetries: gateway.streamMaxRetries,
  })
  const sandbox = runtimeSandboxMode()
  const start = {
    model: gateway.runtimeModelId,
    modelProvider: gateway.modelProviderId,
    approvalPolicy: 'on-request' as const,
    sandbox,
    config,
    serviceName: 'wao-creative-agent',
    developerInstructions: runtimeInstructions(),
    personality: 'pragmatic' as const,
    ephemeral: false,
  }
  return {
    modelKey: gateway.modelKey,
    runtimeModel: gateway.runtimeModelId,
    runtimeRevision: ASSISTANT_RUNTIME_REVISION,
    thread: {
      start,
      resume: {
        model: gateway.runtimeModelId,
        modelProvider: gateway.modelProviderId,
        approvalPolicy: 'on-request',
        sandbox,
        config,
        developerInstructions: runtimeInstructions(),
        personality: 'pragmatic',
      },
    },
  }
}

export function buildAssistantRuntimeTurnContext(locale: string): string {
  const normalized = locale.trim()
  if (!normalized || normalized.length > 64) {
    throw new Error('ASSISTANT_RUNTIME_LOCALE_INVALID')
  }
  return [
    '<wao_turn_context>',
    `locale: ${JSON.stringify(normalized)}`,
    'Write every user-visible response, progress update, plan explanation, and reasoning summary in this locale unless the user explicitly requests another language.',
    '</wao_turn_context>',
  ].join('\n')
}
