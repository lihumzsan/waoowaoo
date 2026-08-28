import { createHash } from 'node:crypto'
import {
  buildProjectAgentBasePrompt,
  buildProjectAgentSystemPrompt,
} from '@/lib/ai-prompts/project-agent-system'
import {
  creativeSkillRoutingInstructions,
  type CreativeRuntimeSkillFile,
} from '@/lib/creative-skills'
import { readCreativeRuntimeConfiguration } from '@/lib/creative-skills/runtime-skills'

const ASSISTANT_RUNTIME_CONTRACT_SCHEMA = 'wao-assistant-runtime-contract-v1'

export type AssistantRuntimeContractRevisionInput = {
  readonly baseInstructions: string
  readonly developerInstructions: string
  readonly runtimeSkills: readonly {
    readonly skillId: string
    readonly content: string
  }[]
}

export type AssistantRuntimeContractSnapshot = AssistantRuntimeContractRevisionInput & {
  readonly runtimeSkills: readonly CreativeRuntimeSkillFile[]
  readonly revision: string
}

type AssistantRuntimeContractProcessState = typeof globalThis & {
  __waoAssistantRuntimeContractSnapshots?: Map<string, AssistantRuntimeContractSnapshot>
}

function admittedContractSnapshots(): Map<string, AssistantRuntimeContractSnapshot> {
  const state = globalThis as AssistantRuntimeContractProcessState
  state.__waoAssistantRuntimeContractSnapshots ??= new Map()
  return state.__waoAssistantRuntimeContractSnapshots
}

function addFramedHashValue(hash: ReturnType<typeof createHash>, value: string): void {
  const bytes = Buffer.from(value, 'utf8')
  const length = Buffer.allocUnsafe(4)
  length.writeUInt32BE(bytes.byteLength)
  hash.update(length)
  hash.update(bytes)
}

export function buildAssistantRuntimeContractRevision(
  input: AssistantRuntimeContractRevisionInput,
): string {
  const hash = createHash('sha256')
  addFramedHashValue(hash, ASSISTANT_RUNTIME_CONTRACT_SCHEMA)
  addFramedHashValue(hash, input.baseInstructions)
  addFramedHashValue(hash, input.developerInstructions)
  const runtimeSkills = [...input.runtimeSkills]
    .sort((left, right) => (
      left.skillId < right.skillId ? -1 : left.skillId > right.skillId ? 1 : 0
    ))
  addFramedHashValue(hash, String(runtimeSkills.length))
  for (const skill of runtimeSkills) {
    addFramedHashValue(hash, skill.skillId)
    addFramedHashValue(hash, skill.content)
  }
  return hash.digest('hex')
}

export async function readAssistantRuntimeContractSnapshot(): Promise<AssistantRuntimeContractSnapshot> {
  const baseInstructions = buildProjectAgentBasePrompt()
  const developerInstructions = buildProjectAgentSystemPrompt(
    creativeSkillRoutingInstructions(),
  )
  const runtimeSkills = Object.freeze(
    (await readCreativeRuntimeConfiguration()).map((skill) => Object.freeze(skill)),
  )
  const snapshot: AssistantRuntimeContractSnapshot = Object.freeze({
    baseInstructions,
    developerInstructions,
    runtimeSkills,
    revision: buildAssistantRuntimeContractRevision({
      baseInstructions,
      developerInstructions,
      runtimeSkills,
    }),
  })
  const snapshots = admittedContractSnapshots()
  const admitted = snapshots.get(snapshot.revision)
  if (admitted) return admitted
  snapshots.set(snapshot.revision, snapshot)
  return snapshot
}

export function requireAdmittedAssistantRuntimeContractSnapshot(
  expectedRevision: string,
): AssistantRuntimeContractSnapshot {
  const snapshot = admittedContractSnapshots().get(expectedRevision)
  if (!snapshot) throw new Error('ASSISTANT_RUNTIME_CONTRACT_SNAPSHOT_NOT_ADMITTED')
  return snapshot
}
