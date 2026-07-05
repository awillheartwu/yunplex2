import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDb, getDb, initDb } from '../../server/lib/db'
import {
  createSession,
  getSessionByToken,
  getSetupState,
  hasAdminPassword,
  isDevAuthDisabled,
  isResetTokenConsumed,
  markSetupRequired,
  markResetTokenConsumed,
  markSetupComplete,
  revokeAllSessions,
  revokeSessionByToken,
  setAdminPassword,
  verifyAdminPassword,
} from '../../server/lib/auth/store'

let dataDir = ''

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'reyunplex-auth-'))
  initDb(dataDir)
})

afterEach(() => {
  closeDb()
  rmSync(dataDir, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('auth store', () => {
  it('stores a scrypt password hash and verifies the admin password', async () => {
    expect(hasAdminPassword()).toBe(false)

    await setAdminPassword('correct horse battery staple')

    expect(hasAdminPassword()).toBe(true)
    expect(await verifyAdminPassword('correct horse battery staple')).toBe(true)
    expect(await verifyAdminPassword('wrong password')).toBe(false)

    const row = getDb().prepare('SELECT password_hash FROM auth_admin WHERE id = 1').get() as { password_hash: string }
    expect(row.password_hash).toMatch(/^scrypt\$/)
    expect(row.password_hash).not.toContain('correct horse battery staple')
  })

  it('stores only the session token hash and supports revocation', async () => {
    const session = await createSession({ ipAddress: '127.0.0.1', userAgent: 'vitest' })
    const found = getSessionByToken(session.token)

    expect(found?.csrfToken).toBe(session.csrfToken)
    const row = getDb().prepare('SELECT token_hash FROM auth_sessions WHERE id = ?').get(found?.id) as { token_hash: string }
    expect(row.token_hash).not.toBe(session.token)
    expect(row.token_hash).toHaveLength(64)

    revokeSessionByToken(session.token)
    expect(getSessionByToken(session.token)).toBeNull()
  })

  it('expires and revokes existing sessions when requested', async () => {
    const first = await createSession()
    const second = await createSession()

    revokeAllSessions()

    expect(getSessionByToken(first.token)).toBeNull()
    expect(getSessionByToken(second.token)).toBeNull()
  })

  it('tracks setup completion by setup version', () => {
    expect(getSetupState().completed).toBe(false)

    const setup = markSetupComplete()

    expect(setup.completed).toBe(true)
    expect(setup.version).toBe(setup.requiredVersion)
  })

  it('can mark setup as required again without deleting admin credentials', async () => {
    await setAdminPassword('correct horse battery staple')
    markSetupComplete()

    const setup = markSetupRequired('manual')

    expect(setup.completed).toBe(false)
    expect(setup.version).toBe(0)
    expect(hasAdminPassword()).toBe(true)
    expect(await verifyAdminPassword('correct horse battery staple')).toBe(true)
  })

  it('consumes an admin reset token only once', () => {
    expect(isResetTokenConsumed('reset-once')).toBe(false)

    markResetTokenConsumed('reset-once')

    expect(isResetTokenConsumed('reset-once')).toBe(true)
    expect(isResetTokenConsumed('other-token')).toBe(false)
  })

  it('only allows dev auth bypass outside production', () => {
    vi.stubEnv('YUNPLEX2_DEV_AUTH_DISABLED', 'true')
    vi.stubEnv('NODE_ENV', 'development')
    expect(isDevAuthDisabled()).toBe(true)

    vi.stubEnv('NODE_ENV', 'production')
    expect(isDevAuthDisabled()).toBe(false)
  })
})
