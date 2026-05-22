import { executeAiVisionStep } from '@/lib/ai-runtime/client'

export type PanelImageGenerationPacket = {
  panelId: string
  sourceText: string | null
  description: string | null
  imagePrompt: string | null
  shotType: string | null
  cameraMove: string | null
  location: string | null
  characters: Array<{
    name: string
    appearance?: string | null
    slot?: string | null
  }>
  allowedActions: string[]
  forbiddenContent: string[]
  aspectRatio: string
  requestedModelKey: string
  resolvedModelKey: string
  modelRoutingReason: string | null
  references: Array<{
    index: number
    url: string
  }>
}

export type PanelImageAuditResult = {
  ok: boolean
  code: string | null
  message: string | null
  issues: string[]
  checks: {
    aspectRatio: {
      expected: string
      actual: string | null
      relativeError: number | null
      passed: boolean
    }
    content?: {
      passed: boolean
      rawText: string
    }
  }
}

type GeneratedImageMetadata = {
  width?: number | null
  height?: number | null
  mimeType?: string | null
  sizeBytes?: number | null
}

function parseAspectRatio(value: string): number | null {
  const match = /^(\d+)\s*:\s*(\d+)$/.exec(value.trim())
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return width / height
}

function formatActualRatio(width: number | null | undefined, height: number | null | undefined): string | null {
  if (!width || !height || width <= 0 || height <= 0) return null
  return `${width}:${height}`
}

function buildFailure(
  code: string,
  message: string,
  expectedAspectRatio: string,
  actualAspectRatio: string | null,
  relativeError: number | null,
  issues: string[],
  rawText?: string,
): PanelImageAuditResult {
  return {
    ok: false,
    code,
    message,
    issues,
    checks: {
      aspectRatio: {
        expected: expectedAspectRatio,
        actual: actualAspectRatio,
        relativeError,
        passed: false,
      },
      ...(rawText !== undefined
        ? {
            content: {
              passed: false,
              rawText,
            },
          }
        : {}),
    },
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function readIssueList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
}

function buildVisionAuditPrompt(packet: PanelImageGenerationPacket): string {
  return [
    'You are a strict QA reviewer for a short-video storyboard image.',
    'Compare the image against the packet. Return only JSON with this shape:',
    '{"passes": boolean, "issues": string[], "notes": string}',
    'Fail if the image has the wrong number of people, wrong named character identity, wrong scene, wrong action, unrelated romance/extra people, or content outside the current panel.',
    'Panel packet:',
    JSON.stringify(packet, null, 2).slice(0, 12000),
  ].join('\n')
}

export async function auditGeneratedPanelImage(params: {
  userId: string
  projectId: string
  imageUrl: string
  expectedAspectRatio: string
  metadata: GeneratedImageMetadata
  packet: PanelImageGenerationPacket
  visionModel?: string | null
  aspectRatioTolerance?: number
}): Promise<PanelImageAuditResult> {
  const width = params.metadata.width ?? null
  const height = params.metadata.height ?? null
  const expectedRatio = parseAspectRatio(params.expectedAspectRatio)
  const actualRatio = width && height && height > 0 ? width / height : null
  const actualAspectRatio = formatActualRatio(width, height)
  const tolerance = params.aspectRatioTolerance ?? 0.02

  if (!expectedRatio || !actualRatio) {
    return buildFailure(
      'PANEL_IMAGE_AUDIT_DIMENSIONS_MISSING',
      'Generated image dimensions are unavailable for aspect-ratio audit',
      params.expectedAspectRatio,
      actualAspectRatio,
      null,
      ['missing image dimensions'],
    )
  }

  const relativeError = Math.abs(actualRatio - expectedRatio) / expectedRatio
  if (relativeError > tolerance) {
    return buildFailure(
      'PANEL_IMAGE_AUDIT_ASPECT_RATIO_MISMATCH',
      `Generated image aspect ratio differs from ${params.expectedAspectRatio}`,
      params.expectedAspectRatio,
      actualAspectRatio,
      relativeError,
      ['aspect ratio mismatch'],
    )
  }

  const visionModel = params.visionModel?.trim()
  if (!visionModel) {
    return {
      ok: false,
      code: 'PANEL_IMAGE_AUDIT_VISION_MODEL_MISSING',
      message: 'Vision audit model is not configured',
      issues: ['vision audit model missing'],
      checks: {
        aspectRatio: {
          expected: params.expectedAspectRatio,
          actual: actualAspectRatio,
          relativeError,
          passed: true,
        },
      },
    }
  }

  let response: Awaited<ReturnType<typeof executeAiVisionStep>>
  try {
    response = await executeAiVisionStep({
      userId: params.userId,
      projectId: params.projectId,
      model: visionModel,
      action: 'panel_image_audit',
      prompt: buildVisionAuditPrompt(params.packet),
      imageUrls: [params.imageUrl],
      temperature: 0,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Vision audit failed'
    return {
      ok: false,
      code: 'PANEL_IMAGE_AUDIT_VISION_RUNTIME_FAILED',
      message: `Vision audit failed: ${message}`,
      issues: ['vision audit runtime failed'],
      checks: {
        aspectRatio: {
          expected: params.expectedAspectRatio,
          actual: actualAspectRatio,
          relativeError,
          passed: true,
        },
        content: {
          passed: false,
          rawText: message,
        },
      },
    }
  }
  const rawText = response.text || ''
  const parsed = extractJsonObject(rawText)
  const passes = parsed?.passes === true
  const issues = readIssueList(parsed?.issues)

  if (!passes || issues.length > 0) {
    return {
      ok: false,
      code: 'PANEL_IMAGE_AUDIT_CONTENT_MISMATCH',
      message: 'Generated image does not match the current panel packet',
      issues: issues.length > 0 ? issues : ['vision audit failed'],
      checks: {
        aspectRatio: {
          expected: params.expectedAspectRatio,
          actual: actualAspectRatio,
          relativeError,
          passed: true,
        },
        content: {
          passed: false,
          rawText,
        },
      },
    }
  }

  return {
    ok: true,
    code: null,
    message: null,
    issues: [],
    checks: {
      aspectRatio: {
        expected: params.expectedAspectRatio,
        actual: actualAspectRatio,
        relativeError,
        passed: true,
      },
      content: {
        passed: true,
        rawText,
      },
    },
  }
}
