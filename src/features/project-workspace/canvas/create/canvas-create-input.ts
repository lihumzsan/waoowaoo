import type { WorkspaceCanvasCreateRequest } from '../contracts/workspace-canvas-interactions'

/** Builds only the operation's public input; ratio/model defaults stay server-owned. */
export function buildWorkspaceCanvasCreateOperationInput(
  request: WorkspaceCanvasCreateRequest,
  outputPath: string,
): Readonly<Record<string, unknown>> {
  const optionalName = request.name ? { name: request.name } : {}
  if (request.capability.mediaKind === 'voice') {
    return {
      request: {
        kind: request.capability.requestKind,
        description: request.prompt,
        previewText: request.voicePreviewText,
        language: 'Auto',
        outputPath,
        resource: { name: request.name },
        target: { kind: 'standalone' },
        count: request.count,
      },
    }
  }

  const common = {
    kind: request.capability.requestKind,
    outputPath,
    ...optionalName,
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
