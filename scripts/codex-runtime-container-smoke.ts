import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { AssistantRuntimePersistence } from '@/lib/assistant-runtime/runtime-persistence'
import {
  ASSISTANT_RUNTIME_STATIC_CONTRACT,
} from '@/lib/assistant-runtime/runtime-access'
import { DockerRuntimeContainerAdapter } from '@/lib/codex-runtime/docker-runtime-container'
import { PRODUCTION_CODEX_INITIALIZE_CAPABILITIES } from '@/lib/codex-runtime/runtime-config'
import { CREATIVE_RUNTIME_SKILLS } from '@/lib/creative-skills'

const execFileAsync = promisify(execFile)

function requireEnvironment(name: string): string {
  const value = process.env[name]
  if (!value || value !== value.trim()) throw new Error(`CODEX_CONTAINER_SMOKE_ENV_REQUIRED:${name}`)
  return value
}

function requirePositiveNumber(name: string): number {
  const value = Number(requireEnvironment(name))
  if (!Number.isFinite(value) || value <= 0) throw new Error(`CODEX_CONTAINER_SMOKE_ENV_INVALID:${name}`)
  return value
}

function requirePositiveInteger(name: string): number {
  const value = Number(requireEnvironment(name))
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`CODEX_CONTAINER_SMOKE_ENV_INVALID:${name}`)
  return value
}

async function main(): Promise<void> {
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    throw new Error('CODEX_CONTAINER_SMOKE_ROOT_FORBIDDEN:run as the Web process user')
  }
  const hostRoot = requireEnvironment('CODEX_RUNTIME_HOST_ROOT')
  const image = requireEnvironment('CODEX_RUNTIME_IMAGE')
  const scopeKey = `container-smoke-${randomUUID()}`
  const scopeId = createHash('sha256').update(scopeKey, 'utf8').digest('hex')
  const scope = { userId: scopeKey, projectId: scopeKey }
  const persistence = new AssistantRuntimePersistence({ hostRoot })
  const materialization = await persistence.materialize(scope)
  const adapter = new DockerRuntimeContainerAdapter({
    image,
    networkName: requireEnvironment('CODEX_RUNTIME_NETWORK'),
    clientInfo: {
      name: 'wao-container-smoke',
      title: 'Wao Codex Container Smoke',
      version: '0.1.0',
    },
    initializeCapabilities: PRODUCTION_CODEX_INITIALIZE_CAPABILITIES,
    cpuLimit: requirePositiveNumber('CODEX_RUNTIME_CPU_LIMIT'),
    memoryBytes: requirePositiveInteger('CODEX_RUNTIME_MEMORY_BYTES'),
    pidsLimit: requirePositiveInteger('CODEX_RUNTIME_PIDS_LIMIT'),
    immutableImageRequired: process.env.NODE_ENV === 'production',
    processEnvironment: process.env,
  })
  let handle: Awaited<ReturnType<Readonly<typeof adapter>['launch']>> | null = null

  try {
    await adapter.reconcile(scopeId)
    handle = await adapter.launch({
      scopeId,
      ownerToken: randomUUID(),
      materialization,
      environment: {
        WAO_MCP_RUNTIME_BEARER_TOKEN: 'container-smoke-token',
      },
    })
    const initialized = await handle.runtime.initialize()
    const skills = await handle.runtime.listSkills({
      cwds: [handle.runtimeWorkspaceDirectory],
      forceReload: true,
    })
    assert.equal(skills.data.length, 1)
    assert.deepEqual(skills.data[0]?.errors, [])
    const expectedSkillIds = CREATIVE_RUNTIME_SKILLS
      .map((skill) => skill.skillIds[1])
      .sort()
    const installedSkills = (skills.data[0]?.skills ?? [])
      .filter((skill) => skill.enabled)
      .sort((left, right) => left.name.localeCompare(right.name))
    assert.deepEqual(installedSkills.map((skill) => skill.name), expectedSkillIds)
    for (const skill of installedSkills) {
      assert.equal(skill.scope, 'repo')
      assert.equal(skill.path, `/workspace/.agents/skills/${skill.name}/SKILL.md`)
    }
    assert.deepEqual(ASSISTANT_RUNTIME_STATIC_CONTRACT.thread.approvalPolicy, {
      granular: {
        sandbox_approval: false,
        rules: false,
        skill_approval: false,
        request_permissions: false,
        mcp_elicitations: true,
      },
    })
    const thread = await handle.runtime.startThread({
      cwd: handle.runtimeWorkspaceDirectory,
      approvalPolicy: ASSISTANT_RUNTIME_STATIC_CONTRACT.thread.approvalPolicy,
      sandbox: ASSISTANT_RUNTIME_STATIC_CONTRACT.thread.sandbox,
      ephemeral: true,
    })
    assert.ok(thread.id)

    const sampleSkillId = expectedSkillIds[0]
    assert.ok(sampleSkillId)
    const sampleSkillPath = `/workspace/.agents/skills/${sampleSkillId}/SKILL.md`
    const sandboxProbeName = `.codex-sandbox-smoke-${randomUUID()}`
    await execFileAsync('docker', [
      'exec',
      handle.identity,
      'codex',
      'sandbox',
      '--',
      'sh',
      '-ec',
      [
        'test "$(id -u)" = "1000"',
        'test -r "$1"',
        'test ! -e "$HOME/skills/$2/SKILL.md"',
        'if sh -c \'printf x > "/workspace/$3"\' sh "$3" 2>/dev/null; then exit 1; fi',
        'if sh -c \'printf x >> "$1"\' sh "$1" 2>/dev/null; then exit 1; fi',
      ].join('\n'),
      'sh',
      sampleSkillPath,
      sampleSkillId,
      sandboxProbeName,
    ])

    process.stdout.write(`${JSON.stringify({
      ok: true,
      runtime: initialized.userAgent,
      image,
      approvalPolicy: ASSISTANT_RUNTIME_STATIC_CONTRACT.thread.approvalPolicy,
      sandbox: ASSISTANT_RUNTIME_STATIC_CONTRACT.thread.sandbox,
      skills: installedSkills.map((skill) => `${skill.name}@${skill.path}`),
      readonlySkillMount: true,
      nestedCodexSandbox: true,
    }, null, 2)}\n`)
  } finally {
    if (handle) await handle.stop('force').catch(() => undefined)
    await persistence.destroyMaterialization(materialization).catch(() => undefined)
    await persistence.clearScope(scope).catch(() => undefined)
  }
}

void main()
