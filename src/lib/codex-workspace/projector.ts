import type {
  CreativeResourceCardView,
  CreativeResourceJsonValue,
  CreativeResourceWorkingSetView,
} from '@/lib/creative-resource/contracts'
import {
  CREATIVE_SKILLS,
  readCreativeSkillResource,
} from '@/lib/creative-skills'
import {
  listProjectCreativeResourceCards,
  readProjectCreativeResourceWorkingSet,
} from '@/lib/creative-resource/view-service'
import {
  validateWorkspaceBundle,
  WORKSPACE_BUNDLE_SCHEMA_VERSION,
  type WorkspaceBundleFile,
  type WorkspaceBundleV1,
} from '@/lib/codex-runtime/workspace-bundle'
import { assembleProjectContext } from '@/lib/project-context/assembler'
import type { ProjectContextSnapshot } from '@/lib/project-context/types'
import {
  CODEX_WORKSPACE_PROJECT_FILE,
  CODEX_WORKSPACE_RESOURCE_INDEX_FILE,
  CODEX_WORKSPACE_SKILL_ROOT,
  CodexWorkspaceError,
  type CodexWorkspaceCurrentSelection,
  type CodexWorkspaceProjectSnapshot,
  type CodexWorkspaceProjection,
  type CodexWorkspaceResourceIndex,
  type CodexWorkspaceResourcePointer,
} from './contracts'
import { requireCodexAuthoringBundle } from './authoring'

const RESOURCE_VIEW_LIMIT = 200
const RESOURCE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u

function canonicalizeJson(value: CreativeResourceJsonValue): CreativeResourceJsonValue {
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalizeJson(value[key] ?? null)]),
  )
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function requireResourceId(resourceId: string): string {
  if (!RESOURCE_ID_PATTERN.test(resourceId)) {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_RESOURCE_ID_INVALID',
      `Resource ID cannot be projected into a workspace path: ${resourceId}`,
    )
  }
  return resourceId
}

function textContentPath(card: CreativeResourceCardView): string {
  const resourceId = requireResourceId(card.resource.resourceId)
  const content = card.resource.materialization?.content
  return content?.kind === 'structured'
    ? `system/text/${resourceId}.json`
    : `system/text/${resourceId}.txt`
}

function projectTextFile(card: CreativeResourceCardView): WorkspaceBundleFile {
  const content = card.resource.materialization?.content
  if (content?.kind === 'text') {
    return { path: textContentPath(card), content: content.text }
  }
  if (content?.kind === 'structured') {
    return {
      path: textContentPath(card),
      content: formatJson(canonicalizeJson(content.data)),
    }
  }
  throw new CodexWorkspaceError(
    'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID',
    `Ready text Resource has no text content: ${card.resource.resourceId}`,
  )
}

function projectResourcePointer(card: CreativeResourceCardView): CodexWorkspaceResourcePointer {
  const resource = card.resource
  const content = resource.materialization?.content
  if (!content) {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID',
      `Ready Resource is not materialized: ${resource.resourceId}`,
    )
  }
  const inputs = resource.materialization?.inputs ?? []
  return {
    resourceId: requireResourceId(resource.resourceId),
    scope: {
      kind: resource.scope.kind,
      projectId: resource.scope.projectId,
      episodeId: resource.scope.episodeId,
    },
    name: resource.name,
    mediaType: resource.mediaType,
    schemaId: resource.schemaId,
    prompt: resource.materialization?.provenance.prompt ?? null,
    contentPath: resource.mediaType === 'text' ? textContentPath(card) : null,
    media: content.kind === 'media'
      ? {
          mimeType: content.mimeType ?? null,
          width: content.width ?? null,
          height: content.height ?? null,
          durationMs: content.durationMs ?? null,
        }
      : null,
    inputs: inputs.map((input) => ({
      resourceId: input.resourceId,
      role: input.role,
      position: input.position,
    })),
  }
}

function projectCurrentSelections(
  workingSet: CreativeResourceWorkingSetView,
): CodexWorkspaceCurrentSelection[] {
  return [...workingSet.currentSelections]
    .map((selection) => ({
      kind: selection.kind,
      targetId: selection.targetId,
      resourceId: selection.resourceId,
      schemaId: selection.schemaId,
      mediaType: selection.mediaType,
      name: selection.name,
    }))
    .sort((left, right) => (
      left.kind < right.kind ? -1
        : left.kind > right.kind ? 1
          : left.targetId < right.targetId ? -1
            : left.targetId > right.targetId ? 1
              : 0
    ))
}

