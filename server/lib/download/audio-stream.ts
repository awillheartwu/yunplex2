import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, rm, stat, statfs } from 'node:fs/promises'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { normalizeAudioFileType, validateAudioBuffer, validateLocalAudioFile } from '../media-validation'

/**
 * Bounded streaming downloader for one audio file.
 *
 * The response body is forwarded chunk-by-chunk to a unique staged
 * `<target>.part-<uuid>` file with backpressure (the next chunk is only read
 * after the previous write is flushed) instead of buffering the whole audio in
 * memory. The staged file is left in place for the caller to tag and rename
 * atomically; this module only cleans up after its own failures.
 *
 * Error contract for retry classification:
 * - HTTP failures carry `httpStatus` and `retryAfterMs` (when Retry-After exists).
 * - Oversized audio carries the permanent code `DOWNLOAD_TOO_LARGE`.
 * - Header/body inactivity timeouts carry `DOWNLOAD_TIMEOUT`.
 * - Filesystem errors (ENOSPC/EACCES/...) are re-thrown untouched.
 */

export const AUDIO_DOWNLOAD_HEADERS_TIMEOUT_MS = 30_000
export const AUDIO_DOWNLOAD_READ_IDLE_TIMEOUT_MS = 60_000
export const AUDIO_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024
export const AUDIO_DOWNLOAD_FREE_SPACE_RESERVE_BYTES = 64 * 1024 * 1024
export const AUDIO_DOWNLOAD_SPACE_RECHECK_BYTES = 16 * 1024 * 1024

const PROGRESS_ACTIVITY_BYTES = 1024 * 1024
const PROGRESS_ACTIVITY_INTERVAL_MS = 1000
const PREFIX_PROBE_BYTES = 16
const MIN_SPACE_RECHECK_BYTES = 1024 * 1024

export interface AudioDownloadProgress {
  receivedBytes: number
  totalBytes: number | null
  /** 0-100 when Content-Length is known, -1 when it is missing. */
  pct: number
}

export interface StagedAudioDownload {
  /** Validated audio file that the caller must tag/rename or delete. */
  partPath: string
  targetPath: string
  fileType: string
  bytes: number
  totalBytes: number | null
}

export interface DownloadAudioToFileOptions {
  url: string
  targetPath: string
  fileType: string
  signal?: AbortSignal
  onProgress?: (progress: AudioDownloadProgress) => void
  headersTimeoutMs?: number
  idleTimeoutMs?: number
  maxBytes?: number
  freeSpaceReserveBytes?: number
  spaceRecheckBytes?: number
  fetchImpl?: typeof fetch
  statfsImpl?: StatfsLike
}

export interface AudioDownloadErrorOptions {
  code: string
  httpStatus?: number
  retryAfterMs?: number
  permanent?: boolean
  cause?: unknown
}

export class AudioDownloadError extends Error {
  readonly code: string
  readonly httpStatus?: number
  readonly retryAfterMs?: number
  readonly permanent: boolean

  constructor(message: string, options: AudioDownloadErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AudioDownloadError'
    this.code = options.code
    this.httpStatus = options.httpStatus
    this.retryAfterMs = options.retryAfterMs
    this.permanent = options.permanent ?? false
  }
}

export function isAudioDownloadError(error: unknown): error is AudioDownloadError {
  return error instanceof AudioDownloadError
}

export class AudioDownloadHttpError extends AudioDownloadError {
  constructor(httpStatus: number, retryAfterMs?: number) {
    super(`下载音频失败（HTTP ${httpStatus}）`, {
      code: 'DOWNLOAD_HTTP_ERROR',
      httpStatus,
      retryAfterMs,
    })
    this.name = 'AudioDownloadHttpError'
  }
}

export class AudioDownloadTimeoutError extends AudioDownloadError {
  readonly span: 'headers' | 'body'

  constructor(span: 'headers' | 'body', timeoutMs: number, cause?: unknown) {
    super(
      span === 'headers'
        ? `音频响应头超时（>${Math.ceil(timeoutMs / 1000)} 秒）`
        : `音频下载中断超时（>${Math.ceil(timeoutMs / 1000)} 秒未收到数据）`,
      { code: 'DOWNLOAD_TIMEOUT', cause },
    )
    this.name = 'AudioDownloadTimeoutError'
    this.span = span
  }
}

