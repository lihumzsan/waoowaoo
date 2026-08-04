import { prisma } from '@/lib/prisma'
import {
  readCreativeOutputDefinition,
  safeParseCreativeOutput,
} from '@/lib/creative-skills/output-registry'
import {
  validateWorkspaceBundle,
  type WorkspaceBundleFile,
  type WorkspaceBundleV1,
} from '@/lib/codex-runtime/workspace-bundle'
import {
  decodeEditableResourceFile,
  decodeMediaPointer,
} from '@/lib/workspace-resource/file-format'
import { createWorkspaceResourceId } from '@/lib/workspace-resource/identity'
import {
  contentKindFromPath,
  validateWorkspaceResourceFilePath,
  validateWorkspaceResourceFolderPath,
} from '@/lib/workspace-resource/path'
import {
  reconcileWorkspaceResourceTreeInTransaction,
  type WorkspaceResourceTreeEntry,
} from '@/lib/workspace-resource/persistence'
import type {
  WorkspaceResourceJsonValue,
} from '@/lib/workspace-resource/contracts'
import {
  WORKSPACE_RESOURCE_FOLDER_SCHEMA_ID,
  WORKSPACE_RESOURCE_SCHEMA,
} from '@/lib/workspace-resource/schema-registry'
import {
  CODEX_WORKSPACE_SYSTEM_PREFIX,
  CodexWorkspaceError,
  type CodexWorkspaceBaseline,
  type CodexWorkspaceCapture,
  type CodexWorkspaceDirectoryIdentity,
} from './contracts'
import { readCodexRuntimeWorkspace } from './projector'

function isSystemPath(workspacePath: string): boolean {
  return workspacePath === CODEX_WORKSPACE_SYSTEM_PREFIX.slice(0, -1)
    || workspacePath.startsWith(CODEX_WORKSPACE_SYSTEM_PREFIX)
}

function fileMap(files: readonly WorkspaceBundleFile[]): Map<string, string> {
  return new Map(files.map((file) => [file.path, file.content]))
}

function assertProtectedProjectionUnchanged(
  baseline: WorkspaceBundleV1,
  captured: WorkspaceBundleV1,
): void {
  const beforeFiles = fileMap(baseline.files.filter((file) => isSystemPath(file.path)))
  const afterFiles = fileMap(captured.files.filter((file) => isSystemPath(file.path)))
  for (const workspacePath of new Set([...beforeFiles.keys(), ...afterFiles.keys()])) {
    if (beforeFiles.get(workspacePath) !== afterFiles.get(workspacePath)) {
      throw new CodexWorkspaceError(
        'CODEX_WORKSPACE_PROTECTED_FILE_CHANGED',
        `Projected system file cannot be created, changed, moved, or deleted: ${workspacePath}`,
      )
    }
  }
  const beforeDirectories = new Set(baseline.directories.filter(isSystemPath))
  const afterDirectories = new Set(captured.directories.filter(isSystemPath))
  if (
    beforeDirectories.size !== afterDirectories.size
    || [...beforeDirectories].some((workspacePath) => !afterDirectories.has(workspacePath))
  ) {
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_PROTECTED_FILE_CHANGED',
      'Projected system directories cannot be created, changed, moved, or deleted',
    )
  }
}

function contentFromEditableFile(input: {
  readonly workspacePath: string
  readonly content: string
}): Extract<WorkspaceResourceTreeEntry['content'], object> {
  const contentKind = contentKindFromPath(input.workspacePath)
  if (contentKind === 'text') return { kind: 'text', text: input.content }
  if (contentKind === 'structured') {
    try {
      return { kind: 'structured', data: JSON.parse(input.content) as WorkspaceResourceJsonValue }
    } catch (error) {
      throw new CodexWorkspaceError(
        'CODEX_WORKSPACE_RESOURCE_CONTENT_INVALID',
        `Invalid JSON at ${input.workspacePath}: ${error instanceof Error ? error.message : 'parse failed'}`,
        {
          cause: error,
          details: {
            field: 'workspacePath',
            workspacePath: input.workspacePath,
            corrections: [{
              action: 'fix_invalid_value',
              fieldPath: '$file',
              message: error instanceof Error ? error.message : 'Write valid JSON.',
            }],
          },
        },
      )
    }
  }
  throw new Error('CODEX_WORKSPACE_POINTER_CONTENT_UNEXPECTED')
}

