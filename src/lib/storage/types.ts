export interface UploadObjectParams {
  key: string
  body: Buffer
  contentType?: string
}

export interface UploadObjectResult {
  key: string
}

export interface DeleteObjectsResult {
  success: number
  failed: number
}

export interface SignedUrlParams {
  key: string
  expiresInSeconds: number
}

export interface GetObjectStreamParams {
  key: string
  range?: string | null
}

export interface ObjectMetadata {
  contentType: string | null
  contentLength: number | null
}

export interface ObjectStreamResult {
  body: ReadableStream<Uint8Array>
  contentType: string | null
  contentLength: number | null
  contentRange: string | null
  acceptRanges: string | null
  statusCode: number
}

export interface StorageProvider {
  readonly kind: 's3'
  verifyReady(): Promise<void>
  ensureBucket(): Promise<'created' | 'existing'>
  uploadObject(params: UploadObjectParams): Promise<UploadObjectResult>
  deleteObject(key: string): Promise<void>
  deleteObjects(keys: string[]): Promise<DeleteObjectsResult>
  getSignedObjectUrl(params: SignedUrlParams): Promise<string>
  getObjectBuffer(key: string): Promise<Buffer>
  getObjectMetadata(key: string): Promise<ObjectMetadata>
  getObjectStream(params: GetObjectStreamParams): Promise<ObjectStreamResult>
  extractStorageKey(input: string | null | undefined): string | null
  toFetchableUrl(inputUrl: string): string
  generateUniqueKey(params: { prefix: string; ext: string }): string
}