export class AudioDownloadTooLargeError extends AudioDownloadError {
  readonly limitBytes: number

  constructor(limitBytes: number) {
    super(`音频文件超过大小上限（${formatBytes(limitBytes)}）`, {
      code: 'DOWNLOAD_TOO_LARGE',
      permanent: true,
    })
    this.name = 'AudioDownloadTooLargeError'
    this.limitBytes = limitBytes
  }
}

export class AudioDownloadIncompleteError extends AudioDownloadError {
  constructor(expectedBytes: number, actualBytes: number) {
    super(`下载文件长度不完整（期望 ${expectedBytes}，实际 ${actualBytes}）`, {
      code: 'DOWNLOAD_INCOMPLETE',
    })
    this.name = 'AudioDownloadIncompleteError'
  }
}

export class AudioDownloadInvalidError extends AudioDownloadError {
  constructor(reason: string) {
    super(reason || '下载的音频文件无效', { code: 'DOWNLOAD_INVALID_AUDIO' })
    this.name = 'AudioDownloadInvalidError'
  }
}

export class AudioDownloadDiskSpaceError extends AudioDownloadError {
  constructor(requiredBytes: number, availableBytes: number) {
    super(
      `下载目录可用空间不足（需要至少 ${formatBytes(requiredBytes)}，当前剩余 ${formatBytes(availableBytes)}）`,
      { code: 'ENOSPC' },
    )
    this.name = 'AudioDownloadDiskSpaceError'
  }
}

type StatfsLike = (path: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>

type AudioBodyReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>
}

const defaultStatfs: StatfsLike = (path) => statfs(path)

export async function downloadAudioToFile(
  options: DownloadAudioToFileOptions,
): Promise<StagedAudioDownload> {
  const headersTimeoutMs = options.headersTimeoutMs ?? AUDIO_DOWNLOAD_HEADERS_TIMEOUT_MS
  const idleTimeoutMs = options.idleTimeoutMs ?? AUDIO_DOWNLOAD_READ_IDLE_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? AUDIO_DOWNLOAD_MAX_BYTES
  const freeSpaceReserveBytes = options.freeSpaceReserveBytes ?? AUDIO_DOWNLOAD_FREE_SPACE_RESERVE_BYTES
  const spaceRecheckBytes = Math.max(
    MIN_SPACE_RECHECK_BYTES,
    options.spaceRecheckBytes ?? AUDIO_DOWNLOAD_SPACE_RECHECK_BYTES,
  )
  const fetchImpl = options.fetchImpl ?? fetch
  const statfsImpl = options.statfsImpl ?? defaultStatfs
  const targetDir = dirname(options.targetPath)
  const partPath = `${options.targetPath}.part-${randomUUID()}`

  let succeeded = false
  let writeStream: WriteStream | null = null
  let writeFinished = false
  let abortController: AbortController | null = null

  try {
    options.signal?.throwIfAborted()
    await mkdir(targetDir, { recursive: true })
    options.signal?.throwIfAborted()

    const { response, controller } = await fetchAudioResponse({
      url: options.url,
      signal: options.signal,
      headersTimeoutMs,
      fetchImpl,
    })
    abortController = controller

    if (!response.ok) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
      await response.body?.cancel().catch(() => undefined)
      throw new AudioDownloadHttpError(response.status, retryAfterMs)
    }

    const contentLength = parseContentLength(response.headers.get('content-length'))
    if (contentLength !== null && contentLength > maxBytes) {
      throw new AudioDownloadTooLargeError(maxBytes)
    }
    await assertFreeSpace(targetDir, contentLength ?? spaceRecheckBytes, freeSpaceReserveBytes, statfsImpl)

    if (!response.body) throw new AudioDownloadInvalidError('响应没有可下载的内容')

    writeStream = createWriteStream(partPath, { flags: 'wx' })
    // Write errors surface through the per-write callbacks; this listener keeps
    // an asynchronous 'error' event from crashing the process.
    writeStream.on('error', () => undefined)

    const received = await pumpResponseBody({
      reader: response.body.getReader(),
      writeStream,
      fileType: options.fileType,
      contentLength,
      maxBytes,
      targetDir,
      freeSpaceReserveBytes,
      spaceRecheckBytes,
      idleTimeoutMs,
      signal: options.signal,
      onProgress: options.onProgress,
      statfsImpl,
    })

    await endWriteStream(writeStream)
    writeFinished = true

    if (contentLength !== null && received !== contentLength) {
      throw new AudioDownloadIncompleteError(contentLength, received)
    }
    const written = await stat(partPath)
    if (written.size !== received) {
      throw new AudioDownloadIncompleteError(received, written.size)
    }

    const validation = validateLocalAudioFile(partPath, options.fileType)
    if (!validation.valid) {
      throw new AudioDownloadInvalidError(validation.reason ?? '下载的音频文件无效')
    }

    options.onProgress?.({
      receivedBytes: received,
      totalBytes: contentLength,
      pct: contentLength === null ? -1 : 100,
    })

    succeeded = true
    return {
      partPath,
      targetPath: options.targetPath,
      fileType: options.fileType,
      bytes: received,
      totalBytes: contentLength,
    }
  } finally {
    if (writeStream && !writeFinished && !writeStream.closed) {
      const closed = once(writeStream, 'close').catch(() => undefined)
      writeStream.destroy()
      await closed
    }
    if (!succeeded) {
      try {
        abortController?.abort()
      } catch {
        /* the transfer is already gone */
      }
      await rm(partPath, { force: true }).catch(() => undefined)
    }
  }
}