function structuredSchemaId(input: {
  readonly workspacePath: string
  readonly data: WorkspaceResourceJsonValue
}): string {
  if (
    !input.data
    || typeof input.data !== 'object'
    || Array.isArray(input.data)
    || !Object.prototype.hasOwnProperty.call(input.data, 'outputKind')
  ) {
    return WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT
  }
  const parsed = safeParseCreativeOutput(input.data)
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 20)
    const corrections = issues.flatMap((issue) => {
      if (issue.code === 'unrecognized_keys') {
        return issue.keys.map((key) => ({
          action: 'remove_unknown_field',
          fieldPath: `$file.${[...issue.path, key].join('.')}`,
          message: `Remove unknown field ${key}.`,
        }))
      }
      return [{
        action: 'fix_invalid_value',
        fieldPath: `$file${issue.path.length > 0 ? `.${issue.path.join('.')}` : ''}`,
        message: issue.message,
      }]
    }).slice(0, 20)
    const summary = issues.map((issue) => (
      `${issue.path.join('.') || '<root>'}: ${issue.message}`
    )).join('; ')
    throw new CodexWorkspaceError(
      'CODEX_WORKSPACE_CREATIVE_OUTPUT_INVALID',
      `Professional JSON does not match its registered outputKind schema at ${input.workspacePath}: ${summary}`,
      {
        details: {
          field: 'workspacePath',
          workspacePath: input.workspacePath,
          corrections,
        },
      },
    )
  }
  return readCreativeOutputDefinition(parsed.data.outputKind).workspaceSchemaId
}

function schemaIdForEditableContent(input: {
  readonly workspacePath: string
  readonly content: Extract<WorkspaceResourceTreeEntry['content'], object>
}): string {
  return input.content.kind === 'structured'
    ? structuredSchemaId({ workspacePath: input.workspacePath, data: input.content.data })
    : WORKSPACE_RESOURCE_SCHEMA.GENERIC_TEXT
}

function parseFileEntries(input: {
  readonly baseline: CodexWorkspaceBaseline
  readonly captured: WorkspaceBundleV1
}): readonly WorkspaceResourceTreeEntry[] {
  const baselineById = new Map(input.baseline.resources.map((resource) => [resource.resourceId, resource]))
  const baselineByPath = new Map(input.baseline.resources.map((resource) => [resource.workspacePath, resource]))
  const claimedIds = new Set<string>()
  return input.captured.files
    .filter((file) => !isSystemPath(file.path))
    .map((file): WorkspaceResourceTreeEntry => {
      const workspacePath = validateWorkspaceResourceFilePath(file.path)
      if (contentKindFromPath(workspacePath) === 'pointer') {
        const pointer = decodeMediaPointer(file.content)
        const baseline = baselineById.get(pointer.resourceId)
        if (
          !baseline
          || baseline.resourceKind !== 'file'
          || baseline.mediaType === null
          || baseline.mediaType === 'text'
          || baseline.fileContent !== file.content
        ) {
          throw new CodexWorkspaceError(
            'CODEX_WORKSPACE_POINTER_EDIT_FORBIDDEN',
            `Media pointer content is system-owned: ${workspacePath}`,
          )
        }
        if (claimedIds.has(pointer.resourceId)) throw new Error('CODEX_WORKSPACE_RESOURCE_ID_DUPLICATED')
        claimedIds.add(pointer.resourceId)
        return {
          resourceId: pointer.resourceId,
          schemaId: baseline.schemaId,
          workspacePath,
          resourceKind: 'file',
          mediaType: baseline.mediaType,
          content: null,
        }
      }

      const decoded = decodeEditableResourceFile({ workspacePath, content: file.content })
      if (decoded.resourceId) {
        const baseline = baselineById.get(decoded.resourceId)
        if (
          !baseline
          || baseline.resourceKind !== 'file'
          || baseline.mediaType !== 'text'
          || baseline.fileContent === null
        ) {
          throw new CodexWorkspaceError(
            'CODEX_WORKSPACE_RESOURCE_ID_INVALID',
            `File claims an identity outside this project workspace: ${workspacePath}`,
          )
        }
        if (claimedIds.has(decoded.resourceId)) throw new Error('CODEX_WORKSPACE_RESOURCE_ID_DUPLICATED')
        claimedIds.add(decoded.resourceId)
        const previous = decodeEditableResourceFile({
          workspacePath: baseline.workspacePath,
          content: baseline.fileContent,
        })
        const content = previous.content === decoded.content
          ? null
          : contentFromEditableFile({ workspacePath, content: decoded.content })
        const schemaId = content
          ? schemaIdForEditableContent({ workspacePath, content })
          : baseline.schemaId
        if (schemaId !== baseline.schemaId) {
          throw new CodexWorkspaceError(
            'CODEX_WORKSPACE_CREATIVE_OUTPUT_KIND_CHANGE_FORBIDDEN',
            `An existing file cannot change its registered outputKind: ${workspacePath}`,
          )
        }
        return {
          resourceId: decoded.resourceId,
          schemaId,
          workspacePath,
          resourceKind: 'file',
          mediaType: 'text',
          content,
        }
      }

      if (baselineByPath.has(workspacePath)) {
        throw new CodexWorkspaceError(
          'CODEX_WORKSPACE_RESOURCE_ID_INVALID',
          `Existing file identity marker was removed: ${workspacePath}`,
        )
      }
      const resourceId = createWorkspaceResourceId()
      claimedIds.add(resourceId)
      const content = contentFromEditableFile({ workspacePath, content: decoded.content })
      return {
        resourceId,
        schemaId: schemaIdForEditableContent({ workspacePath, content }),
        workspacePath,
        resourceKind: 'file',
        mediaType: 'text',
        content,
      }
    })
}

