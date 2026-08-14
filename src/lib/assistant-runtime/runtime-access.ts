import type { RuntimeJsonObject } from '@/lib/codex-runtime/runtime-adapter'
import type {
  RuntimeSessionScope,
  RuntimeSessionThreadConfiguration,
} from '@/lib/codex-runtime/runtime-session-manager'
import {
  issueWaoRuntimeToken,
} from '@/lib/wao-mcp/runtime-token'
import {
  CODEX_DEFAULT_MODEL_ID,
} from '@/lib/ai-providers/codex/constants'
import {
  CREATIVE_RUNTIME_SKILLS,
  CREATIVE_SKILL_REGISTRY,
  creativeSkillRoutingInstructions,
  creativeOutputJsonSchema,
} from '@/lib/creative-skills'
import {
  buildProjectAgentBasePrompt,
  buildProjectAgentSystemPrompt,
} from '@/lib/ai-prompts/project-agent-system'
import {
  formatProjectProductionContext,
  readProjectProductionContext,
  type ProjectProductionContext,
} from '@/lib/project-production-context'

const MCP_PATH = '/api/internal/codex-runtime/mcp'
const WAO_MCP_RUNTIME_BEARER_ENV_KEY = 'WAO_MCP_RUNTIME_BEARER_TOKEN' as const
// Codex defaults MCP tool calls to 60 seconds. Wao production calls can spend
// most of that time planning before they suspend on a user-owned decision, so
// the default races the approval UI. Bound the interaction independently from
// placement authorization; Wao still owns plan validity, idempotency,
// cancellation, and execution state.
const WAO_MCP_TOOL_TIMEOUT_SECONDS = 60 * 60

export const ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS = buildProjectAgentSystemPrompt(
  creativeSkillRoutingInstructions(),
)

// The custom base replaces Codex's built-in coding-agent base prompt. It keeps
// the load-bearing channel, formatting, update, and autonomy contract verbatim
// and drops the Codex identity plus coding-only rules (apply_patch/git editing
// constraints, review mindset, frontend design).
export const ASSISTANT_RUNTIME_BASE_INSTRUCTIONS = buildProjectAgentBasePrompt()

export const ASSISTANT_RUNTIME_CODEX_VERSION = '0.147.0-alpha.6.6' as const

export const ASSISTANT_RUNTIME_STATIC_CONTRACT = {
  thread: {
    // Shell, rule, Skill, and permission escalation have no product-owned UI,
    // so denied commands must fail in place. Destructive Wao actions are MCP
    // elicitations with authenticated browser proof and remain the one
    // interactive approval class.
    approvalPolicy: {
      granular: {
        sandbox_approval: false,
        rules: false,
        skill_approval: false,
        request_permissions: false,
        mcp_elicitations: true,
      },
    },
    sandbox: 'workspace-write',
    serviceName: 'wao-creative-agent',
    // 'none': the pragmatic preset injects a software-engineer persona into the
    // Codex base prompt; tone is owned solely by our developer instructions.
    personality: 'none',
    ephemeral: false,
  },
  tools: {
    webSearch: 'live',
    features: {
      skillSearch: false,
      imageGeneration: false,
      standaloneWebSearch: false,
      remoteCompactionV2: true,
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
  },
  creativeRuntime: {
    primaryAgentGlobalInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
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
  readonly bearerTokenEnvironmentKey: string
}): RuntimeJsonObject {
  const tools = ASSISTANT_RUNTIME_STATIC_CONTRACT.tools
  return {
    // Codex owns the search tool and its native authenticated capability.
    web_search: tools.webSearch,
    features: {
      // Wao installs only its six registry-bound domain Skills. Built-in image
      // generation stays disabled; media generation crosses Wao's direct Operations.
      skill_search: tools.features.skillSearch,
      image_generation: tools.features.imageGeneration,
      standalone_web_search: tools.features.standaloneWebSearch,
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
        // Wao owns confirmation for destructive production actions. Codex
        // approval remains enabled for shell/file permissions,
        // but must not add a second prompt in front of Wao MCP tools.
        default_tools_approval_mode: tools.waoMcp.defaultToolsApprovalMode,
        tool_timeout_sec: WAO_MCP_TOOL_TIMEOUT_SECONDS,
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
  })
  return {
    environment: Object.freeze({
      [WAO_MCP_RUNTIME_BEARER_ENV_KEY]: issued.token,
    }),
    bearerToken: issued.token,
    ownerToken: issued.payload.nonce,
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
  const projectProductionContext = await readProjectProductionContext(input.scope)
  const sandbox = runtimeSandboxMode()
  const config = runtimeConfig({
    mcpUrl: `${waoBaseUrl}${MCP_PATH}`,
    bearerTokenEnvironmentKey: WAO_MCP_RUNTIME_BEARER_ENV_KEY,
  })
  const threadContract = ASSISTANT_RUNTIME_STATIC_CONTRACT.thread
  const start = {
    model: CODEX_DEFAULT_MODEL_ID,
    approvalPolicy: threadContract.approvalPolicy,
    sandbox,
    config,
    serviceName: threadContract.serviceName,
    baseInstructions: ASSISTANT_RUNTIME_BASE_INSTRUCTIONS,
    developerInstructions: ASSISTANT_RUNTIME_DEVELOPER_INSTRUCTIONS,
    personality: threadContract.personality,
    ephemeral: threadContract.ephemeral,
  }
  return {
    modelKey: `codex::${CODEX_DEFAULT_MODEL_ID}`,
    runtimeModel: CODEX_DEFAULT_MODEL_ID,
    projectProductionContext,
    thread: {
      start,
      resume: {
        model: CODEX_DEFAULT_MODEL_ID,
        approvalPolicy: threadContract.approvalPolicy,
        sandbox,
        config,
        baseInstructions: ASSISTANT_RUNTIME_BASE_INSTRUCTIONS,
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
