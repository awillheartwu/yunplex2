import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { downloadSong, isTagWriteError, withTagWriteSlot, writeFlacTags, writeMp3Tags, type SongMeta } from '~~/server/lib/tag-writer'

const workerMock = vi.hoisted(() => {
  type Mode = 'success' | 'messageError' | 'hang'
  const instances: Array<{
    code: string
    options: { eval: boolean; workerData: unknown }
    handlers: Record<string, ((value?: any) => void) | undefined>
    terminated: boolean
  }> = []
  let modes: Mode[] = []

  class FakeWorker {
    code: string
    options: { eval: boolean; workerData: unknown }
    handlers: Record<string, ((value?: any) => void) | undefined> = {}
    terminated = false

    constructor(code: string, options: { eval: boolean; workerData: unknown }) {
      this.code = code
      this.options = options
      instances.push(this)
      const mode = modes.shift() ?? 'success'
      queueMicrotask(() => {
        if (mode === 'success') this.handlers.message?.({ ok: true })
        if (mode === 'messageError') this.handlers.message?.({ ok: false, error: 'mock tag failure' })
      })
    }

    once(event: string, handler: (value?: any) => void) {
      this.handlers[event] = handler
      return this
    }

    terminate() {
      this.terminated = true
      return Promise.resolve(1)
    }
  }

  return {
    FakeWorker,
    instances,
    setModes(next: Mode[]) {
      modes = [...next]
    },
    reset() {
      instances.length = 0
      modes = []
    },
  }
})

vi.mock('node:worker_threads', () => ({ Worker: workerMock.FakeWorker }))

const tempDirs: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
  workerMock.reset()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yunplex-retag-'))
  tempDirs.push(dir)
  return dir
}

const meta: SongMeta = {
  title: 'Test song',
  albumArtist: 'Test artist',
  trackArtist: 'Test artist',
  album: 'Test album',
  trackNumber: 1,
  publishTime: 0,
  picUrl: '',
  duration: 0,
  discNumber: '1',
  totalDiscs: 1,
  totalTracks: 0,
  genre: '',
  releaseDate: '',
  albumDescription: '',
  recordLabel: '',
  releaseType: '',
  artistImgUrl: '',
}

const embedOnly = {
  writeLyrics: false,
  embedMetadata: true,
  embedCover: false,
  saveAlbumCover: false,
  saveArtistImage: false,
}

function stubAudioFetch(payload: Buffer): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array(payload), {
    status: 200,
    headers: { 'content-length': String(payload.length) },
  })))
}

