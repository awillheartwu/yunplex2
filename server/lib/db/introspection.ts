import type Database from 'better-sqlite3'

export function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(tableName) as { name: string } | undefined
  return Boolean(row)
}

export function isIdempotentSchemaError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /(?:duplicate column name|already exists)/i.test(error.message)
    || /^no such table: jobs$/i.test(error.message)
}
