import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { stableArgsFingerprint } from '@/lib/project-agent/stable-args-hash'
import { hasProviderFailureEvidence, parseFailureRecord } from '@/lib/errors/failure'
import { resolvePublicModelName } from '@/lib/ai-exec/model-presentation'
import { readWorkspaceResourceTextContent } from './content-store'
import type {
  WorkspaceResourceActionView,
  WorkspaceResourceAlternativeGroupView,
  WorkspaceResourceAlternativeMemberView,
  WorkspaceResourceAncestorView,
  WorkspaceResourceContent,
  WorkspaceResourceInputRef,
  WorkspaceResourceInputSummary,
  WorkspaceResourceJsonObject,
  WorkspaceResourceJsonValue,
  WorkspaceResourceKind,
  WorkspaceResourceMediaType,
  WorkspaceResourceStatus,
  WorkspaceResourceSummaryView,
  WorkspaceResourceTreePage,
  WorkspaceResourceTreeScope,
  WorkspaceResourceVersionView,
  WorkspaceResourceView,
} from './contracts'
import {
  isWorkspaceResourceKind,
  isWorkspaceResourceMediaType,
  isWorkspaceResourceStatus,
} from './contracts'
import {
  isWorkspaceSubtreePath,
  parentWorkspacePath,
  validateWorkspaceResourceFolderPath,
  workspaceResourceDisplayName,
  workspacePathAncestors,
} from './path'
import { resolveActiveWorkspaceResourceByPath } from './persistence'
import { readWorkspaceResourceRevision } from './projection-revision'
import { WORKSPACE_RESOURCE_SCHEMA } from './schema-registry'
import {
  VOICE_CHARACTER_REFERENCE_ROLE,
  voiceDesignDescriptionSchema,
  voiceDesignGenerationOptionsSchema,
} from '@/lib/voice/voice-design-contract'
import {
  isCharacterVoiceDurationAvailable,
  readCharacterVoiceDurationLimits,
  type CharacterVoiceDurationLimits,
} from './character-voice-selection'
import {
  readVoiceDesignFields,
  type WorkspaceResourceCharacterVoiceSelectionView,
  type WorkspaceResourceVoiceDesignView,
} from './selection-contract'

const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 200
const MAX_RUNTIME_RESOURCES = 5_000

