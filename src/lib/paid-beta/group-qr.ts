import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { OFFICIAL_CONTENT_DIR_ENV } from '@/lib/public-site/official-content'

const PAID_BETA_GROUP_QR_FILE = 'paid-beta-group-qr.png'

function resolveOfficialContentDirectory(): string {
  const configured = process.env[OFFICIAL_CONTENT_DIR_ENV]?.trim()
  if (!configured) {
    throw new Error(`${OFFICIAL_CONTENT_DIR_ENV}_REQUIRED_FOR_PAID_BETA_GROUP_QR`)
  }
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured)
}

export async function readPaidBetaGroupQr(): Promise<ArrayBuffer> {
  const bytes = await readFile(path.join(resolveOfficialContentDirectory(), PAID_BETA_GROUP_QR_FILE))
  const body = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(body).set(bytes)
  return body
}
