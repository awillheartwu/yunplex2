import { describe, expect, it } from 'vitest'
import { deepMerge } from '../../server/lib/config/validation'

describe('config deepMerge', () => {
  it('replaces artistAliases entirely so deletions are persisted', () => {
    const base = {
      other: {
        fontScale: 1.0,
        artistAliases: { '旧名A': '新名A', '旧名B': '新名B' },
      },
    }
    const partial = {
      other: {
        artistAliases: { '旧名A': '新名A' },
      },
    }

    const merged = deepMerge(base, partial as Partial<typeof base>)

    expect(merged.other.artistAliases).toEqual({ '旧名A': '新名A' })
    expect(merged.other.artistAliases).not.toHaveProperty('旧名B')
    expect(merged.other.fontScale).toBe(1.0)
  })

  it('keeps ordinary config sections as deep merges even when they only contain primitive values', () => {
    const base = {
      sync: {
        intervalMinutes: 30,
        downloadConcurrency: 3,
        activityRetentionDays: 30,
      },
    }
    const partial = {
      sync: {
        activityRetentionDays: 7,
      },
    }

    const merged = deepMerge(base, partial as Partial<typeof base>)

    expect(merged.sync).toEqual({
      intervalMinutes: 30,
      downloadConcurrency: 3,
      activityRetentionDays: 7,
    })
  })

  it('replaces an empty artistAliases record when user clears all mappings', () => {
    const base = {
      other: {
        artistAliases: { A: 'B', C: 'D' },
      },
    }
    const partial = {
      other: {
        artistAliases: {} as Record<string, string>,
      },
    }

    const merged = deepMerge(base, partial as Partial<typeof base>)
    expect(merged.other.artistAliases).toEqual({})
  })
})
