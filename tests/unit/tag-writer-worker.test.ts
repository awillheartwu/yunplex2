import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SongMeta } from '../../server/lib/tag-writer'

const testRequire = createRequire(import.meta.url)

const workerMock = vi.hoisted(() => {
  let mode: 'success' | 'messageError' | 'error' | 'exit' | 'timeout' = 'success'
  const instances: any[] = []

  class FakeWorker {
    code: string
    options: { eval: boolean; workerData: unknown }
    handlers: Record<string, ((value?: any) => void) | undefined> = {}
    terminated = false

    constructor(code: string, options: { eval: boolean; workerData: unknown }) {
      this.code = code
      this.options = options
      instances.push(this)

      queueMicrotask(() => {
        if (mode === 'success') this.handlers.message?.({ ok: true })
        if (mode === 'messageError') this.handlers.message?.({ ok: false, error: 'bad flac' })
        if (mode === 'error') this.handlers.error?.(new Error('worker crashed'))
        if (mode === 'exit') this.handlers.exit?.(2)
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
    setMode(next: typeof mode) { mode = next },
    reset() {
      mode = 'success'
      instances.length = 0
    },
    instances,
  }
})

vi.mock('node:worker_threads', () => ({
  Worker: workerMock.FakeWorker,
}))

function makeMeta(overrides: Partial<SongMeta> = {}): SongMeta {
  return {
    title: 'Test Song',
    albumArtist: 'Test Artist',
    trackArtist: '',
    album: 'Test Album',
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
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
  workerMock.reset()
  vi.resetModules()
})

describe('writeFlacTags', () => {
  it('offloads FLAC writes to an inline eval worker thread', async () => {
    const { writeFlacTags } = await import('../../server/lib/tag-writer')

    await writeFlacTags('/tmp/song.flac', makeMeta({ trackArtist: 'Singer' }), Buffer.from('cover'))

    expect(workerMock.instances).toHaveLength(1)
    const worker = workerMock.instances[0]
    expect(worker.options.eval).toBe(true)
    expect(worker.options.workerData).toMatchObject({
      modulePath: testRequire.resolve('metaflac-js'),
      filePath: '/tmp/song.flac',
      tagMap: expect.objectContaining({
        TITLE: 'Test Song',
        ARTIST: 'Singer',
      }),
    })
  })

  it('surfaces worker-side FLAC failures', async () => {
    workerMock.setMode('messageError')
    const { writeFlacTags } = await import('../../server/lib/tag-writer')

    await expect(
      writeFlacTags('/tmp/song.flac', makeMeta(), null),
    ).rejects.toThrow('bad flac')
  })

  it('times out and terminates a stuck worker', async () => {
    vi.useFakeTimers()
    workerMock.setMode('timeout')
    const { writeFlacTags } = await import('../../server/lib/tag-writer')

    const promise = writeFlacTags('/tmp/song.flac', makeMeta(), null)
    const rejection = expect(promise).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(120000)

    await rejection
    expect(workerMock.instances[0]?.terminated).toBe(true)
  })
})

describe('writeMp3Tags', () => {
  it('offloads MP3 writes to an inline eval worker', async () => {
    const { writeMp3Tags } = await import('../../server/lib/tag-writer')

    await writeMp3Tags('/tmp/song.mp3', makeMeta({ trackArtist: 'Singer' }), Buffer.from('cover'))

    expect(workerMock.instances).toHaveLength(1)
    const worker = workerMock.instances[0]
    expect(worker.options.eval).toBe(true)
    expect(worker.options.workerData).toMatchObject({
      modulePath: testRequire.resolve('node-id3'),
      filePath: '/tmp/song.mp3',
    })
    // The tags object should contain the metadata and an image struct
    const wd = worker.options.workerData as Record<string, unknown>
    const tags = wd.tags as Record<string, unknown>
    expect(tags.title).toBe('Test Song')
    expect(tags.artist).toBe('Singer')
    expect(tags.image).toBeDefined()
    // imageBuffer is passed separately so the worker can reconstruct Buffer
    expect(wd.imageBuffer).toBeInstanceOf(Buffer)
  })

  it('handles MP3 tag writing without cover image', async () => {
    const { writeMp3Tags } = await import('../../server/lib/tag-writer')

    await writeMp3Tags('/tmp/song.mp3', makeMeta(), null)

    const wd = workerMock.instances[0].options.workerData as Record<string, unknown>
    const tags = wd.tags as Record<string, unknown>
    expect(tags.image).toBeUndefined()
    expect(wd.imageBuffer).toBeNull()
  })

  it('surfaces worker-side MP3 failures', async () => {
    workerMock.setMode('messageError')
    const { writeMp3Tags } = await import('../../server/lib/tag-writer')

    await expect(
      writeMp3Tags('/tmp/song.mp3', makeMeta(), null),
    ).rejects.toThrow('bad flac')
  })

  it('times out and terminates a stuck MP3 worker', async () => {
    vi.useFakeTimers()
    workerMock.setMode('timeout')
    const { writeMp3Tags } = await import('../../server/lib/tag-writer')

    const promise = writeMp3Tags('/tmp/song.mp3', makeMeta(), null)
    const rejection = expect(promise).rejects.toThrow('超时')
    await vi.advanceTimersByTimeAsync(120000)

    await rejection
    expect(workerMock.instances[0]?.terminated).toBe(true)
  })
})
