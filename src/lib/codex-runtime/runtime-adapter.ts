export type RuntimeJsonPrimitive = string | number | boolean | null

export type RuntimeJsonValue =
  | RuntimeJsonPrimitive
  | RuntimeJsonValue[]
  | { [key: string]: RuntimeJsonValue }

export type RuntimeJsonObject = { [key: string]: RuntimeJsonValue }

export type RuntimeRequestId = string | number

export type RuntimeClientInfo = {
  readonly name: string
  readonly title: string | null
  readonly version: string
}

export type RuntimeInitializeCapabilities = {
  readonly experimentalApi: boolean
  readonly requestAttestation: boolean
  readonly mcpServerOpenaiFormElicitation?: boolean
  readonly optOutNotificationMethods?: readonly string[] | null
}

export type RuntimeInitializeResult = {
  readonly userAgent: string
  readonly codexHome: string
  readonly platformFamily: string
  readonly platformOs: string
  readonly raw: RuntimeJsonObject
}

export type RuntimeImageDetail = 'auto' | 'low' | 'high' | 'original'

export type RuntimeUserInput =
  | {
      readonly type: 'text'
      readonly text: string
    }
  | {
      readonly type: 'image'
      readonly url: string
      readonly detail?: RuntimeImageDetail
    }
  | {
      readonly type: 'localImage'
      readonly path: string
      readonly detail?: RuntimeImageDetail
    }
  | {
      readonly type: 'skill'
      readonly name: string
      readonly path: string
    }
  | {
      readonly type: 'mention'
      readonly name: string
      readonly path: string
    }

export type RuntimeApprovalPolicy =
  | 'untrusted'
  | 'on-request'
  | 'never'
  | {
      readonly granular: {
        readonly sandbox_approval: boolean
        readonly rules: boolean
        readonly skill_approval: boolean
        readonly request_permissions: boolean
        readonly mcp_elicitations: boolean
      }
    }

export type RuntimeSandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'

export type RuntimeSandboxPolicy =
  | {
      readonly type: 'dangerFullAccess'
    }
  | {
      readonly type: 'readOnly'
      readonly networkAccess: boolean
    }
  | {
      readonly type: 'externalSandbox'
      readonly networkAccess?: 'restricted' | 'enabled'
    }
  | {
      readonly type: 'workspaceWrite'
      readonly writableRoots: readonly string[]
      readonly networkAccess: boolean
      readonly excludeTmpdirEnvVar: boolean
      readonly excludeSlashTmp: boolean
    }

export type RuntimePersonality = 'none' | 'friendly' | 'pragmatic'
export type RuntimeReasoningSummary = 'auto' | 'concise' | 'detailed' | 'none'
export type RuntimeTurnStatus = 'completed' | 'interrupted' | 'failed' | 'inProgress'
export type RuntimeCollaborationMode = {
  readonly mode: 'default' | 'plan'
  readonly settings: {
    readonly model: string
    readonly reasoning_effort: string | null
    /** null selects Codex's built-in instructions for this native mode. */
    readonly developer_instructions: string | null
  }
}

export type RuntimeThread = {
  readonly id: string
  readonly raw: RuntimeJsonObject
}

export type RuntimeTurn = {
  readonly id: string
  readonly status: RuntimeTurnStatus
  readonly raw: RuntimeJsonObject
}

export type RuntimeThreadStartParams = {
  readonly model?: string
  readonly modelProvider?: string
  readonly serviceTier?: string | null
  readonly cwd?: string
  readonly approvalPolicy?: RuntimeApprovalPolicy
  readonly sandbox?: RuntimeSandboxMode
  readonly config?: RuntimeJsonObject
  readonly serviceName?: string
  readonly baseInstructions?: string
  readonly developerInstructions?: string
  readonly personality?: RuntimePersonality
  readonly ephemeral?: boolean
}