function parseFolderEntries(input: {
  readonly baseline: CodexWorkspaceBaseline
  readonly captured: WorkspaceBundleV1
  readonly directoryIdentities: readonly CodexWorkspaceDirectoryIdentity[]
}): readonly WorkspaceResourceTreeEntry[] {
  const capturedDirectories = input.captured.directories.filter((workspacePath) => !isSystemPath(workspacePath))
  const identityByPath = new Map<string, string>()
  const pathsByIdentity = new Map<string, string>()
  for (const entry of input.directoryIdentities) {
    if (!input.captured.directories.includes(entry.path)) {
      throw new CodexWorkspaceError(
        'CODEX_WORKSPACE_FOLDER_IDENTITY_INVALID',
        `Directory identity is outside the captured workspace: ${entry.path}`,
      )
    }
    if (identityByPath.has(entry.path) || pathsByIdentity.has(entry.runtimeIdentity)) {
      throw new CodexWorkspaceError(
        'CODEX_WORKSPACE_FOLDER_IDENTITY_INVALID',
        `Directory runtime identity is duplicated: ${entry.path}`,
      )
    }
    identityByPath.set(entry.path, entry.runtimeIdentity)
    pathsByIdentity.set(entry.runtimeIdentity, entry.path)
  }
  const baselineByRuntimeIdentity = new Map<string, string>()
  for (const resource of input.baseline.resources) {
    if (resource.resourceKind !== 'folder') continue
    if (!resource.runtimeIdentity || baselineByRuntimeIdentity.has(resource.runtimeIdentity)) {
      throw new CodexWorkspaceError(
        'CODEX_WORKSPACE_FOLDER_IDENTITY_INVALID',
        `Folder Runtime identity is missing or duplicated: ${resource.workspacePath}`,
      )
    }
    baselineByRuntimeIdentity.set(resource.runtimeIdentity, resource.resourceId)
  }
  return capturedDirectories.map((rawPath): WorkspaceResourceTreeEntry => {
    const workspacePath = validateWorkspaceResourceFolderPath(rawPath)
    const runtimeIdentity = identityByPath.get(workspacePath)
    if (!runtimeIdentity) {
      throw new CodexWorkspaceError(
        'CODEX_WORKSPACE_FOLDER_IDENTITY_INVALID',
        `Folder Runtime identity is missing: ${workspacePath}`,
      )
    }
    return {
      resourceId: baselineByRuntimeIdentity.get(runtimeIdentity) ?? createWorkspaceResourceId(),
      schemaId: WORKSPACE_RESOURCE_FOLDER_SCHEMA_ID,
      workspacePath,
      resourceKind: 'folder',
      mediaType: null,
      content: null,
    }
  })
}

export async function captureCodexWorkspace(input: {
  readonly userId: string
  readonly projectId: string
  readonly baselineRuntimeBundle: WorkspaceBundleV1
  readonly baseline: CodexWorkspaceBaseline
  readonly capturedRuntimeBundle: WorkspaceBundleV1
  readonly capturedDirectoryIdentities: readonly CodexWorkspaceDirectoryIdentity[]
  readonly sourceTurnId?: string | null
}): Promise<CodexWorkspaceCapture> {
  const baselineBundle = validateWorkspaceBundle(input.baselineRuntimeBundle)
  const capturedBundle = validateWorkspaceBundle(input.capturedRuntimeBundle)
  assertProtectedProjectionUnchanged(baselineBundle, capturedBundle)
  const entries = [
    ...parseFolderEntries({
      baseline: input.baseline,
      captured: capturedBundle,
      directoryIdentities: input.capturedDirectoryIdentities,
    }),
    ...parseFileEntries({ baseline: input.baseline, captured: capturedBundle }),
  ]
  const changes = await prisma.$transaction(async (tx) => (
    await reconcileWorkspaceResourceTreeInTransaction(tx, {
      userId: input.userId,
      projectId: input.projectId,
      baseline: input.baseline.resources.map((resource) => ({
        resourceId: resource.resourceId,
        workspacePath: resource.workspacePath,
        resourceKind: resource.resourceKind,
        mediaType: resource.mediaType,
        contentVersion: resource.contentVersion,
      })),
      entries,
      sourceTurnId: input.sourceTurnId,
    })
  ))
  const projection = await readCodexRuntimeWorkspace({
    userId: input.userId,
    projectId: input.projectId,
  })
  return {
    runtimeBundle: projection.runtimeBundle,
    baseline: projection.baseline,
    changes,
  }
}
