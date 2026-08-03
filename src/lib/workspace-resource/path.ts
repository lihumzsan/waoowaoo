import path from 'node:path'
import {
  WORKSPACE_RESOURCE_ROOT_FOLDER_KEY,
  isWorkspaceResourceSubtreePath,
  type WorkspaceResourceKind,
  type WorkspaceResourceMediaType,
} from './contracts'

const MAX_PATH_BYTES = 512
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json'])
const MEDIA_POINTER_EXTENSION = '.resource'
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
  const workspacePath = validateRelativePath(rawPath)
  const extension = path.posix.extname(workspacePath).toLowerCase()
  if (!TEXT_EXTENSIONS.has(extension) && extension !== MEDIA_POINTER_EXTENSION) {
    throw new WorkspaceResourcePathError(
      'WORKSPACE_RESOURCE_PATH_EXTENSION_INVALID',
      `Unsupported resource path extension: ${workspacePath}`,
    )
  }
  return workspacePath
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
  if (mediaType === 'text' ? !TEXT_EXTENSIONS.has(extension) : extension !== MEDIA_POINTER_EXTENSION) {
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

export function contentKindFromPath(workspacePath: string): 'text' | 'structured' | 'pointer' {
  const extension = path.posix.extname(validateWorkspaceResourceFilePath(workspacePath)).toLowerCase()
  if (extension === '.json') return 'structured'
  if (extension === MEDIA_POINTER_EXTENSION) return 'pointer'
  return 'text'
}

export function mediaTypeFromPath(workspacePath: string): WorkspaceResourceMediaType {
  const kind = contentKindFromPath(workspacePath)
  if (kind !== 'pointer') return 'text'
  throw new WorkspaceResourcePathError(
    'WORKSPACE_RESOURCE_POINTER_MEDIA_TYPE_REQUIRED',
    `A new media pointer must be created by a Wao capability: ${workspacePath}`,
  )
}
