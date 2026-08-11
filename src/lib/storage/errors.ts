export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorageConfigError'
  }
}

export class StorageObjectSizeExceededError extends Error {
  readonly maxBytes: number

  constructor(maxBytes: number) {
    super(`Storage object exceeds ${String(maxBytes)} bytes`)
    this.name = 'StorageObjectSizeExceededError'
    this.maxBytes = maxBytes
  }
}