async function settle<T>(promise: Promise<T>): Promise<T | Error> {
  return promise.catch((error: unknown) => error as Error)
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('downloadSong re-tag staging', () => {
  it('keeps queued tagging alive while waiting more than the queue stall limit', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const dir = tempDir()
    writeFileSync(join(dir, 'song.flac'), 'fLaC original audio')
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const busy = withTagWriteSlot(undefined, () => blocked)
    const progress = vi.fn()
    const result = settle(downloadSong(undefined, meta, 'flac', dir, embedOnly, 'song.flac', progress))
    try {
      await waitFor(() => readdirSync(dir).some(name => name.includes('.part-')))
      await vi.advanceTimersByTimeAsync(6 * 60_000)
      expect(workerMock.instances).toHaveLength(0)
      expect(progress.mock.calls.filter(call => call[1] === 'tagging').length).toBeGreaterThan(100)
    } finally { release(); await busy; vi.useRealTimers() }
    expect(await result).toMatchObject({ ops: { tags: 'ok' } })
  })

  it('skips oversized auxiliary images without buffering them or losing audio', async () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'song.flac'), 'fLaC original audio')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oversized image', { headers: { 'content-length': String(9 * 1024 * 1024) } })))
    const result = await downloadSong(undefined, meta, 'flac', dir, { ...embedOnly, embedCover: true }, 'song.flac')
    expect(result).toMatchObject({ ops: { tags: 'ok', cover: 'failed' } })
    expect(readdirSync(dir).some(name => name.includes('.part-'))).toBe(false)
  })

  it('preserves the original file and removes stage files when re-tagging fails', async () => {
    workerMock.setModes(['messageError'])
    const dir = tempDir()
    const filePath = join(dir, 'song.flac')
    const original = Buffer.from('fLaC original audio bytes')
    writeFileSync(filePath, original)

    const error = await settle(downloadSong(undefined, meta, 'flac', dir, embedOnly, 'song.flac'))

    expect(isTagWriteError(error)).toBe(true)
    expect((error as Error).message).toContain('mock tag failure')
    expect(readFileSync(filePath)).toEqual(original)
    expect(readdirSync(dir)).toEqual(['song.flac'])
  })

  it('publishes the tagged stage atomically when re-tagging succeeds', async () => {
    workerMock.setModes(['success'])
    const dir = tempDir()
    const filePath = join(dir, 'song.flac')
    const original = Buffer.from('fLaC original audio bytes')
    writeFileSync(filePath, original)

    const result = await downloadSong(undefined, meta, 'flac', dir, embedOnly, 'song.flac')

    expect(result.ops.download).toBe('skipped')
    expect(result.ops.tags).toBe('ok')
    // The mock worker leaves bytes untouched, proving the file was renamed over
    // the original instead of appended in place.
    expect(readFileSync(filePath)).toEqual(original)
    expect(readdirSync(dir)).toEqual(['song.flac'])
  })

  it('keeps the published file and removes the downloaded stage when tagging a download fails', async () => {
    workerMock.setModes(['messageError'])
    const dir = tempDir()
    const filePath = join(dir, 'song.flac')
    const original = Buffer.from('fLaC original audio bytes')
    writeFileSync(filePath, original)
    stubAudioFetch(Buffer.from('fLaC freshly downloaded bytes'))

    const error = await settle(downloadSong(
      'https://example.test/song.flac', meta, 'flac', dir, embedOnly, 'song.flac',
    ))

    expect(isTagWriteError(error)).toBe(true)
    expect((error as { ops?: { download?: string; tags?: string } }).ops?.download).toBe('ok')
    expect((error as { ops?: { tags?: string } }).ops?.tags).toBe('failed')
    expect(readFileSync(filePath)).toEqual(original)
    expect(readdirSync(dir)).toEqual(['song.flac'])
  })

  it('keeps the target intact and preserves the fs error code when the atomic rename fails', async () => {
    workerMock.setModes(['success'])
    const dir = tempDir()
    const targetPath = join(dir, 'song.flac')
    mkdirSync(targetPath)
    writeFileSync(join(targetPath, 'keep.txt'), 'original')
    stubAudioFetch(Buffer.from('fLaC freshly downloaded bytes'))

    const error = await settle(downloadSong(
      'https://example.test/song.flac', meta, 'flac', dir, embedOnly, 'song.flac',
    ))

    expect(isTagWriteError(error)).toBe(false)
    expect(['EISDIR', 'ENOTEMPTY', 'EEXIST', 'ENOTDIR', 'EPERM']).toContain(
      (error as NodeJS.ErrnoException).code,
    )
    expect(readdirSync(targetPath)).toEqual(['keep.txt'])
    expect(readdirSync(dir)).toEqual(['song.flac'])
  })

  it('removes the downloaded stage when tagging is cancelled', async () => {
    workerMock.setModes(['hang'])
    const dir = tempDir()
    stubAudioFetch(Buffer.from('fLaC freshly downloaded bytes'))
    const controller = new AbortController()

    const promise = downloadSong(
      'https://example.test/song.flac', meta, 'flac', dir, embedOnly, 'song.flac',
      undefined, controller.signal,
    )
    // Wait until the download finished and the hanging tag worker holds the slot.
    await waitFor(() => workerMock.instances.length === 1)
    controller.abort()

    const error = await settle(promise)

    expect(isTagWriteError(error)).toBe(true)
    expect((error as Error).cause).toMatchObject({ name: 'AbortError' })
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('tag write concurrency gate', () => {
  it('serializes FLAC and MP3 writers globally and aborts queued writers', async () => {
    workerMock.setModes(['hang'])
    const firstAbort = new AbortController()
    const first = writeFlacTags('/tmp/serialized.flac', meta, null, firstAbort.signal)
    await new Promise((resolve) => setImmediate(resolve))
    expect(workerMock.instances).toHaveLength(1)

    const secondAbort = new AbortController()
    const second = writeMp3Tags('/tmp/serialized.mp3', meta, null, secondAbort.signal)
    secondAbort.abort()
    const secondError = await settle(second)

    expect((secondError as Error).name).toBe('AbortError')
    // The queued MP3 write never started a worker while FLAC held the slot.
    expect(workerMock.instances).toHaveLength(1)

    firstAbort.abort()
    const firstError = await settle(first)
    expect((firstError as Error).name).toBe('AbortError')
    expect(workerMock.instances[0]!.terminated).toBe(true)

    workerMock.setModes(['success'])
    await writeMp3Tags('/tmp/serialized-after.mp3', meta, null)
    expect(workerMock.instances).toHaveLength(2)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const error = await settle(writeFlacTags('/tmp/never.flac', meta, null, controller.signal))

    expect((error as Error).name).toBe('AbortError')
    expect(workerMock.instances).toHaveLength(0)
  })
})
