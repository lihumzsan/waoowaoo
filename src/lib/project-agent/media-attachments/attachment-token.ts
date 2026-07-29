import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

/**
 * Signed registration receipt for one chat media attachment.
 *
 * A chat attachment deliberately has no Resource row and no ownership relation
 * in the database: the upload step only stores bytes and registers the shared,
 * content-addressed MediaObject. This token is therefore the single explicit
 * owner/scope fact of the attachment: the server signs
 * `userId + projectId + media identity` at upload time, and every consumer
 * (message acceptance, model input projection, materialization) verifies the
 * signature and the scope before touching the media. The token is issued and
 * verified only here; no second attachment ownership judge may exist.
 *
 * This module must stay loadable from both Next commands and Outbox workers,
 * so it only uses node:crypto and the shared NEXTAUTH_SECRET-derived HMAC
 * pattern already used by auth (image-captcha, phone-verification).
 */

const PROJECT_ASSISTANT_ATTACHMENT_TOKEN_PREFIX = 'pama1'
const PROJECT_ASSISTANT_ATTACHMENT_TOKEN_PURPOSE = 'project-assistant-media-attachment:v1'
export const PROJECT_ASSISTANT_ATTACHMENT_TOKEN_MAX_CHARS = 4_000

export const projectAssistantAttachmentTokenPayloadSchema = z.object({
  v: z.literal(1),
  /** MediaObject public identity — the byte-level identity of the upload. */
  publicId: z.string().min(1).max(200),
  /** Canonical domain Resource id this attachment materializes to (CR-01). */
  resourceId: z.string().min(1).max(64),
  /** Explicit owner. Must equal the authenticated user on every consumption. */
  userId: z.string().min(1).max(128),
  /** Explicit scope. Must equal the authorized project on every consumption. */
  projectId: z.string().min(1).max(128),
  mediaType: z.enum(['image', 'audio']),
  /** Original upload file name, frozen for materialization provenance. */
  fileName: z.string().min(1).max(200),
  /** Default display / Resource name derived at upload time. */
  name: z.string().min(1).max(200),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict()

export type ProjectAssistantAttachmentTokenPayload =
  z.infer<typeof projectAssistantAttachmentTokenPayloadSchema>

export type ProjectAssistantAttachmentTokenErrorCode =
  | 'ATTACHMENT_TOKEN_SECRET_UNAVAILABLE'
  | 'ATTACHMENT_TOKEN_MALFORMED'
  | 'ATTACHMENT_TOKEN_SIGNATURE_INVALID'
  | 'ATTACHMENT_TOKEN_PAYLOAD_INVALID'
  | 'ATTACHMENT_TOKEN_SCOPE_MISMATCH'

export class ProjectAssistantAttachmentTokenError extends Error {
  readonly code: ProjectAssistantAttachmentTokenErrorCode

  constructor(code: ProjectAssistantAttachmentTokenErrorCode) {
    super(`PROJECT_ASSISTANT_MEDIA_${code}`)
    this.name = 'ProjectAssistantAttachmentTokenError'
    this.code = code
  }
}

function readTokenSecret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (typeof value !== 'string' || value.length < 24) {
    throw new ProjectAssistantAttachmentTokenError('ATTACHMENT_TOKEN_SECRET_UNAVAILABLE')
  }
  return value
}

function signEncodedPayload(encodedPayload: string): string {
  return createHmac('sha256', readTokenSecret())
    .update(`${PROJECT_ASSISTANT_ATTACHMENT_TOKEN_PURPOSE}.${encodedPayload}`)
    .digest('base64url')
}

export function buildProjectAssistantAttachmentToken(
  payload: ProjectAssistantAttachmentTokenPayload,
): string {
  const parsed = projectAssistantAttachmentTokenPayloadSchema.parse(payload)
  const encodedPayload = Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url')
  return `${PROJECT_ASSISTANT_ATTACHMENT_TOKEN_PREFIX}.${encodedPayload}.${signEncodedPayload(encodedPayload)}`
}

/**
 * Verifies signature first, then payload shape, then scope. Any failure is a
 * typed error; the caller decides how to surface it (message rejection, tool
 * correction, or model-input placeholder).
 */
export function verifyProjectAssistantAttachmentToken(
  token: string,
  scope: { readonly userId: string; readonly projectId: string },
): ProjectAssistantAttachmentTokenPayload {
  const trimmed = token.trim()
  if (!trimmed || trimmed.length > PROJECT_ASSISTANT_ATTACHMENT_TOKEN_MAX_CHARS) {
    throw new ProjectAssistantAttachmentTokenError('ATTACHMENT_TOKEN_MALFORMED')
  }
  const [prefix, encodedPayload, signature, ...rest] = trimmed.split('.')
  if (
    prefix !== PROJECT_ASSISTANT_ATTACHMENT_TOKEN_PREFIX
    || !encodedPayload
    || !signature
    || rest.length > 0
  ) {
    throw new ProjectAssistantAttachmentTokenError('ATTACHMENT_TOKEN_MALFORMED')
  }
  const expected = Buffer.from(signEncodedPayload(encodedPayload), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new ProjectAssistantAttachmentTokenError('ATTACHMENT_TOKEN_SIGNATURE_INVALID')
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
  } catch {
    throw new ProjectAssistantAttachmentTokenError('ATTACHMENT_TOKEN_PAYLOAD_INVALID')
  }
  const payload = projectAssistantAttachmentTokenPayloadSchema.safeParse(decoded)
  if (!payload.success) {
    throw new ProjectAssistantAttachmentTokenError('ATTACHMENT_TOKEN_PAYLOAD_INVALID')
  }
  if (payload.data.userId !== scope.userId || payload.data.projectId !== scope.projectId) {
    throw new ProjectAssistantAttachmentTokenError('ATTACHMENT_TOKEN_SCOPE_MISMATCH')
  }
  return payload.data
}
