import path from 'node:path'
import { AppError } from '@/lib/errors/app-error'
import {
  isCanonicalWorkspaceResourcePath,
  isWorkspaceResourceReservedRootName,
  isWorkspaceResourceSubtreePath,
  type WorkspaceResourceKind,
  type WorkspaceResourceMediaType,
} from './contracts'

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json'])

export class WorkspaceResourcePathError extends AppError {
  constructor(readonly reasonCode: string, message: string) {
    super('INVALID_PARAMS', message, {
      details: { reasonCode },
    })
    this.name = 'WorkspaceResourcePathError'
  }
}

export type WorkspaceResourcePlacementErrorCode =
  | 'WORKSPACE_RESOURCE_FOLDER_NOT_FOUND'
  | 'WORKSPACE_RESOURCE_PATH_CONFLICT'
  | 'WORKSPACE_RESOURCE_TREE_PATH_CONFLICT'

export class WorkspaceResourcePlacementError extends AppError {
  constructor(
    readonly reasonCode: WorkspaceResourcePlacementErrorCode,
    readonly workspacePath: string,
  ) {
    const folderMissing = reasonCode === 'WORKSPACE_RESOURCE_FOLDER_NOT_FOUND'
    super(folderMissing ? 'INVALID_PARAMS' : 'CONFLICT', `${reasonCode}:${workspacePath}`, {
      details: {
        reasonCode,
        field: folderMissing ? 'folderPath' : 'name',
        workspacePath,
      },
    })
    this.name = 'WorkspaceResourcePlacementError'
  }
}

export function assertUniqueWorkspaceResourcePaths(workspacePaths: readonly string[]): void {
  const seen = new Set<string>()
  for (const rawPath of workspacePaths) {
    const workspacePath = validateWorkspaceResourceFilePath(rawPath)
    if (seen.has(workspacePath)) {
      throw new WorkspaceResourcePlacementError('WORKSPACE_RESOURCE_PATH_CONFLICT', workspacePath)
    }
    seen.add(workspacePath)
  }
}

function validateRelativePath(rawPath: string): string {
  if (!isCanonicalWorkspaceResourcePath(rawPath)) {
    throw new WorkspaceResourcePathError('WORKSPACE_RESOURCE_PATH_INVALID', `Invalid resource path: ${rawPath}`)
  }
  return rawPath
}

export function validateWorkspaceResourceFilePath(rawPath: string): string {
  return validateRelativePath(rawPath)
}

export function validateWorkspaceResourceFolderPath(rawPath: string): string {
  return validateRelativePath(rawPath)
}

export function validateWorkspaceResourcePath(rawPath: string): string {
  return validateRelativePath(rawPath)
}

export function validateWorkspaceResourcePathForKind(
  rawPath: string,
  resourceKind: WorkspaceResourceKind,
): string {
  return resourceKind === 'folder'
    ? validateWorkspaceResourceFolderPath(rawPath)
    : validateWorkspaceResourceFilePath(rawPath)
}

export function requireOutputPathForMediaType(
  rawPath: string,
  mediaType: WorkspaceResourceMediaType,
): string {
  const workspacePath = validateWorkspaceResourceFilePath(rawPath)
  const extension = path.posix.extname(workspacePath).toLowerCase()
  if (mediaType === 'text' ? !TEXT_EXTENSIONS.has(extension) : TEXT_EXTENSIONS.has(extension)) {
    throw new WorkspaceResourcePathError(
      'WORKSPACE_RESOURCE_PATH_MEDIA_MISMATCH',
      `Resource path does not match ${mediaType}: ${workspacePath}`,
    )
  }
  return workspacePath
}

export function resourceNameFromPath(
  workspacePath: string,
  resourceKind: WorkspaceResourceKind = 'file',
): string {
  const normalized = validateWorkspaceResourcePathForKind(workspacePath, resourceKind)
  const name = resourceKind === 'folder'
    ? path.posix.basename(normalized).trim()
    : path.posix.parse(normalized).name.trim()
  if (!name) throw new WorkspaceResourcePathError('WORKSPACE_RESOURCE_NAME_INVALID', workspacePath)
  return name
}

function legacyResourceIdSuffix(resourceId: string): string | null {
  const suffix = resourceId.replace(/[^a-zA-Z0-9_-]/gu, '').slice(-12)
  return suffix || null
}

/**
 * Historical generated paths ended in the owning Resource ID. Strip only that
 * exact self-derived suffix at presentation boundaries; arbitrary user names remain
 * untouched and canonical identity stays in resourceId.
 */
