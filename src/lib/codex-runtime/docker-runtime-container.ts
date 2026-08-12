import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { CodexAppServerClient } from './app-server-client'
import type { RuntimeClientInfo, RuntimeInitializeCapabilities } from './runtime-adapter'
import { normalizeRuntimeScopedEnvironment } from './runtime-container'
import type {
  RuntimeContainerAdapter,
  RuntimeContainerHandle,
  RuntimeContainerLaunchRequest,
} from './runtime-container'

const execFileAsync = promisify(execFile)
const MANAGED_LABEL = 'wao.codex-runtime.managed'
const SCOPE_LABEL = 'wao.codex-runtime.scope'
const OWNER_LABEL = 'wao.codex-runtime.owner'
const CONTAINER_WORKSPACE_DIRECTORY = '/workspace'
const CONTAINER_CODEX_HOME_DIRECTORY = '/runtime/codex-home'
const CONTAINER_RUNTIME_SKILLS_DIRECTORY = '/workspace/.agents/skills'
const MIN_MEMORY_BYTES = 256 * 1024 * 1024
const RUNTIME_LOG_MAX_SIZE = '50m'
const RUNTIME_LOG_MAX_FILES = '5'
const BWRAP_DOCKER_CAPABILITIES = [
  'SETGID',
  'SETUID',
  'SYS_CHROOT',
  'SYS_ADMIN',
  'NET_ADMIN',
  'SYS_PTRACE',
] as const

export type DockerRuntimeContainerOptions = {
  readonly image: string
  readonly networkName: string
  readonly clientInfo: RuntimeClientInfo
  readonly initializeCapabilities: RuntimeInitializeCapabilities
  readonly cpuLimit: number
  readonly memoryBytes: number
  readonly pidsLimit: number
  readonly immutableImageRequired: boolean
  readonly dockerCommand?: string
  readonly processEnvironment?: NodeJS.ProcessEnv
  readonly shutdownTimeoutMs?: number
}

export class DockerRuntimeContainerAdapter implements RuntimeContainerAdapter {
  private readonly options: DockerRuntimeContainerOptions

  constructor(options: DockerRuntimeContainerOptions) {
    validateOptions(options)
    this.options = options
  }

  async reconcile(scopeIdValue: string): Promise<void> {
    const scopeId = requireScopeId(scopeIdValue)
    const result = await this.runDocker([
      'container',
      'ls',
      '--all',
      '--quiet',
      '--filter',
      `label=${MANAGED_LABEL}=true`,
      '--filter',
      `label=${SCOPE_LABEL}=${scopeId}`,
    ])
    const containerIds = result.stdout
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean)
    if (containerIds.some((value) => !/^[a-f0-9]{12,64}$/u.test(value))) {
      throw new Error('CODEX_DOCKER_RUNTIME_CONTAINER_ID_INVALID')
    }
    if (containerIds.length > 0) {
      await this.runDocker(['container', 'rm', '--force', ...containerIds])
    }
  }

  async launch(request: RuntimeContainerLaunchRequest): Promise<RuntimeContainerHandle> {
    const scopeId = requireScopeId(request.scopeId)
    const ownerHash = createHash('sha256').update(request.ownerToken, 'utf8').digest('hex')
    const workspaceDirectory = requireAbsolutePath(
      request.materialization.hostWorkspaceDirectory,
      'CODEX_DOCKER_RUNTIME_WORKSPACE_INVALID',
    )
    const codexHomeDirectory = requireAbsolutePath(
      request.materialization.hostCodexHomeDirectory,
      'CODEX_DOCKER_RUNTIME_HOME_INVALID',
    )
    const runtimeSkillsDirectory = path.join(workspaceDirectory, '.agents', 'skills')
    const containerName = `wao-codex-${scopeId.slice(0, 20)}-${randomUUID().slice(0, 8)}`
    const environment = normalizeRuntimeScopedEnvironment(request.environment)
    const dockerProcessEnvironment = {
      ...(this.options.processEnvironment ?? process.env),
      ...environment,
    }
    const dockerArgs = [
      'run',
      '--rm',
      '--interactive',
      '--name',
      containerName,
      '--label',
      `${MANAGED_LABEL}=true`,
      '--label',
      `${SCOPE_LABEL}=${scopeId}`,
      '--label',
      `${OWNER_LABEL}=${ownerHash}`,
      '--network',
      this.options.networkName,
      '--cpus',
      String(this.options.cpuLimit),
      '--memory',
      String(this.options.memoryBytes),
      '--pids-limit',
      String(this.options.pidsLimit),
      '--log-driver',
      'json-file',
      '--log-opt',
      `max-size=${RUNTIME_LOG_MAX_SIZE}`,
      '--log-opt',
      `max-file=${RUNTIME_LOG_MAX_FILES}`,
      '--read-only',
      '--cap-drop',
      'ALL',
      // Codex 0.146 creates a second Linux sandbox with setuid bubblewrap.
      // Keep app-server non-root and grant only the capabilities required to
      // construct that inner namespace; the inner Codex seccomp policy remains
      // the command boundary required by CRR-03.
      ...BWRAP_DOCKER_CAPABILITIES.flatMap((capability) => [
        '--cap-add',
        capability,
      ]),
      '--security-opt',
      'seccomp=unconfined',
      '--security-opt',
      'apparmor=unconfined',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,noexec,size=268435456',
      '--mount',
      buildBindMount(workspaceDirectory, CONTAINER_WORKSPACE_DIRECTORY, 'readwrite'),
      // Wao Skills are repo-scoped so native Skill reads stay inside the
      // Codex workspace policy. The nested read-only mount also prevents the
      // model from changing registry-generated methods through workspace write.
      '--mount',
      buildBindMount(runtimeSkillsDirectory, CONTAINER_RUNTIME_SKILLS_DIRECTORY, 'readonly'),
      '--mount',
      buildBindMount(codexHomeDirectory, CONTAINER_CODEX_HOME_DIRECTORY, 'readwrite'),
      '--workdir',
      CONTAINER_WORKSPACE_DIRECTORY,
      // Forward the selected variable names from the Docker CLI environment.
      // The short-lived project bearer must not be embedded in argv/process lists.
      ...Object.keys(environment).flatMap((name) => ['--env', name]),
      this.options.image,
    ]
    const runtime = new CodexAppServerClient({
      command: this.options.dockerCommand ?? 'docker',
      args: dockerArgs,
      cwd: workspaceDirectory,
      env: dockerProcessEnvironment,
      clientInfo: this.options.clientInfo,
      initializeCapabilities: this.options.initializeCapabilities,
      shutdownTimeoutMs: this.options.shutdownTimeoutMs,
    })
    let stopPromise: Promise<void> | null = null

    return {
      runtime,
      runtimeWorkspaceDirectory: CONTAINER_WORKSPACE_DIRECTORY,
      identity: containerName,
      stop: async (mode) => {
        if (stopPromise) return await stopPromise
        stopPromise = this.stopContainer(runtime, containerName, mode)
        return await stopPromise
      },
    }
  }

  private async stopContainer(
    runtime: CodexAppServerClient,
    containerName: string,
    mode: 'graceful' | 'force',
  ): Promise<void> {
    if (mode === 'graceful') {
      await runtime.shutdown()
    }
    const result = await this.runDocker([
      'container',
      'ls',
      '--all',
      '--quiet',
      '--filter',
      `name=^/${containerName}$`,
      '--filter',
      `label=${MANAGED_LABEL}=true`,
    ])
    if (result.stdout.trim()) {
      await this.runDocker(['container', 'rm', '--force', containerName])
    }
    if (mode === 'force') await runtime.shutdown()
  }

  private async runDocker(args: readonly string[]): Promise<{ readonly stdout: string; readonly stderr: string }> {
    const result = await execFileAsync(
      this.options.dockerCommand ?? 'docker',
      [...args],
      {
        env: this.options.processEnvironment ?? process.env,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
        killSignal: 'SIGKILL',
      },
    )
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    }
  }
}

