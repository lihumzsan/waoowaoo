import { logError as _ulogError } from '@/lib/logging/core'
/**
 * Local file service API.
 *
 * Used when STORAGE_TYPE=local. Supports ranged reads so video/audio previews
 * can load metadata and seek without forcing the whole file through memory.
 */

import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { NextRequest, NextResponse } from 'next/server'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads'

const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.json': 'application/json',
    '.txt': 'text/plain',
}

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    return MIME_TYPES[ext] || 'application/octet-stream'
}

function buildFileResponseHeaders(filePath: string, size: number): Headers {
    const headers = new Headers()
    headers.set('Content-Type', getMimeType(filePath))
    headers.set('Content-Length', String(size))
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'public, max-age=31536000, immutable')
    return headers
}

function parseRangeHeader(rangeHeader: string | null, size: number): { start: number; end: number } | null | 'invalid' {
    if (!rangeHeader) return null

    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
    if (!match) return 'invalid'

    const [, rawStart, rawEnd] = match
    if (!rawStart && !rawEnd) return 'invalid'

    let start: number
    let end: number

    if (!rawStart) {
        const suffixLength = Number.parseInt(rawEnd!, 10)
        if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid'
        start = Math.max(size - suffixLength, 0)
        end = size - 1
    } else {
        start = Number.parseInt(rawStart, 10)
        end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1
    }

    if (
        !Number.isFinite(start)
        || !Number.isFinite(end)
        || start < 0
        || end < start
        || start >= size
    ) {
        return 'invalid'
    }

    return { start, end: Math.min(end, size - 1) }
}

async function resolveSafeFilePath(pathSegments: string[]): Promise<{ filePath: string; size: number } | NextResponse> {
    const decodedPath = decodeURIComponent(pathSegments.join('/'))
    const uploadDirPath = path.resolve(process.cwd(), UPLOAD_DIR)
    const filePath = path.resolve(uploadDirPath, decodedPath)

    if (filePath !== uploadDirPath && !filePath.startsWith(uploadDirPath + path.sep)) {
        _ulogError(`[Files API] path traversal attempt: ${decodedPath}`)
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    return { filePath, size: fileStat.size }
}

function streamFile(filePath: string, options?: { start?: number; end?: number }): ReadableStream<Uint8Array> {
    const nodeStream = createReadStream(filePath, options)
    return Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>
}

async function handleFileRequest(
    request: NextRequest,
    params: Promise<{ path: string[] }>,
    method: 'GET' | 'HEAD',
) {
    try {
        const { path: pathSegments } = await params
        const resolved = await resolveSafeFilePath(pathSegments)
        if (resolved instanceof NextResponse) return resolved

        const { filePath, size } = resolved
        const headers = buildFileResponseHeaders(filePath, size)
        const range = parseRangeHeader(request.headers.get('range'), size)

        if (range === 'invalid') {
            return new Response(null, {
                status: 416,
                headers: {
                    'Content-Range': `bytes */${size}`,
                    'Accept-Ranges': 'bytes',
                },
            })
        }

        if (range) {
            const chunkSize = range.end - range.start + 1
            headers.set('Content-Length', String(chunkSize))
            headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)

            return new Response(method === 'HEAD' ? null : streamFile(filePath, range), {
                status: 206,
                headers,
            })
        }

        return new Response(method === 'HEAD' ? null : streamFile(filePath), {
            status: 200,
            headers,
        })

    } catch (error: unknown) {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined
        if (code === 'ENOENT') {
            return NextResponse.json({ error: 'File not found' }, { status: 404 })
        }

        _ulogError('[Files API] failed to read file:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> },
) {
    return handleFileRequest(request, params, 'GET')
}

export async function HEAD(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> },
) {
    return handleFileRequest(request, params, 'HEAD')
}