export function workspaceResourceDisplayName(input: {
  readonly workspacePath: string
  readonly resourceId: string
  readonly resourceKind?: WorkspaceResourceKind
}): string {
  const resourceKind = input.resourceKind ?? 'file'
  const name = resourceNameFromPath(input.workspacePath, resourceKind)
  if (resourceKind === 'folder') return name
  const suffix = legacyResourceIdSuffix(input.resourceId)
  if (!suffix) return name
  const marker = `-${suffix}`
  return name.endsWith(marker) && name.length > marker.length
    ? name.slice(0, -marker.length)
    : name
}

function safeGeneratedResourceStem(rawName: string, mediaType: Exclude<WorkspaceResourceMediaType, 'text'>): string {
  const withoutExtension = rawName.replace(
    /\.(?:png|jpe?g|webp|gif|mp3|wav|ogg|m4a|aac|mp4|mov|webm|mkv)$/iu,
    '',
  )
  const normalized = withoutExtension
    .normalize('NFC')
    .trim()
    .replace(/[\u0000-\u001f\u007f/\\]+/gu, '-')
    .replace(/^\.+/u, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .slice(0, 96)
    .replace(/[. -]+$/u, '')
  const candidate = normalized || mediaType
  return isWorkspaceResourceReservedRootName(candidate) ? `media-${candidate}` : candidate
}

function safeDocumentStem(rawName: string): string {
  const withoutExtension = rawName.replace(/\.(?:md|txt|json)$/iu, '')
  const normalized = withoutExtension
    .normalize('NFC')
    .trim()
    .replace(/[\u0000-\u001f\u007f/\\]+/gu, '-')
    .replace(/^\.+/u, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .slice(0, 96)
    .replace(/[. -]+$/u, '')
  const candidate = normalized || 'document'
  return isWorkspaceResourceReservedRootName(candidate) ? `document-${candidate}` : candidate
}

export function buildGeneratedWorkspaceResourcePath(input: {
  readonly parentPath: string | null
  readonly name: string
  readonly mediaType: Exclude<WorkspaceResourceMediaType, 'text'>
  readonly alternativeIndex?: number | null
}): string {
  const parentPath = input.parentPath === null
    ? null
    : validateWorkspaceResourceFolderPath(input.parentPath)
  const alternativeIndex = input.alternativeIndex ?? null
  if (alternativeIndex !== null && (!Number.isSafeInteger(alternativeIndex) || alternativeIndex < 0)) {
    throw new WorkspaceResourcePathError(
      'WORKSPACE_RESOURCE_ALTERNATIVE_INDEX_INVALID',
      String(alternativeIndex),
    )
  }
  const alternativeSuffix = alternativeIndex === null
    ? ''
    : `-${String(alternativeIndex + 1).padStart(2, '0')}`
  const fileName = `${safeGeneratedResourceStem(input.name, input.mediaType)}${alternativeSuffix}`
  return validateWorkspaceResourceFilePath(parentPath ? `${parentPath}/${fileName}` : fileName)
}

export function buildSavedWorkspaceDocumentPath(input: {
  readonly parentPath: string | null
  readonly name: string
  readonly contentKind: 'text' | 'structured'
}): string {
  const parentPath = input.parentPath === null ? null : validateWorkspaceResourceFolderPath(input.parentPath)
  const extension = input.contentKind === 'structured' ? '.json' : '.md'
  const fileName = `${safeDocumentStem(input.name)}${extension}`
  return requireOutputPathForMediaType(parentPath ? `${parentPath}/${fileName}` : fileName, 'text')
}

export {
  isWorkspaceResourceSubtreePath as isWorkspaceSubtreePath,
  workspaceResourceParentPath as parentWorkspacePath,
} from './contracts'

export function workspacePathAncestors(workspacePath: string): readonly string[] {
  const segments = workspacePath.split('/')
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'))
}

export function replaceWorkspacePathPrefix(candidate: string, from: string, to: string): string {
  if (!isWorkspaceResourceSubtreePath(candidate, from)) {
    throw new WorkspaceResourcePathError('WORKSPACE_RESOURCE_SUBTREE_PATH_INVALID', candidate)
  }
  return candidate === from ? to : `${to}${candidate.slice(from.length)}`
}

export function contentKindFromPath(workspacePath: string): 'text' | 'structured' {
  const extension = path.posix.extname(validateWorkspaceResourceFilePath(workspacePath)).toLowerCase()
  if (extension === '.json') return 'structured'
  return 'text'
}