function projectSystemFiles(input: {
  readonly context: ProjectContextSnapshot
  readonly resources: readonly CreativeResourceCardView[]
  readonly workingSet: CreativeResourceWorkingSetView
  readonly skillFiles: readonly WorkspaceBundleFile[]
}): WorkspaceBundleFile[] {
  const projectSnapshot: CodexWorkspaceProjectSnapshot = {
    schemaVersion: 1,
    project: {
      projectId: input.context.projectId,
      name: input.context.projectName,
      videoRatio: input.context.policy.videoRatio,
    },
    episode: input.context.episodeId && input.context.episodeName
      ? { episodeId: input.context.episodeId, name: input.context.episodeName }
      : null,
    currentSelections: projectCurrentSelections(input.workingSet),
  }

  const readyResources = input.resources
    .filter((card) => card.resource.status === 'ready' && card.resource.materialization !== null)
    .sort((left, right) => (
      left.resource.resourceId < right.resource.resourceId ? -1
        : left.resource.resourceId > right.resource.resourceId ? 1
          : 0
    ))
  const resourceIndex: CodexWorkspaceResourceIndex = {
    schemaVersion: 1,
    resources: readyResources.map(projectResourcePointer),
  }

  return [
    { path: CODEX_WORKSPACE_PROJECT_FILE, content: formatJson(projectSnapshot) },
    { path: CODEX_WORKSPACE_RESOURCE_INDEX_FILE, content: formatJson(resourceIndex) },
    ...readyResources
      .filter((card) => card.resource.mediaType === 'text')
      .map(projectTextFile),
    ...input.skillFiles,
  ]
}

async function readCreativeSkillFiles(): Promise<WorkspaceBundleFile[]> {
  return await Promise.all(CREATIVE_SKILLS.map(async (definition) => {
    const resource = await readCreativeSkillResource({ uri: definition.entryUri })
    return {
      path: `${CODEX_WORKSPACE_SKILL_ROOT}/${definition.id}/SKILL.md`,
      content: resource.content,
    }
  }))
}

function skillEntryPaths(skillFiles: readonly WorkspaceBundleFile[]): string[] {
  return skillFiles.map((file) => file.path)
}

export function projectCodexRuntimeWorkspace(input: {
  readonly context: ProjectContextSnapshot
  readonly resources: readonly CreativeResourceCardView[]
  readonly workingSet: CreativeResourceWorkingSetView
  readonly authoringBundle: WorkspaceBundleV1
  readonly skillFiles?: readonly WorkspaceBundleFile[]
}): CodexWorkspaceProjection {
  const authoringBundle = requireCodexAuthoringBundle(input.authoringBundle)
  const skills = input.skillFiles ?? []
  const runtimeBundle = validateWorkspaceBundle({
    schemaVersion: WORKSPACE_BUNDLE_SCHEMA_VERSION,
    files: [
      ...authoringBundle.files,
      ...projectSystemFiles({ ...input, skillFiles: skills }),
    ],
  })
  return { runtimeBundle, skillEntryPaths: skillEntryPaths(skills) }
}

async function listScopedResourceCards(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId: string | null
}): Promise<CreativeResourceCardView[]> {
  const projectCardsPromise = listProjectCreativeResourceCards({
    projectId: input.projectId,
    userId: input.userId,
    ...(input.episodeId === null ? {} : { episodeId: null }),
    limit: RESOURCE_VIEW_LIMIT,
  })
  const episodeCardsPromise = input.episodeId
    ? listProjectCreativeResourceCards({
        projectId: input.projectId,
        userId: input.userId,
        episodeId: input.episodeId,
        limit: RESOURCE_VIEW_LIMIT,
      })
    : Promise.resolve([])
  const [projectCards, episodeCards] = await Promise.all([
    projectCardsPromise,
    episodeCardsPromise,
  ])
  if (projectCards.length >= RESOURCE_VIEW_LIMIT || episodeCards.length >= RESOURCE_VIEW_LIMIT) {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_RESOURCE_LIMIT_EXCEEDED',
      `Workspace Resource projection reached its ${String(RESOURCE_VIEW_LIMIT)} item scope limit`,
    )
  }
  const cardsById = new Map<string, CreativeResourceCardView>()
  for (const card of [...projectCards, ...episodeCards]) {
    cardsById.set(card.resource.resourceId, card)
  }
  return [...cardsById.values()]
}

/**
 * Reads the existing authoritative Project Context and Resource Views. It does
 * not read Canvas nodes because Canvas is already a projection of these facts.
 */
export async function readCodexRuntimeWorkspace(input: {
  readonly projectId: string
  readonly userId: string
  readonly episodeId?: string | null
  readonly authoringBundle: WorkspaceBundleV1
}): Promise<CodexWorkspaceProjection> {
  const episodeId = input.episodeId?.trim() || null
  const [context, resources, workingSet, skillFiles] = await Promise.all([
    assembleProjectContext({
      projectId: input.projectId,
      userId: input.userId,
      episodeId,
    }),
    listScopedResourceCards({
      projectId: input.projectId,
      userId: input.userId,
      episodeId,
    }),
    readProjectCreativeResourceWorkingSet({
      projectId: input.projectId,
      userId: input.userId,
      episodeId,
    }),
    readCreativeSkillFiles(),
  ])
  return projectCodexRuntimeWorkspace({
    context,
    resources,
    workingSet,
    authoringBundle: input.authoringBundle,
    skillFiles,
  })
}
