import { scrypt as scryptCallback, timingSafeEqual, randomBytes, createHash } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const PASSWORD_KEY_LENGTH = 64

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomToken(16)
  const key = await scrypt(password, salt, PASSWORD_KEY_LENGTH)
  return `scrypt$${salt}$${Buffer.from(key as Buffer).toString('hex')}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [algorithm, salt, expectedHex] = storedHash.split('$')
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false

  const actual = await scrypt(password, salt, PASSWORD_KEY_LENGTH)
  const expected = Buffer.from(expectedHex, 'hex')
  const actualBuffer = Buffer.from(actual as Buffer)
  if (actualBuffer.length !== expected.length) return false
  return timingSafeEqual(actualBuffer, expected)
}

export function safeTokenEqual(candidate: string, expected: string): boolean {
  const candidateHash = Buffer.from(hashToken(candidate), 'hex')
  const expectedHash = Buffer.from(hashToken(expected), 'hex')
  return candidateHash.length === expectedHash.length && timingSafeEqual(candidateHash, expectedHash)
}
