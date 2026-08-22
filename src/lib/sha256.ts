const ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const INITIAL_HASH = new Uint32Array([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19,
])

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits))
}

function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = []
  for (const character of value) {
    const rawCodePoint = character.codePointAt(0)
    const codePoint =
      rawCodePoint !== undefined &&
      rawCodePoint >= 0xd800 &&
      rawCodePoint <= 0xdfff
        ? 0xfffd
        : rawCodePoint
    if (codePoint === undefined) throw new Error('UTF8_CODE_POINT_MISSING')
    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >>> 12),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      )
    }
  }
  return Uint8Array.from(bytes)
}

function padMessage(message: Uint8Array): Uint8Array {
  const paddingBytes = (64 - ((message.length + 9) % 64)) % 64
  const padded = new Uint8Array(message.length + 1 + paddingBytes + 8)
  padded.set(message)
  padded[message.length] = 0x80

  const bitLengthHigh = Math.floor(message.length / 0x20000000)
  const bitLengthLow = (message.length << 3) >>> 0
  for (let index = 0; index < 4; index += 1) {
    padded[padded.length - 8 + index] =
      bitLengthHigh >>> (24 - index * 8)
    padded[padded.length - 4 + index] =
      bitLengthLow >>> (24 - index * 8)
  }
  return padded
}

function sha256Bytes(value: string): Uint8Array {
  const message = padMessage(encodeUtf8(value))
  const hash = new Uint32Array(INITIAL_HASH)
  const words = new Uint32Array(64)

  for (let offset = 0; offset < message.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const byteOffset = offset + index * 4
      words[index] =
        ((message[byteOffset] ?? 0) << 24) |
        ((message[byteOffset + 1] ?? 0) << 16) |
        ((message[byteOffset + 2] ?? 0) << 8) |
        (message[byteOffset + 3] ?? 0)
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15] ?? 0
      const previous2 = words[index - 2] ?? 0
      const sigma0 =
        rotateRight(previous15, 7) ^
        rotateRight(previous15, 18) ^
        (previous15 >>> 3)
      const sigma1 =
        rotateRight(previous2, 17) ^
        rotateRight(previous2, 19) ^
        (previous2 >>> 10)
      words[index] =
        ((words[index - 16] ?? 0) +
          sigma0 +
          (words[index - 7] ?? 0) +
          sigma1) >>>
        0
    }

    let a = hash[0] ?? 0
    let b = hash[1] ?? 0
    let c = hash[2] ?? 0
    let d = hash[3] ?? 0
    let e = hash[4] ?? 0
    let f = hash[5] ?? 0
    let g = hash[6] ?? 0
    let h = hash[7] ?? 0

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 =
        (h +
          sum1 +
          choice +
          (ROUND_CONSTANTS[index] ?? 0) +
          (words[index] ?? 0)) >>>
        0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sum0 + majority) >>> 0

      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }

    hash[0] = ((hash[0] ?? 0) + a) >>> 0
    hash[1] = ((hash[1] ?? 0) + b) >>> 0
    hash[2] = ((hash[2] ?? 0) + c) >>> 0
    hash[3] = ((hash[3] ?? 0) + d) >>> 0
    hash[4] = ((hash[4] ?? 0) + e) >>> 0
    hash[5] = ((hash[5] ?? 0) + f) >>> 0
    hash[6] = ((hash[6] ?? 0) + g) >>> 0
    hash[7] = ((hash[7] ?? 0) + h) >>> 0
  }

  const digest = new Uint8Array(32)
  for (let index = 0; index < hash.length; index += 1) {
    const word = hash[index] ?? 0
    digest[index * 4] = word >>> 24
    digest[index * 4 + 1] = word >>> 16
    digest[index * 4 + 2] = word >>> 8
    digest[index * 4 + 3] = word
  }
  return digest
}

export function sha256Base64Url(value: string): string {
  const bytes = sha256Bytes(value)
  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    encoded += BASE64URL_ALPHABET[first >>> 2]
    encoded += BASE64URL_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >>> 4)]
    if (second !== undefined) {
      encoded += BASE64URL_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >>> 6)]
    }
    if (third !== undefined) encoded += BASE64URL_ALPHABET[third & 0x3f]
  }
  return encoded
}

export function sha256Hex(value: string): string {
  return Array.from(sha256Bytes(value), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
