import { beforeEach, expect, it, vi } from 'vitest'
const login = vi.hoisted(() => vi.fn())
vi.mock('NeteaseCloudMusicApi', () => ({ default: { login_status: login } }))
import { checkCookie } from '../../server/lib/netease'
beforeEach(() => login.mockReset())
it('requires an authenticated profile, not only a successful account endpoint response', async () => {
  login.mockResolvedValueOnce({ body: { data: { code: 200, profile: null } } })
  expect(await checkCookie('expired')).toEqual({ valid: false })
  login.mockResolvedValueOnce({ body: { data: { code: 200, profile: { userId: 1, nickname: 'Test' } } } })
  expect((await checkCookie('valid')).valid).toBe(true)
})
it('separates upstream failures from authentication rejection', async () => {
  login.mockRejectedValueOnce(new Error('network timeout'))
  expect(await checkCookie('test')).toEqual({ valid: false, networkError: true })
  login.mockRejectedValueOnce({ status: 301 })
  expect(await checkCookie('test')).toEqual({ valid: false })
})
