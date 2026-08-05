import type { RuntimeJsonObject } from '@/lib/codex-runtime/runtime-adapter'
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
import {
  CREATIVE_RUNTIME_SKILLS,
  CREATIVE_SKILL_REGISTRY,
  PRIMARY_AGENT_DISABLED_NATIVE_SKILL_IDS,
  creativeSkillRoutingInstructions,
  creativeOutputJsonSchema,
} from '@/lib/creative-skills'
import { buildProjectAgentSystemPrompt } from '@/lib/ai-prompts/project-agent-system'
import {
  formatProjectProductionContext,
  readProjectProductionContext,
  type ProjectProductionContext,
} from '@/lib/project-production-context'

const MCP_PATH = '/api/internal/codex-runtime/mcp'
// Codex defaults MCP tool calls to 60 seconds. Wao production calls can spend
// most of that time planning before they suspend on a user-owned billing
// decision, so the default races the approval UI. Keep the call alive for the
// same bounded lifetime as its project capability token; Wao still owns plan
// validity, idempotency, cancellation, and execution state.
const WAO_MCP_TOOL_TIMEOUT_SECONDS = WAO_RUNTIME_TOKEN_MAX_TTL_SECONDS

export const ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS = buildProjectAgentSystemPrompt(
  creativeSkillRoutingInstructions(),
)

export const ASSISTANT_RUNTIME_CODEX_VERSION = '0.146.0' as const

export const ASSISTANT_RUNTIME_STATIC_CONTRACT = {
  thread: {
    approvalPolicy: 'on-request',
    sandbox: 'workspace-write',
    serviceName: 'wao-creative-agent',
    personality: 'pragmatic',
    ephemeral: false,
  },
  tools: {
    webSearch: 'live',
    features: {
      skillSearch: false,
      imageGeneration: false,
      standaloneWebSearch: true,
      remoteCompactionV2: false,
      codeMode: {
        enabled: true,
        directOnlyToolNamespaces: ['wao'],
      },
      codeModeHost: {
        enabled: true,
        disableInProcessFallback: true,
      },
    },
    waoMcp: {
      required: true,
      defaultToolsApprovalMode: 'approve',
    },
    modelProvider: {
      wireApi: 'responses',
      requiresOpenAiAuth: false,
      supportsStandaloneWebSearch: true,
    },
  },
  creativeRuntime: {
    agentsEnabled: false,
    primaryAgentGlobalInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
    disabledNativeSkillIds: PRIMARY_AGENT_DISABLED_NATIVE_SKILL_IDS,
    skills: CREATIVE_SKILL_REGISTRY,
    runtimeSkills: CREATIVE_RUNTIME_SKILLS,
    outputSchemas: Object.fromEntries(CREATIVE_RUNTIME_SKILLS.map((skill) => [
      skill.outputKind,
      creativeOutputJsonSchema(skill.outputKind),
    ])),
  },
} as const

export type AssistantRuntimeAccess = {
  readonly environment: Readonly<Record<string, string>>
  readonly bearerToken: string
  readonly ownerToken: string
  readonly expiresAtMs: number
}

export type AssistantRuntimeModelConfiguration = {
  readonly modelKey: string
  readonly runtimeModel: string
  readonly projectProductionContext: ProjectProductionContext
  readonly thread: RuntimeSessionThreadConfiguration
}

