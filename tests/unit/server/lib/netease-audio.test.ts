import { beforeEach, describe, expect, it, vi } from 'vitest'

const audio = vi.hoisted(() => vi.fn())
vi.mock('@neteasecloudmusicapienhanced/api', () => ({ default: { song_url_v1: audio } }))
vi.mock('~~/server/lib/download/netease-request', () => ({
  controlledNeteaseRequest: (action: () => Promise<unknown>) => action(),
}))

beforeEach(() => { audio.mockReset() })

describe('Netease full audio eligibility', () => {
  it.each([
    [{ url: null, type: 'flac', code: 404 }, 'SONG_URL_UNAVAILABLE'],
    [{ url: 'https://fixture.invalid/trial.mp3', type: 'mp3', freeTrialInfo: { start: 0, end: 30 } }, 'SONG_URL_UNAVAILABLE'],
    [{ url: 'https://fixture.invalid/audio.ape', type: 'ape' }, 'DOWNLOAD_FORMAT_UNSUPPORTED'],
  ])('rejects unavailable, trial or unsupported audio before any file download', async (response, code) => {
    audio.mockResolvedValue({ body: { data: [response] } })
    const { getSongUrl } = await import('~~/server/lib/netease')
    await expect(getSongUrl(42, 'hires', 'fixture-cookie')).rejects.toMatchObject({ code })
  })

  it('accepts full FLAC and uses one supported quality fallback for an unsupported response', async () => {
    audio.mockResolvedValueOnce({ body: { data: [{ url: 'https://fixture.invalid/audio.ape', type: 'ape' }] } })
      .mockResolvedValueOnce({ body: { data: [{ url: 'https://fixture.invalid/audio.flac', type: 'FLAC', freeTrialInfo: 'null' }] } })
    const { getSongUrl } = await import('~~/server/lib/netease')
    await expect(getSongUrl(42, 'jymaster', 'fixture-cookie')).resolves.toEqual({ url: 'https://fixture.invalid/audio.flac', type: 'flac' })
    expect(audio.mock.calls.map(([request]) => request.level)).toEqual(['jymaster', 'jyeffect'])
  })
})