export type RuntimeThreadResumeParams = {
  readonly threadId: string
  readonly model?: string
  readonly modelProvider?: string
  readonly serviceTier?: string | null
  readonly cwd?: string
  readonly approvalPolicy?: RuntimeApprovalPolicy
  readonly sandbox?: RuntimeSandboxMode
  readonly config?: RuntimeJsonObject
  readonly baseInstructions?: string
  readonly developerInstructions?: string
  readonly personality?: RuntimePersonality
}

export type RuntimeThreadReadParams = {
  readonly threadId: string
  readonly includeTurns?: boolean
}

export type RuntimeSkillsListParams = {
  readonly cwds?: readonly string[]
  readonly forceReload?: boolean
}

export type RuntimeSkillMetadata = {
  readonly name: string
  readonly description: string
  readonly path: string
  readonly scope: 'user' | 'repo' | 'system' | 'admin'
  readonly enabled: boolean
}

export type RuntimeSkillError = {
  readonly path: string
  readonly message: string
}

export type RuntimeSkillsListEntry = {
  readonly cwd: string
  readonly skills: readonly RuntimeSkillMetadata[]
  readonly errors: readonly RuntimeSkillError[]
}

export type RuntimeSkillsListResponse = {
  readonly data: readonly RuntimeSkillsListEntry[]
}

export type RuntimeTurnStartParams = {
  readonly threadId: string
  readonly clientUserMessageId?: string
  readonly input: readonly RuntimeUserInput[]
  readonly cwd?: string
  readonly approvalPolicy?: RuntimeApprovalPolicy
  readonly sandboxPolicy?: RuntimeSandboxPolicy
  readonly model?: string
  readonly serviceTier?: string | null
  readonly effort?: string
  readonly summary?: RuntimeReasoningSummary
  readonly personality?: RuntimePersonality
  readonly outputSchema?: RuntimeJsonValue
  readonly collaborationMode?: RuntimeCollaborationMode
}

export type RuntimeTurnSteerParams = {
  readonly threadId: string
  readonly clientUserMessageId?: string
  readonly input: readonly RuntimeUserInput[]
  readonly expectedTurnId: string
}

export type RuntimeTurnInterruptParams = {
  readonly threadId: string
  readonly turnId: string
}

export type RuntimeServerRequest = {
  readonly id: RuntimeRequestId
  readonly method: string
  readonly params: RuntimeJsonObject
}

export type RuntimeServerRequestResponse =
  | {
      readonly id: RuntimeRequestId
      readonly result: RuntimeJsonValue
    }
  | {
      readonly id: RuntimeRequestId
      readonly error: {
        readonly code: number
        readonly message: string
        readonly data?: RuntimeJsonValue
      }
    }

export type RuntimeEvent =
  | {
      readonly type: 'notification'
      readonly method: string
      readonly params: RuntimeJsonObject
    }
  | {
      readonly type: 'serverRequest'
      readonly request: RuntimeServerRequest
    }
  | {
      readonly type: 'processExited'
      readonly code: number | null
      readonly signal: NodeJS.Signals | null
      readonly expected: boolean
    }
  | {
      readonly type: 'protocolError'
      readonly error: Error
    }

export type RuntimeEventListener = (event: RuntimeEvent) => void

export interface RuntimeAdapter {
  readonly closed: boolean

  initialize(): Promise<RuntimeInitializeResult>
  startThread(params: RuntimeThreadStartParams): Promise<RuntimeThread>
  resumeThread(params: RuntimeThreadResumeParams): Promise<RuntimeThread>
  readThread(params: RuntimeThreadReadParams): Promise<RuntimeThread>
  listSkills(params: RuntimeSkillsListParams): Promise<RuntimeSkillsListResponse>
  startTurn(params: RuntimeTurnStartParams): Promise<RuntimeTurn>
  steerTurn(params: RuntimeTurnSteerParams): Promise<string>
  interruptTurn(params: RuntimeTurnInterruptParams): Promise<void>
  hasPendingServerRequest(requestId: RuntimeRequestId): boolean
  respondToServerRequest(response: RuntimeServerRequestResponse): Promise<void>
  subscribe(listener: RuntimeEventListener): () => void
  shutdown(): Promise<void>
}
