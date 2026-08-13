import { createHash, timingSafeEqual } from 'node:crypto'

const PKCE_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/u

export function parsePkceChallenge(value: string | null): string {
  if (!value || !CHALLENGE_PATTERN.test(value)) throw new Error('WAO_SSO_PKCE_CHALLENGE_INVALID')
  return value
}

export function verifyPkceS256(verifier: string, expectedChallenge: string): boolean {
  if (!PKCE_PATTERN.test(verifier) || !CHALLENGE_PATTERN.test(expectedChallenge)) return false
  const actual = createHash('sha256').update(verifier, 'ascii').digest('base64url')
  return timingSafeEqual(Buffer.from(actual, 'ascii'), Buffer.from(expectedChallenge, 'ascii'))
}
