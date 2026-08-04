import type { WorkspaceCanvasCreateRequest } from '../contracts/workspace-canvas-interactions'

/** Builds only the operation's public input; ratio/model defaults stay server-owned. */
export function buildWorkspaceCanvasCreateOperationInput(
  request: WorkspaceCanvasCreateRequest,
  outputPath: string,
): Readonly<Record<string, unknown>> {
  if (request.capability.mediaKind === 'voice') {
    return {
      request: {
        kind: request.capability.requestKind,
        description: request.prompt,
        previewText: request.voicePreviewText,
        language: 'Auto',
        outputPath,
        count: request.count,
      },
    }
  }

  const common = {
    kind: request.capability.requestKind,
    outputPath,
    schemaId: request.capability.defaultSchemaId,
    prompt: request.prompt,
    count: request.count,
  }
  if (request.capability.mediaKind === 'video' || request.capability.mediaKind === 'music') {
    return {
      request: {
        ...common,
        durationSeconds: request.durationSeconds,
      },
    }
  }
  return { request: common }
}
