import type { WorkspaceCanvasCreateRequest } from '../contracts/workspace-canvas-interactions'

/** Builds only the operation's public input; ratio/model defaults stay server-owned. */
export function buildWorkspaceCanvasCreateOperationInput(
  request: WorkspaceCanvasCreateRequest,
  folderPath: string | null,
): Readonly<Record<string, unknown>> {
  if (request.capability.mediaKind === 'voice') {
    return {
      request: {
        kind: request.capability.requestKind,
        description: request.prompt,
        previewText: request.voicePreviewText,
        language: 'Auto',
        folderPath,
        name: request.name || 'voice',
        count: request.count,
      },
    }
  }

  const common = {
    itemId: 'canvas-primary',
    name: request.name || request.capability.mediaKind,
    folderPath,
    schemaId: request.capability.defaultSchemaId,
    prompt: request.prompt,
    count: request.count,
  }
  const item = request.capability.mediaKind === 'video'
    ? { ...common, mediaType: 'video', durationSeconds: request.durationSeconds }
    : request.capability.mediaKind === 'music'
      ? { ...common, mediaType: 'audio', durationSeconds: request.durationSeconds }
      : { ...common, mediaType: 'image', assetKind: null }
  return { request: { kind: request.capability.requestKind, items: [item] } }
}