function validateOptions(options: DockerRuntimeContainerOptions): void {
  if (!options.image || options.image !== options.image.trim() || /\s/u.test(options.image)) {
    throw new Error('CODEX_DOCKER_RUNTIME_IMAGE_INVALID')
  }
  if (options.immutableImageRequired && !/^.+@sha256:[a-f0-9]{64}$/u.test(options.image)) {
    throw new Error('CODEX_DOCKER_RUNTIME_IMAGE_DIGEST_REQUIRED')
  }
  if (options.immutableImageRequired && options.image.endsWith(`@sha256:${'0'.repeat(64)}`)) {
    throw new Error('CODEX_DOCKER_RUNTIME_IMAGE_DIGEST_PLACEHOLDER')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(options.networkName)) {
    throw new Error('CODEX_DOCKER_RUNTIME_NETWORK_INVALID')
  }
  if (!Number.isFinite(options.cpuLimit) || options.cpuLimit <= 0) {
    throw new Error('CODEX_DOCKER_RUNTIME_CPU_LIMIT_INVALID')
  }
  if (!Number.isSafeInteger(options.memoryBytes) || options.memoryBytes < MIN_MEMORY_BYTES) {
    throw new Error('CODEX_DOCKER_RUNTIME_MEMORY_LIMIT_INVALID')
  }
  if (!Number.isSafeInteger(options.pidsLimit) || options.pidsLimit < 32) {
    throw new Error('CODEX_DOCKER_RUNTIME_PIDS_LIMIT_INVALID')
  }
  if (
    options.initializeCapabilities.experimentalApi !== true
    || options.initializeCapabilities.mcpServerOpenaiFormElicitation !== false
  ) {
    throw new Error('CODEX_DOCKER_RUNTIME_INITIALIZE_CAPABILITIES_INVALID')
  }
}

function requireScopeId(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('CODEX_RUNTIME_SCOPE_ID_INVALID')
  return value
}

function requireAbsolutePath(value: string, code: string): string {
  const normalized = path.normalize(value.trim())
  if (!path.isAbsolute(normalized)) throw new Error(code)
  return normalized
}

function buildBindMount(
  source: string,
  destination: string,
  access: 'readonly' | 'readwrite',
): string {
  if (source.includes(',') || destination.includes(',')) {
    throw new Error('CODEX_DOCKER_RUNTIME_MOUNT_PATH_INVALID')
  }
  const readonlyOption = access === 'readonly' ? ',readonly' : ''
  return `type=bind,src=${source},dst=${destination}${readonlyOption}`
}
