import path from 'node:path'
import {
  WORKSPACE_RESOURCE_ROOT_FOLDER_KEY,
  isWorkspaceResourceSubtreePath,
  type WorkspaceResourceKind,
  type WorkspaceResourceMediaType,
} from './contracts'

const MAX_PATH_BYTES = 512
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json'])
const RESERVED_ROOTS = new Set(['system', '.wao'])

export class WorkspaceResourcePathError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'WorkspaceResourcePathError'
  }
}

export type WorkspaceResourcePlacementErrorCode =
  | 'WORKSPACE_RESOURCE_PARENT_FOLDER_NOT_FOUND'
  | 'WORKSPACE_RESOURCE_PATH_CONFLICT'
  | 'WORKSPACE_RESOURCE_TREE_PATH_CONFLICT'

export class WorkspaceResourcePlacementError extends Error {
  constructor(
    readonly code: WorkspaceResourcePlacementErrorCode,
    readonly workspacePath: string,
  ) {
    super(`${code}:${workspacePath}`)
    this.name = 'WorkspaceResourcePlacementError'
  }
}

function validateRelativePath(rawPath: string): string {
  if (
    rawPath === WORKSPACE_RESOURCE_ROOT_FOLDER_KEY
    || rawPath !== rawPath.trim()
    || rawPath !== rawPath.normalize('NFC')
    || rawPath.startsWith('/')
    || rawPath.endsWith('/')
    || rawPath.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(rawPath)
    || Buffer.byteLength(rawPath, 'utf8') > MAX_PATH_BYTES
  ) {
    throw new WorkspaceResourcePathError('WORKSPACE_RESOURCE_PATH_INVALID', `Invalid resource path: ${rawPath}`)
  }
  const segments = rawPath.split('/')
  if (
    segments.length === 0
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.'))
    || RESERVED_ROOTS.has(segments[0] ?? '')
    || path.posix.normalize(rawPath) !== rawPath
  ) {
    throw new WorkspaceResourcePathError(
      'WORKSPACE_RESOURCE_PATH_OUTSIDE_PROJECT',
      `Resource path must stay inside the user project tree: ${rawPath}`,
    )
  }
  return rawPath
}

export function validateWorkspaceResourceFilePath(rawPath: string): string {
  return validateRelativePath(rawPath)
}

export function validateWorkspaceResourceFolderPath(rawPath: string): string {
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
  return RESERVED_ROOTS.has(candidate) ? `media-${candidate}` : candidate
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
  return RESERVED_ROOTS.has(candidate) ? `document-${candidate}` : candidate
}

export function buildGeneratedWorkspaceResourcePath(input: {
  readonly parentPath: string | null
  readonly name: string
  readonly resourceId: string
  readonly mediaType: Exclude<WorkspaceResourceMediaType, 'text'>
}): string {
  const parentPath = input.parentPath === null
    ? null
    : validateWorkspaceResourceFolderPath(input.parentPath)
  const resourceSuffix = input.resourceId.replace(/[^a-zA-Z0-9_-]/gu, '').slice(-12)
  if (!resourceSuffix) throw new WorkspaceResourcePathError('WORKSPACE_RESOURCE_ID_INVALID', input.resourceId)
  const fileName = `${safeGeneratedResourceStem(input.name, input.mediaType)}-${resourceSuffix}`
  return validateWorkspaceResourceFilePath(parentPath ? `${parentPath}/${fileName}` : fileName)
}

export function buildSavedWorkspaceDocumentPath(input: {
  readonly parentPath: string | null
  readonly name: string
  readonly resourceId: string
  readonly contentKind: 'text' | 'structured'
}): string {
  const parentPath = input.parentPath === null ? null : validateWorkspaceResourceFolderPath(input.parentPath)
  const resourceSuffix = input.resourceId.replace(/[^a-zA-Z0-9_-]/gu, '').slice(-12)
  if (!resourceSuffix) throw new WorkspaceResourcePathError('WORKSPACE_RESOURCE_ID_INVALID', input.resourceId)
  const extension = input.contentKind === 'structured' ? '.json' : '.md'
  const fileName = `${safeDocumentStem(input.name)}-${resourceSuffix}${extension}`
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