const resourceSelect = {
  id: true,
  userId: true,
  projectId: true,
  workspacePath: true,
  resourceKind: true,
  mediaType: true,
  schemaId: true,
  name: true,
  status: true,
  currentVersion: true,
  prompt: true,
  modelKey: true,
  generationOptions: true,
  selectedVoiceVersionId: true,
  selectedVoiceRevision: true,
  selectedVoiceVersion: {
    select: {
      resourceId: true,
      version: true,
      contentKind: true,
      media: { select: { publicId: true, durationMs: true } },
      resource: {
        select: {
          userId: true,
          projectId: true,
          workspacePath: true,
          mediaType: true,
          schemaId: true,
          status: true,
          deletedAt: true,
          prompt: true,
          generationOptions: true,
        },
      },
    },
  },
  vocalPerformanceMode: true,
  operationId: true,
  memberIndex: true,
  alternativeGroupExecutionId: true,
  taskId: true,
  task: { select: { failure: true } },
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkspaceResourceSelect

type ResourceRow = Prisma.WorkspaceResourceGetPayload<{ select: typeof resourceSelect }>

const versionInclude = {
  media: {
    select: {
      id: true,
      publicId: true,
      storageKey: true,
      mimeType: true,
      sizeBytes: true,
      sha256: true,
      width: true,
      height: true,
      durationMs: true,
    },
  },
} satisfies Prisma.WorkspaceResourceVersionInclude

type VersionRow = Prisma.WorkspaceResourceVersionGetPayload<{ include: typeof versionInclude }>

function requireResourceKind(value: string): WorkspaceResourceKind {
  if (!isWorkspaceResourceKind(value)) throw new Error(`WORKSPACE_RESOURCE_KIND_INVALID:${value}`)
  return value
}

function requireMediaType(value: string | null): WorkspaceResourceMediaType | null {
  if (value === null) return null
  if (!isWorkspaceResourceMediaType(value)) throw new Error(`WORKSPACE_RESOURCE_MEDIA_TYPE_INVALID:${value}`)
  return value
}

function requireStatus(value: string): WorkspaceResourceStatus {
  if (!isWorkspaceResourceStatus(value)) throw new Error(`WORKSPACE_RESOURCE_STATUS_INVALID:${value}`)
  return value
}

function safeNumber(value: bigint | null): number {
  if (value === null) return 0
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new Error('WORKSPACE_RESOURCE_SIZE_INVALID')
  return number
}

function jsonProjection(value: Prisma.JsonValue | null): WorkspaceResourceJsonValue | null {
  if (value === null) return null
  return value as WorkspaceResourceJsonValue
}

async function versionContent(row: VersionRow): Promise<WorkspaceResourceContent> {
  if (row.contentKind === 'media') {
    return {
      kind: 'media',
      mediaId: row.media.id,
      url: `/m/${encodeURIComponent(row.media.publicId)}`,
      mimeType: row.media.mimeType,
      width: row.media.width,
      height: row.media.height,
      durationMs: row.media.durationMs,
    }
  }
  const content = await readWorkspaceResourceTextContent(row.media.storageKey)
  if (row.contentKind === 'text') return { kind: 'text', text: content }
  if (row.contentKind === 'structured') {
    return { kind: 'structured', data: JSON.parse(content) as WorkspaceResourceJsonValue }
  }
  throw new Error(`WORKSPACE_RESOURCE_CONTENT_KIND_INVALID:${row.contentKind}`)
}

function previewUrl(version: VersionRow | undefined): string | null {
  return version?.contentKind === 'media'
    ? `/m/${encodeURIComponent(version.media.publicId)}`
    : null
}

function projectCharacterVoiceSelection(
  row: ResourceRow,
  limits: CharacterVoiceDurationLimits | null,
): WorkspaceResourceCharacterVoiceSelectionView | null {
  if (row.schemaId !== WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE) return null
  const version = row.selectedVoiceVersion
  if (!version) return { revision: row.selectedVoiceRevision, selectedVoice: null }
  const voice = version.resource
  if (voice.userId !== row.userId || voice.projectId !== row.projectId) {
    throw new Error('WORKSPACE_RESOURCE_SELECTED_VOICE_SCOPE_MISMATCH')
  }
  const available = row.deletedAt === null && row.status === 'ready'
    && voice.deletedAt === null && voice.status === 'ready'
    && voice.mediaType === 'audio' && voice.schemaId === WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE
    && version.contentKind === 'media'
    && isCharacterVoiceDurationAvailable(version.media.durationMs, limits)
  return {
    revision: row.selectedVoiceRevision,
    selectedVoice: {
      resourceId: version.resourceId,
      contentVersion: version.version,
      name: workspaceResourceDisplayName({ workspacePath: voice.workspacePath, resourceId: version.resourceId }),
      url: available ? `/m/${encodeURIComponent(version.media.publicId)}` : null,
      durationMs: version.media.durationMs,
      ...readVoiceDesignFields(voice),
      available,
    },
  }
}

function projectVoiceDesign(input: {
  readonly resource: ResourceRow
  readonly version: VersionRow | undefined
  readonly inputs: readonly WorkspaceResourceInputRef[]
  readonly inputResources: ReadonlyMap<string, ResourceRow>
  readonly inputVersions: ReadonlyMap<string, VersionRow>
  readonly limits: CharacterVoiceDurationLimits | null
}): WorkspaceResourceVoiceDesignView | null {
  const row = input.resource
  if (row.schemaId !== WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE) return null
  const fields = readVoiceDesignFields(row)
  const characterRefs = input.inputs.filter((reference) => reference.role === VOICE_CHARACTER_REFERENCE_ROLE)
  if (characterRefs.length > 1) throw new Error('WORKSPACE_RESOURCE_VOICE_CHARACTER_AMBIGUOUS')
  const characterRef = characterRefs[0]
  const character = characterRef ? input.inputResources.get(characterRef.resourceId) : undefined
  if (character && (character.userId !== row.userId || character.projectId !== row.projectId)) {
    throw new Error('WORKSPACE_RESOURCE_VOICE_CHARACTER_SCOPE_MISMATCH')
  }
  const characterAvailable = Boolean(character && characterRef
    && character.deletedAt === null && character.status === 'ready'
    && character.schemaId === WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE && character.mediaType === 'image'
    && input.inputVersions.has(`${character.id}:${String(characterRef.contentVersion)}`))
  const isSelected = Boolean(input.version && character?.selectedVoiceVersionId === input.version.id)
  let selectUnavailableReason: WorkspaceResourceVoiceDesignView['selectUnavailableReason'] = null
  if (!isSelected) {
    if (!characterAvailable) selectUnavailableReason = 'character_unavailable'
    else if (row.deletedAt !== null || row.status !== 'ready' || input.version?.contentKind !== 'media') {
      selectUnavailableReason = 'audio_unavailable'
    } else if (input.limits === null) selectUnavailableReason = 'video_unsupported'
    else if (!isCharacterVoiceDurationAvailable(input.version.media.durationMs, input.limits)) {
      selectUnavailableReason = 'duration_unsupported'
    }
  }
  const description = voiceDesignDescriptionSchema.safeParse(row.prompt)
  const options = voiceDesignGenerationOptionsSchema.safeParse(row.generationOptions)
  return {
    ...fields,
    character: character && characterRef ? {
      resourceId: character.id,
      contentVersion: characterRef.contentVersion,
      name: workspaceResourceDisplayName({ workspacePath: character.workspacePath, resourceId: character.id }),
      available: characterAvailable,
    } : null,
    isSelected,
    selectUnavailableReason,
    candidateAction: row.deletedAt === null && characterAvailable && characterRef && description.success && options.success ? {
      execution: 'planned',
      operationId: 'create_audio',
      input: {
        request: {
          kind: 'new',
          items: [{
            itemId: row.id,
            name: workspaceResourceDisplayName({ workspacePath: row.workspacePath, resourceId: row.id }),
            folderPath: parentWorkspacePath(row.workspacePath),
            count: 1,
            mediaType: 'audio',
            audioKind: 'voice',
            schemaId: WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE,
            prompt: description.data,
            previewText: options.data.previewText,
            language: options.data.language,
            references: [{
              resourceId: characterRef.resourceId,
              contentVersion: characterRef.contentVersion,
              role: VOICE_CHARACTER_REFERENCE_ROLE,
              channel: 'context',
            }],
          }],
        },
      },
    } : null,
    selectAction: selectUnavailableReason === null && !isSelected && character && input.version ? {
      execution: 'direct',
      operationId: 'select_character_voice',
      input: {
        characterResourceId: character.id,
        voiceResourceId: row.id,
        voiceContentVersion: input.version.version,
        expectedSelectionRevision: character.selectedVoiceRevision,
      },
    } : null,
  }
}

function projectActions(input: {
  readonly resource: ResourceRow
  readonly current: VersionRow | undefined
  readonly mediaType: WorkspaceResourceMediaType | null
}): readonly WorkspaceResourceActionView[] {
  const deleteAction: WorkspaceResourceActionView = {
    kind: 'delete',
    enabled: input.resource.status !== 'pending',
    operationId: 'delete_resource',
    input: {
      resourceId: input.resource.id,
      workspacePath: input.resource.workspacePath,
    },
    href: null,
    approvalInputHash: stableArgsFingerprint({
      resourceId: input.resource.id,
      workspacePath: input.resource.workspacePath,
    }),
  }
  if (input.resource.resourceKind === 'folder') return [deleteAction]
  const downloadHref = previewUrl(input.current)
  const failed = (
    input.resource.status === 'failed'
    || input.resource.status === 'canceled'
  )
  const retryOperationId = !failed ? null
    : input.resource.operationId === 'create_image'
      || input.resource.operationId === 'create_audio'
      || input.resource.operationId === 'create_video'
      ? input.resource.operationId
      : input.resource.operationId === 'rerun_failed_production_items'
        ? 'rerun_failed_production_items'
        : null
  const retryInput: WorkspaceResourceJsonObject | null = retryOperationId === 'rerun_failed_production_items'
    ? { resourceIds: [input.resource.id] }
    : retryOperationId
      ? { request: { kind: 'retry', resourceIds: [input.resource.id] } }
      : null
  return [
    {
      kind: 'retry',
      enabled: retryOperationId !== null,
      operationId: retryOperationId,
      input: retryInput,
      href: null,
      approvalInputHash: null,
    },
    {
      kind: 'variant',
      enabled: false,
      operationId: null,
      input: null,
      href: null,
      approvalInputHash: null,
    },
    {
      kind: 'download',
      enabled: downloadHref !== null,
      operationId: null,
      input: null,
      href: downloadHref,
      approvalInputHash: null,
    },
    deleteAction,
  ]
}

function projectAncestors(
  workspacePath: string,
  folderByPath: ReadonlyMap<string, ResourceRow>,
): readonly WorkspaceResourceAncestorView[] {
  return workspacePathAncestors(workspacePath).map((ancestorPath) => {
    const folder = folderByPath.get(ancestorPath)
    if (!folder) throw new Error(`WORKSPACE_RESOURCE_ANCESTOR_FOLDER_MISSING:${ancestorPath}`)
    return {
      resourceId: folder.id,
      name: workspaceResourceDisplayName({
        workspacePath: folder.workspacePath,
        resourceId: folder.id,
        resourceKind: 'folder',
      }),
      workspacePath: folder.workspacePath,
    }
  })
}

async function loadViews(
  rows: readonly ResourceRow[],
  options: {
    readonly includeContent: boolean
    readonly contentVersionsByResourceId?: ReadonlyMap<string, number>
  },
): Promise<WorkspaceResourceView[]> {
  if (rows.length === 0) return []
  const voiceProjects = new Map(rows
    .filter((row) => row.schemaId === WORKSPACE_RESOURCE_SCHEMA.CHARACTER_IMAGE
      || row.schemaId === WORKSPACE_RESOURCE_SCHEMA.VOICE_REFERENCE)
    .map((row) => [row.projectId, { projectId: row.projectId, userId: row.userId }]))
  const voiceLimitsByProject = new Map(await Promise.all(Array.from(voiceProjects.values()).map(async (project) => (
    [project.projectId, await readCharacterVoiceDurationLimits(project)] as const
  ))))
  const contentVersionFor = (row: ResourceRow): number => (
    options.contentVersionsByResourceId?.get(row.id) ?? row.currentVersion
  )
  const versionKeys = rows
    .filter((row) => row.resourceKind === 'file' && contentVersionFor(row) > 0)
    .map((row) => ({ resourceId: row.id, version: contentVersionFor(row) }))
  const lineage = versionKeys.length === 0 ? [] : await prisma.workspaceResourceLineage.findMany({
    where: { OR: versionKeys.map((entry) => ({ outputResourceId: entry.resourceId, outputVersion: entry.version })) },
    orderBy: [{ outputResourceId: 'asc' }, { outputVersion: 'asc' }, { role: 'asc' }, { position: 'asc' }],
  })
  const inputVersionKeys = lineage.map((entry) => ({ resourceId: entry.inputResourceId, version: entry.inputVersion }))
  const alternativeGroupIds = Array.from(new Set(
    rows.map((row) => row.alternativeGroupExecutionId).filter((value): value is string => Boolean(value)),
  ))
  const siblings = alternativeGroupIds.length === 0 ? [] : await prisma.workspaceResource.findMany({
    where: { alternativeGroupExecutionId: { in: alternativeGroupIds } },
    orderBy: [{ alternativeGroupExecutionId: 'asc' }, { memberIndex: 'asc' }, { id: 'asc' }],
    select: resourceSelect,
  })
  const siblingVersionKeys = siblings
    .filter((row) => row.resourceKind === 'file' && row.currentVersion > 0)
    .map((row) => ({ resourceId: row.id, version: row.currentVersion }))
  const allVersionKeys = [...versionKeys, ...inputVersionKeys, ...siblingVersionKeys]
  const versionIdentity = new Map(allVersionKeys.map((entry) => [`${entry.resourceId}:${String(entry.version)}`, entry]))
  const versions = versionIdentity.size === 0 ? [] : await prisma.workspaceResourceVersion.findMany({
    where: { OR: [...versionIdentity.values()] },
    include: versionInclude,
  })
  const versionByKey = new Map(versions.map((version) => [`${version.resourceId}:${String(version.version)}`, version]))
  const inputIds = Array.from(new Set(lineage.map((entry) => entry.inputResourceId)))
  const inputResources = inputIds.length === 0 ? [] : await prisma.workspaceResource.findMany({
    where: { id: { in: inputIds } },
    select: resourceSelect,
  })
  const inputById = new Map(inputResources.map((resource) => [resource.id, resource]))
  const projectIds = Array.from(new Set(rows.map((row) => row.projectId)))
  const folders = await prisma.workspaceResource.findMany({
    where: { projectId: { in: projectIds }, resourceKind: 'folder' },
    orderBy: [{ deletedAt: 'asc' }, { updatedAt: 'desc' }],
    select: resourceSelect,
  })
  const folderByProjectPath = new Map<string, ResourceRow>()
  for (const folder of folders) {
    const key = `${folder.projectId}:${folder.workspacePath}`
    if (!folderByProjectPath.has(key) || folder.deletedAt === null) folderByProjectPath.set(key, folder)
  }
  const inputsByOutput = new Map<string, WorkspaceResourceInputRef[]>()
  const summariesByOutput = new Map<string, WorkspaceResourceInputSummary[]>()
  for (const entry of lineage) {
    const key = `${entry.outputResourceId}:${String(entry.outputVersion)}`
    const source = inputById.get(entry.inputResourceId)
    if (!source || source.resourceKind !== 'file') {
      throw new Error(`WORKSPACE_RESOURCE_LINEAGE_INPUT_INVALID:${entry.inputResourceId}`)
    }
    const mediaType = requireMediaType(source.mediaType)
    if (!mediaType) throw new Error(`WORKSPACE_RESOURCE_LINEAGE_INPUT_MEDIA_MISSING:${source.id}`)
    const ref: WorkspaceResourceInputRef = {
      resourceId: entry.inputResourceId,
      contentVersion: entry.inputVersion,
      workspacePath: source.workspacePath,
      role: entry.role,
      position: entry.position,
    }
    const inputVersion = versionByKey.get(`${entry.inputResourceId}:${String(entry.inputVersion)}`)
    inputsByOutput.set(key, [...(inputsByOutput.get(key) ?? []), ref])
    summariesByOutput.set(key, [
      ...(summariesByOutput.get(key) ?? []),
      {
        ...ref,
        resourceKind: 'file',
        mediaType,
        schemaId: source.schemaId,
        name: workspaceResourceDisplayName({
          workspacePath: source.workspacePath,
          resourceId: source.id,
        }),
        previewUrl: previewUrl(inputVersion),
      },
    ])
  }
  const alternativeMembersByGroup = new Map<string, WorkspaceResourceAlternativeMemberView[]>()
  for (const sibling of siblings) {
    const groupId = sibling.alternativeGroupExecutionId
    if (!groupId || sibling.memberIndex === null) continue
    const member: WorkspaceResourceAlternativeMemberView = {
      resourceId: sibling.id,
      workspacePath: sibling.workspacePath,
      name: workspaceResourceDisplayName({
        workspacePath: sibling.workspacePath,
        resourceId: sibling.id,
      }),
      schemaId: sibling.schemaId,
      mediaType: requireMediaType(sibling.mediaType),
      status: requireStatus(sibling.status),
      memberIndex: sibling.memberIndex,
      previewUrl: previewUrl(versionByKey.get(`${sibling.id}:${String(sibling.currentVersion)}`)),
    }
    alternativeMembersByGroup.set(groupId, [...(alternativeMembersByGroup.get(groupId) ?? []), member])
  }
  return await Promise.all(rows.map(async (row): Promise<WorkspaceResourceView> => {
    const resourceKind = requireResourceKind(row.resourceKind)
    const mediaType = requireMediaType(row.mediaType)
    const contentVersion = resourceKind === 'file' ? contentVersionFor(row) : 0
    if ((resourceKind === 'folder') !== (mediaType === null)) {
      throw new Error(`WORKSPACE_RESOURCE_KIND_MEDIA_MISMATCH:${row.id}`)
    }
    const folderByPath = new Map<string, ResourceRow>()
    for (const ancestorPath of workspacePathAncestors(row.workspacePath)) {
      const folder = folderByProjectPath.get(`${row.projectId}:${ancestorPath}`)
      if (folder) folderByPath.set(ancestorPath, folder)
    }
    const ancestors = projectAncestors(row.workspacePath, folderByPath)
    const version = resourceKind === 'file' && contentVersion > 0
      ? versionByKey.get(`${row.id}:${String(contentVersion)}`)
      : undefined
    if (resourceKind === 'file' && contentVersion > 0 && !version) {
      throw new Error(`WORKSPACE_RESOURCE_VERSION_MISSING:${row.id}:${String(contentVersion)}`)
    }
    const current: WorkspaceResourceVersionView | null = version ? {
      version: version.version,
      content: options.includeContent ? await versionContent(version) : null,
      sha256: version.sha256,
      sizeBytes: safeNumber(version.sizeBytes),
      createdAt: version.createdAt.toISOString(),
    } : null
    const lineageKey = `${row.id}:${String(contentVersion)}`
    const groupMembers = row.alternativeGroupExecutionId
      ? alternativeMembersByGroup.get(row.alternativeGroupExecutionId) ?? []
      : []
    const alternativeGroup: WorkspaceResourceAlternativeGroupView | null = row.alternativeGroupExecutionId
      ? { groupId: row.alternativeGroupExecutionId, total: groupMembers.length, members: groupMembers }
      : null
    const summary: WorkspaceResourceSummaryView = resourceKind === 'folder'
      ? { kind: 'folder' }
      : !version
        ? { kind: 'empty' }
        : version.contentKind === 'media'
          ? {
              kind: 'media',
              url: `/m/${encodeURIComponent(version.media.publicId)}`,
              mimeType: version.media.mimeType,
              width: version.media.width,
              height: version.media.height,
              durationMs: version.media.durationMs,
            }
          : version.contentKind === 'structured'
            ? { kind: 'structured', preview: version.contentPreview }
            : { kind: 'text', preview: version.contentPreview }
    return {
      resourceId: row.id,
      projectId: row.projectId,
      resourceKind,
      workspacePath: row.workspacePath,
      ancestors,
      mediaType,
      schemaId: row.schemaId,
      name: workspaceResourceDisplayName({
        workspacePath: row.workspacePath,
        resourceId: row.id,
        resourceKind,
      }),
      status: requireStatus(row.status),
      contentVersion,
      current,
      summary,
      prompt: row.prompt,
      modelName: resolvePublicModelName(row.modelKey),
      generationOptions: jsonProjection(row.generationOptions),
      voiceDesign: projectVoiceDesign({
        resource: row,
        version,
        inputs: inputsByOutput.get(lineageKey) ?? [],
        inputResources: inputById,
        inputVersions: versionByKey,
        limits: voiceLimitsByProject.get(row.projectId) ?? null,
      }),
      characterVoiceSelection: projectCharacterVoiceSelection(row, voiceLimitsByProject.get(row.projectId) ?? null),
      vocalPerformanceMode: row.vocalPerformanceMode,
      operationId: row.operationId,
      memberIndex: row.memberIndex,
      alternativeGroupExecutionId: row.alternativeGroupExecutionId,
      alternativeGroup,
      inputs: inputsByOutput.get(lineageKey) ?? [],
      inputSummaries: summariesByOutput.get(lineageKey) ?? [],
      actions: projectActions({ resource: row, current: version, mediaType }),
      taskId: row.taskId,
      error: (() => {
        const failure = parseFailureRecord(row.task?.failure)
        return failure
          ? {
              code: failure.interpretation.code,
              diagnostic: hasProviderFailureEvidence(failure)
                ? failure.native.message
                : null,
            }
          : null
      })(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }))
}

function requireLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_PAGE_SIZE
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    throw new Error('WORKSPACE_RESOURCE_PAGE_LIMIT_INVALID')
  }
  return limit
}

type Cursor = { readonly workspacePath: string; readonly id: string }

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  const raw = value?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>
    if (typeof parsed.workspacePath === 'string' && typeof parsed.id === 'string') {
      return { workspacePath: parsed.workspacePath, id: parsed.id }
    }
  } catch {
    throw new Error('WORKSPACE_RESOURCE_CURSOR_INVALID')
  }
  throw new Error('WORKSPACE_RESOURCE_CURSOR_INVALID')
}

