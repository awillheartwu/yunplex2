import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AUDIO_DOWNLOAD_MAX_BYTES,
  AudioDownloadDiskSpaceError,
  AudioDownloadHttpError,
  AudioDownloadIncompleteError,
  AudioDownloadInvalidError,
  AudioDownloadTimeoutError,
  AudioDownloadTooLargeError,
  downloadAudioToFile,
  type AudioDownloadProgress,
} from '~~/server/lib/download/audio-stream'

const tempDirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yunplex-audio-stream-'))
  tempDirs.push(dir)
  return dir
}

/** Build `totalBytes` of fake FLAC payload with a valid container header. */
function flacChunks(totalBytes: number, chunkSize = 64 * 1024): Uint8Array[] {
  const chunks: Uint8Array[] = []
  let remaining = totalBytes
  while (remaining > 0) {
    const size = Math.min(chunkSize, remaining)
    chunks.push(new Uint8Array(size))
    remaining -= size
  }
  chunks[0]!.set([0x66, 0x4c, 0x61, 0x43]) // "fLaC"
  return chunks
}

function streamResponse(chunks: Iterable<Uint8Array>, headers?: Record<string, string>): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers })
}

async function settle<T>(promise: Promise<T>): Promise<T | Error> {
  return promise.catch((error: unknown) => error as Error)
}

