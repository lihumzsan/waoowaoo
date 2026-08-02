import type { WorkspaceCanvasCreateKind } from '../contracts/workspace-canvas-interactions'

const RESERVED_ROOT_NAMES = new Set(['system', '.wao'])

function safeStem(rawName: string, fallback: string): string {
  const withoutExtension = rawName.replace(/\.[^./\\]+$/u, '')
  const normalized = withoutExtension
    .normalize('NFC')
    .trim()
    .replace(/[\u0000-\u001f\u007f/\\]+/gu, '-')
    .replace(/^\.+/u, '')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .slice(0, 96)
    .replace(/[. -]+$/u, '')
  const candidate = normalized || fallback
  return RESERVED_ROOT_NAMES.has(candidate) ? `resource-${candidate}` : candidate
}

function joinDirectory(directoryPath: string, fileName: string): string {
  return directoryPath ? `${directoryPath}/${fileName}` : fileName
}

export function buildCanvasCreationOutputPath(input: {
  readonly directoryPath: string
  readonly name: string
  readonly kind: WorkspaceCanvasCreateKind
  readonly uniqueSuffix: string
}): string {
  const stem = safeStem(input.name, input.kind)
  return joinDirectory(
    input.directoryPath,
    `${stem}-${input.uniqueSuffix}.resource`,
  )
}

export function buildCanvasUploadOutputPath(input: {
  readonly directoryPath: string
  readonly fileName: string
  readonly uniqueSuffix: string
}): string {
  const stem = safeStem(input.fileName, 'upload')
  return joinDirectory(
    input.directoryPath,
    `${stem}-${input.uniqueSuffix}.resource`,
  )
}
