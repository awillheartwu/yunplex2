import { describe, expect, it } from 'vitest'
import { isIdempotentSchemaError } from './introspection'

describe('schema error classification', () => {
  it('allows only known historical idempotency failures', () => {
    expect(isIdempotentSchemaError(new Error('duplicate column name: run_id'))).toBe(true)
    expect(isIdempotentSchemaError(new Error('table task_runs already exists'))).toBe(true)
    expect(isIdempotentSchemaError(new Error('no such table: jobs'))).toBe(true)
  })

  it('does not hide unexpected migration failures', () => {
    expect(isIdempotentSchemaError(new Error('no such table: playlist_sources'))).toBe(false)
    expect(isIdempotentSchemaError(new ReferenceError('tableExists is not defined'))).toBe(false)
    expect(isIdempotentSchemaError('duplicate column name')).toBe(false)
  })
})