describe('downloadAudioToFile', () => {
  it('streams to a unique .part path and keeps reporting activity without Content-Length', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')
    const progress: AudioDownloadProgress[] = []
    const total = 3 * 1024 * 1024

    const result = await downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => streamResponse(flacChunks(total)),
      onProgress: (update) => progress.push(update),
    })

    expect(result.partPath.startsWith(`${target}.part-`)).toBe(true)
    expect(result.bytes).toBe(total)
    expect(result.totalBytes).toBeNull()
    expect(existsSync(target)).toBe(false)
    expect(readdirSync(dir)).toEqual([result.partPath.slice(dir.length + 1)])

    // Activity is reported even though the response never announced a length.
    expect(progress.length).toBeGreaterThanOrEqual(2)
    expect(progress.every((update) => update.totalBytes === null)).toBe(true)
    expect(progress.every((update) => update.pct === -1)).toBe(true)
    expect(progress.at(-1)!.receivedBytes).toBe(total)

    // Each download owns a unique stage, even for the same target.
    const second = await downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => streamResponse(flacChunks(1024)),
    })
    expect(second.partPath).not.toBe(result.partPath)
    rmSync(second.partPath, { force: true })
  })

  it('rejects a response that ends before Content-Length and removes the part file', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => streamResponse(flacChunks(1024), { 'content-length': '4096' }),
    }))

    expect(error).toBeInstanceOf(AudioDownloadIncompleteError)
    expect((error as AudioDownloadIncompleteError).code).toBe('DOWNLOAD_INCOMPLETE')
    expect((error as Error).message).toBe('下载文件长度不完整（期望 4096，实际 1024）')
    expect(readdirSync(dir)).toEqual([])
  })

  it('rejects an invalid audio signature while streaming and keeps no file', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => streamResponse([new Uint8Array(1024)], { 'content-length': '1024' }),
    }))

    expect(error).toBeInstanceOf(AudioDownloadInvalidError)
    expect((error as AudioDownloadInvalidError).code).toBe('DOWNLOAD_INVALID_AUDIO')
    expect((error as Error).message).toBe('FLAC 文件头无效')
    expect(readdirSync(dir)).toEqual([])
  })

  it('aborts mid-stream and cleans up the part file', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.mp3')
    const controller = new AbortController()
    let sent = 0
    const fetchImpl = async () => new Response(new ReadableStream<Uint8Array>({
      pull(streamController) {
        if (sent >= 3) {
          streamController.close()
          return
        }
        sent++
        const chunk = new Uint8Array(64 * 1024)
        chunk.set([0x49, 0x44, 0x33]) // "ID3"
        streamController.enqueue(chunk)
        if (sent === 1) queueMicrotask(() => controller.abort())
      },
    }), { status: 200 })

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/song.mp3',
      targetPath: target,
      fileType: 'mp3',
      signal: controller.signal,
      fetchImpl: fetchImpl as typeof fetch,
    }))

    expect((error as Error).name).toBe('AbortError')
    expect(readdirSync(dir)).toEqual([])
  })

  it('never materializes audio-sized buffers through Buffer.concat', async () => {
    const dir = tempDir()
    const target = join(dir, 'big.flac')
    const total = 12 * 1024 * 1024
    const concatSpy = vi.spyOn(Buffer, 'concat')

    const result = await downloadAudioToFile({
      url: 'https://example.test/big.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => streamResponse(flacChunks(total)),
    })
    expect(result.bytes).toBe(total)
    const concatBytes = concatSpy.mock.calls.reduce((sum, [list]) => {
      const entries = Array.isArray(list) ? list : [list]
      return sum + entries.reduce((entrySum: number, entry) => entrySum + (entry?.byteLength ?? 0), 0)
    }, 0)

    // A whole-file buffer would have concatenated at least the 12 MiB payload.
    expect(concatBytes).toBeLessThan(1024 * 1024)
  })

  it('enforces the conservative 1 GiB cap before reading a declared oversize body', async () => {
    expect(AUDIO_DOWNLOAD_MAX_BYTES).toBe(1024 * 1024 * 1024)
    const dir = tempDir()
    const target = join(dir, 'huge.flac')
    // Erroring on the first pull proves the body is never read: a reader would
    // surface this error instead of the size guard.
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('oversize body must not be read')
      },
    })

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/huge.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => new Response(body, {
        status: 200,
        headers: { 'content-length': String(AUDIO_DOWNLOAD_MAX_BYTES + 1) },
      }),
    }))

    expect(error).toBeInstanceOf(AudioDownloadTooLargeError)
    expect((error as AudioDownloadTooLargeError).code).toBe('DOWNLOAD_TOO_LARGE')
    expect((error as AudioDownloadTooLargeError).permanent).toBe(true)
    expect(readdirSync(dir)).toEqual([])
  })

  it('enforces the byte cap while streaming when Content-Length is missing', async () => {
    const dir = tempDir()
    const target = join(dir, 'huge.flac')

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/huge.flac',
      targetPath: target,
      fileType: 'flac',
      maxBytes: 1024 * 1024,
      fetchImpl: async () => streamResponse(flacChunks(4 * 1024 * 1024)),
    }))

    expect(error).toBeInstanceOf(AudioDownloadTooLargeError)
    expect((error as AudioDownloadTooLargeError).limitBytes).toBe(1024 * 1024)
    expect(readdirSync(dir)).toEqual([])
  })

  it('fails fast when statfs reports less than the 64 MiB reserve', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => streamResponse([], { 'content-length': String(16 * 1024 * 1024) }),
      statfsImpl: async () => ({ bavail: 8, bsize: 1024 * 1024 }),
    }))

    expect(error).toBeInstanceOf(AudioDownloadDiskSpaceError)
    expect((error as AudioDownloadDiskSpaceError).code).toBe('ENOSPC')
    expect((error as Error).message).toContain('空间不足')
    expect(readdirSync(dir)).toEqual([])
  })

  it('re-checks disk space periodically for unknown-length downloads', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')
    let statfsCalls = 0

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      spaceRecheckBytes: 1024 * 1024,
      fetchImpl: async () => streamResponse(flacChunks(3 * 1024 * 1024)),
      statfsImpl: async () => {
        statfsCalls++
        return statfsCalls === 1
          ? { bavail: 4096, bsize: 1024 * 1024 }
          : { bavail: 0, bsize: 1024 * 1024 }
      },
    }))

    expect(statfsCalls).toBeGreaterThanOrEqual(2)
    expect(error).toBeInstanceOf(AudioDownloadDiskSpaceError)
    expect(readdirSync(dir)).toEqual([])
  })

  it('continues when statfs is unsupported on the target filesystem', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')

    const result = await downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => streamResponse(flacChunks(1024)),
      statfsImpl: async () => {
        throw new Error('statfs unsupported')
      },
    })

    expect(result.bytes).toBe(1024)
    expect(existsSync(result.partPath)).toBe(true)
  })

  it('reports HTTP status and Retry-After for retry decisions', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')

    const rateLimited = await settle(downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '120' },
      }),
    }))
    expect(rateLimited).toBeInstanceOf(AudioDownloadHttpError)
    expect((rateLimited as AudioDownloadHttpError).httpStatus).toBe(429)
    expect((rateLimited as AudioDownloadHttpError).retryAfterMs).toBe(120_000)
    expect((rateLimited as Error).message).toContain('HTTP 429')

    const unavailable = await settle(downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      fetchImpl: async () => new Response('down', {
        status: 503,
        headers: { 'retry-after': new Date(Date.now() + 60_000).toUTCString() },
      }),
    }))
    expect(unavailable).toBeInstanceOf(AudioDownloadHttpError)
    expect((unavailable as AudioDownloadHttpError).httpStatus).toBe(503)
    expect((unavailable as AudioDownloadHttpError).retryAfterMs).toBeGreaterThan(0)
    expect((unavailable as AudioDownloadHttpError).retryAfterMs).toBeLessThanOrEqual(60_000)

    expect(readdirSync(dir)).toEqual([])
  })

  it('times out waiting for response headers', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')
    const fetchImpl = (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
    })

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      headersTimeoutMs: 40,
      fetchImpl: fetchImpl as typeof fetch,
    }))

    expect(error).toBeInstanceOf(AudioDownloadTimeoutError)
    expect((error as AudioDownloadTimeoutError).span).toBe('headers')
    expect((error as AudioDownloadTimeoutError).code).toBe('DOWNLOAD_TIMEOUT')
    expect(readdirSync(dir)).toEqual([])
  })

  it('times out when no bytes arrive and cleans up', async () => {
    const dir = tempDir()
    const target = join(dir, 'song.flac')
    const chunks = flacChunks(256 * 1024)
    const pending = [...chunks]
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = pending.shift()
        if (next) {
          controller.enqueue(next)
          return
        }
        return new Promise(() => undefined)
      },
    })

    const error = await settle(downloadAudioToFile({
      url: 'https://example.test/song.flac',
      targetPath: target,
      fileType: 'flac',
      idleTimeoutMs: 40,
      fetchImpl: async () => new Response(body, { status: 200 }),
    }))

    expect(error).toBeInstanceOf(AudioDownloadTimeoutError)
    expect((error as AudioDownloadTimeoutError).span).toBe('body')
    expect(readdirSync(dir)).toEqual([])
  })

})
