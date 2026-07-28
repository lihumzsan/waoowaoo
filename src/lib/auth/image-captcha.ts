import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { PHONE_AUTH_RESULT_CODES } from '@/lib/auth/phone-auth-contract'
import { redis } from '@/lib/redis'

const CAPTCHA_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
const CAPTCHA_LENGTH = 4
const CAPTCHA_TTL_SECONDS = 2 * 60

const CONSUME_CAPTCHA_SCRIPT = `
local expectedHash = redis.call('GET', KEYS[1])
if not expectedHash then
  return 0
end
redis.call('DEL', KEYS[1])
if expectedHash == ARGV[1] then
  return 1
end
return -1
`

type ImageCaptchaErrorCode =
  | typeof PHONE_AUTH_RESULT_CODES.humanVerificationInvalid
  | typeof PHONE_AUTH_RESULT_CODES.humanVerificationUnavailable

export class ImageCaptchaError extends Error {
  readonly code: ImageCaptchaErrorCode

  constructor(code: ImageCaptchaErrorCode) {
    super(code)
    this.name = 'ImageCaptchaError'
    this.code = code
  }
}

export interface IssuedImageCaptcha {
  captchaId: string
  imageDataUrl: string
  expiresInSeconds: number
}

function readHashSecret(): string {
  const value = process.env.NEXTAUTH_SECRET
  if (typeof value !== 'string' || value.length < 24) {
    throw new ImageCaptchaError(PHONE_AUTH_RESULT_CODES.humanVerificationUnavailable)
  }
  return value
}

function digest(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function captchaRedisKey(secret: string, captchaId: string): string {
  return `auth:phone:image-captcha:${digest(secret, `captcha:${captchaId}`)}`
}

function normalizeCaptchaAnswer(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toUpperCase()
  return /^[2-9A-HJ-NP-Z]{4}$/.test(normalized) ? normalized : null
}

function generateCaptchaAnswer(): string {
  return Array.from(
    { length: CAPTCHA_LENGTH },
    () => CAPTCHA_ALPHABET[randomInt(0, CAPTCHA_ALPHABET.length)],
  ).join('')
}

function renderCaptchaSvg(answer: string): string {
  const textNodes = Array.from(answer).map((character, index) => {
    const x = 22 + index * 29 + randomInt(-2, 3)
    const y = 34 + randomInt(-3, 4)
    const rotation = randomInt(-16, 17)
    const color = ['#0f172a', '#1e3a8a', '#334155', '#155e75'][randomInt(0, 4)]
    return `<text x="${x}" y="${y}" fill="${color}" font-family="ui-monospace,monospace" font-size="25" font-weight="700" transform="rotate(${rotation} ${x} ${y})">${character}</text>`
  }).join('')

  const noiseLines = Array.from({ length: 5 }, () => {
    const x1 = randomInt(0, 141)
    const y1 = randomInt(4, 45)
    const x2 = randomInt(0, 141)
    const y2 = randomInt(4, 45)
    const color = ['#94a3b8', '#60a5fa', '#a78bfa'][randomInt(0, 3)]
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="1.2" opacity="0.65"/>`
  }).join('')

  const noiseDots = Array.from({ length: 18 }, () => {
    const cx = randomInt(3, 138)
    const cy = randomInt(3, 46)
    const radius = randomInt(1, 3)
    return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#64748b" opacity="0.35"/>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="48" viewBox="0 0 140 48"><rect width="140" height="48" rx="10" fill="#f8fafc"/>${noiseLines}${noiseDots}${textNodes}</svg>`
}

export async function issueImageCaptcha(clientIdentity: string): Promise<IssuedImageCaptcha> {
  const secret = readHashSecret()
  const captchaId = randomUUID()
  const answer = generateCaptchaAnswer()
  const key = captchaRedisKey(secret, captchaId)
  const answerHash = digest(secret, `answer:${captchaId}:${clientIdentity}:${answer}`)

  try {
    await redis.set(key, answerHash, 'EX', CAPTCHA_TTL_SECONDS)
  } catch {
    throw new ImageCaptchaError(PHONE_AUTH_RESULT_CODES.humanVerificationUnavailable)
  }

  const svg = renderCaptchaSvg(answer)
  return {
    captchaId,
    imageDataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`,
    expiresInSeconds: CAPTCHA_TTL_SECONDS,
  }
}

export async function consumeImageCaptcha(input: {
  captchaId: unknown
  answer: unknown
  clientIdentity: string
}): Promise<void> {
  if (
    typeof input.captchaId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.captchaId)
  ) {
    throw new ImageCaptchaError(PHONE_AUTH_RESULT_CODES.humanVerificationInvalid)
  }
  const answer = normalizeCaptchaAnswer(input.answer)
  if (!answer) {
    throw new ImageCaptchaError(PHONE_AUTH_RESULT_CODES.humanVerificationInvalid)
  }

  const secret = readHashSecret()
  const key = captchaRedisKey(secret, input.captchaId)
  const answerHash = digest(
    secret,
    `answer:${input.captchaId}:${input.clientIdentity}:${answer}`,
  )

  let result: unknown
  try {
    result = await redis.eval(CONSUME_CAPTCHA_SCRIPT, 1, key, answerHash)
  } catch {
    throw new ImageCaptchaError(PHONE_AUTH_RESULT_CODES.humanVerificationUnavailable)
  }

  if (Number(result) !== 1) {
    throw new ImageCaptchaError(PHONE_AUTH_RESULT_CODES.humanVerificationInvalid)
  }
}
