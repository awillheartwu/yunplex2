import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectionTestError } from '../config/connection-test-error'
import { SETUP_CHECK_LABELS, runRequiredSetupChecks, runSetupCheck } from './checks'

const runConnectionTest = vi.hoisted(() => vi.fn())

vi.mock('../config/connection-test-runner', () => ({
  assertConnectionTestSection: (value: unknown) => value,
  runConnectionTest,
}))

beforeEach(() => {
  runConnectionTest.mockReset()
})

describe('setup check results', () => {
  it('keeps the exact finding and its domain code for the API envelope', async () => {
    runConnectionTest.mockRejectedValueOnce(new ConnectionTestError('filesystem_failed', '下载目录不可写: /music'))

    await expect(runSetupCheck('download', {})).resolves.toEqual({
      key: 'download',
      ok: false,
      message: '下载目录不可写: /music',
      code: 'filesystem_failed',
    })
  })

  it('falls back to unknown_error only for unexpected failures', async () => {
    runConnectionTest.mockRejectedValueOnce(new Error('boom'))

    await expect(runSetupCheck('plex', {})).resolves.toMatchObject({ ok: false, message: 'boom', code: 'unknown_error' })
  })

  it('returns the successful detail unchanged', async () => {
    runConnectionTest.mockResolvedValueOnce({
      section: 'netease',
      message: '网易云音乐连接正常 (Tester)',
      data: { section: 'netease', success: true },
    })

    await expect(runSetupCheck('netease', {})).resolves.toEqual({
      key: 'netease',
      ok: true,
      message: '网易云音乐连接正常 (Tester)',
      detail: { section: 'netease', success: true },
    })
  })

  it('runs the required checks in order with labels for the completion failure message', async () => {
    runConnectionTest.mockImplementation(async (key: string) => ({ section: key, message: `${key} ok`, data: { section: key } }))

    const results = await runRequiredSetupChecks({})

    expect(results.map(result => result.key)).toEqual(['netease', 'plex', 'download'])
    expect(results.every(result => result.ok)).toBe(true)
    expect(SETUP_CHECK_LABELS).toEqual({
      netease: '网易云 Cookie',
      plex: 'Plex 连接',
      download: '下载目录',
    })
  })
})
