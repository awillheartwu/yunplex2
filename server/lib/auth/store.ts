import { getDb } from '../db'
import { hashPassword, hashToken, randomToken, verifyPassword } from './crypto'

export const CURRENT_SETUP_VERSION = 1
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const SESSION_COOKIE_NAME = 'yunplex2_session'

export interface AuthSession {
  id: string
  tokenHash: string
  csrfToken: string
  createdAt: string
  expiresAt: string
  revokedAt: string | null
  ipAddress: string
  userAgent: string
}

export interface CreatedSession {
  token: string
  csrfToken: string
  expiresAt: string
}

export interface SetupState {
  completed: boolean
  completedAt: string | null
  version: number
  requiredVersion: number
}

interface SessionRow {
  id: string
  token_hash: string
  csrf_token: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  ip_address: string
  user_agent: string
}

interface AdminRow {
  password_hash: string
  updated_at: string
}

export function isDevAuthDisabled(): boolean {
  return process.env.YUNPLEX2_DEV_AUTH_DISABLED === 'true' && process.env.NODE_ENV !== 'production'
}

export function hasAdminPassword(): boolean {
  const row = getDb().prepare('SELECT id FROM auth_admin WHERE id = 1').get() as { id: number } | undefined
  return Boolean(row)
}

export async function setAdminPassword(password: string): Promise<void> {
  const normalized = validatePassword(password)
  const passwordHash = await hashPassword(normalized)
  const now = new Date().toISOString()
  getDb().prepare(`
    INSERT INTO auth_admin (id, password_hash, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at
  `).run(passwordHash, now)
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const row = getDb().prepare('SELECT password_hash, updated_at FROM auth_admin WHERE id = 1').get() as AdminRow | undefined
  if (!row) return false
  return verifyPassword(password, row.password_hash)
}

export function validatePassword(password: unknown): string {
  if (typeof password !== 'string') throw new Error('密码不能为空')
  const normalized = password.trim()
  if (normalized.length < 8) throw new Error('密码至少需要 8 个字符')
  if (normalized.length > 200) throw new Error('密码过长')
  return normalized
}

export function getSetupState(): SetupState {
  const completedAt = getAppStateValue('setup_completed_at')
  const version = Number(getAppStateValue('setup_version') ?? 0)
  return {
    completed: Boolean(completedAt) && version >= CURRENT_SETUP_VERSION,
    completedAt,
    version,
    requiredVersion: CURRENT_SETUP_VERSION,
  }
}

export function markSetupComplete(): SetupState {
  const now = new Date().toISOString()
  setAppStateValue('setup_completed_at', now)
  setAppStateValue('setup_version', String(CURRENT_SETUP_VERSION))
  return getSetupState()
}

export function markSetupRequired(reason: string): SetupState {
  deleteAppStateValue('setup_completed_at')
  setAppStateValue('setup_version', '0')
  setAppStateValue('setup_required_reason', reason)
  setAppStateValue('setup_required_at', new Date().toISOString())
  return getSetupState()
}

export async function createSession(metadata: { ipAddress?: string; userAgent?: string } = {}): Promise<CreatedSession> {
  const token = randomToken(36)
  const csrfToken = randomToken(32)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString()
  getDb().prepare(`
    INSERT INTO auth_sessions (
      id, token_hash, csrf_token, created_at, expires_at, revoked_at, ip_address, user_agent
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    randomToken(18),
    hashToken(token),
    csrfToken,
    now.toISOString(),
    expiresAt,
    metadata.ipAddress ?? '',
    metadata.userAgent ?? '',
  )
  return { token, csrfToken, expiresAt }
}

export function getSessionByToken(token: string | undefined): AuthSession | null {
  if (!token) return null
  const row = getDb().prepare(`
    SELECT id, token_hash, csrf_token, created_at, expires_at, revoked_at, ip_address, user_agent
    FROM auth_sessions
    WHERE token_hash = ?
  `).get(hashToken(token)) as SessionRow | undefined
  if (!row || row.revoked_at) return null

  const now = Date.now()
  if (Date.parse(row.expires_at) <= now) {
    revokeSessionByToken(token)
    return null
  }

  return mapSession(row)
}

export function revokeSessionByToken(token: string | undefined): void {
  if (!token) return
  getDb().prepare(`
    UPDATE auth_sessions
    SET revoked_at = ?
    WHERE token_hash = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), hashToken(token))
}

export function revokeAllSessions(): void {
  getDb().prepare(`
    UPDATE auth_sessions
    SET revoked_at = ?
    WHERE revoked_at IS NULL
  `).run(new Date().toISOString())
}

export function isResetTokenAvailable(): boolean {
  const token = process.env.YUNPLEX2_ADMIN_RESET_TOKEN
  return Boolean(token && !isResetTokenConsumed(token))
}

export function isResetTokenConsumed(token: string): boolean {
  const consumedHash = getAppStateValue('consumed_admin_reset_token_hash')
  return Boolean(consumedHash && consumedHash === hashToken(token))
}

export function markResetTokenConsumed(token: string): void {
  setAppStateValue('consumed_admin_reset_token_hash', hashToken(token))
  setAppStateValue('consumed_admin_reset_token_at', new Date().toISOString())
}

function getAppStateValue(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM app_state WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

function setAppStateValue(key: string, value: string): void {
  getDb().prepare(`
    INSERT INTO app_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

function deleteAppStateValue(key: string): void {
  getDb().prepare('DELETE FROM app_state WHERE key = ?').run(key)
}

function mapSession(row: SessionRow): AuthSession {
  return {
    id: row.id,
    tokenHash: row.token_hash,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  }
}