function requireAbsoluteHttpUrl(value: string | undefined, code: string): string {
  if (!value || value !== value.trim()) throw new Error(code)
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(code)
  if (url.username || url.password || url.hash || url.search) throw new Error(code)
  return url.toString().replace(/\/$/u, '')
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
  const tools = ASSISTANT_RUNTIME_STATIC_CONTRACT.tools
  return {
    // Codex owns the search tool the model sees, and that ownership is what
    // makes a search legible: Codex creates one `webSearch` item per call with
    // the model's own query, so three searches render as three rows. The
    // provider behind it is Wao's gateway, which delegates to OpenAI hosted
    // research — the tool is native, the capability is not OpenRouter's.
    web_search: tools.webSearch,
    features: {
      // Wao installs only its six registry-bound domain Skills. Built-in image
      // generation stays disabled; paid media crosses Wao's direct Operations.
      skill_search: tools.features.skillSearch,
      image_generation: tools.features.imageGeneration,
      // The custom provider answers search itself through /alpha/search. This
      // third switch is what installs the tool; provider capability and live
      // mode alone do not.
      standalone_web_search: tools.features.standaloneWebSearch,
      // Keep compaction local: Wao proxies Responses and standalone search,
      // not OpenAI's private remote-compaction endpoint.
      remote_compaction_v2: tools.features.remoteCompactionV2,
      // GPT-5.6 Sol/Terra select Codex's code-mode-only tool contract in their
      // official model metadata. The bundled process host must therefore be
      // available or those models fail closed without shell or Web Search.
      // Wao stays direct-model-only so business approval never crosses the
      // nested executor and still has one visible, product-owned protocol.
      code_mode: {
        enabled: tools.features.codeMode.enabled,
        direct_only_tool_namespaces: [...tools.features.codeMode.directOnlyToolNamespaces],
      },
      code_mode_host: {
        enabled: tools.features.codeModeHost.enabled,
        disable_in_process_fallback: tools.features.codeModeHost.disableInProcessFallback,
      },
    },
    mcp_servers: {
      wao: {
        url: input.mcpUrl,
        bearer_token_env_var: input.bearerTokenEnvironmentKey,
        required: tools.waoMcp.required,
        // Wao owns approval for its immutable production plan and quoted
        // budget. Codex approval remains enabled for shell/file permissions,
        // but must not add a second prompt in front of Wao MCP tools.
        default_tools_approval_mode: tools.waoMcp.defaultToolsApprovalMode,
        tool_timeout_sec: WAO_MCP_TOOL_TIMEOUT_SECONDS,
      },
    },
    model_providers: {
      [input.modelProviderId]: {
        name: 'Wao Responses Gateway',
        base_url: input.modelGatewayUrl,
        env_key: input.bearerTokenEnvironmentKey,
        wire_api: tools.modelProvider.wireApi,
        requires_openai_auth: tools.modelProvider.requiresOpenAiAuth,
        supports_standalone_web_search: tools.modelProvider.supportsStandaloneWebSearch,
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
  const [gateway, projectProductionContext] = await Promise.all([
    resolveCodexModelGatewayRuntimeConfig({
      scope: {
        ...input.scope,
        assistantId: 'workspace-command',
      },
      runtimeReachableWaoBaseUrl: waoBaseUrl,
      runtimeBearerToken: input.access.bearerToken,
    }),
    readProjectProductionContext(input.scope),
  ])
  const config = runtimeConfig({
    mcpUrl: `${waoBaseUrl}${MCP_PATH}`,
    modelGatewayUrl: gateway.baseUrl,
    modelProviderId: gateway.modelProviderId,
    bearerTokenEnvironmentKey: gateway.bearerTokenEnvironmentKey,
    requestMaxRetries: gateway.requestMaxRetries,
    streamMaxRetries: gateway.streamMaxRetries,
  })
  const sandbox = runtimeSandboxMode()
  const threadContract = ASSISTANT_RUNTIME_STATIC_CONTRACT.thread
  const start = {
    model: gateway.runtimeModelId,
    modelProvider: gateway.modelProviderId,
    approvalPolicy: threadContract.approvalPolicy,
    sandbox,
    config,
    serviceName: threadContract.serviceName,
    developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
    personality: threadContract.personality,
    ephemeral: threadContract.ephemeral,
  }
  return {
    modelKey: gateway.modelKey,
    runtimeModel: gateway.runtimeModelId,
    projectProductionContext,
    thread: {
      start,
      resume: {
        model: gateway.runtimeModelId,
        modelProvider: gateway.modelProviderId,
        approvalPolicy: threadContract.approvalPolicy,
        sandbox,
        config,
        developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
        personality: threadContract.personality,
      },
    },
  }
}

export function buildAssistantRuntimeTurnContext(
  locale: string,
  projectProductionContext: ProjectProductionContext,
): string {
  const normalized = locale.trim()
  if (!normalized || normalized.length > 64) {
    throw new Error('ASSISTANT_RUNTIME_LOCALE_INVALID')
  }
  return [
    '<wao_turn_context>',
    `locale: ${JSON.stringify(normalized)}`,
    'Write every user-visible response, progress update, plan explanation, and reasoning summary in this locale unless the user explicitly requests another language.',
    'Use this same working language for every user-visible project folder, document, and Resource name unless the user explicitly requests another language.',
    '<wao_project_production_context>',
    formatProjectProductionContext(projectProductionContext),
    '</wao_project_production_context>',
    '</wao_turn_context>',
  ].join('\n')
}