export async function listWorkspaceResourceTreePage(input: {
  readonly userId: string
  readonly projectId: string
  readonly prefix?: string | null
  readonly search?: string | null
  readonly cursor?: string | null
  readonly limit?: number
  readonly deleted?: boolean
  readonly scope?: WorkspaceResourceTreeScope
}): Promise<WorkspaceResourceTreePage> {
  const revision = await readWorkspaceResourceRevision(input)
  const limit = requireLimit(input.limit)
  const cursor = decodeCursor(input.cursor)
  const search = input.search?.trim() || null
  const parentPath = input.prefix?.trim()
    ? validateWorkspaceResourceFolderPath(input.prefix.trim())
    : null
  const cursorWhere: Prisma.WorkspaceResourceWhereInput = cursor ? {
    OR: [
      { workspacePath: { gt: cursor.workspacePath } },
      { workspacePath: cursor.workspacePath, id: { gt: cursor.id } },
    ],
  } : {}
  const baseWhere: Prisma.WorkspaceResourceWhereInput = {
    userId: input.userId,
    projectId: input.projectId,
    ...(input.deleted ? { deletedAt: { not: null } } : { deletedAt: null, activePath: { not: null } }),
    ...(search ? { workspacePath: { contains: search } } : {}),
  }
  if (!search) {
    const candidates = await prisma.workspaceResource.findMany({
      where: baseWhere,
      orderBy: [{ workspacePath: 'asc' }, { id: 'asc' }],
      take: MAX_RUNTIME_RESOURCES + 1,
      select: resourceSelect,
    })
    if (candidates.length > MAX_RUNTIME_RESOURCES) throw new Error('WORKSPACE_RESOURCE_RUNTIME_LIMIT_EXCEEDED')
    const directChildren = input.scope === 'subtree'
      ? candidates.filter((row) => (
          parentPath === null
            ? true
            : isWorkspaceSubtreePath(row.workspacePath, parentPath) && row.workspacePath !== parentPath
        ))
      : candidates.filter((row) => parentWorkspacePath(row.workspacePath) === parentPath)
    const afterCursor = cursor ? directChildren.filter((row) => (
      row.workspacePath > cursor.workspacePath
      || (row.workspacePath === cursor.workspacePath && row.id > cursor.id)
    )) : directChildren
    const pageRows = afterCursor.slice(0, limit)
    const last = pageRows.at(-1)
    return {
      items: await loadViews(pageRows, { includeContent: false }),
      nextCursor: afterCursor.length > limit && last
        ? encodeCursor({ workspacePath: last.workspacePath, id: last.id })
        : null,
      revision,
    }
  }
  const rows = await prisma.workspaceResource.findMany({
    where: {
      ...baseWhere,
      AND: [cursorWhere],
    },
    orderBy: [{ workspacePath: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: resourceSelect,
  })
  const pageRows = rows.slice(0, limit)
  const last = pageRows.at(-1)
  return {
    items: await loadViews(pageRows, { includeContent: false }),
    nextCursor: rows.length > limit && last
      ? encodeCursor({ workspacePath: last.workspacePath, id: last.id })
      : null,
    revision,
  }
}

export async function listAllWorkspaceResourcesForRuntime(input: {
  readonly userId: string
  readonly projectId: string
}): Promise<readonly WorkspaceResourceView[]> {
  const rows = await prisma.workspaceResource.findMany({
    where: { userId: input.userId, projectId: input.projectId, deletedAt: null, activePath: { not: null } },
    orderBy: [{ workspacePath: 'asc' }, { id: 'asc' }],
    take: MAX_RUNTIME_RESOURCES + 1,
    select: resourceSelect,
  })
  if (rows.length > MAX_RUNTIME_RESOURCES) throw new Error('WORKSPACE_RESOURCE_RUNTIME_LIMIT_EXCEEDED')
  return await loadViews(rows, { includeContent: true })
}

export async function readWorkspaceResource(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
}): Promise<WorkspaceResourceView> {
  const row = await prisma.workspaceResource.findFirst({
    where: {
      userId: input.userId,
      projectId: input.projectId,
      id: input.resourceId,
    },
    select: resourceSelect,
  })
  if (!row) throw new Error('WORKSPACE_RESOURCE_NOT_FOUND')
  const [view] = await loadViews([row], { includeContent: true })
  if (!view) throw new Error('WORKSPACE_RESOURCE_NOT_FOUND')
  return view
}

export async function readWorkspaceResourceAtVersion(input: {
  readonly userId: string
  readonly projectId: string
  readonly resourceId: string
  readonly contentVersion: number
}): Promise<WorkspaceResourceView> {
  if (!Number.isSafeInteger(input.contentVersion) || input.contentVersion < 1) {
    throw new Error('WORKSPACE_RESOURCE_CONTENT_VERSION_INVALID')
  }
  const row = await prisma.workspaceResource.findFirst({
    where: {
      userId: input.userId,
      projectId: input.projectId,
      id: input.resourceId,
    },
    select: resourceSelect,
  })
  if (!row) throw new Error('WORKSPACE_RESOURCE_NOT_FOUND')
  const [view] = await loadViews([row], {
    includeContent: true,
    contentVersionsByResourceId: new Map([[input.resourceId, input.contentVersion]]),
  })
  if (!view) throw new Error('WORKSPACE_RESOURCE_NOT_FOUND')
  return view
}

export async function readWorkspaceResourceByPath(input: {
  readonly userId: string
  readonly projectId: string
  readonly workspacePath: string
}): Promise<WorkspaceResourceView> {
  const resource = await resolveActiveWorkspaceResourceByPath(prisma, input)
  return await readWorkspaceResource({
    userId: input.userId,
    projectId: input.projectId,
    resourceId: resource.resourceId,
  })
}