async function fetchAudioResponse(params: {
  url: string
  signal?: AbortSignal
  headersTimeoutMs: number
  fetchImpl: typeof fetch
}): Promise<{ response: Response; controller: AbortController }> {
  const controller = new AbortController()
  const combinedSignal = params.signal
    ? AbortSignal.any([params.signal, controller.signal])
    : controller.signal
  let headersTimeoutError: AudioDownloadTimeoutError | null = null
  const timer = setTimeout(() => {
    headersTimeoutError = new AudioDownloadTimeoutError('headers', params.headersTimeoutMs)
    controller.abort(headersTimeoutError)
  }, params.headersTimeoutMs)
  timer.unref?.()

  try {
    const response = await params.fetchImpl(params.url, { signal: combinedSignal })
    return { response, controller }
  } catch (error) {
    if (params.signal?.aborted) throwAbortReason(params.signal)
    if (headersTimeoutError) throw headersTimeoutError
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function pumpResponseBody(params: {
  reader: AudioBodyReader
  writeStream: WriteStream
  fileType: string
  contentLength: number | null
  maxBytes: number
  targetDir: string
  freeSpaceReserveBytes: number
  spaceRecheckBytes: number
  idleTimeoutMs: number
  signal?: AbortSignal
  onProgress?: (progress: AudioDownloadProgress) => void
  statfsImpl: StatfsLike
}): Promise<number> {
  const probe = Buffer.alloc(PREFIX_PROBE_BYTES)
  let probeLength = 0
  let prefixSettled = false
  let received = 0
  let nextSpaceCheckAt = params.spaceRecheckBytes
  let lastEmitAt = 0
  let lastEmitBytes = 0
  let emitted = false

  for (;;) {
    params.signal?.throwIfAborted()
    const read = await readWithIdleTimeout(params.reader, params.idleTimeoutMs, params.signal)
    if (read.done) break
    const chunk = read.value
    if (!chunk || chunk.byteLength === 0) continue

    received += chunk.byteLength
    if (received > params.maxBytes) throw new AudioDownloadTooLargeError(params.maxBytes)

    if (params.contentLength === null && received >= nextSpaceCheckAt) {
      await assertFreeSpace(
        params.targetDir,
        params.spaceRecheckBytes,
        params.freeSpaceReserveBytes,
        params.statfsImpl,
      )
      nextSpaceCheckAt = received + params.spaceRecheckBytes
    }

    if (!prefixSettled && probeLength < PREFIX_PROBE_BYTES) {
      const copyLength = Math.min(PREFIX_PROBE_BYTES - probeLength, chunk.byteLength)
      probe.set(chunk.subarray(0, copyLength), probeLength)
      probeLength += copyLength
      const verdict = evaluateAudioPrefix(probe.subarray(0, probeLength), params.fileType)
      if (verdict.done) {
        prefixSettled = true
        if (verdict.reason) throw new AudioDownloadInvalidError(verdict.reason)
      }
    }

    const emitDue = !emitted
      || received - lastEmitBytes >= PROGRESS_ACTIVITY_BYTES
      || Date.now() - lastEmitAt >= PROGRESS_ACTIVITY_INTERVAL_MS
    if (emitDue) {
      emitted = true
      lastEmitAt = Date.now()
      lastEmitBytes = received
      params.onProgress?.({
        receivedBytes: received,
        totalBytes: params.contentLength,
        pct: params.contentLength === null
          ? -1
          : Math.min(100, Math.round((received / params.contentLength) * 100)),
      })
    }

    await writeChunk(params.writeStream, chunk)
  }

  return received
}

function readWithIdleTimeout(
  reader: AudioBodyReader,
  idleTimeoutMs: number,
  signal?: AbortSignal,
): Promise<{ done: boolean; value?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal?.reason) }
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const timer = setTimeout(() => {
      cleanup()
      reject(new AudioDownloadTimeoutError('body', idleTimeoutMs))
    }, idleTimeoutMs)
    timer.unref?.()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) { abort(); return }
    reader.read().then(
      (result) => {
        cleanup()
        resolve(result)
      },
      (error) => {
        cleanup()
        reject(error)
      },
    )
  })
}

function writeChunk(stream: WriteStream, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error?: Error | null) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function endWriteStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => {
      stream.removeListener('error', onError)
      stream.removeListener('finish', onFinish)
      stream.removeListener('close', onClose)
    }
    const settleOk = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const settleErr = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onError = (error: Error) => settleErr(error)
    const onFinish = () => settleOk()
    const onClose = () => settleOk()
    stream.once('error', onError)
    stream.once('finish', onFinish)
    stream.once('close', onClose)
    stream.end()
  })
}

async function assertFreeSpace(
  targetDir: string,
  needBytes: number,
  reserveBytes: number,
  statfsImpl: StatfsLike,
): Promise<void> {
  const availableBytes = await readAvailableBytes(targetDir, statfsImpl)
  if (availableBytes === null) return
  const requiredBytes = needBytes + reserveBytes
  if (availableBytes < requiredBytes) {
    throw new AudioDownloadDiskSpaceError(requiredBytes, availableBytes)
  }
}

async function readAvailableBytes(targetDir: string, statfsImpl: StatfsLike): Promise<number | null> {
  try {
    const stats = await statfsImpl(targetDir)
    const bavail = Number(stats.bavail)
    const bsize = Number(stats.bsize)
    if (!Number.isFinite(bavail) || !Number.isFinite(bsize)) return null
    return bavail * bsize
  } catch {
    // statfs is not available on every platform/filesystem; fall back to the
    // kernel ENOSPC report instead of blocking a legitimate download.
    return null
  }
}

function evaluateAudioPrefix(
  prefix: Uint8Array,
  fileType: string,
): { done: boolean; reason: string | null } {
  const type = normalizeAudioFileType(fileType)
  if (type === 'flac') {
    if (hasAsciiPrefix(prefix, 'ID3')) {
      // ID3-tagged FLAC: the full staged-file check skips the ID3 payload.
      return { done: true, reason: null }
    }
    if (prefix.length < 4) return { done: false, reason: null }
    const result = validateAudioBuffer(prefix, type)
    return { done: true, reason: result.valid ? null : result.reason ?? 'FLAC 文件头无效' }
  }
  if (prefix.length < PREFIX_PROBE_BYTES) return { done: false, reason: null }
  const result = validateAudioBuffer(prefix, type)
  return { done: true, reason: result.valid ? null : result.reason ?? '下载的音频文件无效' }
}

function hasAsciiPrefix(buffer: Uint8Array, value: string): boolean {
  if (buffer.length < value.length) return false
  for (let index = 0; index < value.length; index++) {
    if (buffer[index] !== value.charCodeAt(index)) return false
  }
  return true
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value.trim(), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1000
    return Number.isFinite(milliseconds) ? milliseconds : undefined
  }
  const at = Date.parse(trimmed)
  if (Number.isNaN(at)) return undefined
  return Math.max(0, at - Date.now())
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`
}

function throwAbortReason(signal: AbortSignal): never {
  const reason: unknown = signal.reason
  if (reason instanceof Error) throw reason
  const error = new Error(reason === undefined ? '操作已取消' : String(reason))
  error.name = 'AbortError'
  throw error
}
